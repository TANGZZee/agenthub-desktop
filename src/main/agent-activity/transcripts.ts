/**
 * Per-CLI transcript parsing — layer 1 of the agent-activity pipeline.
 *
 * Each supported CLI appends JSONL to a session journal, but the *shape* of a
 * tool call differs. These extractors know only how to find "a tool started"
 * and "a tool finished" in one format; the caller normalizes the tool name via
 * `src/shared/agent-activity.ts` (layers 2/3), so no extractor needs to know
 * about animations.
 *
 * Schemas below were verified against real journals on disk:
 *
 *   claude  `~/.claude/projects/<slug>/<session>.jsonl`
 *           { message: { content: [ { type:"tool_use", id, name } ] } }
 *           { message: { content: [ { type:"tool_result", tool_use_id } ] } }
 *
 *   pi      `~/.pi/agent/sessions/<slug>/<session>.jsonl`
 *           { type:"message", message:{ role:"assistant",
 *             content:[ { type:"toolCall", id, name } ] } }
 *           { type:"message", message:{ role:"toolResult",
 *             toolCallId, toolName, isError } }
 *
 *   codex   `<codex-home>/sessions/<yyyy>/<mm>/<dd>/rollout-<ts>.jsonl`
 *           { payload: { type:"function_call", call_id, name } }
 *           { payload: { type:"function_call_output", call_id } }
 *           { payload: { type:"custom_tool_call", call_id, name } }
 *           { payload: { type:"custom_tool_call_output", call_id } }
 *
 * Every extractor is defensive: a malformed line, an unknown envelope, or a
 * newer schema field yields nothing rather than throwing. A CLI upgrade must
 * degrade to "no animation", never to a crashed journal reader.
 */
import type { AgentKind } from "../../shared/agent-activity";
import { canonicalTool, type ToolPhase } from "../../shared/agent-activity";

/** One raw tool-call observation, before name normalisation downstream. */
export interface RawToolObservation {
  callId: string;
  rawToolName: string;
  phase: ToolPhase;
  /** ISO timestamp when the journal provided one, else null. */
  at: string | null;
}

export interface TranscriptExtractor {
  kind: AgentKind;
  /** Parse one JSONL line. Returns every tool observation it carries. */
  parseLine(value: unknown): RawToolObservation[];
}

/** Narrow an unknown to a plain object without trusting its contents. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** ISO-or-null coercion; a numeric epoch is accepted (pi writes ms). */
function asTimestamp(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // pi mixes seconds and milliseconds; anything below ~1e12 is seconds.
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

/**
 * Claude Code: tool calls live in `message.content[]` blocks. A `tool_use`
 * block starts a call; a `tool_result` block (keyed by `tool_use_id`) ends it,
 * carrying `is_error` when the tool failed.
 */
const claudeExtractor: TranscriptExtractor = {
  kind: "claude",
  parseLine(value) {
    const line = asRecord(value);
    if (!line) return [];
    const message = asRecord(line.message);
    if (!message) return [];
    const content = message.content;
    if (!Array.isArray(content)) return [];
    const at = asTimestamp(line.timestamp) ?? asTimestamp(message.timestamp);
    const out: RawToolObservation[] = [];
    for (const raw of content) {
      const block = asRecord(raw);
      if (!block) continue;
      const type = asString(block.type);
      if (type === "tool_use") {
        const callId = asString(block.id);
        const name = asString(block.name);
        if (callId && name) {
          out.push({ callId, rawToolName: name, phase: "started", at });
        }
      } else if (type === "tool_result") {
        const callId = asString(block.tool_use_id);
        if (!callId) continue;
        // A result carries no tool name; downstream pairs it with the start.
        out.push({
          callId,
          rawToolName: "",
          phase: block.is_error === true ? "failed" : "finished",
          at,
        });
      }
    }
    return out;
  },
};

/**
 * pi: a `message` entry whose `content[]` holds `toolCall` blocks starts a
 * call; a separate `toolResult` message (top-level `toolCallId`/`toolName`,
 * plus `isError`) ends it.
 */
const piExtractor: TranscriptExtractor = {
  kind: "pi",
  parseLine(value) {
    const line = asRecord(value);
    if (!line) return [];
    if (asString(line.type) !== "message") return [];
    const message = asRecord(line.message);
    if (!message) return [];
    const at = asTimestamp(line.timestamp) ?? asTimestamp(message.timestamp);
    const role = asString(message.role);

    if (role === "toolResult") {
      const callId = asString(message.toolCallId);
      if (!callId) return [];
      return [
        {
          callId,
          rawToolName: asString(message.toolName),
          phase: message.isError === true ? "failed" : "finished",
          at,
        },
      ];
    }

    const content = message.content;
    if (!Array.isArray(content)) return [];
    const out: RawToolObservation[] = [];
    for (const raw of content) {
      const block = asRecord(raw);
      if (!block) continue;
      if (asString(block.type) !== "toolCall") continue;
      const callId = asString(block.id);
      const name = asString(block.name);
      if (callId && name) {
        out.push({ callId, rawToolName: name, phase: "started", at });
      }
    }
    return out;
  },
};

/**
 * Codex: the tool call is `payload.type` on an otherwise opaque envelope
 * (`response_item` / `event_msg` wrapper). `custom_tool_call` is the
 * `apply_patch` variant and carries the same `call_id`/`name` pair.
 */
const codexExtractor: TranscriptExtractor = {
  kind: "codex",
  parseLine(value) {
    const line = asRecord(value);
    if (!line) return [];
    const payload = asRecord(line.payload);
    if (!payload) return [];
    const type = asString(payload.type);
    const at = asTimestamp(line.timestamp) ?? asTimestamp(payload.timestamp);
    const callId = asString(payload.call_id) || asString(payload.id);
    if (!callId) return [];

    if (type === "function_call" || type === "custom_tool_call") {
      const name = asString(payload.name);
      if (!name) return [];
      return [{ callId, rawToolName: name, phase: "started", at }];
    }
    if (
      type === "function_call_output" ||
      type === "custom_tool_call_output"
    ) {
      // Codex records success/failure inside the output string itself; treat
      // the mere presence of an output as completion rather than guessing.
      return [{ callId, rawToolName: "", phase: "finished", at }];
    }
    return [];
  },
};

const EXTRACTORS: Readonly<Record<AgentKind, TranscriptExtractor>> = {
  claude: claudeExtractor,
  pi: piExtractor,
  codex: codexExtractor,
};

export function extractorFor(kind: AgentKind): TranscriptExtractor {
  return EXTRACTORS[kind];
}

/**
 * Parse a whole journal body, tolerating blank and malformed lines.
 *
 * `started` events whose finish never arrives (the CLI exited mid-tool, or the
 * journal is still being written) are returned as-is; resolving them is the
 * caller's business since only it knows whether the session is still live.
 */
export function parseTranscript(
  kind: AgentKind,
  body: string,
): RawToolObservation[] {
  const extractor = EXTRACTORS[kind];
  const out: RawToolObservation[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    try {
      out.push(...extractor.parseLine(parsed));
    } catch {
      // A hostile/odd line must never abort the rest of the journal.
    }
  }
  return out;
}

/**
 * Fold observations into per-call state, pairing starts with finishes.
 *
 * A finish with no matching start (the reader attached mid-session, or the
 * start predates the journal tail) is dropped rather than inventing a call.
 * `resolveToolName` lets the caller recover a name for CLIs whose finish event
 * omits it (Claude's `tool_result` carries only the id).
 */
export interface FoldedToolCall {
  callId: string;
  rawToolName: string;
  tool: ReturnType<typeof canonicalTool>;
  phase: ToolPhase;
  at: string | null;
}

export function foldToolCalls(
  kind: AgentKind,
  observations: readonly RawToolObservation[],
  resolveToolName?: (callId: string) => string | undefined,
): FoldedToolCall[] {
  const names = new Map<string, string>();
  for (const obs of observations) {
    if (obs.rawToolName) names.set(obs.callId, obs.rawToolName);
  }
  const out: FoldedToolCall[] = [];
  const seen = new Set<string>();
  const started = new Set<string>();
  for (const obs of observations) {
    // A finish may carry no name (Claude's `tool_result` has only the id), so
    // fall back to the start we already saw, then to the caller's resolver.
    const rawToolName =
      obs.rawToolName || names.get(obs.callId) || resolveToolName?.(obs.callId) || "";
    // Emit transitions only: the first `started`, then a terminal phase.
    const key = `${obs.callId}:${obs.phase}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (obs.phase === "started") {
      if (!rawToolName) continue;
      started.add(obs.callId);
      out.push({
        callId: obs.callId,
        rawToolName,
        tool: canonicalTool(kind, rawToolName),
        phase: "started",
        at: obs.at,
      });
      continue;
    }

    // A terminal event for a call we never saw start (the reader attached
    // mid-session, or the start predates the journal tail) is dropped: the
    // animation layer has no state to transition from, so emitting it would
    // invent a tool call this desktop never observed running.
    if (!started.has(obs.callId)) continue;
    out.push({
      callId: obs.callId,
      rawToolName,
      tool: canonicalTool(kind, rawToolName),
      phase: obs.phase,
      at: obs.at,
    });
  }
  return out;
}
