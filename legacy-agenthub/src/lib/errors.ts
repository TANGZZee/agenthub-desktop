import type { ErrorKind } from "../../shared/protocol";

const ERROR_KINDS = new Set<ErrorKind>([
  "nodeMissing",
  "sidecarCrashed",
  "sidecarTimeout",
  "internal",
  "configInvalid",
  "agentNotFound",
  "alreadyRunning",
  "agentStartFailed",
  "stopFailed",
]);

export function errKind(error: unknown): ErrorKind | null {
  if (typeof error !== "object" || error === null || !("kind" in error)) {
    return null;
  }

  const kind = (error as { kind?: unknown }).kind;
  return typeof kind === "string" && ERROR_KINDS.has(kind as ErrorKind)
    ? (kind as ErrorKind)
    : null;
}

export function errMessage(error: unknown): string {
  if (typeof error !== "object" || error === null || !("message" in error)) {
    return String(error);
  }

  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : String(error);
}
