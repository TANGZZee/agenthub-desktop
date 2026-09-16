/**
 * Where each CLI keeps its session journals, and how to read them.
 *
 * The office visualization wants *recent* tool activity per agent. Every
 * supported CLI records that in a JSONL journal under a per-user directory, so
 * this module owns the "find the journals" concern and nothing else — parsing
 * lives in `transcripts.ts`, name/animation mapping in
 * `src/shared/agent-activity.ts`.
 *
 * Paths are resolved from a home directory passed in by the caller rather than
 * read from `os.homedir()` here, so tests can point at a fixture tree.
 */
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "fs";
import { join } from "path";
import type { AgentKind } from "../../shared/agent-activity";

export interface JournalLocation {
  kind: AgentKind;
  /** Directory scanned for journals, or null when the CLI has no directory. */
  dir: string | null;
}

/** Per-CLI journal layout, relative to the user's home directory. */
const LAYOUT: Readonly<Record<AgentKind, string[]>> = {
  claude: [".claude", "projects"],
  pi: [".pi", "agent", "sessions"],
  codex: [".codex", "sessions"],
};

/**
 * Resolve the journal directory for one CLI.
 *
 * `HERMES_ACTIVITY_HOME_<KIND>` overrides the base home per provider, which is
 * what makes this testable without touching a real user profile.
 */
export function journalLocation(kind: AgentKind, home: string): JournalLocation {
  const override =
    process.env[`HERMES_ACTIVITY_HOME_${kind.toUpperCase()}`]?.trim() || home;
  const dir = join(override, ...LAYOUT[kind]);
  return { kind, dir: existsSync(dir) ? dir : null };
}

/** Journal file matcher per CLI — codex prefixes its rollouts. */
const FILE_MATCHERS: Readonly<Record<AgentKind, (name: string) => boolean>> = {
  claude: (n) => n.endsWith(".jsonl"),
  pi: (n) => n.endsWith(".jsonl"),
  codex: (n) => /^rollout-.*\.jsonl$/.test(n),
};

export interface JournalFile {
  kind: AgentKind;
  path: string;
  /** Last modification time (ms since epoch). */
  mtimeMs: number;
  sizeBytes: number;
}

/**
 * List journal files under `dir`, newest first, bounded by `maxFiles`.
 *
 * The bounded walk matters: these directories grow without limit (this machine
 * alone holds 100+ journals totalling hundreds of MB), so callers must be able
 * to ask for "the N most recent" without enumerating everything.
 */
export function listJournals(
  kind: AgentKind,
  dir: string,
  maxFiles: number,
): JournalFile[] {
  const matches = FILE_MATCHERS[kind];
  const found: JournalFile[] = [];
  const stack = [dir];
  let visited = 0;
  // A hard node budget keeps a pathological tree from stalling the main
  // process; journals are shallow, so this is never reached in practice.
  const NODE_BUDGET = 20_000;

  while (stack.length > 0 && visited < NODE_BUDGET) {
    const current = stack.pop();
    if (current === undefined) break;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      visited += 1;
      if (visited >= NODE_BUDGET) break;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!matches(entry.name)) continue;
      try {
        const st = statSync(full);
        found.push({
          kind,
          path: full,
          mtimeMs: st.mtimeMs,
          sizeBytes: st.size,
        });
      } catch {
        // Raced with a deletion — skip it.
      }
    }
  }

  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found.slice(0, maxFiles);
}

/**
 * Read the tail of a journal.
 *
 * A journal is append-only and can be very large (one codex rollout here is
 * 48 MB), so only the last `maxBytes` are read: the newest tool activity is
 * always at the end. A partial leading line is expected and harmless —
 * `parseTranscript` skips unparseable lines.
 */
export function readJournalTail(path: string, maxBytes: number): string {
  const st = statSync(path);
  if (st.size <= maxBytes) return readFileSync(path, "utf8");

  const fd = openSync(path, "r");
  try {
    const length = maxBytes;
    const start = st.size - length;
    const buffer = Buffer.allocUnsafe(length);
    const read = readSync(fd, buffer, 0, length, start);
    return buffer.subarray(0, read).toString("utf8");
  } finally {
    closeSync(fd);
  }
}
