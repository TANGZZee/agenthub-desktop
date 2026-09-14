import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

export interface TaskEventRecord {
  eventId: string;
  taskId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

type SqliteDb = {
  pragma(sql: string): unknown;
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number };
    all(...params: unknown[]): unknown[];
  };
  close(): void;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  assigned_worker_id TEXT NOT NULL,
  status TEXT NOT NULL,
  write_scope TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  run_id INTEGER,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS task_attempts (
  attempt_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  run_id INTEGER,
  worker_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  exit_code INTEGER,
  error_message TEXT
);
CREATE TABLE IF NOT EXISTS task_events (
  event_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage_records (
  usage_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost REAL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  audit_id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  task_id TEXT,
  detail_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id, created_at);
`;

function safePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...payload };
  for (const key of Object.keys(copy)) {
    if (/_token|api[_-]?key|authorization|auth[_-]?token|secret/i.test(key)) copy[key] = "[已隐藏]";
  }
  if (typeof copy.text === "string") copy.text = copy.text.slice(0, 4096);
  return copy;
}

function openSqlite(databasePath: string): SqliteDb | null {
  try {
    const require = createRequire(resolve(process.cwd(), "package.json"));
    const Database = require("better-sqlite3");
    mkdirSync(dirname(resolve(databasePath)), { recursive: true });
    const db = new Database(databasePath) as SqliteDb;
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 3000");
    db.exec(SCHEMA);
    return db;
  } catch (error) {
    console.error(`[sidecar] SQLite 未能打开，改用内存记录：${String(error)}`);
    return null;
  }
}

export class TaskRepository {
  private readonly db: SqliteDb | null;
  private readonly memoryTasks = new Map<string, Record<string, unknown>>();
  private readonly memoryEvents: TaskEventRecord[] = [];

  constructor(databasePath: string) {
    this.db = openSqlite(databasePath);
  }

  saveTask(task: { taskId: string; proposalId: string; title: string; description: string; assignedWorkerId: string; status: string; writeScope: string; createdAt: string; updatedAt: string; runId?: number; lastError?: string }): void {
    if (this.db) {
      this.db.prepare(`INSERT INTO tasks(task_id,proposal_id,title,description,assigned_worker_id,status,write_scope,created_at,updated_at,run_id,last_error) VALUES(@taskId,@proposalId,@title,@description,@assignedWorkerId,@status,@writeScope,@createdAt,@updatedAt,@runId,@lastError) ON CONFLICT(task_id) DO UPDATE SET status=@status,updated_at=@updatedAt,run_id=@runId,last_error=@lastError`).run({ ...task, runId: task.runId ?? null, lastError: task.lastError ?? null });
      return;
    }
    this.memoryTasks.set(task.taskId, { ...task });
  }

  addEvent(taskId: string, eventType: string, payload: Record<string, unknown> = {}): TaskEventRecord {
    const event = { eventId: `${Date.now()}-${Math.random().toString(36).slice(2)}`, taskId, eventType, payload: safePayload(payload), createdAt: new Date().toISOString() };
    if (this.db) {
      this.db.prepare("INSERT INTO task_events(event_id,task_id,event_type,payload_json,created_at) VALUES(?,?,?,?,?)").run(event.eventId, event.taskId, event.eventType, JSON.stringify(event.payload), event.createdAt);
    } else {
      this.memoryEvents.push(event);
    }
    return event;
  }

  listEvents(taskId: string, limit = 100): TaskEventRecord[] {
    if (this.db) {
      return (this.db.prepare("SELECT event_id eventId,task_id taskId,event_type eventType,payload_json,created_at createdAt FROM task_events WHERE task_id=? ORDER BY created_at DESC LIMIT ?").all(taskId, Math.max(1, Math.min(500, limit))) as Array<Record<string, string>>).map((row) => ({ eventId: row.eventId, taskId: row.taskId, eventType: row.eventType, payload: JSON.parse(row.payload_json) as Record<string, unknown>, createdAt: row.createdAt })).reverse();
    }
    return this.memoryEvents.filter((event) => event.taskId === taskId).slice(-Math.max(1, Math.min(500, limit)));
  }

  listTasks(): Array<{ taskId: string; proposalId: string; title: string; description: string; assignedWorkerId: string; status: string; writeScope: string; createdAt: string; updatedAt: string; runId?: number }> {
    if (this.db) {
      return (this.db.prepare("SELECT task_id taskId, proposal_id proposalId, title, description, assigned_worker_id assignedWorkerId, status, write_scope writeScope, created_at createdAt, updated_at updatedAt, run_id runId FROM tasks ORDER BY updated_at DESC").all() as Array<Record<string, unknown>>).map((row) => ({ taskId: String(row.taskId), proposalId: String(row.proposalId), title: String(row.title), description: String(row.description), assignedWorkerId: String(row.assignedWorkerId), status: String(row.status), writeScope: String(row.writeScope), createdAt: String(row.createdAt), updatedAt: String(row.updatedAt), ...(typeof row.runId === "number" ? { runId: row.runId } : {}) }));
    }
    return [...this.memoryTasks.values()].map((row) => ({
      taskId: String(row.taskId),
      proposalId: String(row.proposalId),
      title: String(row.title),
      description: String(row.description),
      assignedWorkerId: String(row.assignedWorkerId),
      status: String(row.status),
      writeScope: String(row.writeScope),
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
      ...(typeof row.runId === "number" ? { runId: row.runId } : {}),
    }));
  }

  addAttempt(taskId: string, workerId: string, runId: number, status = "running"): string {
    const attemptId = `${taskId}-${runId}`;
    this.db?.prepare("INSERT OR REPLACE INTO task_attempts(attempt_id,task_id,run_id,worker_id,status,started_at) VALUES(?,?,?,?,?,?)").run(attemptId, taskId, runId, workerId, status, new Date().toISOString());
    return attemptId;
  }

  finishAttempt(taskId: string, runId: number, status: string, exitCode: number | null = null, errorMessage: string | null = null): void {
    this.db?.prepare("UPDATE task_attempts SET status=?,finished_at=?,exit_code=?,error_message=? WHERE task_id=? AND run_id=?").run(status, new Date().toISOString(), exitCode, errorMessage, taskId, runId);
  }

  addAudit(action: string, taskId: string | null, detail: Record<string, unknown> = {}): void {
    this.db?.prepare("INSERT INTO audit_log(audit_id,action,task_id,detail_json,created_at) VALUES(?,?,?,?,?)").run(`${Date.now()}-${Math.random().toString(36).slice(2)}`, action, taskId, JSON.stringify(detail), new Date().toISOString());
  }

  addUsage(taskId: string, inputTokens?: number, outputTokens?: number, cost?: number): void {
    this.db?.prepare("INSERT INTO usage_records(usage_id,task_id,input_tokens,output_tokens,cost,created_at) VALUES(?,?,?,?,?,?)").run(`${Date.now()}-${Math.random().toString(36).slice(2)}`, taskId, inputTokens ?? null, outputTokens ?? null, cost ?? null, new Date().toISOString());
  }

  close(): void {
    this.db?.close();
  }
}
