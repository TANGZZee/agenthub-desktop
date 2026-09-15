import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AgentHubCatalogStore,
  listAgentHubCatalog,
  type CatalogProbe,
} from "../src/main/agenthub/catalog";
import {
  REVIEWED_MODEL_CAPABLE_RUNNER_IDS,
  REVIEWED_RUNNER_IDS,
} from "../src/main/agenthub/profiles";

/**
 * The security boundary of this feature.
 *
 * The market catalog is a network document. It may add entries, reorder them and
 * describe them — but whether an agent may RUN is decided locally against a
 * runner whose read-only flags were reviewed on a real machine. These tests pin
 * that a catalog entry cannot promote anything, however it is written.
 */

const TEST_DIR = join(process.cwd(), "Temp", "tests", "market-guard");

/**
 * A probe that claims every CLI exists, to isolate the runner decision.
 *
 * `npm` shim paths (`.cmd`/`.bat`) are deliberately reported as absent: on
 * Windows those are only healthy when the shim resolves to a real entry point,
 * and a fabricated path cannot. Resolving the native name instead mirrors a real
 * machine and keeps this test about the runner decision rather than about shims.
 */
function alwaysFoundProbe(): CatalogProbe {
  return {
    resolve: (names) =>
      new Map(
        names
          .filter((name) => !/\.(cmd|bat)$/i.test(name))
          .map((name) => [name, `/fake/${name}`]),
      ),
    version: () => "1.0.0",
  };
}

function store(): AgentHubCatalogStore {
  return new AgentHubCatalogStore(join(TEST_DIR, `guard-${Date.now()}.json`));
}

describe("market catalog cannot grant runnability", () => {
  // @lat: [[agenthub-workers#Market catalog source]]
  it("only lists the reviewed runner as available", () => {
    // Pi is the sole reviewed runner, and it is built in rather than coming from
    // the catalog.
    expect(REVIEWED_RUNNER_IDS).toEqual(["pi"]);
    expect(REVIEWED_MODEL_CAPABLE_RUNNER_IDS).toEqual(["pi"]);
  });

  it("reports an agent's runner status from the local review list", async () => {
    const { runnerStatusFor } = await import("../src/main/agenthub/catalog");

    expect(runnerStatusFor("pi")).toBe("available");
    expect(runnerStatusFor("claude-code")).toBe("planned");
    expect(runnerStatusFor("anything-invented-by-the-catalog")).toBe("planned");
  });

  it("keeps catalog entries listed-only even when the CLI is present", () => {
    const { entries } = listAgentHubCatalog(store(), alwaysFoundProbe());

    // Every catalog candidate is detected by the probe (it claims everything
    // exists) yet none of them may be connected.
    const market = entries.filter((item) => !item.builtIn);
    expect(market.length).toBeGreaterThan(0);
    for (const item of market) {
      expect(item.runner, `${item.id} must stay planned`).toBe("planned");
      expect(item.installable, `${item.id} must not be connectable`).toBe(
        false,
      );
      expect(item.supportsModelSelection).toBe(false);
    }
  });

  it("marks the reviewed runner as connectable when its CLI is present", () => {
    const { entries } = listAgentHubCatalog(store(), alwaysFoundProbe());
    const pi = entries.find((item) => item.id === "pi");

    expect(pi?.runner).toBe("available");
    expect(pi?.installable).toBe(true);
    expect(pi?.supportsModelSelection).toBe(true);
  });

  it("ignores a runner field smuggled through the catalog document", async () => {
    // The parser must not carry the claim even if the JSON contains one, which
    // matters because the parsed entries are what feeds the catalog listing.
    const { parseMarketCatalog } =
      await import("../src/shared/agenthub-market");
    const parsed = parseMarketCatalog({
      version: 1,
      agents: [
        {
          id: "sneaky",
          rank: 1,
          name: "Sneaky",
          vendor: "Nobody",
          category: "official",
          role: { zh: "示例", en: "Sample" },
          description: { zh: "说明", en: "Description" },
          docsUrl: "https://example.com/",
          installHint: "npm i sneaky",
          binaries: { win: ["sneaky.cmd"], unix: ["sneaky"] },
          runner: "available",
          supportsModelSelection: true,
        },
      ],
    });

    expect(parsed?.entries[0]).not.toHaveProperty("runner");
    expect(parsed?.entries[0]).not.toHaveProperty("supportsModelSelection");
  });
});
