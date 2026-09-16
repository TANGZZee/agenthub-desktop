import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import {
  clearCliProbeCache,
  probeCliCommands,
} from "../src/main/agenthub/profiles";

/**
 * CLI discovery.
 *
 * Discovery previously shelled out to `where.exe`/`which` for the whole name
 * set at once. On Windows that measured ~3.4 s and, inside Electron, hit its
 * 10 s timeout outright — so every catalog probe stalled and returned nothing,
 * and the app reported zero detected CLIs on a machine that had several
 * installed.
 *
 * Discovery now walks `PATH` on the filesystem instead. These tests pin the
 * behaviour that made the subprocess approach wrong, rather than the mechanics
 * of any particular lookup.
 */

describe("CLI path discovery", () => {
  it("resolves an executable that is really on PATH", async () => {
    // `node` is guaranteed present: every one of these tests is running on it.
    const found = await probeCliCommands([process.platform === "win32" ? "node.exe" : "node"]);
    expect(found.size).toBeGreaterThan(0);
    const hit = [...found.values()][0];
    expect(hit.length).toBeGreaterThan(0);
  });

  it("returns an empty map for a name that does not exist, without throwing", async () => {
    const found = await probeCliCommands(["definitely-not-a-real-cli-xyz-42"]);
    expect(found.size).toBe(0);
  });

  it("keeps hits while other names miss, instead of discarding them", async () => {
    // The regression: `where.exe` exits non-zero as soon as ONE name is
    // missing, and that non-zero status was treated as total failure, so the
    // names it HAD found were thrown away.
    const real = process.platform === "win32" ? "node.exe" : "node";
    const found = await probeCliCommands([real, "definitely-not-a-real-cli-xyz-42"]);
    expect(found.has(real)).toBe(true);
    expect(found.has("definitely-not-a-real-cli-xyz-42")).toBe(false);
  });

  it("completes promptly", async () => {
    // The subprocess version took seconds and timed out at 10 s. A PATH walk is
    // filesystem work, so this must be far below that.
    const names = Array.from(
      { length: 40 },
      (_, i) => `not-a-real-cli-${i}-xyz`,
    );
    const started = Date.now();
    await probeCliCommands(names);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it.skipIf(process.platform !== "win32")(
    "finds a CLI in the npm global directory even when PATH omits it",
    async () => {
      // The reported failure: `codex --version` worked in a fresh terminal while
      // the app still showed the CLI as undetected, because the npm global
      // directory was on the persisted PATH but not in the app process's
      // inherited copy. Every catalog entry installs with `npm install -g`, so
      // that directory is searched explicitly rather than assumed reachable.
      const scratch = join(tmpdir(), "cli-discovery-" + randomUUID());
      const npmDir = join(scratch, "npm");
      mkdirSync(npmDir, { recursive: true });
      writeFileSync(join(npmDir, "codex.cmd"), "@ECHO off\r\n", "utf8");

      const savedPath = process.env.PATH;
      const savedAppData = process.env.APPDATA;
      // A PATH that plainly does not contain the npm directory.
      process.env.PATH = "C:\\Windows\\System32";
      process.env.APPDATA = scratch;
      clearCliProbeCache();
      try {
        const found = await probeCliCommands(["codex.cmd", "codex"]);
        expect(found.get("codex.cmd")).toBe(join(npmDir, "codex.cmd"));
        // A bare name resolves through PATHEXT to the same shim.
        expect(found.get("codex")).toBe(join(npmDir, "codex.cmd"));
      } finally {
        process.env.PATH = savedPath;
        if (savedAppData === undefined) delete process.env.APPDATA;
        else process.env.APPDATA = savedAppData;
        clearCliProbeCache();
        rmSync(scratch, { recursive: true, force: true });
      }
    },
  );
});

afterEach(() => {
  // Results are cached for 30 s; a test that rewrites PATH must not leak that
  // into the next one.
  clearCliProbeCache();
});
