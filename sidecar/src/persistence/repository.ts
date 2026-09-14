import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface TaskEventRecord {
  eventId: string;
  taskId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

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

export class TaskRepository {
  private readonly db: Database;
  constructor(databasePath: string) {
    mkdirSync(dirname(resolve(databasePath)), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 3000");
    this.db.exec(SCHEMA);
  }
  saveTask(task: { taskId: string; proposalId: string; title: string; description: string; assignedWorkerId: string; status: string; writeScope: string; createdAt: string; updatedAt: string; runId?: number; lastError?: string }): void {
    this.db.prepare(`INSERT INTO tasks(task_id,proposal_id,title,description,assigned_worker_id,status,write_scope,created_at,updated_at,run_id,last_error) VALUES(@taskId,@proposalId,@title,@description,@assignedWorkerId,@status,@writeScope,@createdAt,@updatedAt,@runId,@lastError) ON CONFLICT(task_id) DO UPDATE SET status=@status,updated_at=@updatedAt,run_id=@runId,last_error=@lastError`).run({ ...task, runId: task.runId ?? null, lastError: task.lastError ?? null });
  }
  addEvent(taskId: string, eventType: string, payload: Record<string, unknown> = {}): TaskEventRecord {
    const event = { eventId: `${Date.now()}-${Math.random().toString(36).slice(2)}`, taskId, eventType, payload: safePayload(payload), createdAt: new Date().toISOString() };
    this.db.prepare("INSERT INTO task_events(event_id,task_id,event_type,payload_json,created_at) VALUES(?,?,?,?,?)").run(event.eventId, event.taskId, event.eventType, JSON.stringify(event.payload), event.createdAt);
    return event;
  }
  listEvents(taskId: string, limit = 100): TaskEventRecord[] {
    return (this.db.prepare("SELECT event_id eventId,task_id taskId,event_type eventType,payload_json,created_at createdAt FROM task_events WHERE task_id=? ORDER BY created_at DESC LIMIT ?").all(taskId, Math.max(1, Math.min(500, limit))) as Array<Record<string,string>>).map((row) => ({ eventId: row.eventId, taskId: row.taskId, eventType: row.eventType, payload: JSON.parse(row.payload_json) as Record<string, unknown>, createdAt: row.createdAt })).reverse();
  }
  addAttempt(taskId: string, workerId: string, runId: number, status = "running"): string { const attemptId = `${taskId}-${runId}`; this.db.prepare("INSERT OR REPLACE INTO task_attempts(attempt_id,task_id,run_id,worker_id,status,started_at) VALUES(?,?,?,?,?,?)").run(attemptId, taskId, runId, workerId, status, new Date().toISOString()); return attemptId; }
  finishAttempt(taskId: string, runId: number, status: string, exitCode: number | null = null, errorMessage: string | null = null): void { this.db.prepare("UPDATE task_attempts SET status=?,finished_at=?,exit_code=?,error_message=? WHERE task_id=? AND run_id=?").run(status, new Date().toISOString(), exitCode, errorMessage, taskId, runId); }
  close(): void { this.db.close(); }
}
