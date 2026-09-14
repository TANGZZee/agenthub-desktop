import { existsSync, statSync } from "fs";
import { isAbsolute, relative, resolve } from "path";
import type { WorkerProfile, WorkerStartArgs } from "../../shared/agenthub";
import { AGENTHUB_PROMPT_LIMIT } from "../../shared/agenthub";

export const FORBIDDEN_START_FIELDS = [
  "command",
  "args",
  "env",
  "shell",
  "executable",
  "argv",
  "stdin",
] as const;

export class AdmissionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AdmissionError";
    this.code = code;
  }
}

export function assertNoForbiddenFields(args: Record<string, unknown>): void {
  for (const field of FORBIDDEN_START_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(args, field)) {
      throw new AdmissionError(
        "forbidden_field",
        `Worker tools cannot set '${field}'. Command, environment, and shell are owned by the desktop.`,
      );
    }
  }
}

// @lat: [[agenthub-workers#Admission]]
export function parseStartArgs(raw: Record<string, unknown>): WorkerStartArgs {
  assertNoForbiddenFields(raw);
  const workerId = typeof raw.workerId === "string" ? raw.workerId.trim() : "";
  const prompt = typeof raw.prompt === "string" ? raw.prompt : "";
  if (!workerId) {
    throw new AdmissionError("invalid_args", "workerId is required.");
  }
  if (!prompt.trim()) {
    throw new AdmissionError("invalid_args", "prompt is required.");
  }
  if (prompt.length > AGENTHUB_PROMPT_LIMIT) {
    throw new AdmissionError(
      "prompt_too_long",
      `prompt exceeds ${AGENTHUB_PROMPT_LIMIT} characters.`,
    );
  }
  const cwd =
    typeof raw.cwd === "string" && raw.cwd.trim() ? raw.cwd : undefined;
  const taskId =
    typeof raw.taskId === "string" && raw.taskId.trim()
      ? raw.taskId.trim()
      : undefined;
  const timeoutMs =
    typeof raw.timeoutMs === "number" && Number.isFinite(raw.timeoutMs)
      ? raw.timeoutMs
      : undefined;
  if (timeoutMs !== undefined && timeoutMs < 1) {
    throw new AdmissionError("invalid_args", "timeoutMs must be positive.");
  }
  return { workerId, prompt, cwd, taskId, timeoutMs };
}

export function resolveAdmittedCwd(
  profile: WorkerProfile,
  requested: string | undefined,
  fallback: string,
): string {
  const cwd = resolve(requested?.trim() || fallback);
  let stats: ReturnType<typeof statSync>;
  try {
    if (!existsSync(cwd)) {
      throw new AdmissionError(
        "cwd_missing",
        `Working directory does not exist: ${cwd}`,
      );
    }
    stats = statSync(cwd);
  } catch (err) {
    if (err instanceof AdmissionError) throw err;
    throw new AdmissionError(
      "cwd_missing",
      `Working directory is not readable: ${cwd}`,
    );
  }
  if (!stats.isDirectory()) {
    throw new AdmissionError(
      "cwd_invalid",
      `Working directory is not a folder: ${cwd}`,
    );
  }
  if (profile.cwdRoots.length > 0) {
    const allowed = profile.cwdRoots.some((root) => isPathInside(root, cwd));
    if (!allowed) {
      throw new AdmissionError(
        "cwd_forbidden",
        "Working directory is outside this worker's allowlist.",
      );
    }
  }
  return cwd;
}

export function isPathInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
