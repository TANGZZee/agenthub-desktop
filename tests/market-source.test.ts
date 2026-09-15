import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMarketCatalog,
  refreshMarketCatalog,
  resetMarketCatalogCache,
} from "../src/main/agenthub/market-source";
import { MARKET_ENTRIES } from "../src/main/agenthub/market.generated";

/**
 * Three sources, in order: a fetched document, the last good one cached on disk,
 * and the table this build shipped. A failure at any step must degrade to the
 * next one rather than emptying the list.
 *
 * `app` is not available here, so the on-disk cache is skipped — these tests
 * therefore exercise the fetch path and the built-in fallback, which is exactly
 * what a fresh install hits.
 */

function document(agents: unknown[], version = 1): string {
  return JSON.stringify({ version, agents });
}

const SAMPLE = {
  id: "from-the-network",
  rank: 1,
  name: "Network Agent",
  vendor: "Network",
  category: "open-source",
  role: { zh: "示例", en: "Sample" },
  description: { zh: "说明", en: "Description" },
  docsUrl: "https://example.com/docs",
  installHint: "npm install -g network-agent",
  binaries: { win: ["network.cmd"], unix: ["network"] },
  permissions: ["planned"],
};

function fakeFetch(impl: () => Promise<unknown>): typeof fetch {
  return (async () => impl()) as unknown as typeof fetch;
}

function okResponse(body: string): Response {
  return {
    ok: true,
    status: 200,
    text: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  resetMarketCatalogCache();
});

describe("market catalog source", () => {
  // @lat: [[agenthub-workers#Market catalog source]]
  it("falls back to the shipped table before any fetch", () => {
    const state = getMarketCatalog();

    expect(state.origin).toBe("built-in");
    expect(state.entries).toHaveLength(MARKET_ENTRIES.length);
    expect(state.error).toBeNull();
  });

  it("publishes a fetched document as the remote list", async () => {
    const state = await refreshMarketCatalog({
      fetchImpl: fakeFetch(async () => okResponse(document([SAMPLE]))),
      now: () => 1_700_000_000_000,
    });

    expect(state.origin).toBe("remote");
    expect(state.entries.map((entry) => entry.id)).toEqual([
      "from-the-network",
    ]);
    expect(state.fetchedAt).toBe(1_700_000_000_000);
    expect(state.error).toBeNull();
    // And the new list is what later reads see.
    expect(getMarketCatalog().entries).toHaveLength(1);
  });

  it("keeps the previous list when the network fails, and records why", async () => {
    await refreshMarketCatalog({
      fetchImpl: fakeFetch(async () => okResponse(document([SAMPLE]))),
    });

    const state = await refreshMarketCatalog({
      fetchImpl: fakeFetch(async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      }),
    });

    expect(state.origin).toBe("remote");
    expect(state.entries).toHaveLength(1);
    expect(state.error).toContain("ENOTFOUND");
  });

  it("keeps the previous list when the response is not ok", async () => {
    const state = await refreshMarketCatalog({
      fetchImpl: fakeFetch(
        async () => ({ ok: false, status: 503 }) as Response,
      ),
    });

    expect(state.origin).toBe("built-in");
    expect(state.entries).toHaveLength(MARKET_ENTRIES.length);
    expect(state.error).toBe("HTTP 503");
  });

  it("keeps the previous list when the body is not JSON", async () => {
    const state = await refreshMarketCatalog({
      fetchImpl: fakeFetch(async () => okResponse("<html>nope</html>")),
    });

    expect(state.origin).toBe("built-in");
    expect(state.error).toBeTruthy();
  });

  it("keeps the previous list when the document fails validation", async () => {
    const state = await refreshMarketCatalog({
      fetchImpl: fakeFetch(async () =>
        okResponse(document([{ id: "broken", docsUrl: "http://insecure" }])),
      ),
    });

    expect(state.origin).toBe("built-in");
    expect(state.entries).toHaveLength(MARKET_ENTRIES.length);
    expect(state.error).toBeTruthy();
  });

  it("refuses an oversized document instead of parsing it", async () => {
    const state = await refreshMarketCatalog({
      fetchImpl: fakeFetch(async () => okResponse("x".repeat(600_000))),
    });

    expect(state.origin).toBe("built-in");
    expect(state.error).toContain("too large");
  });

  it("reports how many entries validation dropped", async () => {
    const state = await refreshMarketCatalog({
      fetchImpl: fakeFetch(async () =>
        okResponse(document([SAMPLE, { id: "broken", docsUrl: "http://x" }])),
      ),
    });

    expect(state.origin).toBe("remote");
    expect(state.rejected).toBe(1);
  });

  it("never throws, whatever the fetch does", async () => {
    await expect(
      refreshMarketCatalog({
        fetchImpl: (() => {
          throw new Error("synchronous explosion");
        }) as unknown as typeof fetch,
      }),
    ).resolves.toBeTruthy();
  });
});

describe("market catalog url", () => {
  // @lat: [[agenthub-workers#Market catalog source]]
  it("only accepts an override over https or loopback", async () => {
    const { marketCatalogUrl, DEFAULT_MARKET_URL } =
      await import("../src/main/agenthub/market-source");

    vi.stubEnv("HERMES_AGENTHUB_MARKET_URL", "http://evil.example.com/c.json");
    expect(marketCatalogUrl()).toBe(DEFAULT_MARKET_URL);

    vi.stubEnv("HERMES_AGENTHUB_MARKET_URL", "http://127.0.0.1:8080/c.json");
    expect(marketCatalogUrl()).toBe("http://127.0.0.1:8080/c.json");

    vi.stubEnv(
      "HERMES_AGENTHUB_MARKET_URL",
      "https://mirror.example.com/c.json",
    );
    expect(marketCatalogUrl()).toBe("https://mirror.example.com/c.json");

    vi.unstubAllEnvs();
    expect(marketCatalogUrl()).toBe(DEFAULT_MARKET_URL);
  });
});
