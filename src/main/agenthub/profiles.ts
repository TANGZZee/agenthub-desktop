import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { basename, delimiter, join } from "path";
import {
  WORKER_MODEL_PLACEHOLDER,
  type WorkerProfile,
} from "../../shared/agenthub";
import { echoWorkerCommand } from "./runner";

const WINDOWS_SHIM = /\.(cmd|bat)$/i;
const EXECUTABLE_SUFFIX = /\.(cmd|exe|bat|ps1)$/i;

/** Providers Pi can authenticate against, checked by the readiness probe. */
export const PI_CREDENTIAL_PROVIDERS = [
  "google",
  "anthropic",
  "openai",
  "openrouter",
] as const;

/**
 * Shown when Pi is installed but has no usable model credentials. Without this
 * gate a Pi run hangs with no output at all, because `pi -p` never reports that
 * it has no model to answer with.
 */
export const PI_CREDENTIAL_HINT =
  "Pi 已安装，但还没有可用的模型凭据（google / anthropic / openai / openrouter 均未就绪），任务不会返回结果。" +
  "请先在终端完成 pi 登录或配置 API Key，再回到这里运行。 " +
  "Pi has no usable model credentials yet (google / anthropic / openai / openrouter are all not ready), " +
  "so a task would hang with no output. Sign in or configure an API key for pi in a terminal first.";

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

export function resolvePiCommand(): string | null {
  const fromPath = probeCliCommands(
    process.platform === "win32" ? ["pi.cmd"] : ["pi"],
  ).get(process.platform === "win32" ? "pi.cmd" : "pi");
  if (fromPath) return fromPath;

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
 */
export function probeCliCommands(
  names: readonly string[],
): Map<string, string> {
  const requested = [...new Set(names)].filter(Boolean);
  if (requested.length === 0) return new Map();

  const now = Date.now();
  if (!pathProbeCache || pathProbeCache.at + CLI_PROBE_TTL_MS <= now) {
    pathProbeCache = { at: now, probed: new Set(), found: new Map() };
  }
  const cache = pathProbeCache;
  const missing = requested.filter((name) => !cache.probed.has(name));

  if (missing.length > 0) {
    const lookup = process.platform === "win32" ? "where.exe" : "which";
    try {
      const output = execFileSync(lookup, missing, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        timeout: 10_000,
      });
      const lines = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      for (const name of missing) {
        const lower = name.toLowerCase();
        const stem = lower.replace(EXECUTABLE_SUFFIX, "");
        const hit = lines.find((line) => {
          const base = basename(line).toLowerCase();
          return base === lower || base.replace(EXECUTABLE_SUFFIX, "") === stem;
        });
        if (hit) cache.found.set(name, hit);
        cache.probed.add(name);
      }
    } catch {
      /* nothing on PATH — an empty result is the correct answer */
      for (const name of missing) cache.probed.add(name);
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
 * Read a CLI's version. A Windows `.cmd` shim cannot be executed with
 * `execFile` (`EINVAL`), so that case goes through the shell with a quoted,
 * constant argument — no caller-supplied text ever reaches it.
 */
export function readCliVersionCached(path: string): string | null {
  const now = Date.now();
  const cached = versionCache.get(path);
  if (cached && cached.at + CLI_PROBE_TTL_MS > now) return cached.version;

  let version: string | null = null;
  try {
    const useShell = process.platform === "win32" && WINDOWS_SHIM.test(path);
    const output = useShell
      ? execFileSync(`"${path}" --version`, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
          timeout: 5_000,
          shell: true,
        })
      : execFileSync(path, ["--version"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
          timeout: 5_000,
        });
    version = output.trim().split(/\r?\n/)[0]?.trim() || null;
  } catch {
    version = null;
  }
  versionCache.set(path, { at: now, version });
  return version;
}

/** Probe the first executable name that exists on PATH. */
export function detectCliCommand(command: string | readonly string[]): {
  path: string | null;
  version: string | null;
} {
  const names = Array.isArray(command) ? command : [command];
  const found = probeCliCommands(names);
  for (const name of names) {
    const path = found.get(name);
    if (path) return { path, version: readCliVersionCached(path) };
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
 * Pi's fixed, main-process-owned Worker profile. `installed` is the user's
 * catalog choice: the profile stays unregistered until the user connects Pi on
 * the Workers page.
 */
export function createPiWorkerProfile(
  installed = false,
  model: string | null = null,
): WorkerProfile {
  const command = resolvePiCommand();
  const projectRoot = process.cwd();
  return {
    id: "pi",
    name: "Pi (controlled CLI)",
    kind: "cli",
    installed,
    model,
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
    preflight: {
      probes: PI_CREDENTIAL_PROVIDERS.map((provider) => [
        "auth",
        "check",
        "--provider",
        provider,
        "--no-refresh",
      ]),
      hint: PI_CREDENTIAL_HINT,
    },
  };
}

export function getRegisteredWorkerProfiles(
  defaultCwd: string,
  installedIds: readonly string[] = [],
  modelFor: (id: string) => string | null = () => null,
): WorkerProfile[] {
  const profiles: WorkerProfile[] = [];
  if (installedIds.includes("pi")) {
    profiles.push(createPiWorkerProfile(true, modelFor("pi")));
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
