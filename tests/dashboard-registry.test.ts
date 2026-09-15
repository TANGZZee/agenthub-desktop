import { describe, expect, it, vi } from "vitest";

import {
  drainAndKillDashboards,
  killDashboardTree,
  waitForProcessesToExit,
  type KillableDashboard,
} from "../src/main/dashboard-registry";

function fakeDashboard(pid?: number): {
  handle: KillableDashboard;
  kill: ReturnType<typeof vi.fn>;
} {
  const kill = vi.fn(() => true);
  return { handle: { proc: { pid, kill } }, kill };
}

describe("dashboard registry shutdown", () => {
  // @lat: [[desktop-updates#Engine update and the venv lock]]
  it("kills every supervised dashboard, including the default-profile one", () => {
    // Regression: the registry is keyed by `profileKey(profile)`, which falls
    // back to the *active* profile name — so an entry stored under "default"
    // was looked up as the active profile's key and silently missed. That
    // dashboard survived, kept the install's venv locked, and made
    // `hermes update` refuse to replace dependencies.
    const registry = new Map<string, KillableDashboard>();
    const defaults = fakeDashboard(111);
    const active = fakeDashboard(222);
    registry.set("default", defaults.handle);
    registry.set("gj", active.handle);

    const killed: Array<number | undefined> = [];
    const pids = drainAndKillDashboards(registry, (handle) =>
      killed.push(handle.proc.pid),
    );

    expect(pids).toEqual([111, 222]);
    expect(killed).toEqual([111, 222]);
    expect(registry.size).toBe(0);
  });

  it("drains the registry so a second call is a no-op", () => {
    const registry = new Map<string, KillableDashboard>();
    registry.set("default", fakeDashboard(111).handle);
    drainAndKillDashboards(registry, () => undefined);

    expect(drainAndKillDashboards(registry, () => undefined)).toEqual([]);
  });

  it("is a no-op for an empty registry", () => {
    expect(drainAndKillDashboards(new Map())).toEqual([]);
  });

  it("still hands over an entry whose spawn never produced a pid", () => {
    const registry = new Map<string, KillableDashboard>();
    const noPid = fakeDashboard(undefined);
    registry.set("spawn-failed", noPid.handle);

    expect(drainAndKillDashboards(registry)).toEqual([]);
    expect(noPid.kill).toHaveBeenCalledTimes(1);
  });
});

describe("killDashboardTree", () => {
  // @lat: [[desktop-updates#Engine update and the venv lock]]
  it("takes the whole process tree on Windows", () => {
    // The CLI runs the real server from its own runtime python as a child of
    // the process we spawned: signalling only the supervisor orphans the
    // server, which keeps the port and its loaded state.
    const { handle, kill } = fakeDashboard(4242);
    const run = vi.fn();
    killDashboardTree(handle, "win32", run);

    expect(run).toHaveBeenCalledWith("taskkill", ["/F", "/T", "/PID", "4242"]);
    expect(kill).not.toHaveBeenCalled();
  });

  it("uses the portable kill off Windows", () => {
    const { handle, kill } = fakeDashboard(4242);
    const run = vi.fn();
    killDashboardTree(handle, "darwin", run);

    expect(run).not.toHaveBeenCalled();
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it("falls back to the portable kill without a pid", () => {
    const { handle, kill } = fakeDashboard(undefined);
    const run = vi.fn();
    killDashboardTree(handle, "win32", run);

    expect(run).not.toHaveBeenCalled();
    expect(kill).toHaveBeenCalledTimes(1);
  });
});

describe("waitForProcessesToExit", () => {
  // @lat: [[desktop-updates#Engine update and the venv lock]]
  it("returns every pid that outlived the deadline", async () => {
    const alive = new Set([1, 2]);
    const remaining = await waitForProcessesToExit(
      [1, 2],
      (pid) => alive.has(pid),
      120,
      5,
    );
    expect(remaining).toEqual([1, 2]);
  });

  it("reports only the stragglers", async () => {
    const remaining = await waitForProcessesToExit(
      [1, 2],
      (pid) => pid === 2,
      120,
      5,
    );
    expect(remaining).toEqual([2]);
  });

  it("resolves immediately when there is nothing to wait for", async () => {
    await expect(
      waitForProcessesToExit([], () => false, 1_000, 5),
    ).resolves.toEqual([]);
  });
});
