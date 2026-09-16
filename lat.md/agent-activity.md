# Agent Activity

The desktop shows what its agents are doing by reading each CLI's own session journal, normalized into one tool vocabulary so the visualization never needs to know which CLI produced an event.

Agents are driven by two independent sources that answer different questions, joined at the [[src/main/agent-activity/index.ts#collectAgentActivity]] seam:

- **Who exists** — the AgentHub catalog plus its worker layer. This is the authoritative roster; an agent the user has not connected never appears.
- **What each one is doing** — the CLI's JSONL session journal, which carries tool-level detail the worker layer does not.

Worker state alone could only animate "working/idle"; journals alone would show sessions for agents the user disabled and hide an enabled agent that has not run yet. Neither source is dropped when the other is unavailable: a missing journal degrades that agent to idle rather than removing it from the roster.

## Three-layer normalization

The pipeline is split so that adding a CLI means writing one envelope extractor and one name table — never another end-to-end pipeline.

1. **Envelope extraction** ([[src/main/agent-activity/transcripts.ts]]) finds "a tool started" and "a tool finished" in one journal format. Each extractor knows only its own shape.
2. **Vocabulary normalization** ([[src/shared/agent-activity.ts#canonicalTool]]) maps the CLI's own tool name onto a canonical tool.
3. **Animation mapping** ([[src/shared/agent-activity.ts#animationGroupFor]]) maps a canonical tool onto the animation group the office can play.

An unknown tool name is never an error: it becomes `other`, which has no animation group. A CLI upgrade that introduces a new tool therefore degrades to "no animation" instead of breaking the reader — verified by tests that feed deliberately unmapped names.

## Per-CLI journal formats

Each extractor's shape was verified against real journals on disk, not inferred from documentation.

### Claude Code

Journals live under `<home>/.claude/projects/`. Tool calls are content blocks: a `tool_use` block starts a call, and a `tool_result` block keyed by `tool_use_id` ends it, carrying `is_error` on failure.

A `tool_result` carries **no tool name** — only the id it answers — so [[src/main/agent-activity/transcripts.ts#foldToolCalls]] recovers the name from the paired start. Without that pairing every completion would render as `other` and the character would stop animating the moment a tool finished.

### pi

Journals live under `<home>/.pi/agent/sessions/`. A `message` entry whose `content[]` holds `toolCall` blocks starts a call; a separate `toolResult` message (with top-level `toolCallId`, `toolName`, and `isError`) ends it.

Unlike Claude, pi's terminal event *does* name the tool, so its completions stay animatable even if the matching start scrolled out of the read window.

### codex

Journals live under `<home>/.codex/sessions/` as `rollout-*.jsonl`, nested in date directories.

Tool calls sit on `payload.type` of an otherwise opaque envelope: `function_call` / `custom_tool_call` start, `function_call_output` / `custom_tool_call_output` finish. Codex names describe the **mechanism** rather than the intent — `exec_command`, `apply_patch`, `write_stdin` — so its table is the only one where the mapping is not close to an identity.

## Journal discovery and bounded reads

Journals grow without limit; this machine holds 100+ files totalling hundreds of MB, with individual codex rollouts near 48 MB. Reading them whole on a poll would stall the main process, so:

- [[src/main/agent-activity/journals.ts#listJournals]] walks with a node budget, matches each CLI's filename convention (codex prefixes its rollout files, so a bare `.jsonl` filter would pick up `session_index.jsonl`), and returns only the newest N.
- [[src/main/agent-activity/journals.ts#readJournalTail]] reads only the last `maxBytes` of a file, since the newest activity is always at the end. A partial leading line is expected and harmless because the parser skips unparseable lines.

## Freshness and "currently running"

`started` with no matching terminal event means *running now* — but only while the journal is fresh.

An abandoned call, a crashed CLI, or a journal from last week would otherwise leave a character frozen mid-animation forever, so activity older than a bounded window reads as idle.

A terminal event whose start was never observed is dropped. Emitting it would invent a tool call this desktop never watched begin, and the animation layer has no prior state to transition from.

## Resume-safety

A journal can be read mid-session, so the parser tolerates malformed lines, unknown envelope types, missing timestamps, and both seconds- and milliseconds-epoch values.

A hostile or truncated line must never abort the rest of the journal. [[tests/agent-activity.test.ts]] and [[tests/agent-activity-journals.test.ts]] cover each of those cases, and [[src/main/ipc/register.ts]] wraps the whole collection so a journal failure degrades to idle rather than failing the IPC call.

## Verification against real journals

The unit fixtures reproduce the envelope shapes, and the extractors were additionally run over the real journals on this machine to confirm the schemas match what the CLIs actually write.

Claude Code (11 files, ~2.5k transitions), pi (61 files, ~9.4k transitions), and codex (28 files, ~6k transitions) all parsed with zero unmatched envelopes. That check is machine-specific and therefore not part of the committed suite.
