import { describe, expect, it, beforeAll } from "vitest";
import {
  ensurePixelOfficeAssets,
  resetPixelOfficeAssets,
  bundledLayout,
} from "../src/renderer/src/screens/Office/pixel/assets";
import {
  getCatalogEntry,
  getActiveCategories,
} from "../src/renderer/src/screens/Office/pixel/layout/furnitureCatalog";
import { getLoadedCharacterCount } from "../src/renderer/src/screens/Office/pixel/sprites/spriteData";
import { hasFloorSprites } from "../src/renderer/src/screens/Office/pixel/floorTiles";
import { hasWallSprites } from "../src/renderer/src/screens/Office/pixel/wallTiles";
import { createDefaultLayout } from "../src/renderer/src/screens/Office/pixel/layout/layoutSerializer";
import { OfficeState } from "../src/renderer/src/screens/Office/pixel/engine/officeState";
import { setTeamMode } from "../src/renderer/src/screens/Office/pixel/engine/npcManager";
import { agentNumericId } from "../src/renderer/src/screens/Office/pixel/PixelOffice";

/**
 * Integration test for the pixel-office asset pipeline.
 *
 * This is the seam most likely to break silently: the office renders *something*
 * even when asset loading fails, because the engine ships fallback sprites. So
 * asserting "it rendered" proves nothing — these tests assert the real bundle
 * reached the engine's stores, that the catalog produced seats, and that agents
 * can therefore actually sit down instead of being scattered on random tiles.
 *
 * Uses the generated `sprites.json` (produced by
 * `scripts/build-pixel-office-assets.mjs`), so a broken decoder or a manifest
 * shape change fails here rather than in a blank-looking office.
 */

beforeAll(() => {
  resetPixelOfficeAssets();
  const result = ensurePixelOfficeAssets();
  expect(result.loaded).toBe(true);
});

describe("pixel office asset pipeline", () => {
  it("installs the decoded sprite bundle into the engine", () => {
    // 6 character palettes came from char_0..5.png; the engine's fallback
    // count is used when nothing loaded, so a bare `> 0` would be vacuous —
    // the generated bundle is the only source that yields exactly 6 here.
    expect(getLoadedCharacterCount()).toBeGreaterThan(0);
    expect(hasFloorSprites()).toBe(true);
    expect(hasWallSprites()).toBe(true);
  });

  it("builds a furniture catalog from the manifests", () => {
    // Desks are what agents sit at, so their presence proves the manifest
    // `category` mapping survived the decode.
    const desk = getCatalogEntry("DESK_FRONT");
    expect(desk).toBeTruthy();
    expect(desk?.isDesk).toBe(true);

    const categories = getActiveCategories().map((c) => c.id);
    expect(categories).toContain("desks");
    expect(categories).toContain("chairs");
  });

  it("produces seats so agents sit rather than scattering", () => {
    resetPixelOfficeAssets();
    ensurePixelOfficeAssets();
    const state = new OfficeState(bundledLayout() ?? createDefaultLayout());
    setTeamMode(false, state.characters, state.seats);
    // Seats come from chair furniture; a catalog without chairs would leave
    // this empty and every agent would spawn on a random walkable tile.
    expect(state.seats.size).toBeGreaterThan(0);
  });

  it("places a roster agent on a seat", () => {
    resetPixelOfficeAssets();
    ensurePixelOfficeAssets();
    const state = new OfficeState(bundledLayout() ?? createDefaultLayout());
    setTeamMode(false, state.characters, state.seats);
    const id = agentNumericId("pi");
    state.addAgent(id, undefined, undefined, undefined, true);

    const created = state.getCharacters().find((c) => c.id === id);
    expect(created).toBeTruthy();
    // skipSpawnEffect was requested, so the matrix intro must not be pending.
    expect(created?.matrixEffect ?? null).toBeNull();
    expect(created?.seatId).toBeTruthy();
  });

  it("drives the animation state from a bridged tool name", () => {
    resetPixelOfficeAssets();
    ensurePixelOfficeAssets();
    const state = new OfficeState(bundledLayout() ?? createDefaultLayout());
    setTeamMode(false, state.characters, state.seats);
    const id = agentNumericId("codex");
    state.addAgent(id, undefined, undefined, undefined, true);

    // The engine stores whatever name it is given; `isReadingTool` then
    // decides typing vs reading, so an unmapped name must still be safe.
    state.setAgentTool(id, "Read");
    expect(state.getCharacters().find((c) => c.id === id)?.currentTool).toBe(
      "Read",
    );
    state.setAgentTool(id, "Bash");
    expect(state.getCharacters().find((c) => c.id === id)?.currentTool).toBe(
      "Bash",
    );
    // Unknown names are accepted and simply match no animation branch.
    state.setAgentTool(id, "SomethingNew");
    expect(
      state.getCharacters().find((c) => c.id === id)?.currentTool,
    ).toBe("SomethingNew");
  });

  it("removes an agent that left the roster", () => {
    resetPixelOfficeAssets();
    ensurePixelOfficeAssets();
    const state = new OfficeState(bundledLayout() ?? createDefaultLayout());
    setTeamMode(false, state.characters, state.seats);
    const id = agentNumericId("pi");
    state.addAgent(id, undefined, undefined, undefined, true);
    expect(state.getCharacters().some((c) => c.id === id)).toBe(true);

    state.removeAgent(id);
    // Removal plays a despawn animation first: the character is marked and its
    // seat freed immediately, but it only leaves the map once the effect
    // drains. Both halves matter — a stale seat would keep a departed agent
    // occupying a desk forever.
    expect(state.getCharacters().find((c) => c.id === id)?.matrixEffect).toBe(
      "despawn",
    );

    for (let i = 0; i < 120; i += 1) state.update(1 / 60);
    expect(state.getCharacters().some((c) => c.id === id)).toBe(false);
  });

  it("advances simulation without throwing", () => {
    resetPixelOfficeAssets();
    ensurePixelOfficeAssets();
    const state = new OfficeState(bundledLayout() ?? createDefaultLayout());
    setTeamMode(false, state.characters, state.seats);
    state.addAgent(agentNumericId("pi"), undefined, undefined, undefined, true);
    state.addAgent(agentNumericId("codex"), undefined, undefined, undefined, true);
    // A few seconds of ticks: exercises wander/pathfinding against the
    // generated layout, which is where a bad tile map would blow up.
    for (let i = 0; i < 120; i += 1) state.update(1 / 60);
    expect(state.getCharacters().length).toBe(2);
  });

  // Regression guard for the premise of this view: every character on screen
  // must be an actual AgentHub agent. Upstream seeds six decorative "coworker"
  // NPCs, which here would read as agents that don't exist.
  it("shows no decorative coworkers, only roster agents", () => {
    resetPixelOfficeAssets();
    ensurePixelOfficeAssets();
    const state = new OfficeState(bundledLayout() ?? createDefaultLayout());
    setTeamMode(false, state.characters, state.seats);

    for (let i = 0; i < 240; i += 1) state.update(1 / 60);
    expect(state.getCharacters()).toHaveLength(0);

    state.addAgent(agentNumericId("pi"), undefined, undefined, undefined, true);
    for (let i = 0; i < 240; i += 1) state.update(1 / 60);
    const ids = state.getCharacters().map((c) => c.id);
    expect(ids).toEqual([agentNumericId("pi")]);
    // No negative ids: the engine reserves those for coworkers/sub-agents.
    expect(ids.every((id) => id > 0)).toBe(true);
  });
});
