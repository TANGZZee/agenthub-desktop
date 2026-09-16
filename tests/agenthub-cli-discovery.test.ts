import { describe, expect, it } from "vitest";
import { probeCliCommands } from "../src/main/agenthub/profiles";

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
});
