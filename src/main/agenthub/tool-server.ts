import { createServer, type IncomingMessage, type Server } from "http";
import { randomBytes } from "crypto";
import type { WorkerToolStatus } from "../../shared/agenthub";
import { dispatchWorkerTool } from "./orchestrator";

const MAX_BODY_BYTES = 64_000;

let server: Server | null = null;
let listenUrl: string | null = null;
let token = "";

export function getWorkerToolToken(): string {
  if (!token) token = randomBytes(24).toString("hex");
  return token;
}

export function getWorkerToolStatus(): WorkerToolStatus {
  return {
    listening: Boolean(server?.listening),
    url: listenUrl,
    tokenConfigured: Boolean(token),
  };
}

export function getWorkerToolClientEnv(): Record<string, string> {
  const status = getWorkerToolStatus();
  if (!status.url) return {};
  return {
    AGENTHUB_WORKER_URL: status.url,
    AGENTHUB_WORKER_TOKEN: getWorkerToolToken(),
  };
}

export function startWorkerToolServer(): Promise<WorkerToolStatus> {
  if (server?.listening && listenUrl) {
    return Promise.resolve(getWorkerToolStatus());
  }
  getWorkerToolToken();
  return new Promise((resolve, reject) => {
    server = createServer((req, res) => {
      void handleRequest(req, res);
    });
    server.on("error", (err) => {
      reject(err);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server?.address();
      if (address && typeof address === "object") {
        listenUrl = `http://127.0.0.1:${address.port}/worker/tool`;
      }
      resolve(getWorkerToolStatus());
    });
  });
}

export function stopWorkerToolServer(): Promise<void> {
  const current = server;
  server = null;
  listenUrl = null;
  if (!current) return Promise.resolve();
  return new Promise((resolve) => {
    current.close(() => resolve());
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: import("http").ServerResponse,
): Promise<void> {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== "POST" || url.pathname !== "/worker/tool") {
    json(res, 404, { ok: false, error: "Not found", code: "not_found" });
    return;
  }
  const provided =
    bearer(req.headers.authorization) ||
    header(req.headers["x-agenthub-token"]);
  if (!provided || provided !== getWorkerToolToken()) {
    json(res, 401, { ok: false, error: "Unauthorized", code: "unauthorized" });
    return;
  }
  let body: unknown;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    json(res, 400, { ok: false, error: "Invalid JSON", code: "invalid_json" });
    return;
  }
  const record = asRecord(body);
  const tool = typeof record.tool === "string" ? record.tool : "";
  const args = record.arguments ?? record.args ?? {};
  const result = await dispatchWorkerTool(tool, args);
  json(res, result.ok ? 200 : 400, result);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function bearer(value: string | string[] | undefined): string {
  const raw = header(value);
  if (raw.toLowerCase().startsWith("bearer ")) return raw.slice(7).trim();
  return "";
}

function header(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function json(
  res: import("http").ServerResponse,
  status: number,
  payload: unknown,
): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () =>
      resolve(Buffer.concat(chunks).toString("utf8") || "{}"),
    );
    req.on("error", reject);
  });
}
