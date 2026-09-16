import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  collectAgentActivity,
  collectOfficeActivity,
  discoverActiveAgents,
  journalKindFor,
  type AgentRosterEntry,
} from "../src/main/agent-activity";

/**
 * The hybrid join: the worker roster decides *who* exists and whether they are
 * enabled, the JSONL journal decides *what* each one is doing. These tests use
 * an injected home so a real user's journals can't affect the outcome.
 */

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "hermes-activity-"));
  process.env.HERMES_ACTIVITY_HOME_PI = home;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.HERMES_ACTIVITY_HOME_PI;
});

/** Write a pi journal with the given raw tool-call lines. */
function writePiJournal(name: string, body: string, mtimeMs?: number): string {
  const dir = join(home, ".pi", "agent", "sessions", "proj");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, body);
  if (mtimeMs !== undefined) {
    const s = mtimeMs / 1000;
    utimesSync(path, s, s);
  }
  return path;
}

/** One pi toolCall start (no matching result → still running). */
function piStart(id: string, name: string, at: string): string {
  return JSON.stringify({
    type: "message",
    timestamp: at,
    message: {
      role: "assistant",
      content: [{ type: "toolCall", id, name, arguments: {} }],
    },
  });
}

/** One pi toolResult (terminal for `id`). */
function piResult(id: string, name: string, at: string, isError = false): string {
  return JSON.stringify({
    type: "message",
    timestamp: at,
    message: {
      role: "toolResult",
      toolCallId: id,
      toolName: name,
      content: [{ type: "text", text: "ok" }],
      isError,
    },
  });
}

const roster: AgentRosterEntry[] = [
  { id: "pi", name: "Pi", enabled: true, runningCount: 1 },
  { id: "codex", name: "Codex", enabled: true, runningCount: 0 },
  { id: "mystery", name: "Mystery", enabled: true, runningCount: 0 },
];

describe("agent-activity roster join", () => {
  it("maps AgentHub worker ids onto journal kinds", () => {
    expect(journalKindFor("pi")).toBe("pi");
    expect(journalKindFor("codex")).toBe("codex");
    expect(journalKindFor("claude-code")).toBe("claude");
    // Unknown agents have no journal but must still appear in the roster.
    expect(journalKindFor("mystery")).toBeNull();
  });

  it("keeps an agent in the result even with no journal of its own", () => {
    const out = collectAgentActivity(roster, { home });
    expect(out.map((a) => a.agentId)).toEqual(["pi", "codex", "mystery"]);
    // Nothing journal-backed is running, so every entry is idle.
    expect(out.every((a) => a.currentTool === null)).toBe(true);
  });

  it("reports the newest unfinished call as the current animation", () => {
    const now = Date.now();
    writePiJournal(
      "s.jsonl",
      [
        piStart("c1", "read", new Date(now - 5000).toISOString()),
        piResult("c1", "read", new Date(now - 4000).toISOString()),
        piStart("c2", "edit", new Date(now - 1000).toISOString()),
      ].join("\n"),
      now,
    );

    const out = collectAgentActivity(roster, { home });
    const pi = out.find((a) => a.agentId === "pi");
    expect(pi?.currentTool).toBe("edit");
    expect(pi?.currentTool).toBe("edit");
    expect(pi?.rawToolName).toBe("edit");
  });

  it("reads idle once every call has finished", () => {
    const now = Date.now();
    writePiJournal(
      "s.jsonl",
      [
        piStart("c1", "bash", new Date(now - 3000).toISOString()),
        piResult("c1", "bash", new Date(now - 2000).toISOString()),
      ].join("\n"),
      now,
    );

    const out = collectAgentActivity(roster, { home });
    const pi = out.find((a) => a.agentId === "pi");
    // No unfinished call → resting state, not the last tool it ran.
    expect(pi?.currentTool).toBeNull();
    expect(pi?.currentTool).toBeNull();
    // The finished call is still reported as recent history.
    expect(pi?.recent[0]).toMatchObject({ tool: "bash", phase: "finished" });
  });

  it("counts failed tool calls", () => {
    const now = Date.now();
    writePiJournal(
      "s.jsonl",
      [
        piStart("c1", "bash", new Date(now - 3000).toISOString()),
        piResult("c1", "bash", new Date(now - 2000).toISOString(), true),
      ].join("\n"),
      now,
    );

    const out = collectAgentActivity(roster, { home });
    expect(out.find((a) => a.agentId === "pi")?.failedCount).toBe(1);
  });

  it("ignores stale activity so a dead journal can't freeze an animation", () => {
    // Journal last written an hour ago: whatever it recorded is not "now".
    const old = Date.now() - 60 * 60 * 1000;
    writePiJournal("s.jsonl", piStart("c1", "edit", new Date(old).toISOString()), old);

    const out = collectAgentActivity(roster, { home });
    expect(out.find((a) => a.agentId === "pi")?.currentTool).toBeNull();
  });

  it("does not animate an unmapped tool", () => {
    const now = Date.now();
    writePiJournal(
      "s.jsonl",
      piStart("c1", "memory_write", new Date(now - 1000).toISOString()),
      now,
    );

    const out = collectAgentActivity(roster, { home });
    const pi = out.find((a) => a.agentId === "pi");
    // The agent is genuinely running, so the tool is reported honestly as the
    // canonical catch-all. Deciding that "other" has no animation is the
    // renderer's job (`engineToolFor` returns null), not the collector's —
    // keeping it here would hide a real tool from the detail panel.
    expect(pi?.currentTool).toBe("other");
  });

  it("survives a corrupt journal without dropping the roster", () => {
    const now = Date.now();
    writePiJournal("bad.jsonl", "{not json\n{also not json", now);

    const out = collectAgentActivity(roster, { home });
    expect(out).toHaveLength(3);
    expect(out.every((a) => a.currentTool === null)).toBe(true);
  });

  it("yields idle for every agent when no journal directory exists", () => {
    const empty = mkdtempSync(join(tmpdir(), "hermes-empty-"));
    process.env.HERMES_ACTIVITY_HOME_PI = empty;
    try {
      const out = collectAgentActivity(roster, { home: empty });
      expect(out).toHaveLength(3);
      expect(out.every((a) => a.currentTool === null)).toBe(true);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("agent-activity active-agent discovery", () => {
  it("finds an agent whose journal was written just now", () => {
    const now = Date.now();
    writePiJournal("live.jsonl", piStart("c1", "read", new Date(now).toISOString()), now);

    const active = discoverActiveAgents({ home });
    expect(active.map((a) => a.id)).toEqual(["pi"]);
  });

  it("ignores an agent whose journal is stale", () => {
    // A journal from an hour ago means the agent is not working *now*; showing
    // it would put a ghost in the office.
    const old = Date.now() - 60 * 60 * 1000;
    writePiJournal("old.jsonl", piStart("c1", "read", new Date(old).toISOString()), old);

    expect(discoverActiveAgents({ home })).toEqual([]);
  });

  it("returns nothing when there are no journals at all", () => {
    const empty = mkdtempSync(join(tmpdir(), "hermes-none-"));
    process.env.HERMES_ACTIVITY_HOME_PI = empty;
    try {
      expect(discoverActiveAgents({ home: empty })).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  // The connected roster only lists agents hooked up through the Capabilities
  // screen. An agent configured in config/agents.json and working right now is
  // absent from it, which would leave the office empty while its agents are
  // visibly busy.
  it("merges a working agent that was never 'connected'", () => {
    const now = Date.now();
    writePiJournal("live.jsonl", piStart("c1", "edit", new Date(now).toISOString()), now);

    // Roster deliberately omits pi.
    const connected: AgentRosterEntry[] = [
      { id: "codex", name: "Codex", enabled: true, runningCount: 0 },
    ];
    const out = collectOfficeActivity(connected, { home });

    const ids = out.map((a) => a.agentId);
    expect(ids).toContain("codex");
    expect(ids).toContain("pi");
    // The journal-derived agent still gets its live tool.
    expect(out.find((a) => a.agentId === "pi")?.currentTool).toBe("edit");
  });

  it("reports an agent present in both sources only once", () => {
    const now = Date.now();
    writePiJournal("live.jsonl", piStart("c1", "bash", new Date(now).toISOString()), now);

    const connected: AgentRosterEntry[] = [
      { id: "pi", name: "Pi (connected)", enabled: true, runningCount: 1 },
    ];
    const out = collectOfficeActivity(connected, { home });

    expect(out).toHaveLength(1);
    // The connected roster owns identity, so its display name survives.
    expect(out[0].agentId).toBe("pi");
  });
});
