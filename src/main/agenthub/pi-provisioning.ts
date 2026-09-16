import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { app } from "electron";
import { customProviderEnvKey } from "../../shared/url-key-map";
import { normalizeModelEndpointUrl } from "../../shared/model-endpoint";
import { hostDerivedEnvKeyForUrl } from "../host-derived-env";
import { readModelsRaw } from "../models";
import { readEnv } from "../config";
import { getActiveProfileNameSync } from "../utils";

/**
 * Give a coding CLI the Hermes model library in the shape *that CLI* expects.
 *
 * A worker CLI resolves models against its own config, not against Hermes. Pi,
 * for instance, has no environment variable for a custom base URL — `baseUrl`
 * is `models.json`-only (or an extension), and its environment variables are
 * fixed per vendor (`OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, …). So "use the model
 * I picked in Hermes" cannot be done by exporting variables: an attempt to
 * point Pi at a private endpoint via `OPENAI_BASE_URL` silently reaches the real
 * OpenAI instead.
 *
 * Writing that CLI's own config file is the only thing that works, and it is
 * verified: a Pi with an empty config reports "No models available", while the
 * same binary with just a `models.json` containing one provider lists that
 * provider's models and answers a prompt.
 *
 * The generated directory is **separate** from the user's real CLI config.
 * `PI_CODING_AGENT_DIR` points the child at it, so the user's hand-written
 * `~/.pi/agent` is never read or modified, and removing the override restores
 * their own setup untouched.
 */

/** One provider entry in the shape Pi's `models.json` expects. */
interface PiProvider {
  baseUrl: string;
  api: string;
  apiKey: string;
  models: Array<{
    id: string;
    name: string;
    reasoning?: boolean;
    contextWindow?: number;
    maxTokens?: number;
    input?: string[];
  }>;
}

/** The document written into the generated directory. */
export interface PiModelsDocument {
  providers: Record<string, PiProvider>;
}

/** A key as resolved for one endpoint, or null when the endpoint has none. */
function resolveKeyForEndpoint(
  endpoint: string,
  env: NodeJS.ProcessEnv,
  profile: string | undefined,
): string | null {
  // Hermes keys live in the profile's `.env`, not necessarily in `process.env`
  // (a packaged Electron app launched from the Start Menu inherits neither the
  // shell env nor the file). Profiles also hold their own `.env`, so resolving
  // without the active profile reads the wrong file and finds nothing. The
  // runtime resolves chat keys through `readEnv(profile)` for exactly this
  // reason, so provisioning must consult the same sources in the same order.
  const envChain: NodeJS.ProcessEnv = {
    ...process.env,
    ...env,
    ...readEnv(profile ?? getActiveProfileNameSync()),
  };

  const hostKey = hostDerivedEnvKeyForUrl(endpoint);
  const fromHost = hostKey ? envChain[hostKey] : undefined;
  if (fromHost) return fromHost;

  // Per-label custom-provider key (CUSTOM_PROVIDER_<NAME>_KEY), matching the
  // runtime's own fallback order in `sendMessageViaCli`.
  for (const row of readModelsRaw()) {
    if (row.provider !== "custom") continue;
    if (normalizeModelEndpointUrl(row.baseUrl) !== endpoint) continue;
    const label = row.providerLabel || row.name;
    if (!label) continue;
    const perLabel = envChain[customProviderEnvKey(label)];
    if (perLabel) return perLabel;
  }

  return envChain.CUSTOM_API_KEY || envChain.OPENAI_API_KEY || null;
}

/** Map a Hermes `apiMode`/provider onto one of Pi's `api` values. */
function piApiFor(row: { apiMode?: string | null; provider?: string }): string {
  const mode = (row.apiMode || "").toLowerCase();
  if (mode.includes("responses")) return "openai-responses";
  if (mode.includes("anthropic") || row.provider === "anthropic") {
    return "anthropic-messages";
  }
  return "openai-completions";
}

/**
 * The API root to hand a CLI for one stored endpoint.
 *
 * Hermes stores a custom endpoint roughly as the user typed it, commonly a bare
 * origin like `https://ai.apiclub.top`, and its own engine appends `/v1` when it
 * builds a request (`hermes_cli/auxiliary_client.py`). A CLI that consumes the
 * value as an OpenAI base URL does no such thing: Pi posts to
 * `<base>/chat/completions`, so a bare origin lands on the site's HTML landing
 * page. That is a `200` with a body that is not a completion, which surfaces as
 * "stream ended without finish_reason" rather than as a clear error — measured
 * against this user's own endpoint, where `/chat/completions` returned the
 * site's HTML and `/v1/chat/completions` returned a real completion.
 *
 * Appending `/v1` when the URL carries no path matches the engine's behaviour
 * and the convention every OpenAI-compatible server follows (vLLM, LM Studio,
 * Ollama, and the gateways here all serve under `/v1`). An endpoint that
 * already states a path is left exactly as configured.
 */
function piApiBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname.replace(/\/+$/, "")) return trimmed;
    return `${trimmed}/v1`;
  } catch {
    return trimmed;
  }
}

/**
 * Build the Pi `models.json` document for every custom/OpenAI-compatible
 * endpoint in the user's Hermes library.
 *
 * Only endpoints the library actually holds are emitted, grouped by normalized
 * base URL so one endpoint becomes one Pi provider. An endpoint with no
 * resolvable key is skipped rather than written with a placeholder: Pi would
 * then list models that cannot answer, which is worse than not listing them.
 */
export function buildPiModelsDocument(
  env: NodeJS.ProcessEnv = process.env,
  profile?: string,
): PiModelsDocument {
  const groups = new Map<string, PiProvider>();
  const nameByEndpoint = new Map<string, string>();

  for (const row of readModelsRaw()) {
    // First-party endpoints (OpenAI/Anthropic proper) already work through Pi's
    // built-in vendor credentials; only private/compatible endpoints need this.
    if (!row.baseUrl) continue;
    const endpoint = normalizeModelEndpointUrl(row.baseUrl);
    if (!endpoint) continue;

    const key = resolveKeyForEndpoint(endpoint, env, profile);
    if (!key) continue;

    if (!nameByEndpoint.has(endpoint) && row.providerLabel) {
      nameByEndpoint.set(endpoint, row.providerLabel);
    }

    let provider = groups.get(endpoint);
    if (!provider) {
      provider = {
        baseUrl: piApiBaseUrl(endpoint),
        api: piApiFor(row),
        apiKey: key,
        models: [],
      };
      groups.set(endpoint, provider);
    }
    // One endpoint may serve several models; avoid duplicating an id.
    if (provider.models.some((m) => m.id === row.model)) continue;
    provider.models.push({
      id: row.model,
      name: row.name || row.model,
      input: ["text"],
    });
  }

  const providers: Record<string, PiProvider> = {};
  let index = 0;
  for (const [endpoint, provider] of groups) {
    // A stable, readable provider name: the user's own label when there is one.
    const label = nameByEndpoint.get(endpoint);
    const name = label || `hermes-${index + 1}`;
    providers[name] = provider;
    index += 1;
  }
  return { providers };
}

/**
 * Directory holding the generated config, or null when there is no userData.
 *
 * Scoped per worker id so two CLIs can be provisioned independently.
 */
export function provisionedConfigDir(workerId: string): string | null {
  try {
    const base = app?.getPath("userData");
    if (!base) return null;
    return join(base, "agenthub-cli-config", workerId);
  } catch {
    return null;
  }
}

/**
 * Write the generated config for `workerId` and return the directory to point
 * the child at, or null when there is nothing usable to provision.
 *
 * Returns null when the library has no custom endpoint with a resolvable key —
 * in that case the CLI should keep using its own config, unchanged.
 */
export function provisionPiConfig(
  workerId: string,
  env: NodeJS.ProcessEnv = process.env,
  profile?: string,
): string | null {
  const dir = provisionedConfigDir(workerId);
  if (!dir) return null;

  const document = buildPiModelsDocument(env, profile);
  if (Object.keys(document.providers).length === 0) {
    // Nothing to provision: leave the user's real config in play.
    removeProvisionedConfig(workerId);
    return null;
  }

  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "models.json"),
      JSON.stringify(document, null, 2),
      "utf-8",
    );
    return dir;
  } catch {
    return null;
  }
}

/** Delete a previously generated directory, if any. */
export function removeProvisionedConfig(workerId: string): void {
  const dir = provisionedConfigDir(workerId);
  if (!dir) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

/** Read back a generated document — used by tests and diagnostics. */
export function readProvisionedConfig(
  workerId: string,
): PiModelsDocument | null {
  const dir = provisionedConfigDir(workerId);
  if (!dir || !existsSync(join(dir, "models.json"))) return null;
  try {
    return JSON.parse(readFileSync(join(dir, "models.json"), "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Provider-qualified model id for a bare model name, or null when the model is
 * not one this worker was provisioned with.
 *
 * Pi addresses models as `provider/model`. When the user picks a library model
 * by bare name we must resolve which provisioned provider serves it, otherwise
 * Pi rejects the id as unknown.
 */
export function provisionedModelId(
  workerId: string,
  model: string | null,
): string | null {
  if (!model) return null;
  // Already qualified (or a Pi-native id) — leave it alone.
  if (model.includes("/")) return model;

  const document = readProvisionedConfig(workerId);
  if (!document) return null;
  for (const [name, provider] of Object.entries(document.providers)) {
    if (provider.models.some((m) => m.id === model)) {
      return `${name}/${model}`;
    }
  }
  return null;
}
