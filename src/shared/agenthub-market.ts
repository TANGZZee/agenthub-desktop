import type {
  LocalizedText,
  WorkerCatalogCategory,
  WorkerPermissionToken,
} from "./agenthub";

/**
 * Parsing for the AgentHub market catalog.
 *
 * The catalog arrives from the network (and later from a cache file on disk),
 * so it is **untrusted**. Everything here is display-only: it can describe an
 * agent, and it can never make one runnable, change a runner, or introduce an
 * executable path. Whether an agent can be connected is decided locally in
 * src/main/agenthub/profiles.ts.
 *
 * Parsing is deliberately strict — an entry that does not fully validate is
 * dropped rather than coerced, and there is no `runner` field at all (the
 * authoring validator rejects it, and this parser ignores any it finds).
 */

/** A validated catalog entry, ready to merge into the worker catalog. */
export interface MarketEntryDraft {
  id: string;
  rank: number;
  name: string;
  vendor: string;
  category: WorkerCatalogCategory;
  role: LocalizedText;
  description: LocalizedText;
  docsUrl: string;
  /** Shown for the user to copy and run themselves — never executed. */
  installHint: string;
  binaries: { win: string[]; unix: string[] };
  permissions: WorkerPermissionToken[];
}

export interface MarketCatalogParseResult {
  entries: MarketEntryDraft[];
  /** Entries present in the document but dropped by validation. */
  rejected: number;
}

export const MARKET_LIMITS = {
  entries: 300,
  idLength: 64,
  nameLength: 80,
  vendorLength: 80,
  roleLength: 60,
  descriptionLength: 400,
  hintLength: 200,
  urlLength: 300,
  binariesPerPlatform: 6,
  binaryLength: 64,
  permissionsPerEntry: 8,
} as const;

export const MARKET_CATALOG_VERSION = 1;

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
// An executable name to probe on PATH: a bare file name, never a path and never
// anything a shell would reinterpret.
const BINARY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const CATEGORIES: readonly WorkerCatalogCategory[] = [
  "official",
  "open-source",
  "vendor-cli",
  "china-ecosystem",
];

const PERMISSIONS: readonly WorkerPermissionToken[] = [
  "read",
  "grep",
  "find",
  "ls",
  "project-root",
  "read-only-sandbox",
  "no-write",
  "planned",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Trim to a bounded, single-line printable string.
 *
 * Control characters and newlines are removed because `installHint` is meant to
 * be **pasted into a terminal**: a value carrying embedded newlines could turn
 * one copied line into several commands.
 */
function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const stripped = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim();
  if (!stripped) return null;
  const collapsed = stripped.replace(/\s{2,}/g, " ");
  return collapsed.length > maxLength
    ? collapsed.slice(0, maxLength).trim()
    : collapsed;
}

function cleanLocalized(
  value: unknown,
  maxLength: number,
): LocalizedText | null {
  if (!isRecord(value)) return null;
  const zh = cleanText(value.zh, maxLength);
  const en = cleanText(value.en, maxLength);
  if (!zh || !en) return null;
  return { zh, en };
}

function cleanId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  if (!id || id.length > MARKET_LIMITS.idLength) return null;
  return ID_PATTERN.test(id) ? id : null;
}

/** Only `https:` — a catalog entry must never point a user at plaintext. */
function cleanDocsUrl(value: unknown): string | null {
  const text = cleanText(value, MARKET_LIMITS.urlLength);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function cleanBinaries(value: unknown, key: "win" | "unix"): string[] {
  if (!isRecord(value)) return [];
  const raw = value[key];
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const name = item.trim();
    if (!name || name.length > MARKET_LIMITS.binaryLength) continue;
    if (!BINARY_PATTERN.test(name)) continue;
    if (!out.includes(name)) out.push(name);
    if (out.length >= MARKET_LIMITS.binariesPerPlatform) break;
  }
  return out;
}

function cleanPermissions(value: unknown): WorkerPermissionToken[] {
  if (!Array.isArray(value)) return [];
  const out: WorkerPermissionToken[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const token = item.trim() as WorkerPermissionToken;
    if (!PERMISSIONS.includes(token)) continue;
    if (!out.includes(token)) out.push(token);
    if (out.length >= MARKET_LIMITS.permissionsPerEntry) break;
  }
  return out;
}

function parseEntry(value: unknown): MarketEntryDraft | null {
  if (!isRecord(value)) return null;

  const id = cleanId(value.id);
  const name = cleanText(value.name, MARKET_LIMITS.nameLength);
  const vendor = cleanText(value.vendor, MARKET_LIMITS.vendorLength);
  const role = cleanLocalized(value.role, MARKET_LIMITS.roleLength);
  const description = cleanLocalized(
    value.description,
    MARKET_LIMITS.descriptionLength,
  );
  const docsUrl = cleanDocsUrl(value.docsUrl);
  const installHint = cleanText(value.installHint, MARKET_LIMITS.hintLength);
  const category =
    typeof value.category === "string" &&
    CATEGORIES.includes(value.category as WorkerCatalogCategory)
      ? (value.category as WorkerCatalogCategory)
      : null;

  // Everything a card needs to be useful and honest. A missing one drops the
  // entry rather than rendering a half-empty card.
  if (
    !id ||
    !name ||
    !vendor ||
    !role ||
    !description ||
    !docsUrl ||
    !installHint ||
    !category
  ) {
    return null;
  }

  const binaries = {
    win: cleanBinaries(value.binaries, "win"),
    unix: cleanBinaries(value.binaries, "unix"),
  };
  // Without at least one probeable name the entry could never be detected as
  // installed, so it would be permanently un-connectable — drop it.
  if (binaries.win.length === 0 && binaries.unix.length === 0) return null;

  const rank =
    typeof value.rank === "number" && Number.isFinite(value.rank)
      ? Math.max(1, Math.trunc(value.rank))
      : Number.MAX_SAFE_INTEGER;

  return {
    id,
    rank,
    name,
    vendor,
    category,
    role,
    description,
    docsUrl,
    installHint,
    binaries,
    permissions: cleanPermissions(value.permissions),
  };
}

/**
 * Validate a remote catalog document.
 *
 * Returns `null` when the document is structurally unusable (so the caller keeps
 * whatever it already had) and otherwise the surviving entries plus how many
 * were dropped, so the UI can say "3 entries were skipped" instead of silently
 * showing a shorter list.
 *
 * Ordering is by rank then name, so a remote document cannot reorder the list
 * arbitrarily.
 */
export function parseMarketCatalog(
  raw: unknown,
): MarketCatalogParseResult | null {
  if (!isRecord(raw)) return null;
  const version = raw.version;
  if (typeof version !== "number" || !Number.isFinite(version)) return null;
  if (version > MARKET_CATALOG_VERSION) return null;
  if (!Array.isArray(raw.agents)) return null;

  const byId = new Map<string, MarketEntryDraft>();
  let rejected = 0;
  for (const item of raw.agents) {
    const entry = parseEntry(item);
    if (!entry) {
      rejected += 1;
      continue;
    }
    // First occurrence wins, so a later duplicate cannot shadow a vetted id.
    if (byId.has(entry.id)) {
      rejected += 1;
      continue;
    }
    byId.set(entry.id, entry);
    if (byId.size >= MARKET_LIMITS.entries) break;
  }

  if (byId.size === 0) return null;

  const entries = [...byId.values()].sort(
    (a, b) => a.rank - b.rank || a.name.localeCompare(b.name),
  );
  return { entries, rejected };
}
