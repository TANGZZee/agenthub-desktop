/**
 * Agent activity — provider-agnostic tool-call vocabulary.
 *
 * The desktop visualizes what its agents are doing. Every supported CLI writes
 * its session transcript as JSONL, but the *envelope* differs per CLI while the
 * underlying intent does not: all three emit "a tool started" and "a tool
 * finished/failed". This module is the single normalization seam:
 *
 *   layer 1 (per-CLI)  `src/main/agent-activity/transcripts.ts` finds the
 *                      tool-call envelope in each journal format.
 *   layer 2 (here)     maps the CLI's own tool name onto a canonical tool.
 *   layer 3 (here)     maps a canonical tool onto an animation group.
 *
 * Layers 2 and 3 are shared by every CLI, so adding a provider means writing an
 * envelope extractor and a name table — not another pipeline.
 *
 * Unknown tool names are never an error: they degrade to `other`, which has no
 * animation group. That keeps a CLI upgrade (or a brand-new tool) from breaking
 * the office instead of merely not animating it.
 */

/** CLI whose session journal we can read. */
export type AgentKind = "claude" | "pi" | "codex";

export const AGENT_KINDS: readonly AgentKind[] = ["claude", "pi", "codex"];

/**
 * Normalized tool intent. Deliberately small and semantic: these are the
 * categories a viewer can actually distinguish, not a mirror of any one CLI's
 * tool list.
 */
export type CanonicalTool =
  | "read"
  | "search"
  | "glob"
  | "fetch"
  | "websearch"
  | "write"
  | "edit"
  | "bash"
  | "task"
  | "other";

/**
 * Animation bucket a canonical tool belongs to. Mirrors the visual states the
 * office renderer can play; `null` means "no specific animation" (the character
 * stays in its resting state rather than pretending to work).
 */
export type AnimationGroup =
  | "reading"
  | "searching"
  | "writing"
  | "debugging"
  | "collaborating";

/** Lifecycle phase of one tool call. */
export type ToolPhase = "started" | "finished" | "failed";

/** One normalized tool-call event, independent of which CLI produced it. */
export interface ToolActivity {
  /** Which CLI journal this came from. */
  agentKind: AgentKind;
  /** Session identity (journal file path); stable across restarts. */
  sessionId: string;
  /** CLI-assigned call id, used to pair start with finish. */
  callId: string;
  /** The CLI's own tool name, kept for display/debugging. */
  rawToolName: string;
  tool: CanonicalTool;
  phase: ToolPhase;
  /** ISO-8601 timestamp of the journal entry. */
  at: string;
}

export const ANIMATION_GROUP: Readonly<
  Partial<Record<CanonicalTool, AnimationGroup>>
> = {
  read: "reading",
  fetch: "reading",
  search: "searching",
  glob: "searching",
  websearch: "searching",
  write: "writing",
  edit: "writing",
  bash: "debugging",
  task: "collaborating",
};

/** Animation group for a canonical tool, or null when it has none. */
export function animationGroupFor(tool: CanonicalTool): AnimationGroup | null {
  return ANIMATION_GROUP[tool] ?? null;
}

/**
 * Per-CLI tool-name tables.
 *
 * Keys are `normalizeToolName` output (lowercase, punctuation-stripped), so
 * `exec_command` is authored as `execcommand`. A name absent from every table
 * is `other`.
 */
const CLAUDE_TOOLS: Readonly<Record<string, CanonicalTool>> = {
  read: "read",
  notebookread: "read",
  grep: "search",
  glob: "glob",
  webfetch: "fetch",
  websearch: "websearch",
  write: "write",
  notebookedit: "edit",
  edit: "edit",
  multiedit: "edit",
  bash: "bash",
  bashoutput: "bash",
  killbash: "bash",
  killbackgroundtask: "bash",
  task: "task",
  agent: "task",
  taskcreate: "task",
  taskupdate: "task",
  taskstop: "task",
  taskget: "task",
  tasklist: "task",
};

/** pi's tools are Claude's lowercased, plus a few of its own. */
const PI_TOOLS: Readonly<Record<string, CanonicalTool>> = {
  read: "read",
  readmany: "read",
  grep: "search",
  search: "search",
  glob: "glob",
  find: "glob",
  ls: "glob",
  list: "glob",
  webfetch: "fetch",
  fetchcontent: "fetch",
  websearch: "websearch",
  getsearchcontent: "websearch",
  write: "write",
  edit: "edit",
  multiedit: "edit",
  applypatch: "edit",
  bash: "bash",
  shell: "bash",
  terminal: "bash",
  subagent: "task",
  task: "task",
};

/** Codex names describe the mechanism (`exec_command`), not the intent. */
const CODEX_TOOLS: Readonly<Record<string, CanonicalTool>> = {
  execcommand: "bash",
  shell: "bash",
  writestdin: "bash",
  applypatch: "edit",
  viewimage: "read",
  readfile: "read",
  readmcpresource: "read",
  listmcpresources: "read",
  spawnagent: "task",
  sendmessage: "task",
  websearch: "websearch",
  search: "search",
  js: "bash",
};

const TOOL_TABLES: Readonly<Record<AgentKind, Readonly<Record<string, CanonicalTool>>>> = {
  claude: CLAUDE_TOOLS,
  pi: PI_TOOLS,
  codex: CODEX_TOOLS,
};

/**
 * Reduce a raw tool name to a table key: trimmed, lowercased, punctuation
 * stripped, with any `mcp__server__tool` MCP prefix reduced to its final
 * segment so MCP tools can still match an intent-table entry.
 *
 * Punctuation is removed because the CLIs disagree on word separators for the
 * same concept — `exec_command` / `execCommand` / `exec-command` — and the
 * tables are authored in that reduced form (`execcommand`).
 */
export function normalizeToolName(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  const withoutMcp = trimmed.startsWith("mcp__")
    ? trimmed.split("__").pop() || trimmed
    : trimmed;
  return withoutMcp.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Canonical tool for `raw` as emitted by `kind`.
 *
 * MCP-prefixed names are also tried against every table, because a server tool
 * named `read` means "read" regardless of which CLI surfaced it.
 */
export function canonicalTool(kind: AgentKind, raw: string): CanonicalTool {
  const key = normalizeToolName(raw);
  if (!key) return "other";
  const direct = TOOL_TABLES[kind][key];
  if (direct) return direct;
  if (raw.startsWith("mcp__")) {
    for (const table of Object.values(TOOL_TABLES)) {
      const hit = table[key];
      if (hit) return hit;
    }
  }
  return "other";
}

/** True when this event should drive a visible animation change. */
export function isAnimated(tool: CanonicalTool): boolean {
  return animationGroupFor(tool) !== null;
}
