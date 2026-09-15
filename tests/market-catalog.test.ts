import { describe, expect, it } from "vitest";
import {
  MARKET_LIMITS,
  parseMarketCatalog,
} from "../src/shared/agenthub-market";

/**
 * The market catalog arrives from the network, so parsing is the boundary that
 * decides what may reach the UI. These tests pin the strictness: a malformed
 * entry is dropped, not coerced.
 */

function validEntry(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "sample-agent",
    rank: 1,
    name: "Sample Agent",
    vendor: "Sample",
    category: "open-source",
    role: { zh: "示例", en: "Sample" },
    description: { zh: "说明", en: "Description" },
    docsUrl: "https://example.com/docs",
    installHint: "npm install -g sample-agent",
    binaries: { win: ["sample.cmd"], unix: ["sample"] },
    permissions: ["no-write", "planned"],
    ...overrides,
  };
}

function doc(
  agents: unknown[],
  version = 1,
): { version: number; agents: unknown[] } {
  return { version, agents };
}

describe("parseMarketCatalog", () => {
  // @lat: [[agenthub-workers#Market catalog source]]
  it("accepts a well-formed document and sorts by rank", () => {
    const result = parseMarketCatalog(
      doc([
        validEntry({ id: "b-second", rank: 2 }),
        validEntry({ id: "a-first", rank: 1 }),
      ]),
    );

    expect(result).not.toBeNull();
    expect(result?.entries.map((entry) => entry.id)).toEqual([
      "a-first",
      "b-second",
    ]);
    expect(result?.rejected).toBe(0);
  });

  it("rejects a document whose version it does not understand", () => {
    expect(parseMarketCatalog(doc([validEntry()], 99))).toBeNull();
    expect(parseMarketCatalog({ agents: [validEntry()] })).toBeNull();
    expect(parseMarketCatalog(null)).toBeNull();
    expect(parseMarketCatalog("nope")).toBeNull();
  });

  it("rejects a document with no usable entries", () => {
    expect(parseMarketCatalog(doc([]))).toBeNull();
    expect(parseMarketCatalog(doc([{ id: "x" }]))).toBeNull();
  });

  it("drops an entry that points at a non-https docsUrl", () => {
    // A catalog must never send a user to a plaintext page.
    const result = parseMarketCatalog(
      doc([
        validEntry({ id: "good" }),
        validEntry({ id: "insecure", docsUrl: "http://example.com/docs" }),
      ]),
    );

    expect(result?.entries.map((e) => e.id)).toEqual(["good"]);
    expect(result?.rejected).toBe(1);
  });

  it("drops an entry with no probeable executable name", () => {
    // Without a name to look for, the entry could never be detected as
    // installed, so it would be permanently un-connectable.
    const result = parseMarketCatalog(
      doc([
        validEntry({ id: "good" }),
        validEntry({ id: "undetectable", binaries: { win: [], unix: [] } }),
      ]),
    );

    expect(result?.entries.map((e) => e.id)).toEqual(["good"]);
    expect(result?.rejected).toBe(1);
  });

  it("keeps the first of two entries sharing an id and counts the drop", () => {
    const result = parseMarketCatalog(
      doc([
        validEntry({ id: "twin", name: "First" }),
        validEntry({ id: "twin", name: "Second" }),
      ]),
    );

    expect(result?.entries).toHaveLength(1);
    expect(result?.entries[0].name).toBe("First");
    expect(result?.rejected).toBe(1);
  });

  it("filters unknown permission tokens instead of dropping the entry", () => {
    const result = parseMarketCatalog(
      doc([validEntry({ permissions: ["no-write", "sudo-everything"] })]),
    );

    expect(result?.entries[0].permissions).toEqual(["no-write"]);
  });

  it("collapses an install hint to a single line", () => {
    // installHint is copied into a terminal: embedded newlines would turn one
    // copied line into several commands.
    const result = parseMarketCatalog(
      doc([
        validEntry({
          installHint: "npm i sample\n&& rm -rf /home/user\t--force",
        }),
      ]),
    );

    const hint = result?.entries[0].installHint ?? "";
    expect(hint).not.toMatch(/[\r\n\t]/);
    expect(hint).toBe("npm i sample && rm -rf /home/user --force");
  });

  it("bounds over-long text fields", () => {
    const longName = "x".repeat(MARKET_LIMITS.nameLength + 50);
    const result = parseMarketCatalog(doc([validEntry({ name: longName })]));

    expect(result?.entries[0].name).toHaveLength(MARKET_LIMITS.nameLength);
  });

  it("ignores a runner field if one is smuggled in", () => {
    // Connectability is decided locally; the parser must not carry such a claim
    // through to the caller.
    const result = parseMarketCatalog(
      doc([validEntry({ runner: "available", supportsModelSelection: true })]),
    );

    expect(result?.entries[0]).not.toHaveProperty("runner");
    expect(result?.entries[0]).not.toHaveProperty("supportsModelSelection");
  });

  it("keeps a random rank from reordering the list arbitrarily", () => {
    const result = parseMarketCatalog(
      doc([
        validEntry({ id: "no-rank", rank: undefined }),
        validEntry({ id: "rank-nine", rank: 9 }),
      ]),
    );

    expect(result?.entries.map((e) => e.id)).toEqual(["rank-nine", "no-rank"]);
  });
});
