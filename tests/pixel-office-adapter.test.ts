import { describe, expect, it } from "vitest";
import { agentNumericId } from "../src/renderer/src/screens/Office/pixel/PixelOffice";
import { engineToolFor } from "../src/renderer/src/screens/Office/pixel/toolBridge";
import type { CanonicalTool } from "../src/shared/agent-activity";

/**
 * The pixel office is a port of an upstream engine (MIT, noya21th/996) that
 * speaks its own tool names and keys characters by number. These tests pin the
 * two translation seams between AgentHub's data and that engine.
 */

describe("pixel office agent identity", () => {
  it("maps an agent id to a stable positive number", () => {
    const first = agentNumericId("pi");
    expect(first).toBe(agentNumericId("pi"));
    expect(first).toBeGreaterThan(0);
  });

  it("keeps distinct agents on distinct characters", () => {
    const ids = ["pi", "codex", "claude", "hermes", "mystery"];
    const mapped = ids.map(agentNumericId);
    expect(new Set(mapped).size).toBe(ids.length);
  });

  it("never collides with the engine's reserved sub-agent range", () => {
    // The engine allocates sub-agent ids from -1 downward; a roster id must
    // never land there or an agent would be treated as someone's sub-agent.
    for (const id of ["a", "pi", "codex", "zzz", "", "  ", "长名字"]) {
      expect(agentNumericId(id)).toBeGreaterThan(0);
    }
  });
});

describe("pixel office tool bridge", () => {
  it("translates every canonical tool onto the engine's vocabulary", () => {
    expect(engineToolFor("read")).toBe("Read");
    expect(engineToolFor("search")).toBe("Grep");
    expect(engineToolFor("glob")).toBe("Glob");
    expect(engineToolFor("fetch")).toBe("WebFetch");
    expect(engineToolFor("websearch")).toBe("WebSearch");
    expect(engineToolFor("write")).toBe("Write");
    expect(engineToolFor("edit")).toBe("Edit");
    expect(engineToolFor("bash")).toBe("Bash");
    expect(engineToolFor("task")).toBe("Task");
  });

  it("returns null for unmapped tools and idle so the character rests", () => {
    // The engine's animation lookup returns null for unknown names, which is
    // exactly the resting behaviour we want — no invented animation.
    expect(engineToolFor("other")).toBeNull();
    expect(engineToolFor(null)).toBeNull();
  });

  it("produces only names the engine actually recognizes", () => {
    // Guards the seam: every non-null mapping must be one of the engine's own
    // documented tool names, or the renderer silently shows no animation.
    const engineKnown = new Set([
      "Read",
      "Grep",
      "Glob",
      "WebFetch",
      "WebSearch",
      "Write",
      "Edit",
      "Bash",
      "Task",
    ]);
    const canonical: CanonicalTool[] = [
      "read",
      "search",
      "glob",
      "fetch",
      "websearch",
      "write",
      "edit",
      "bash",
      "task",
      "other",
    ];
    for (const tool of canonical) {
      const mapped = engineToolFor(tool);
      if (mapped !== null) {
        expect(engineKnown.has(mapped)).toBe(true);
      }
    }
  });
});
