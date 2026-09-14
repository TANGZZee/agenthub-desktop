import type { TaskStatus } from "../../shared/task-protocol";
const transitions: Record<TaskStatus, TaskStatus[]> = { created: ["admitted", "rejected"], admitted: ["queued", "rejected"], rejected: [], queued: ["running", "cancelled"], running: ["succeeded", "failed", "cancelled", "escalated"], succeeded: [], failed: ["queued", "escalated"], cancelled: [], escalated: [] };
export function canTransition(from: TaskStatus, to: TaskStatus): boolean { return transitions[from].includes(to); }
export function transitionTask(from: TaskStatus, to: TaskStatus): TaskStatus { if (!canTransition(from, to)) throw new Error(`非法任务状态转换：${from} → ${to}`); return to; }
export function allowedTaskTransitions(from: TaskStatus): TaskStatus[] { return [...transitions[from]]; }
