import type { AdmissionResult } from "../../shared/task-protocol";
import type { TaskEnvelope, TaskProposal, TaskStatus } from "../../shared/task-protocol";
import { admitProposal } from "./admission";
import { transitionTask } from "./task-state";

export type TaskRecord = Omit<TaskEnvelope, "status"> & { status: TaskStatus; updatedAt: string; runId?: number };
export interface TaskQueueOptions { cwd: string; availableWorkers: string[]; forbidden?: string[]; }

export class TaskQueue {
  private readonly records = new Map<string, TaskRecord>();
  constructor(private readonly options: TaskQueueOptions) {}
  submit(proposal: TaskProposal): AdmissionResult { const result = admitProposal(proposal, this.options); if (!result.accepted || !result.envelope) return result; const record: TaskRecord = { ...result.envelope, status: "admitted", updatedAt: new Date().toISOString() }; this.records.set(record.taskId, record); return { ...result, envelope: { ...record, status: "admitted" } }; }
  queue(taskId: string): TaskRecord { return this.change(taskId, "queued"); }
  start(taskId: string, runId: number): TaskRecord { const record = this.change(taskId, "running"); record.runId = runId; this.records.set(taskId, record); return { ...record }; }
  finish(taskId: string, status: "succeeded" | "failed" | "cancelled"): TaskRecord { return this.change(taskId, status); }
  cancel(taskId: string): TaskRecord { return this.change(taskId, "cancelled"); }
  get(taskId: string): TaskRecord | undefined { const value = this.records.get(taskId); return value ? { ...value } : undefined; }
  list(): TaskRecord[] { return [...this.records.values()].map((record) => ({ ...record })); }
  findRunningByAgent(agentId: string): TaskRecord | undefined { return [...this.records.values()].find((record) => record.status === "running" && record.assignedWorkerId === agentId); }
  private change(taskId: string, status: TaskStatus): TaskRecord { const record = this.records.get(taskId); if (!record) throw new Error(`任务不存在：${taskId}`); record.status = transitionTask(record.status, status); record.updatedAt = new Date().toISOString(); this.records.set(taskId, record); return { ...record }; }
}
