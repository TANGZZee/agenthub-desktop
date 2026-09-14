export const WORKER_TOOL_NAMES = [
  "worker.list",
  "worker.start",
  "worker.prompt",
  "worker.read",
  "worker.wait",
  "worker.cancel",
  "worker.retry",
  "worker.inspect",
] as const;

export type WorkerToolName = (typeof WORKER_TOOL_NAMES)[number];
export type WorkerKind = "echo" | "cli";
export type WorkerRunStatus =
  | "starting"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out";

export const TERMINAL_WORKER_STATUSES: readonly WorkerRunStatus[] = [
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
];

export function isTerminalWorkerStatus(status: WorkerRunStatus): boolean {
  return TERMINAL_WORKER_STATUSES.includes(status);
}

export interface WorkerProfile {
  id: string;
  name: string;
  kind: WorkerKind;
  /** Whether the user selected this Agent in the AgentHub catalog. */
  installed: boolean;
  /** Whether the selected Agent has a usable local executable. */
  enabled: boolean;
  command: string;
  args: string[];
  /** Main-process-owned prompt placement. Hermes cannot change this. */
  promptPlacement?: "env" | "final_arg";
  /** Default directory when a tool call omits cwd. */
  defaultCwd?: string;
  /** An empty list allows any existing directory. */
  cwdRoots: string[];
  timeoutMs: number;
  maxConcurrent: number;
  /** Extra env owned by the profile. Never accepted from tool args. */
  profileEnv?: Record<string, string>;
  /**
   * Main-process-owned readiness probes. Each probe is an argv appended to the
   * profile's own executable, and the worker starts only if at least one probe
   * exits 0. Used to fail fast with a readable reason (for example a CLI with no
   * model credentials) instead of spawning a process that can never answer.
   */
  preflight?: { probes: string[][]; hint: string };
  /**
   * Model the user picked from the Hermes model library for this worker. The
   * main process fills it in from the AgentHub settings store; the CLI's own
   * provider configuration and credentials are never rewritten.
   */
  model?: string | null;
}

/** Placeholder in `args` replaced by the chosen model, or dropped with its flag. */
export const WORKER_MODEL_PLACEHOLDER = "{model}";

/**
 * Normalize a model id chosen from the Hermes model library. The value reaches
 * a CLI's argv, so anything outside a conservative alphabet (letters, digits,
 * and `. _ : @ / + -`) is rejected instead of escaped — callers must treat a
 * null result as "no model".
 */
export function sanitizeWorkerModel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120) return null;
  return /^[A-Za-z0-9._:@/+-]+$/.test(trimmed) ? trimmed : null;
}

export interface LocalizedText {
  zh: string;
  en: string;
}

export type WorkerCatalogCategory =
  | "official"
  | "open-source"
  | "vendor-cli"
  | "china-ecosystem";

export type WorkerRunnerStatus = "available" | "planned";

/** Language-neutral permission tokens; the UI localizes their labels. */
export type WorkerPermissionToken =
  | "read"
  | "grep"
  | "find"
  | "ls"
  | "project-root"
  | "read-only-sandbox"
  | "no-write"
  | "planned";

export interface WorkerCatalogEntry {
  id: string;
  name: string;
  vendor: string;
  category: WorkerCatalogCategory;
  /** Market rank; null for AgentHub's own built-in worker. */
  rank: number | null;
  role: LocalizedText;
  description: LocalizedText;
  docsUrl: string;
  installHint: string;
  /** A matching executable exists on this machine. */
  detected: boolean;
  /** The user explicitly connected this agent to AgentHub. */
  installed: boolean;
  /** Installed *and* runnable, i.e. a reviewed runner exists. */
  enabled: boolean;
  executablePath: string | null;
  version: string | null;
  permissions: WorkerPermissionToken[];
  /** The connect button is usable: detected plus a reviewed runner. */
  installable: boolean;
  runner: WorkerRunnerStatus;
  /** AgentHub's own worker rather than an external CLI. */
  builtIn: boolean;
  /** Chosen model from the Hermes model library; null means the CLI default. */
  model: string | null;
  /** Whether this worker's runner accepts a model argument at all. */
  supportsModelSelection: boolean;
  note?: LocalizedText;
}

export interface WorkerCatalogResult {
  entries: WorkerCatalogEntry[];
}

/**
 * One model already configured in Hermes, offered to connected agents. AgentHub
 * never invents a provider, key, or endpoint: it only picks a model the user
 * already set up in Hermes, or a model named explicitly for one agent.
 */
export interface AgentHubModelOption {
  id: string;
  label: string;
  provider: string;
  model: string;
}

export interface PublicWorkerProfile {
  id: string;
  name: string;
  kind: WorkerKind;
  installed: boolean;
  enabled: boolean;
  timeoutMs: number;
  maxConcurrent: number;
  running: number;
}

export interface WorkerRunRecord {
  taskId: string;
  workerId: string;
  runId: string;
  status: WorkerRunStatus;
  promptPreview: string;
  summary: string;
  output: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  endedAt?: number;
  exitCode?: number | null;
  pid?: number;
  attempt: number;
  parentRunId?: string;
  cwd: string;
}

export interface WorkerStartArgs {
  workerId: string;
  prompt: string;
  cwd?: string;
  taskId?: string;
  timeoutMs?: number;
}

export interface WorkerToolOk {
  ok: true;
  tool: WorkerToolName;
  result: unknown;
}

export interface WorkerToolErr {
  ok: false;
  tool: WorkerToolName;
  error: string;
  code: string;
}

export type WorkerToolResponse = WorkerToolOk | WorkerToolErr;

export interface WorkerToolStatus {
  listening: boolean;
  url: string | null;
  tokenConfigured: boolean;
}

export const AGENTHUB_OUTPUT_LIMIT = 16_384;
export const AGENTHUB_PROMPT_LIMIT = 8_000;
export const AGENTHUB_PROMPT_PREVIEW_LIMIT = 240;
