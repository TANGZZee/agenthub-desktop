import type { AdmissionResult } from "../../shared/task-protocol";
import type { TaskEnvelope, TaskProposal, TaskStatus } from "../../shared/task-protocol";
import { admitProposal } from "./admission";
import { transitionTask } from "./task-state";

export type TaskRecord = Omit<TaskEnvelope, "status"> & { status: TaskStatus; updatedAt: string; };
export interface TaskQueueOptions { cwd: string; availableWorkers: string[]; forbidden?: string[]; }

export class TaskQueue {
  private readonly records = new Map<string, TaskRecord>();
  constructor(private readonly options: TaskQueueOptions) {}

  submit(proposal: TaskProposal): AdmissionResult {
    const result = admitProposal(proposal, this.options);
    if (!result.accepted || !result.envelope) return result;
    const now = new Date().toISOString();
    const record: TaskRecord = { ...result.envelope, status: "admitted", updatedAt: now };
    this.records.set(record.taskId, record);
    return { ...result, envelope: { ...record, status: "admitted" } };
  }

  queue(taskId: string): TaskRecord {
    const record = this.require(taskId);
    record.status = transitionTask(record.status, "queued");
    record.updatedAt = new Date().toISOString();
    return { ...record };
  }

  cancel(taskId: string): TaskRecord {
    const record = this.require(taskId);
    record.status = transitionTask(record.status, "cancelled");
    record.updatedAt = new Date().toISOString();
    return { ...record };
  }

  get(taskId: string): TaskRecord | undefined { const value = this.records.get(taskId); return value ? { ...value } : undefined; }
  list(): TaskRecord[] { return [...this.records.values()].map((record) => ({ ...record })); }
  private require(taskId: string): TaskRecord { const record = this.records.get(taskId); if (!record) throw new Error(`任务不存在：${taskId}`); return record; }
}
