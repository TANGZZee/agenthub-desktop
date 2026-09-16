import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  journalLocation,
  listJournals,
  readJournalTail,
} from "../src/main/agent-activity/journals";

/**
 * Journal discovery. Paths come from an injected home so these tests build a
 * fixture tree instead of reading a real user profile (the machine running them
 * has 100+ real journals that must not influence the result).
 */

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "hermes-journals-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.HERMES_ACTIVITY_HOME_PI;
});

function write(path: string, body: string, mtimeMs?: number): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body);
  if (mtimeMs !== undefined) {
    const secs = mtimeMs / 1000;
    utimesSync(path, secs, secs);
  }
}

describe("agent-activity journal discovery", () => {
  it("resolves each CLI's journal directory from an injected home", () => {
    mkdirSync(join(home, ".pi", "agent", "sessions"), { recursive: true });
    expect(journalLocation("pi", home).dir).toBe(
      join(home, ".pi", "agent", "sessions"),
    );
    // An absent directory reports null rather than a path that can't be read.
    expect(journalLocation("claude", home).dir).toBeNull();
  });

  it("honours the per-CLI home override", () => {
    const other = mkdtempSync(join(tmpdir(), "hermes-journals-override-"));
    mkdirSync(join(other, ".pi", "agent", "sessions"), { recursive: true });
    process.env.HERMES_ACTIVITY_HOME_PI = other;
    try {
      expect(journalLocation("pi", home).dir).toBe(
        join(other, ".pi", "agent", "sessions"),
      );
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("only matches codex rollout files, not every jsonl", () => {
    const dir = join(home, "codex");
    write(join(dir, "rollout-2026-01-01T00-00-00-abc.jsonl"), "{}", 1_700_000_000_000);
    write(join(dir, "session_index.jsonl"), "{}", 1_700_000_000_000);
    write(join(dir, "notes.txt"), "x", 1_700_000_000_000);

    const found = listJournals("codex", dir, 10);
    expect(found).toHaveLength(1);
    expect(found[0].path).toContain("rollout-");
  });

  it("returns the newest journals first", () => {
    const dir = join(home, "pi");
    write(join(dir, "a.jsonl"), "{}", 1_700_000_000_000);
    write(join(dir, "b.jsonl"), "{}", 1_700_000_100_000);
    write(join(dir, "c.jsonl"), "{}", 1_700_000_050_000);

    const found = listJournals("pi", dir, 10);
    expect(found.map((f) => f.path.split(/[\\/]/).pop())).toEqual([
      "b.jsonl",
      "c.jsonl",
      "a.jsonl",
    ]);
  });

  it("bounds the result set to the requested count", () => {
    const dir = join(home, "pi");
    for (let i = 0; i < 8; i += 1) {
      write(join(dir, `j${i}.jsonl`), "{}", 1_700_000_000_000 + i * 1000);
    }
    expect(listJournals("pi", dir, 3)).toHaveLength(3);
  });

  it("walks nested date directories", () => {
    const dir = join(home, "codex");
    write(
      join(dir, "2026", "09", "16", "rollout-2026-09-16T01-00-00-x.jsonl"),
      "{}",
      1_700_000_000_000,
    );
    expect(listJournals("codex", dir, 5)).toHaveLength(1);
  });

  it("returns nothing for a missing directory instead of throwing", () => {
    expect(listJournals("pi", join(home, "nope"), 5)).toEqual([]);
  });

  it("reads a small journal whole", () => {
    const file = join(home, "small.jsonl");
    write(file, "line1\nline2\n");
    expect(readJournalTail(file, 10_000)).toBe("line1\nline2\n");
  });

  it("reads only the tail of a large journal", () => {
    // A real codex rollout here is 48 MB; reading it whole on every poll would
    // stall the main process.
    const file = join(home, "big.jsonl");
    const head = "H".repeat(5000);
    const tail = "T".repeat(500);
    write(file, head + tail);

    const out = readJournalTail(file, 500);
    expect(out).toHaveLength(500);
    expect(out).toBe(tail);
    expect(out).not.toContain("H");
  });
});
