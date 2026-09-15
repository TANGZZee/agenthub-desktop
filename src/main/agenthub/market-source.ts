import { app } from "electron";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  parseMarketCatalog,
  type MarketEntryDraft,
} from "../../shared/agenthub-market";
import type { WorkerMarketOrigin } from "../../shared/agenthub";
import { safeWriteFile } from "../utils";
import { MARKET_ENTRIES, MARKET_UPDATED_AT } from "./market.generated";

/**
 * Where the list of candidate agents comes from.
 *
 * The catalog used to be compiled into the app, so adding an eleventh agent
 * meant a full rebuild and reinstall. It now comes from a JSON document that is
 * fetched, validated, and cached on disk — the list can grow without shipping a
 * build.
 *
 * Three sources, tried in this order:
 *
 *   1. the remote document (a successful refresh),
 *   2. the last good document cached under userData,
 *   3. the table this build shipped with (`market.generated.ts`).
 *
 * The built-in table is always the last resort, so a missing network, a bad
 * document, or a corrupt cache degrades to the list that shipped with the app
 * instead of an empty screen.
 *
 * Everything fetched is display-only. Which agents are *runnable* is decided
 * locally (see `REVIEWED_RUNNER_IDS` in profiles.ts); the remote document
 * cannot influence it.
 */

const CACHE_FILENAME = "agenthub-market.v1.json";
const CACHE_VERSION = 1;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_DOCUMENT_BYTES = 512 * 1024;

/**
 * The published catalog. It lives in the fork's own repository on the
 * development branch, so publishing a new entry is a commit — no server to run
 * and no release to cut.
 *
 * If `main` is ever moved to the current code, this URL is the single place to
 * update.
 */
export const DEFAULT_MARKET_URL =
  "https://raw.githubusercontent.com/TANGZZee/agenthub-desktop/migration/hermes-desktop-base/docs/catalog/agenthub-market.json";

export type MarketOrigin = WorkerMarketOrigin;

export interface MarketCatalogState {
  entries: MarketEntryDraft[];
  origin: MarketOrigin;
  /** Epoch ms of the last successful fetch, or null for cache/built-in. */
  fetchedAt: number | null;
  /** Entries the document carried but validation dropped. */
  rejected: number;
  /** Last refresh failure, kept so the UI can explain a stale list. */
  error: string | null;
}

/**
 * Where the fetched document is cached, or `null` when there is no userData
 * directory to write to.
 *
 * `app` is unavailable in unit tests and during the very earliest main-process
 * startup. A cache is a convenience, so losing it must never break the Worker
 * catalog — callers skip caching when this returns null.
 */
function cachePath(): string | null {
  try {
    const dir = app?.getPath("userData");
    return dir ? join(dir, CACHE_FILENAME) : null;
  } catch {
    return null;
  }
}

export function marketCatalogUrl(): string {
  const override = process.env.HERMES_AGENTHUB_MARKET_URL?.trim();
  if (!override) return DEFAULT_MARKET_URL;
  // A self-hosted mirror or a local test server has to be reachable. Plain
  // http is allowed only for a loopback address, so an override can never
  // silently downgrade a public fetch.
  try {
    const url = new URL(override);
    if (url.protocol === "https:") return url.toString();
    if (
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost")
    ) {
      return url.toString();
    }
  } catch {
    // Fall through to the default.
  }
  return DEFAULT_MARKET_URL;
}

interface CachedDocument {
  version: number;
  fetchedAt: number;
  document: unknown;
}

function readCache(
  path: string,
): { entries: MarketEntryDraft[]; fetchedAt: number } | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(
      readFileSync(path, "utf8"),
    ) as Partial<CachedDocument>;
    if (parsed.version !== CACHE_VERSION) return null;
    // Re-validated on read rather than trusted: the cache is a file on disk, so
    // it gets the same scrutiny as the network response it came from.
    const result = parseMarketCatalog(parsed.document);
    if (!result) return null;
    return {
      entries: result.entries,
      fetchedAt:
        typeof parsed.fetchedAt === "number" &&
        Number.isFinite(parsed.fetchedAt)
          ? parsed.fetchedAt
          : 0,
    };
  } catch {
    return null;
  }
}

function writeCache(path: string, document: unknown, fetchedAt: number): void {
  const payload: CachedDocument = {
    version: CACHE_VERSION,
    fetchedAt,
    document,
  };
  try {
    safeWriteFile(path, `${JSON.stringify(payload, null, 2)}\n`);
  } catch {
    // A cache we cannot write only costs a re-fetch next launch.
  }
}

let state: MarketCatalogState | null = null;

/** The shipped table, used when there is neither a fetch nor a cache. */
export function builtInCatalogState(): MarketCatalogState {
  return {
    entries: MARKET_ENTRIES.map((entry) => ({
      ...entry,
      role: { ...entry.role },
      description: { ...entry.description },
      binaries: {
        win: [...entry.binaries.win],
        unix: [...entry.binaries.unix],
      },
      permissions: [...entry.permissions],
    })),
    origin: "built-in",
    fetchedAt: null,
    rejected: 0,
    error: null,
  };
}

function initialState(): MarketCatalogState {
  const cache = cachePath();
  const cached = cache ? readCache(cache) : null;
  if (cached) {
    return {
      entries: cached.entries,
      origin: "cache",
      fetchedAt: cached.fetchedAt,
      rejected: 0,
      error: null,
    };
  }
  return builtInCatalogState();
}

/**
 * The catalog to render right now. Synchronous on purpose: the worker catalog
 * listing is synchronous, and a network round-trip in the middle of it would
 * make the Workers page block on DNS.
 */
export function getMarketCatalog(): MarketCatalogState {
  state ??= initialState();
  return state;
}

export interface RefreshOptions {
  fetchImpl?: typeof fetch;
  url?: string;
  now?: () => number;
}

/**
 * Fetch, validate, cache, and publish a fresh catalog.
 *
 * Never throws. A failure keeps the previous list and records why, because
 * showing the shipped list with "last refresh failed" is strictly better than
 * showing nothing at all.
 */
export async function refreshMarketCatalog(
  options: RefreshOptions = {},
): Promise<MarketCatalogState> {
  const doFetch = options.fetchImpl ?? fetch;
  const url = options.url ?? marketCatalogUrl();
  const now = options.now ?? Date.now;
  const previous = getMarketCatalog();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let document: unknown;
  try {
    const response = await doFetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const text = await response.text();
    if (text.length > MAX_DOCUMENT_BYTES) {
      throw new Error(`catalog too large (${text.length} bytes)`);
    }
    document = JSON.parse(text);
  } catch (err) {
    state = {
      ...previous,
      error: err instanceof Error ? err.message : String(err),
    };
    return state;
  } finally {
    clearTimeout(timer);
  }

  const parsed = parseMarketCatalog(document);
  if (!parsed) {
    state = {
      ...previous,
      error: "catalog document was rejected by validation",
    };
    return state;
  }

  const fetchedAt = now();
  const cache = cachePath();
  if (cache) writeCache(cache, document, fetchedAt);
  state = {
    entries: parsed.entries,
    origin: "remote",
    fetchedAt,
    rejected: parsed.rejected,
    error: null,
  };
  return state;
}

/** Drop the in-memory state so the next read re-derives it (tests, restarts). */
export function resetMarketCatalogCache(): void {
  state = null;
}

export { MARKET_UPDATED_AT };
