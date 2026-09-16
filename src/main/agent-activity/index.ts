/**
 * Merge "which agents exist" with "what each one is doing".
 *
 * The office has two independent sources of truth, and they answer different
 * questions:
 *
 *   - AgentHub's worker/task layer says **who exists** and whether they are
 *     working (the durable, authoritative roster).
 *   - Each CLI's JSONL journal says **what a session is doing right now**
 *     (tool-level detail the worker layer doesn't have).
 *
 * Neither alone is enough. Worker state without journals can only animate
 * "working/idle" and loses the tool-level animation; journals without workers
 * would show sessions for agents the user has disabled, and would hide an agent
 * that is enabled but hasn't run yet. This module joins them by agent id.
 */
import type { AgentKind } from "../../shared/agent-activity";
import {
  AGENT_KINDS,
  type CanonicalTool,
} from "../../shared/agent-activity";
import {
  foldToolCalls,
  parseTranscript,
  type FoldedToolCall,
} from "./transcripts";
import { journalLocation, listJournals, readJournalTail } from "./journals";
import { homedir } from "os";

/** One agent as the worker layer describes it. */
export interface AgentRosterEntry {
  /** Stable id shared with the CLI journal layout (e.g. "pi", "codex"). */
  id: string;
  /** Display name for the office character label. */
  name: string;
  /** Whether the worker layer considers this agent enabled/installed. */
  enabled: boolean;
  /** In-flight runs reported by the worker layer. */
  runningCount: number;
}

/** Per-agent activity snapshot handed to the renderer. */
export interface AgentActivity {
  agentId: string;
  /** Canonical tool currently running, or null when idle. */
  currentTool: CanonicalTool | null;
  /** Raw CLI tool name, for display/debugging. */
  rawToolName: string | null;
  /** Recent finished/failed transitions, newest first. */
  recent: Array<{ tool: CanonicalTool; phase: "finished" | "failed"; at: string | null }>;
  /** Counts of failed tool calls in the observed window. */
  failedCount: number;
}

/**
 * Journal "kind" for an AgentHub worker id.
 *
 * AgentHub ids are the CLI slugs the sidecar launches, so they map directly;
 * anything else has no journal and falls back to worker-only state.
 */
export function journalKindFor(agentId: string): AgentKind | null {
  const normalized = (agentId || "").trim().toLowerCase();
  if (normalized === "claude" || normalized === "claude-code") return "claude";
  if (normalized === "pi") return "pi";
  if (normalized === "codex") return "codex";
  return null;
}

export interface CollectOptions {
  /** Home directory holding the CLI journals. */
  home?: string;
  /** How many journals per CLI to inspect (newest first). */
  maxJournalsPerAgent?: number;
  /** Bytes read from the tail of each journal. */
  maxBytesPerJournal?: number;
  /** Only transitions at/after this epoch-ms count as "recent". */
  sinceMs?: number;
}

const DEFAULTS = {
  maxJournalsPerAgent: 3,
  maxBytesPerJournal: 256 * 1024,
  // Tool activity older than this isn't "current"; a stale journal must read as
  // idle rather than leaving a character frozen mid-animation forever.
  freshnessMs: 10 * 60 * 1000,
} as const;

/**
 * Read one agent's journal activity.
 *
 * `started` transitions with no matching terminal event are treated as
 * *currently running* only while the journal is fresh; an abandoned call would
 * otherwise animate forever. The newest such call wins.
 */
function readAgentActivity(
  agentId: string,
  kind: AgentKind,
  options: Required<Pick<CollectOptions, "maxJournalsPerAgent" | "maxBytesPerJournal">> & {
    home: string;
    sinceMs: number;
  },
): AgentActivity {
  const idle: AgentActivity = {
    agentId,
    currentTool: null,
    rawToolName: null,
    recent: [],
    failedCount: 0,
  };

  const location = journalLocation(kind, options.home);
  if (!location.dir) return idle;

  const journals = listJournals(kind, location.dir, options.maxJournalsPerAgent);
  if (journals.length === 0) return idle;

  const calls: FoldedToolCall[] = [];
  for (const journal of journals) {
    let body: string;
    try {
      body = readJournalTail(journal.path, options.maxBytesPerJournal);
    } catch {
      continue;
    }
    const observations = parseTranscript(kind, body);
    calls.push(...foldToolCalls(kind, observations));
  }
  if (calls.length === 0) return idle;

  const atMs = (call: FoldedToolCall): number =>
    call.at ? Date.parse(call.at) : Number.NaN;

  const fresh = calls.filter((call) => {
    const ms = atMs(call);
    if (Number.isNaN(ms)) return true; // No timestamp: can't prove it's stale.
    return ms >= options.sinceMs;
  });
  if (fresh.length === 0) return idle;

  // Pair each start with its terminal event so "running" means "no finish yet",
  // not merely "a start exists somewhere".
  const terminal = new Map<string, FoldedToolCall>();
  for (const call of fresh) {
    if (call.phase !== "started") terminal.set(call.callId, call);
  }
  const openStarts = fresh.filter(
    (call) => call.phase === "started" && !terminal.has(call.callId),
  );

  // Newest unfinished call = what the agent is doing now.
  let current: FoldedToolCall | null = null;
  let currentMs = -Infinity;
  for (const call of openStarts) {
    const ms = atMs(call);
    const score = Number.isNaN(ms) ? 0 : ms;
    if (score >= currentMs) {
      currentMs = score;
      current = call;
    }
  }

  const recent = fresh
    .filter((call) => call.phase !== "started")
    .slice(-20)
    .reverse()
    .map((call) => ({
      tool: call.tool,
      phase: call.phase === "failed" ? ("failed" as const) : ("finished" as const),
      at: call.at,
    }));

  return {
    agentId,
    currentTool: current?.tool ?? null,
    rawToolName: current?.rawToolName ?? null,
    recent,
    failedCount: recent.filter((r) => r.phase === "failed").length,
  };
}

/**
 * Agents with a journal written recently — i.e. actually running.
 *
 * The connected-worker roster only knows about agents the user explicitly
 * connected through the Capabilities screen. An agent configured in
 * `config/agents.json` and currently working is absent from that list, which
 * would leave the office empty while its agents are demonstrably busy.
 *
 * Journal recency is the honest signal for "this agent is working right now":
 * every CLI appends to its journal as it runs. This deliberately does NOT
 * invent an agent from a stale journal — the window is the same freshness
 * bound the activity reader uses, so an agent that stopped working disappears
 * rather than lingering as a ghost.
 */
export function discoverActiveAgents(
  options: CollectOptions = {},
): AgentRosterEntry[] {
  const home = options.home ?? homedir();
  const sinceMs = options.sinceMs ?? Date.now() - DEFAULTS.freshnessMs;
  const found: AgentRosterEntry[] = [];

  for (const kind of AGENT_KINDS) {
    const location = journalLocation(kind, home);
    if (!location.dir) continue;
    try {
      const journals = listJournals(kind, location.dir, 1);
      const newest = journals[0];
      if (!newest || newest.mtimeMs < sinceMs) continue;
      found.push({
        id: kind,
        name: kind,
        enabled: true,
        runningCount: 1,
      });
    } catch {
      // An unreadable journal directory just means "nothing active" here.
    }
  }
  return found;
}

/**
 * Build the activity list for a roster.
 *
 * Agents without a recognizable journal kind simply report idle activity rather
 * than being dropped — the roster (not the journal) decides who exists.
 */
export function collectAgentActivity(
  roster: readonly AgentRosterEntry[],
  options: CollectOptions = {},
): AgentActivity[] {
  const now = Date.now();
  const resolved = {
    home: options.home ?? homedir(),
    maxJournalsPerAgent: options.maxJournalsPerAgent ?? DEFAULTS.maxJournalsPerAgent,
    maxBytesPerJournal: options.maxBytesPerJournal ?? DEFAULTS.maxBytesPerJournal,
    sinceMs: options.sinceMs ?? now - DEFAULTS.freshnessMs,
  };

  return roster.map((entry) => {
    const kind = journalKindFor(entry.id);
    if (!kind) {
      return {
        agentId: entry.id,
        currentTool: null,
        rawToolName: null,
        recent: [],
        failedCount: 0,
      };
    }
    try {
      return readAgentActivity(entry.id, kind, resolved);
    } catch {
      // A journal read must never take down the roster; degrade to idle.
      return {
        agentId: entry.id,
        currentTool: null,
        rawToolName: null,
        recent: [],
        failedCount: 0,
      };
    }
  });
}

/**
 * Merge the connected-worker roster with the journal-active one.
 *
 * The connected roster wins on identity (it carries the user's display names
 * and is the authoritative "who exists"), while journal-active agents not in
 * that roster are appended so a working agent is never invisible. An id in both
 * is reported once.
 */
export function collectOfficeActivity(
  connected: readonly AgentRosterEntry[],
  options: CollectOptions = {},
): AgentActivity[] {
  const seen = new Set(connected.map((entry) => entry.id.toLowerCase()));
  const merged: AgentRosterEntry[] = [...connected];
  for (const active of discoverActiveAgents(options)) {
    if (seen.has(active.id.toLowerCase())) continue;
    seen.add(active.id.toLowerCase());
    merged.push(active);
  }
  return collectAgentActivity(merged, options);
}
