import { spawnSync } from "child_process";

/** The minimum a dashboard handle must offer to be shut down. */
export interface KillableDashboard {
  proc: {
    pid?: number;
    kill: () => boolean;
  };
}

/**
 * Kill a dashboard process *and its children*.
 *
 * `child.kill()` only signals the process we spawned. The Hermes CLI then runs
 * the actual server as a child of its own runtime python, so killing just the
 * supervisor orphans that server — it keeps the port and the state it loaded.
 * `taskkill /T` takes the whole tree.
 */
export function killDashboardTree(
  handle: KillableDashboard,
  platform: string = process.platform,
  // Injectable so the command shape is testable without mocking
  // `child_process` process-wide.
  run: (command: string, args: string[]) => void = (command, args) => {
    spawnSync(command, args, { stdio: "ignore", windowsHide: true });
  },
): void {
  const pid = handle.proc.pid;
  if (platform === "win32" && typeof pid === "number" && pid > 0) {
    try {
      run("taskkill", ["/F", "/T", "/PID", String(pid)]);
      return;
    } catch {
      // Fall through to the portable kill below.
    }
  }
  try {
    handle.proc.kill();
  } catch {
    // Already gone — nothing to do.
  }
}
/**
 * Empty a dashboard registry, killing every entry.
 *
 * Each entry is drained *by value* rather than by looking its key back up:
 * `profileKey(undefined)` resolves to the **active** profile name, so a registry
 * entry stored under `"default"` used to be looked up as the active profile's
 * key and silently missed. The result was a dashboard that survived every
 * "stop all dashboards" call — and, because it ran from the install's venv, an
 * engine update that could never get past `hermes update`'s pre-flight check.
 *
 * Returns the PIDs that were handed to the killer.
 */
export function drainAndKillDashboards(
  registry: Map<string, KillableDashboard>,
  kill: (handle: KillableDashboard) => void = killDashboardTree,
): number[] {
  const entries = [...registry.values()];
  registry.clear();
  const pids: number[] = [];
  for (const handle of entries) {
    if (typeof handle.proc.pid === "number" && handle.proc.pid > 0) {
      pids.push(handle.proc.pid);
    }
    kill(handle);
  }
  return pids;
}

/**
 * Wait (bounded) until none of `pids` are alive any more.
 *
 * Killing is asynchronous: the pre-flight check inside `hermes update` runs
 * seconds later, and a process that is still tearing down at that moment still
 * counts as "running from this install's venv". Returns the PIDs that outlived
 * the deadline.
 */
export async function waitForProcessesToExit(
  pids: number[],
  isAlive: (pid: number) => boolean,
  timeoutMs = 15_000,
  pollMs = 150,
): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  let remaining = pids.filter(isAlive);
  while (remaining.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    remaining = remaining.filter(isAlive);
  }
  return remaining;
}
