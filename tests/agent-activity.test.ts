import { describe, expect, it } from "vitest";
import {
  animationGroupFor,
  canonicalTool,
  normalizeToolName,
  isAnimated,
} from "../src/shared/agent-activity";
import {
  extractorFor,
  foldToolCalls,
  parseTranscript,
} from "../src/main/agent-activity/transcripts";

/**
 * The agent-activity pipeline normalizes three different CLI journals into one
 * tool vocabulary. Fixtures below reproduce the exact envelope shapes verified
 * against real journals on disk (~/.claude/projects, ~/.pi/agent/sessions,
 * ~/.codex/sessions/rollout-*.jsonl).
 */

describe("agent-activity vocabulary", () => {
  it("normalizes casing, whitespace and MCP prefixes", () => {
    expect(normalizeToolName("  Read ")).toBe("read");
    expect(normalizeToolName("Bash")).toBe("bash");
    expect(normalizeToolName("mcp__github__read")).toBe("read");
    expect(normalizeToolName("")).toBe("");
  });

  it("maps each CLI's own tool names onto shared canonical tools", () => {
    // Claude Code (PascalCase)
    expect(canonicalTool("claude", "Read")).toBe("read");
    expect(canonicalTool("claude", "Grep")).toBe("search");
    expect(canonicalTool("claude", "Edit")).toBe("edit");
    expect(canonicalTool("claude", "Bash")).toBe("bash");
    // pi (lowercase, plus its own extras)
    expect(canonicalTool("pi", "read")).toBe("read");
    expect(canonicalTool("pi", "web_search")).toBe("websearch");
    expect(canonicalTool("pi", "get_search_content")).toBe("websearch");
    // codex describes the mechanism, not the intent
    expect(canonicalTool("codex", "exec_command")).toBe("bash");
    expect(canonicalTool("codex", "apply_patch")).toBe("edit");
    expect(canonicalTool("codex", "view_image")).toBe("read");
    expect(canonicalTool("codex", "spawn_agent")).toBe("task");
  });

  it("degrades unknown tools to `other` instead of failing", () => {
    // A future CLI tool must not break the reader.
    expect(canonicalTool("pi", "memory_write")).toBe("other");
    expect(canonicalTool("claude", "ExitPlanMode")).toBe("other");
    expect(canonicalTool("codex", "some_new_tool")).toBe("other");
    expect(canonicalTool("pi", "")).toBe("other");
    expect(isAnimated("other")).toBe(false);
  });

  it("maps canonical tools onto animation groups", () => {
    expect(animationGroupFor("read")).toBe("reading");
    expect(animationGroupFor("search")).toBe("searching");
    expect(animationGroupFor("edit")).toBe("writing");
    expect(animationGroupFor("bash")).toBe("debugging");
    expect(animationGroupFor("task")).toBe("collaborating");
    expect(animationGroupFor("other")).toBeNull();
  });
});

describe("agent-activity transcript extraction", () => {
  it("reads Claude Code tool_use / tool_result blocks", () => {
    const use = {
      timestamp: "2026-09-16T01:00:00.000Z",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_1", name: "Edit" }],
      },
    };
    const result = {
      timestamp: "2026-09-16T01:00:05.000Z",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1" }],
      },
    };
    const obs = [
      ...extractorFor("claude").parseLine(use),
      ...extractorFor("claude").parseLine(result),
    ];
    expect(obs).toHaveLength(2);
    expect(obs[0]).toMatchObject({ callId: "toolu_1", rawToolName: "Edit", phase: "started" });
    // The result block carries no tool name — only the id it answers.
    expect(obs[1]).toMatchObject({ callId: "toolu_1", rawToolName: "", phase: "finished" });

    const folded = foldToolCalls("claude", obs);
    expect(folded).toHaveLength(2);
    // Name is recovered from the paired start, so the finish still animates.
    expect(folded[1]).toMatchObject({ tool: "edit", phase: "finished" });
  });

  it("marks a Claude tool_result with is_error as failed", () => {
    const obs = extractorFor("claude").parseLine({
      message: {
        content: [{ type: "tool_result", tool_use_id: "t1", is_error: true }],
      },
    });
    expect(obs).toEqual([
      expect.objectContaining({ callId: "t1", phase: "failed" }),
    ]);
  });

  it("reads pi toolCall blocks and toolResult messages", () => {
    const assistant = {
      type: "message",
      timestamp: "2026-09-16T02:00:00.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "..." },
          { type: "toolCall", id: "call_1", name: "bash", arguments: {} },
        ],
      },
    };
    const toolResult = {
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "bash",
        content: [{ type: "text", text: "ok" }],
        isError: false,
      },
    };
    const obs = [
      ...extractorFor("pi").parseLine(assistant),
      ...extractorFor("pi").parseLine(toolResult),
    ];
    expect(obs).toHaveLength(2);
    const folded = foldToolCalls("pi", obs);
    expect(folded.map((f) => f.tool)).toEqual(["bash", "bash"]);
    expect(folded.map((f) => f.phase)).toEqual(["started", "finished"]);
  });

  it("ignores non-message pi entries", () => {
    expect(extractorFor("pi").parseLine({ type: "session", id: "x" })).toEqual([]);
    expect(extractorFor("pi").parseLine({ type: "model_change" })).toEqual([]);
  });

  it("reads codex function_call / custom_tool_call envelopes", () => {
    const fc = {
      timestamp: "2026-09-16T03:00:00.000Z",
      type: "response_item",
      payload: { type: "function_call", call_id: "c1", name: "exec_command", arguments: "{}" },
    };
    const out = {
      timestamp: "2026-09-16T03:00:01.000Z",
      type: "response_item",
      payload: { type: "function_call_output", call_id: "c1", output: "done" },
    };
    const patch = {
      type: "response_item",
      payload: { type: "custom_tool_call", call_id: "c2", name: "apply_patch", input: "..." },
    };
    const obs = [
      ...extractorFor("codex").parseLine(fc),
      ...extractorFor("codex").parseLine(out),
      ...extractorFor("codex").parseLine(patch),
    ];
    expect(obs).toHaveLength(3);
    expect(obs[0]).toMatchObject({ callId: "c1", rawToolName: "exec_command", phase: "started" });
    expect(obs[1]).toMatchObject({ callId: "c1", phase: "finished" });

    const folded = foldToolCalls("codex", obs);
    expect(folded[0].tool).toBe("bash");
    expect(folded[2].tool).toBe("edit");
  });

  it("parses a whole journal and skips malformed lines", () => {
    const body = [
      JSON.stringify({
        type: "message",
        message: { role: "assistant", content: [{ type: "toolCall", id: "a", name: "read" }] },
      }),
      "{ this is not json",
      "",
      JSON.stringify({
        type: "message",
        message: { role: "toolResult", toolCallId: "a", toolName: "read" },
      }),
    ].join("\n");

    const obs = parseTranscript("pi", body);
    expect(obs).toHaveLength(2);
    expect(foldToolCalls("pi", obs).map((f) => f.phase)).toEqual([
      "started",
      "finished",
    ]);
  });

  it("returns nothing for an empty or unparseable journal", () => {
    expect(parseTranscript("pi", "")).toEqual([]);
    expect(parseTranscript("codex", "not json at all")).toEqual([]);
  });

  it("drops a finish whose start was never seen", () => {
    // The reader attached mid-session; inventing a call would animate a tool
    // that this desktop never observed starting.
    const obs = parseTranscript(
      "pi",
      JSON.stringify({
        type: "message",
        message: { role: "toolResult", toolCallId: "ghost", toolName: "read" },
      }),
    );
    expect(foldToolCalls("pi", obs)).toEqual([]);
  });

  it("does not duplicate repeated identical transitions", () => {
    const line = JSON.stringify({
      type: "message",
      message: { role: "assistant", content: [{ type: "toolCall", id: "a", name: "read" }] },
    });
    const obs = parseTranscript("pi", `${line}\n${line}`);
    // Same call id + phase seen twice collapses to one entry.
    expect(foldToolCalls("pi", obs)).toHaveLength(1);
  });

  it("accepts epoch timestamps in seconds and milliseconds", () => {
    const ms = extractorFor("pi").parseLine({
      type: "message",
      message: { role: "assistant", content: [{ type: "toolCall", id: "a", name: "read" }] },
      timestamp: 1_758_000_000_000,
    });
    const sec = extractorFor("pi").parseLine({
      type: "message",
      message: { role: "assistant", content: [{ type: "toolCall", id: "b", name: "read" }] },
      timestamp: 1_758_000_000,
    });
    expect(ms[0].at).toBe(sec[0].at);
  });
});
