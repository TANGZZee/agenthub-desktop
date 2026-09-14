import { execFileSync } from "child_process";
import { mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import {
  AGENTHUB_OUTPUT_LIMIT,
  AGENTHUB_PROMPT_PREVIEW_LIMIT,
  WORKER_MODEL_PLACEHOLDER,
  WORKER_TOOL_NAMES,
  sanitizeWorkerModel,
  isTerminalWorkerStatus,
  type PublicWorkerProfile,
  type WorkerProfile,
  type WorkerRunRecord,
  type WorkerToolName,
  type WorkerToolResponse,
} from "../../shared/agenthub";
import {
  AdmissionError,
  parseStartArgs,
  resolveAdmittedCwd,
} from "./admission";
import { collectSecretValues, redactSecrets } from "./redact";
import { getAgentHubCatalogStore, getSelectedAgentHubIds } from "./catalog";
import { getRegisteredWorkerProfiles } from "./profiles";
import {
  createNodeProcessRunner,
  resolveWorkerLaunch,
  type ProcessRunner,
  type SpawnedWorker,
} from "./runner";

interface LiveRun {
  record: WorkerRunRecord;
  prompt: string;
  timeoutMs: number;
  rawOutput: string;
  secrets: string[];
  handle?: SpawnedWorker;
  timeout?: NodeJS.Timeout;
  waiters: Array<() => void>;
  finishing: boolean;
}

export type PreflightRunner = (spec: {
  command: string;
  args: string[];
}) => boolean;

export interface OrchestratorOptions {
  workers?: WorkerProfile[];
  runner?: ProcessRunner;
  preflightRunner?: PreflightRunner;
  now?: () => number;
  defaultCwd?: string;
  onChange?: () => void;
}

function defaultWorkspace(): string {
  const dir = join(process.cwd(), "Temp", "agenthub-workspaces", "echo");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Fill in the profile's model placeholder. `{model}` is replaced by the value
 * the user picked from the Hermes model library; when no model is chosen the
 * placeholder and the flag immediately before it are dropped, so the CLI keeps
 * its own default. The value is validated first: it lands in argv, so anything
 * outside a conservative model-id alphabet is refused rather than escaped.
 */
function expandProfileArgs(
  args: readonly string[],
  model: string | null,
): string[] {
  const chosen = sanitizeWorkerModel(model);
  const expanded: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === WORKER_MODEL_PLACEHOLDER) continue;
    if (args[index + 1] === WORKER_MODEL_PLACEHOLDER) {
      if (chosen) expanded.push(arg, chosen);
      index += 1;
      continue;
    }
    expanded.push(arg);
  }
  return expanded;
}

/**
 * Default readiness probe: run one probe argv with the worker's own executable.
 * `ELECTRON_RUN_AS_NODE` keeps the Electron binary behaving as plain Node when
 * a Windows shim was resolved to a JavaScript entry.
 */
function defaultPreflightRunner(spec: {
  command: string;
  args: string[];
}): boolean {
  const launch = resolveWorkerLaunch(spec.command, spec.args);
  try {
    execFileSync(launch.command, launch.args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      timeout: 10_000,
      encoding: "utf8",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Refuse to spawn a worker that cannot possibly answer: first that its command
 * is launchable at all, then that at least one of the profile's readiness
 * probes exits 0 (for example a CLI with working model credentials). This turns
 * a silent multi-minute hang into an immediate, readable admission error.
 */
function assertWorkerReady(profile: WorkerProfile, run: PreflightRunner): void {
  try {
    resolveWorkerLaunch(profile.command, []);
  } catch (err) {
    throw new AdmissionError(
      "worker_unlaunchable",
      err instanceof Error ? err.message : String(err),
    );
  }
  const preflight = profile.preflight;
  if (!preflight || preflight.probes.length === 0) return;
  const passed = preflight.probes.some((args) => {
    try {
      return run({ command: profile.command, args });
    } catch {
      return false;
    }
  });
  if (!passed) {
    throw new AdmissionError("worker_not_ready", preflight.hint);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function previewPrompt(prompt: string, secrets: string[]): string {
  const redacted = redactSecrets(prompt, secrets);
  return redacted.length <= AGENTHUB_PROMPT_PREVIEW_LIMIT
    ? redacted
    : `${redacted.slice(0, AGENTHUB_PROMPT_PREVIEW_LIMIT)}…`;
}

function summarize(status: WorkerRunStatus, output: string): string {
  const trimmed = output.trim();
  if (status === "timed_out") return "Worker timed out.";
  if (status === "cancelled") return "Worker cancelled.";
  if (status === "failed") return trimmed.slice(0, 280) || "Worker failed.";
  if (!trimmed) return "Worker finished with no output.";
  return (trimmed.split(/\r?\n/).find(Boolean) || trimmed).slice(0, 280);
}

type WorkerRunStatus = WorkerRunRecord["status"];

export class WorkerOrchestrator {
  private readonly workers: Map<string, WorkerProfile>;
  private readonly runner: ProcessRunner;
  private readonly now: () => number;
  private readonly defaultCwd: string;
  private readonly onChange?: () => void;
  private readonly preflightRunner: PreflightRunner;
  private readonly runs = new Map<string, LiveRun>();

  constructor(options: OrchestratorOptions = {}) {
    this.defaultCwd = options.defaultCwd ?? defaultWorkspace();
    this.workers = new Map(
      (
        options.workers ??
        getRegisteredWorkerProfiles(
          this.defaultCwd,
          getSelectedAgentHubIds(),
          (id) => getAgentHubCatalogStore().modelFor(id),
        )
      )
        .filter((profile) => profile.installed && profile.enabled)
        .map((profile) => [profile.id, profile]),
    );
    this.runner = options.runner ?? createNodeProcessRunner();
    this.now = options.now ?? Date.now;
    this.preflightRunner = options.preflightRunner ?? defaultPreflightRunner;
    this.onChange = options.onChange;
  }

  // @lat: [[agenthub-workers#Tool boundary]]
  dispatch(tool: string, rawArgs: unknown): Promise<WorkerToolResponse> {
    const name = tool as WorkerToolName;
    if (!WORKER_TOOL_NAMES.includes(name)) {
      return Promise.resolve({
        ok: false,
        tool: "worker.inspect",
        error: `Unknown worker tool: ${tool}`,
        code: "unknown_tool",
      });
    }
    try {
      const args = asRecord(rawArgs);
      switch (name) {
        case "worker.list":
          return Promise.resolve(this.ok(name, this.list()));
        case "worker.start":
          return Promise.resolve(this.ok(name, this.start(args)));
        case "worker.prompt":
          return Promise.resolve(this.ok(name, this.prompt(args)));
        case "worker.read":
          return Promise.resolve(this.ok(name, this.read(args)));
        case "worker.wait":
          return this.wait(args).then((result) => this.ok(name, result));
        case "worker.cancel":
          return Promise.resolve(this.ok(name, this.cancel(args)));
        case "worker.retry":
          return Promise.resolve(this.ok(name, this.retry(args)));
        case "worker.inspect":
          return Promise.resolve(this.ok(name, this.inspect(args)));
      }
    } catch (err) {
      return Promise.resolve(this.fail(name, err));
    }
  }

  list(): { workers: PublicWorkerProfile[]; runs: WorkerRunRecord[] } {
    return {
      workers: [...this.workers.values()].map((profile) => ({
        id: profile.id,
        name: profile.name,
        kind: profile.kind,
        installed: profile.installed,
        enabled: profile.enabled,
        timeoutMs: profile.timeoutMs,
        maxConcurrent: profile.maxConcurrent,
        running: this.runningCount(profile.id),
      })),
      runs: this.publicRuns(),
    };
  }

  start(raw: Record<string, unknown>): WorkerRunRecord {
    const parsed = parseStartArgs(raw);
    const profile = this.requireWorker(parsed.workerId);
    if (!profile.enabled) {
      throw new AdmissionError(
        "disabled",
        `Worker '${profile.id}' is disabled.`,
      );
    }
    if (this.runningCount(profile.id) >= profile.maxConcurrent) {
      throw new AdmissionError("busy", `Worker '${profile.id}' is busy.`);
    }
    const cwd = resolveAdmittedCwd(
      profile,
      parsed.cwd,
      profile.defaultCwd ?? this.defaultCwd,
    );
    assertWorkerReady(profile, this.preflightRunner);
    return this.launch({
      profile,
      prompt: parsed.prompt,
      cwd,
      taskId: parsed.taskId ?? randomUUID(),
      timeoutMs: Math.min(
        parsed.timeoutMs ?? profile.timeoutMs,
        profile.timeoutMs,
      ),
      attempt: 1,
    });
  }

  prompt(raw: Record<string, unknown>): WorkerRunRecord {
    const live = this.requireLive(this.requireId(raw.runId, "runId"));
    const prompt = typeof raw.prompt === "string" ? raw.prompt : "";
    if (!prompt.trim())
      throw new AdmissionError("invalid_args", "prompt is required.");
    if (isTerminalWorkerStatus(live.record.status)) {
      throw new AdmissionError("not_running", "Worker is no longer running.");
    }
    if (!live.handle?.writeStdin(`${prompt}\n`)) {
      throw new AdmissionError(
        "not_interactive",
        "Worker does not accept extra prompts.",
      );
    }
    live.record.updatedAt = this.now();
    this.emitChange();
    return this.publicRun(live);
  }

  read(raw: Record<string, unknown>): WorkerRunRecord {
    return this.publicRun(this.requireLive(this.requireId(raw.runId, "runId")));
  }

  async wait(raw: Record<string, unknown>): Promise<WorkerRunRecord> {
    const live = this.requireLive(this.requireId(raw.runId, "runId"));
    if (!isTerminalWorkerStatus(live.record.status)) {
      const timeoutMs =
        typeof raw.timeoutMs === "number" && raw.timeoutMs > 0
          ? raw.timeoutMs
          : live.timeoutMs;
      await new Promise<void>((resolveWait) => {
        const onDone = (): void => {
          clearTimeout(timer);
          resolveWait();
        };
        const timer = setTimeout(() => {
          live.waiters = live.waiters.filter((waiter) => waiter !== onDone);
          resolveWait();
        }, timeoutMs);
        live.waiters.push(onDone);
      });
    }
    return this.publicRun(live);
  }

  cancel(raw: Record<string, unknown>): WorkerRunRecord {
    const live = this.requireLive(this.requireId(raw.runId, "runId"));
    if (!isTerminalWorkerStatus(live.record.status)) {
      this.finish(live, {
        status: "cancelled",
        error: "Cancelled by operator.",
      });
    }
    return this.publicRun(live);
  }

  retry(raw: Record<string, unknown>): WorkerRunRecord {
    const live = this.requireLive(this.requireId(raw.runId, "runId"));
    if (!isTerminalWorkerStatus(live.record.status)) {
      throw new AdmissionError("still_running", "Worker is still running.");
    }
    if (live.record.status === "succeeded") {
      throw new AdmissionError(
        "not_failed",
        "Succeeded runs cannot be retried.",
      );
    }
    return this.launch({
      profile: this.requireWorker(live.record.workerId),
      prompt: live.prompt,
      cwd: live.record.cwd,
      taskId: live.record.taskId,
      timeoutMs: live.timeoutMs,
      attempt: live.record.attempt + 1,
      parentRunId: live.record.runId,
    });
  }

  inspect(raw: Record<string, unknown>): {
    workers: PublicWorkerProfile[];
    worker?: PublicWorkerProfile;
    run?: WorkerRunRecord;
  } {
    const listed = this.list();
    const workerId =
      typeof raw.workerId === "string" ? raw.workerId.trim() : "";
    const runId = typeof raw.runId === "string" ? raw.runId.trim() : "";
    return {
      workers: listed.workers,
      worker: workerId
        ? listed.workers.find((item) => item.id === workerId)
        : undefined,
      run: runId ? this.publicRun(this.requireLive(runId)) : undefined,
    };
  }

  shutdown(): void {
    for (const live of this.runs.values()) {
      if (!isTerminalWorkerStatus(live.record.status)) {
        this.finish(live, {
          status: "cancelled",
          error: "Application is shutting down.",
        });
      }
    }
  }

  private launch(input: {
    profile: WorkerProfile;
    prompt: string;
    cwd: string;
    taskId: string;
    timeoutMs: number;
    attempt: number;
    parentRunId?: string;
  }): WorkerRunRecord {
    const now = this.now();
    const secrets = collectSecretValues(input.profile.profileEnv);
    const runId = randomUUID();
    const record: WorkerRunRecord = {
      taskId: input.taskId,
      workerId: input.profile.id,
      runId,
      status: "starting",
      promptPreview: previewPrompt(input.prompt, secrets),
      summary: "Starting worker…",
      output: "",
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      attempt: input.attempt,
      parentRunId: input.parentRunId,
      cwd: input.cwd,
    };
    const live: LiveRun = {
      record,
      prompt: input.prompt,
      timeoutMs: input.timeoutMs,
      rawOutput: "",
      secrets,
      waiters: [],
      finishing: false,
    };
    this.runs.set(runId, live);

    try {
      const args = expandProfileArgs(
        input.profile.args,
        input.profile.model ?? null,
      );
      const spawnArgs =
        input.profile.promptPlacement === "final_arg"
          ? [...args, input.prompt]
          : args;
      live.handle = this.runner({
        command: input.profile.command,
        args: spawnArgs,
        cwd: input.cwd,
        env: {
          ...(input.profile.profileEnv ?? {}),
          AGENTHUB_WORKER_ID: input.profile.id,
          ...(input.profile.promptPlacement === "final_arg"
            ? {}
            : { AGENTHUB_WORKER_PROMPT: input.prompt }),
        },
        onStdout: (chunk) => this.appendOutput(live, chunk),
        onStderr: (chunk) => this.appendOutput(live, chunk),
        onExit: (code) => {
          if (live.finishing) return;
          this.finish(
            live,
            code === 0
              ? { status: "succeeded", exitCode: code }
              : {
                  status: "failed",
                  exitCode: code,
                  error: `Worker exited with code ${code ?? "null"}.`,
                },
          );
        },
        onError: (err) => {
          if (!live.finishing) {
            this.finish(live, {
              status: "failed",
              error: redactSecrets(err.message, live.secrets),
            });
          }
        },
      });
      record.pid = live.handle.pid;
      record.status = "running";
      record.summary = "Worker running…";
      record.updatedAt = this.now();
      live.timeout = setTimeout(() => {
        if (!live.finishing && !isTerminalWorkerStatus(live.record.status)) {
          this.finish(live, {
            status: "timed_out",
            error: `Worker exceeded ${input.timeoutMs}ms.`,
          });
        }
      }, input.timeoutMs);
    } catch (err) {
      this.finish(live, {
        status: "failed",
        error: redactSecrets(
          err instanceof Error ? err.message : String(err),
          live.secrets,
        ),
      });
    }
    this.emitChange();
    return this.publicRun(live);
  }

  private appendOutput(live: LiveRun, chunk: string): void {
    live.rawOutput = `${live.rawOutput}${chunk}`.slice(
      -AGENTHUB_OUTPUT_LIMIT * 2,
    );
    live.record.output = redactSecrets(live.rawOutput, live.secrets).slice(
      -AGENTHUB_OUTPUT_LIMIT,
    );
    live.record.updatedAt = this.now();
    this.emitChange();
  }

  private finish(
    live: LiveRun,
    update: {
      status: WorkerRunStatus;
      error?: string;
      exitCode?: number | null;
    },
  ): void {
    if (live.finishing) return;
    live.finishing = true;
    if (live.timeout) clearTimeout(live.timeout);
    try {
      live.handle?.kill();
    } catch {
      // best-effort process cleanup
    }
    const output = redactSecrets(live.rawOutput, live.secrets).slice(
      -AGENTHUB_OUTPUT_LIMIT,
    );
    live.record.status = update.status;
    live.record.output = output;
    live.record.summary = summarize(update.status, output);
    live.record.error = update.error
      ? redactSecrets(update.error, live.secrets)
      : undefined;
    live.record.exitCode = update.exitCode;
    live.record.endedAt = this.now();
    live.record.updatedAt = live.record.endedAt;
    for (const waiter of live.waiters.splice(0)) waiter();
    this.emitChange();
  }

  private requireWorker(id: string): WorkerProfile {
    const profile = this.workers.get(id);
    if (!profile)
      throw new AdmissionError("unknown_worker", `Unknown worker '${id}'.`);
    return profile;
  }

  private requireLive(runId: string): LiveRun {
    const live = this.runs.get(runId);
    if (!live)
      throw new AdmissionError("unknown_run", `Unknown run '${runId}'.`);
    return live;
  }

  private requireId(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new AdmissionError("invalid_args", `${field} is required.`);
    }
    return value.trim();
  }

  private runningCount(workerId: string): number {
    return [...this.runs.values()].filter(
      (live) =>
        live.record.workerId === workerId &&
        !isTerminalWorkerStatus(live.record.status),
    ).length;
  }

  private publicRuns(): WorkerRunRecord[] {
    return [...this.runs.values()]
      .map((live) => this.publicRun(live))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 50);
  }

  private publicRun(live: LiveRun): WorkerRunRecord {
    return {
      ...live.record,
      output: redactSecrets(live.record.output, live.secrets).slice(
        -AGENTHUB_OUTPUT_LIMIT,
      ),
      promptPreview: previewPrompt(live.prompt, live.secrets),
      error: live.record.error
        ? redactSecrets(live.record.error, live.secrets)
        : undefined,
    };
  }

  private ok(tool: WorkerToolName, result: unknown): WorkerToolResponse {
    return { ok: true, tool, result };
  }

  private fail(tool: WorkerToolName, err: unknown): WorkerToolResponse {
    if (err instanceof AdmissionError) {
      return { ok: false, tool, error: err.message, code: err.code };
    }
    return {
      ok: false,
      tool,
      error: redactSecrets(err instanceof Error ? err.message : String(err)),
      code: "internal_error",
    };
  }

  private emitChange(): void {
    this.onChange?.();
  }
}

let defaultOrchestrator: WorkerOrchestrator | null = null;
let changeListener: (() => void) | null = null;

export function setWorkerChangeListener(listener: (() => void) | null): void {
  changeListener = listener;
}

export function getDefaultOrchestrator(): WorkerOrchestrator {
  if (!defaultOrchestrator) {
    defaultOrchestrator = new WorkerOrchestrator({
      onChange: () => changeListener?.(),
    });
  }
  return defaultOrchestrator;
}

export function resetDefaultOrchestrator(): void {
  defaultOrchestrator?.shutdown();
  defaultOrchestrator = null;
}

export function dispatchWorkerTool(
  tool: string,
  args: unknown,
): Promise<WorkerToolResponse> {
  return getDefaultOrchestrator().dispatch(tool, args);
}
