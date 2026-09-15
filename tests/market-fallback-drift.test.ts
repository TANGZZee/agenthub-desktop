import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MARKET_ENTRIES,
  MARKET_UPDATED_AT,
} from "../src/main/agenthub/market.generated";
import { parseMarketCatalog } from "../src/shared/agenthub-market";

/**
 * The shipped fallback is generated from the catalog JSON by
 * `npm run catalog:sync`. If someone edits the JSON and forgets to regenerate —
 * or hand-edits the generated file — the app would ship a stale list, and the
 * only symptom would be a missing agent. This fails loudly instead.
 */

const CATALOG_PATH = join(
  process.cwd(),
  "docs",
  "catalog",
  "agenthub-market.json",
);

function loadedCatalog(): unknown {
  return JSON.parse(readFileSync(CATALOG_PATH, "utf8"));
}

describe("market fallback drift", () => {
  // @lat: [[agenthub-workers#Market catalog source]]
  it("matches docs/catalog/agenthub-market.json exactly", () => {
    const parsed = parseMarketCatalog(loadedCatalog());
    expect(parsed, "the catalog JSON must validate").not.toBeNull();

    // Same order, same content: the generated table is the catalog, compiled.
    expect(MARKET_ENTRIES).toEqual(parsed?.entries);
  });

  it("carries the catalog's updated date", () => {
    const catalog = loadedCatalog() as { updatedAt?: string };
    expect(MARKET_UPDATED_AT).toBe(catalog.updatedAt ?? "");
  });

  it("is marked as generated so nobody edits it by hand", () => {
    const generated = readFileSync(
      join(process.cwd(), "src", "main", "agenthub", "market.generated.ts"),
      "utf8",
    );
    expect(generated).toContain("GENERATED FILE");
    expect(generated).toContain("npm run catalog:sync");
  });
});
