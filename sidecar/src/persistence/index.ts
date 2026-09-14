import { homedir } from "node:os";
import { join } from "node:path";
import type { TaskRecord } from "../task-queue";
import { TaskRepository } from "./repository";

export function defaultDatabasePath(): string {
  const base = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  return join(base, "AgentHub Desktop", "data", "agenthub.sqlite");
}

export function taskPayload(task: TaskRecord): Record<string, unknown> {
  return { title: task.title, workerId: task.assignedWorkerId, status: task.status };
}

export function restoreTasks(repository: TaskRepository): TaskRecord[] { return repository.listTasks().map((task) => ({ ...task, cwd: process.cwd(), proposedWorkerId: task.assignedWorkerId, allowedPaths: [], forbidden: [], toolPolicy: [], dependsOn: [], status: task.status as TaskRecord["status"], lastError: undefined } as TaskRecord)); }

export function persistTask(repository: TaskRepository, task: TaskRecord): void {
  repository.saveTask({ taskId: task.taskId, proposalId: task.proposalId, title: task.title, description: task.description, assignedWorkerId: task.assignedWorkerId, status: task.status, writeScope: task.writeScope, createdAt: task.createdAt, updatedAt: task.updatedAt, runId: task.runId });
}
