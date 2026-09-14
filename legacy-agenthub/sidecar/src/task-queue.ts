import type { AdmissionResult, TaskEnvelope, TaskProposal, TaskStatus } from "../../shared/task-protocol";
import { admitProposal } from "./admission";
import { transitionTask } from "./task-state";

export type TaskRecord = Omit<TaskEnvelope, "status"> & {
  status: TaskStatus;
  updatedAt: string;
  runId?: number;
  lastError?: string;
  retryCount?: number;
};

export interface TaskQueueOptions {
  cwd: string;
  availableWorkers: string[];
  forbidden?: string[];
}

export class TaskQueue {
  private readonly records = new Map<string, TaskRecord>();
  private readonly options: TaskQueueOptions;

  constructor(options: TaskQueueOptions) {
    this.options = options;
  }

  submit(proposal: TaskProposal): AdmissionResult {
    const result = admitProposal(proposal, this.options);
    if (!result.accepted || !result.envelope) return result;
    const record: TaskRecord = {
      ...result.envelope,
      status: "admitted",
      updatedAt: new Date().toISOString(),
      retryCount: 0,
    };
    this.records.set(record.taskId, record);
    return { ...result, envelope: { ...record, status: "admitted" } };
  }

  queue(taskId: string): TaskRecord {
    return this.change(taskId, "queued");
  }

  start(taskId: string, runId: number): TaskRecord {
    const record = this.change(taskId, "running");
    record.runId = runId;
    this.records.set(taskId, record);
    return { ...record };
  }

  finish(taskId: string, status: "succeeded" | "failed" | "cancelled", lastError?: string): TaskRecord {
    const record = this.change(taskId, status);
    if (lastError) record.lastError = lastError;
    this.records.set(taskId, record);
    return { ...record };
  }

  cancel(taskId: string): TaskRecord {
    return this.change(taskId, "cancelled");
  }

  retry(taskId: string): TaskRecord {
    const record = this.change(taskId, "queued");
    record.retryCount = (record.retryCount ?? 0) + 1;
    record.runId = undefined;
    record.lastError = undefined;
    this.records.set(taskId, record);
    return { ...record };
  }

  hydrate(record: TaskRecord): void {
    this.records.set(record.taskId, { ...record });
  }

  get(taskId: string): TaskRecord | undefined {
    const value = this.records.get(taskId);
    return value ? { ...value } : undefined;
  }

  list(): TaskRecord[] {
    return [...this.records.values()].map((record) => ({ ...record }));
  }

  findRunningByAgent(agentId: string): TaskRecord | undefined {
    return [...this.records.values()].find(
      (record) => record.status === "running" && record.assignedWorkerId === agentId,
    );
  }

  isWorkerBusy(agentId: string): boolean {
    return this.findRunningByAgent(agentId) !== undefined;
  }

  nextQueued(): TaskRecord | undefined {
    const busy = new Set(
      [...this.records.values()]
        .filter((record) => record.status === "running")
        .map((record) => record.assignedWorkerId),
    );
    return [...this.records.values()].find(
      (record) => record.status === "queued" && !busy.has(record.assignedWorkerId),
    );
  }

  private change(taskId: string, status: TaskStatus): TaskRecord {
    const record = this.records.get(taskId);
    if (!record) throw new Error(`任务不存在：${taskId}`);
    record.status = transitionTask(record.status, status);
    record.updatedAt = new Date().toISOString();
    this.records.set(taskId, record);
    return { ...record };
  }
}
