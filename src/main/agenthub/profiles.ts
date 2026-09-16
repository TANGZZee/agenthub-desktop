import { execFileSync, spawn } from "child_process";
import { existsSync, readdirSync } from "fs";
import { delimiter, join } from "path";
import {
  WORKER_MODEL_PLACEHOLDER,
  type WorkerProfile,
} from "../../shared/agenthub";
import { echoWorkerCommand } from "./runner";
import {
  provisionPiConfig,
  provisionedModelId,
  removeProvisionedConfig,
} from "./pi-provisioning";

const WINDOWS_SHIM = /\.(cmd|bat)$/i;

/**
 * The only agents this build can actually RUN.
 *
 * A catalog entry describes an agent; it can never make one runnable. Whether a
 * CLI may be dispatched is decided here, against a runner whose read-only
 * argument set was reviewed and verified on a real machine — currently just Pi.
 *
 * Everything else in the catalog stays "listed only", however the catalog
 * describes it.
 */
export const REVIEWED_RUNNER_IDS: readonly string[] = ["pi"];

/**
 * Reviewed runners that accept a model argument, so the UI can offer the model
 * picker for them. Also local: a catalog entry cannot claim this capability.
 */
export const REVIEWED_MODEL_CAPABLE_RUNNER_IDS: readonly string[] = ["pi"];

/** Providers Pi can authenticate against, checked by the readiness probe. */
export const PI_CREDENTIAL_PROVIDERS = [
  "google",
  "anthropic",
  "openai",
  "openrouter",
] as const;

/**
 * Shown when Pi is installed but no readiness probe passes. Without this gate a
 * Pi run hangs with no output at all, because `pi -p` never reports that it has
 * no model to answer with.
 *
 * The wording covers both failure modes, because they look identical from here
 * but need different fixes: the CLI may have no credential for any configured
 * provider, *or* it may have working credentials while the selected model is
 * one it does not know (the picker offers the Hermes model library, whose ids
 * are not Pi's model names). Naming both stops the message from sending someone
 * to re-authenticate when the real fix is to pick a different model.
 */
export const PI_CREDENTIAL_HINT =
  "Pi 现在跑不起来：要么没有可用的模型凭据，要么选中的模型 Pi 不认识。" +
  "请在终端运行 `pi --list-models` 查看可用模型（例如 Jy/glm-5.3-flash），" +
  "再用 `pi auth check --model <模型名>` 确认它有凭据，然后在上面改成同一个名字。" +
  "Pi cannot run yet: either it has no usable model credential, or the selected model is not one Pi knows. " +
  "Run `pi --list-models` in a terminal to see valid names (e.g. Jy/glm-5.3-flash), " +
  "confirm one with `pi auth check --model <name>`, then set that same name above.";

/**
 * CLI discovery is cached because the Workers page polls the catalog every few
 * seconds, and each uncached probe spawns `where.exe`/`which` plus a version
 * process per hit. The cache also keeps a first paint from costing dozens of
 * child processes.
 */
const CLI_PROBE_TTL_MS = 30_000;

interface PathProbeCacheEntry {
  at: number;
  found: Map<string, string>;
  probed: Set<string>;
}

interface VersionCacheEntry {
  at: number;
  version: string | null;
}

let pathProbeCache: PathProbeCacheEntry | null = null;
const versionCache = new Map<string, VersionCacheEntry>();

/** Drop cached CLI discovery results, e.g. right after a catalog change. */
export function clearCliProbeCache(): void {
  pathProbeCache = null;
  versionCache.clear();
}

function findOnPath(command: string): string | null {
  const lookup = process.platform === "win32" ? "where.exe" : "which";
  try {
    const output = execFileSync(lookup, [command], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    return output || null;
  } catch {
    return null;
  }
}

/**
 * Resolve Pi's executable path.
 *
 * Reads the probe **cache** only, so it never spawns anything: this runs inside
 * `createPiWorkerProfile`, which is called while building the catalog and must
 * stay instant. The well-known install locations below are checked directly, so
 * a Pi that is present is found even on a cold cache; the cache fills on the
 * next async catalog probe and refines the answer.
 */
export function resolvePiCommand(): string | null {
  const name = process.platform === "win32" ? "pi.cmd" : "pi";
  const fromCache = pathProbeCache?.found.get(name);
  if (fromCache) return fromCache;

  const candidates = [
    join(
      process.env.USERPROFILE || process.env.HOME || "",
      "AppData",
      "Roaming",
      "npm",
      "pi.cmd",
    ),
    join(process.env.LOCALAPPDATA || "", "pi", "pi.cmd"),
    join(
      process.cwd(),
      "node_modules",
      ".bin",
      process.platform === "win32" ? "pi.cmd" : "pi",
    ),
  ];

  return (
    candidates.find((candidate) => candidate && existsSync(candidate)) ?? null
  );
}

/**
 * Resolve many executable names in one child process. `where.exe` (and `which`)
 * accept multiple patterns, so a whole catalog costs one lookup instead of one
 * per name. Results are cached because the Workers page polls the catalog while
 * a run is visible; an install or removal clears the cache.
 *
 * This is deliberately **asynchronous**. The synchronous form blocked the
 * main-process event loop for the entire lookup, and on Windows `where.exe`
 * with the full name set measured ~3.4 s — long enough that Electron stopped
 * answering messages and the window showed "Not Responding". Because the cache
 * TTL is 30 s and the Workers tab polls every 2.5 s, that freeze recurred
 * roughly every half minute.
 */
export async function probeCliCommands(
  names: readonly string[],
): Promise<Map<string, string>> {
  const requested = [...new Set(names)].filter(Boolean);
  if (requested.length === 0) return new Map();

  const now = Date.now();
  if (!pathProbeCache || pathProbeCache.at + CLI_PROBE_TTL_MS <= now) {
    pathProbeCache = { at: now, probed: new Set(), found: new Map() };
  }
  const cache = pathProbeCache;
  const missing = requested.filter((name) => !cache.probed.has(name));

  if (missing.length > 0) {
    for (const name of missing) {
      const hit = findExecutableOnPath(name);
      if (hit) cache.found.set(name, hit);
      cache.probed.add(name);
    }
  }

  const result = new Map<string, string>();
  for (const name of requested) {
    const hit = cache.found.get(name);
    if (hit) result.set(name, hit);
  }
  return result;
}

/**
 * Resolve on a zero exit with stdout; reject on a spawn error or timeout.
 *
 * A **non-zero exit still resolves** when the child produced output. `where.exe`
 * and `which` exit non-zero when any requested name is missing while still
 * printing the ones they found, so rejecting on the status would discard real
 * hits — the catalog then reported no CLIs detected on a machine that had them.
 * Callers that need to distinguish statuses check the returned text.
 */
function runCaptured(
  command: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });

    let stdout = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      // Guard against a runaway child; these probes emit a few lines.
      if (stdout.length < 4 * 1024 * 1024) stdout += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Status intentionally ignored — see the docstring.
      resolve(stdout);
    });
  });
}

/**
 * Locate one executable name on `PATH` by inspecting the filesystem directly.
 *
 * This replaces a `where.exe`/`which` subprocess. That lookup measured ~3.4 s
 * for the full name set on this machine, and inside Electron it hit its 10 s
 * timeout outright, so every catalog probe both stalled for seconds and came
 * back empty — the app reported no CLIs detected even with several installed.
 *
 * Walking `PATH` costs filesystem stats instead of a spawned process: it is
 * sub-millisecond, immune to whatever odd entries (`UNC` shares, WSL mounts)
 * slow `where.exe` down, and has partial-success semantics for free — each name
 * is decided on its own, where `where.exe` exits non-zero as soon as *one* name
 * is missing and its output was previously discarded as a failure.
 *
 * Windows names without an extension are completed with `PATHEXT`, matching how
 * `where.exe` resolves `claude` to `claude.cmd`.
 */
function findExecutableOnPath(name: string): string | null {
  const pathValue = process.env.PATH ?? process.env.Path ?? "";
  const dirs = pathValue.split(delimiter).filter(Boolean);
  const hasExtension = /\.[^./\\]+$/.test(name);

  const wanted = new Set([name.toLowerCase()]);
  if (process.platform === "win32" && !hasExtension) {
    const pathExt = (
      process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD;.VBS;.JS;.WSF;.WSH;.MSC"
    )
      .split(";")
      .filter(Boolean);
    for (const ext of pathExt) wanted.add((name + ext).toLowerCase());
  }

  for (const dir of dirs) {
    // One readdir per directory beats a `statSync` per (dir × name × extension)
    // combination. With ~45 PATH entries, 40 names and 9 PATHEXT values the
    // naive form issued ~16k stats and took seconds; a listing is a single
    // enumeration the whole name set can be answered from.
    const entries = listDir(dir);
    if (!entries) continue;
    for (const entry of entries) {
      if (!wanted.has(entry.name.toLowerCase())) continue;
      const full = join(dir, entry.name);
      if (entry.isFile) return full;
    }
  }
  return null;
}

/** Listing of one directory as `{ name, isFile }`, or null when unreadable. */
function listDir(dir: string): Array<{ name: string; isFile: boolean }> | null {
  try {
    return readdirSync(dir, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      isFile: entry.isFile(),
    }));
  } catch {
    // An unreadable or absent PATH entry is normal; keep scanning.
    return null;
  }
}

/**
 * Read a CLI's version, without blocking the event loop.
 *
 * A Windows `.cmd` shim cannot be executed directly (`EINVAL`), so that case
 * goes through the shell with a quoted, constant argument — no caller-supplied
 * text ever reaches it. The async form matters for the same reason as
 * `probeCliCommands`: a shim starts a whole Node runtime, measured at ~0.3–0.5 s
 * per hit, and the synchronous version froze the window for that whole time.
 */
export async function readCliVersionCached(path: string): Promise<string | null> {
  const now = Date.now();
  const cached = versionCache.get(path);
  if (cached && cached.at + CLI_PROBE_TTL_MS > now) return cached.version;

  let version: string | null = null;
  try {
    const useShell = process.platform === "win32" && WINDOWS_SHIM.test(path);
    const output = useShell
      ? await runCapturedShell(`"${path}" --version`, 5_000)
      : await runCaptured(path, ["--version"], 5_000);
    version = output.trim().split(/\r?\n/)[0]?.trim() || null;
  } catch {
    version = null;
  }
  versionCache.set(path, { at: now, version });
  return version;
}

/**
 * Shell variant of `runCaptured` for `.cmd`/`.bat` shims.
 *
 * A Windows shim cannot be spawned directly (`EINVAL`), so the command runs
 * through the shell. The argument is a constant built by the caller (never
 * caller-supplied text), so nothing untrusted reaches the shell. stdin is
 * discarded for the same reason as `runCaptured`.
 */
function runCapturedShell(command: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      windowsHide: true,
      shell: true,
      stdio: ["ignore", "pipe", "ignore"],
    });

    let stdout = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`version probe timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (stdout.length < 4 * 1024 * 1024) stdout += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Status intentionally ignored, as in `runCaptured`: a CLI may print a
      // version and still exit non-zero, and an empty stdout already
      // degrades to "unknown version" at the call site.
      resolve(stdout);
    });
  });
}

/** Probe the first executable name that exists on PATH. */
export async function detectCliCommand(
  command: string | readonly string[],
): Promise<{ path: string | null; version: string | null }> {
  const names = Array.isArray(command) ? command : [command];
  const found = await probeCliCommands(names);
  for (const name of names) {
    const path = found.get(name);
    if (path) {
      return { path, version: await readCliVersionCached(path) };
    }
  }
  return { path: null, version: null };
}

export function createEchoWorkerProfile(defaultCwd: string): WorkerProfile {
  const echo = echoWorkerCommand();
  return {
    id: "echo",
    name: "Echo (M1 loopback)",
    kind: "echo",
    installed: true,
    enabled: true,
    command: echo.command,
    args: echo.args,
    cwdRoots: [],
    defaultCwd,
    timeoutMs: 15_000,
    maxConcurrent: 1,
  };
}

/**
 * Readiness probes for Pi, most specific first.
 *
 * The chosen model is probed directly when there is one, because that is the
 * exact condition a run needs: Pi accepts `--model`, and its readiness is a
 * property of the model rather than the vendor. A user whose credentials live
 * under their own named endpoints (which is the normal case here — the model
 * picker offers the Hermes library, not Pi's built-in vendors) has no
 * `google`/`anthropic`/`openai`/`openrouter` credential at all, so probing only
 * those rejected setups that work fine.
 *
 * The built-in vendor probes remain as a fallback for the no-model case, where
 * Pi resolves a default of its own.
 */
function piReadinessProbes(model: string | null): string[][] {
  const probes: string[][] = [];
  if (model) {
    probes.push(["auth", "check", "--model", model, "--no-refresh"]);
  }
  for (const provider of PI_CREDENTIAL_PROVIDERS) {
    probes.push(["auth", "check", "--provider", provider, "--no-refresh"]);
  }
  return probes;
}

/**
 * Pi's fixed, main-process-owned Worker profile. `installed` is the user's
 * catalog choice: the profile stays unregistered until the user connects Pi on
 * the Workers page.
 */
export function createPiWorkerProfile(
  installed = false,
  model: string | null = null,
  env: NodeJS.ProcessEnv = process.env,
): WorkerProfile {
  const command = resolvePiCommand();
  const projectRoot = process.cwd();

  // Give Pi the Hermes model library in Pi's own config format, in a directory
  // of our own. Pi has no environment variable for a custom base URL, so this
  // file is the only way for a library model to be usable — and it is written
  // under `PI_CODING_AGENT_DIR` so the user's real ~/.pi/agent is untouched.
  const configDir = installed ? provisionPiConfig("pi", env) : null;
  // Pi addresses models as `provider/model`; a library model chosen by bare
  // name has to be qualified with the provider that serves it.
  const chosenModel =
    (configDir ? provisionedModelId("pi", model) : null) ?? model;

  const profileEnv: Record<string, string> = {};
  // Only override when we actually provisioned something; otherwise Pi keeps
  // using the user's own config exactly as before.
  if (configDir) profileEnv.PI_CODING_AGENT_DIR = configDir;

  return {
    id: "pi",
    name: "Pi (controlled CLI)",
    kind: "cli",
    installed,
    model: chosenModel,
    enabled: installed && Boolean(command),
    command: command ?? (process.platform === "win32" ? "pi.cmd" : "pi"),
    args: [
      "--offline",
      "--no-session",
      "--tools",
      "read,grep,find,ls",
      "--model",
      WORKER_MODEL_PLACEHOLDER,
      "-p",
    ],
    promptPlacement: "final_arg",
    cwdRoots: [projectRoot],
    defaultCwd: projectRoot,
    timeoutMs: 10 * 60 * 1000,
    maxConcurrent: 1,
    profileEnv,
    preflight: {
      probes: piReadinessProbes(chosenModel),
      hint: PI_CREDENTIAL_HINT,
    },
  };
}

export function getRegisteredWorkerProfiles(
  defaultCwd: string,
  installedIds: readonly string[] = [],
  modelFor: (id: string) => string | null = () => null,
  env: NodeJS.ProcessEnv = process.env,
): WorkerProfile[] {
  const profiles: WorkerProfile[] = [];
  if (installedIds.includes("pi")) {
    profiles.push(createPiWorkerProfile(true, modelFor("pi"), env));
  } else {
    // Disconnected: drop the generated config so a stale endpoint/key does not
    // linger on disk after the user has removed the worker.
    removeProvisionedConfig("pi");
  }

  return profiles
    .filter((profile) => profile.installed && profile.enabled)
    .map((profile) => ({
      ...profile,
      defaultCwd: profile.defaultCwd ?? defaultCwd,
    }));
}

export function describePiInstall(): {
  installed: boolean;
  command: string | null;
  pathEntries: number;
} {
  const command = resolvePiCommand();
  const pathValue = process.env.PATH || process.env.Path || "";
  return {
    installed: Boolean(command),
    command,
    pathEntries: pathValue.split(delimiter).filter(Boolean).length,
  };
}

export { findOnPath };
