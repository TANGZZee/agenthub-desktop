import { spawn, type ChildProcess, type SpawnOptions } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { hiddenSubprocessOptions } from "../process-options";

export const ECHO_WORKER_SCRIPT = [
  "const prompt = process.env.AGENTHUB_WORKER_PROMPT || '';",
  "const delay = Number(process.env.AGENTHUB_WORKER_DELAY_MS || '0');",
  "const fail = process.env.AGENTHUB_WORKER_FAIL === '1';",
  "const finish = () => {",
  "  console.log('WORKER_OK:' + prompt);",
  "  process.exit(fail ? 2 : 0);",
  "};",
  "if (delay > 0) setTimeout(finish, delay);",
  "else finish();",
].join("");

const WINDOWS_SHIM = /\.(cmd|bat)$/i;

export interface SpawnSpec {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  onStdout: (chunk: string) => void;
  onStderr: (chunk: string) => void;
  onExit: (code: number | null, signal: NodeJS.Signals | null) => void;
  onError: (err: Error) => void;
}

export interface SpawnedWorker {
  pid?: number;
  writeStdin: (text: string) => boolean;
  kill: () => void;
}

export type ProcessRunner = (spec: SpawnSpec) => SpawnedWorker;

/**
 * npm installs Windows CLIs as `.cmd` batch shims. Node refuses to spawn a
 * `.cmd`/`.bat` without `shell: true` (EINVAL, from the 2024 command-injection
 * hardening), and a shell would re-parse the task prompt that AgentHub appends
 * as a final argument. So we read the shim, resolve the JavaScript entry it
 * points at, and run that entry with Node directly — the prompt never reaches a
 * command interpreter.
 *
 * Returns null when the shim does not reference a resolvable script.
 */
export function resolveWindowsShimEntry(shimPath: string): string | null {
  try {
    const content = readFileSync(shimPath, "utf8");
    const candidates = [
      ...content.matchAll(/%dp0%\s*([^"%\r\n]+?\.(?:js|cjs|mjs|exe|com))/gi),
    ]
      .map((match) =>
        resolve(dirname(shimPath), match[1].replace(/^[\\/]+/, "")),
      )
      .filter((candidate) => existsSync(candidate));
    if (candidates.length === 0) return null;
    // npm shims mention their own bundled `node.exe` before the real entry, so
    // prefer a JavaScript entry and fall back to the last existing target.
    return (
      candidates.find((candidate) => /\.(?:js|cjs|mjs)$/i.test(candidate)) ??
      candidates[candidates.length - 1]
    );
  } catch {
    return null;
  }
}

/**
 * Turn a registered worker command into an actually spawnable process. On
 * Windows a `.cmd` shim becomes `node <entry.js>`; anything that cannot be
 * resolved raises a readable error instead of failing with EINVAL deep in the
 * spawn call.
 */
export function resolveWorkerLaunch(
  command: string,
  args: string[],
): { command: string; args: string[] } {
  if (process.platform !== "win32" || !WINDOWS_SHIM.test(command)) {
    return { command, args };
  }
  const entry = resolveWindowsShimEntry(command);
  if (!entry) {
    throw new Error(
      `Cannot start '${command}' on Windows: its command shim points at a target that does not exist. The CLI install looks incomplete or damaged — reinstall it, or use a native build.`,
    );
  }
  // A shim either points at a JS entry (run it with Node) or at a native
  // executable shipped inside the package (spawn it directly).
  return /\.(?:js|cjs|mjs)$/i.test(entry)
    ? { command: process.execPath, args: [entry, ...args] }
    : { command: entry, args };
}

function baseChildEnv(): Record<string, string> {
  const env: Record<string, string> = {
    ELECTRON_RUN_AS_NODE: "1",
  };
  for (const key of [
    "PATH",
    "Path",
    "SystemRoot",
    "windir",
    "COMSPEC",
    "TMP",
    "TEMP",
  ]) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

export function createNodeProcessRunner(): ProcessRunner {
  return (spec) => {
    const launch = resolveWorkerLaunch(spec.command, spec.args);
    const spawnOptions: SpawnOptions = hiddenSubprocessOptions({
      cwd: spec.cwd,
      env: { ...baseChildEnv(), ...spec.env },
      stdio: ["pipe", "pipe", "pipe"] satisfies SpawnOptions["stdio"],
      windowsHide: true,
    });
    const child: ChildProcess = spawn(
      launch.command,
      launch.args,
      spawnOptions,
    );

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => spec.onStdout(chunk));
    child.stderr?.on("data", (chunk: string) => spec.onStderr(chunk));
    child.on("error", (err) => spec.onError(err));
    child.on("exit", (code, signal) => spec.onExit(code, signal));

    return {
      pid: child.pid,
      writeStdin: (text) => {
        if (!child.stdin || child.stdin.destroyed) return false;
        child.stdin.write(text);
        return true;
      },
      kill: () => {
        if (child.killed || child.exitCode !== null) return;
        child.kill();
      },
    };
  };
}

export function echoWorkerCommand(): { command: string; args: string[] } {
  return {
    command: process.execPath,
    args: ["-e", ECHO_WORKER_SCRIPT],
  };
}
