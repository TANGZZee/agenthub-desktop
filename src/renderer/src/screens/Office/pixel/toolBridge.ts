/**
 * Bridge AgentHub's canonical tool vocabulary onto the pixel engine's words.
 *
 * `src/shared/agent-activity.ts` normalizes every CLI (Claude Code, pi, codex)
 * onto a small canonical set. The ported engine (MIT, `noya21th/996`) instead
 * switches on its own hard-coded names — `Read`/`Grep`/`Bash`/… — to choose
 * between its typing and reading animations, and returns `null` for anything
 * it doesn't recognize.
 *
 * Keeping the translation here means the shared vocabulary stays free of one
 * renderer's spelling, and a future renderer can map the same canonical tools
 * its own way.
 */
import type { CanonicalTool } from "../../../../../shared/agent-activity";

/**
 * Engine tool name for a canonical tool, or null when the engine has no
 * animation for it.
 *
 * The engine's own set is exactly Read, Grep, Glob, WebFetch, WebSearch,
 * Write, Edit, Bash and Task; `other` deliberately maps to null so an
 * unrecognized CLI tool leaves the character resting rather than inventing an
 * animation.
 */
const ENGINE_TOOL: Readonly<Record<CanonicalTool, string | null>> = {
  read: "Read",
  search: "Grep",
  glob: "Glob",
  fetch: "WebFetch",
  websearch: "WebSearch",
  write: "Write",
  edit: "Edit",
  bash: "Bash",
  task: "Task",
  other: null,
};

export function engineToolFor(tool: CanonicalTool | null): string | null {
  if (!tool) return null;
  return ENGINE_TOOL[tool] ?? null;
}
