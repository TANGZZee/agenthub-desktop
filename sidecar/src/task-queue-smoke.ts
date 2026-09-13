import { TaskQueue } from "./task-queue";

const queue = new TaskQueue({ cwd: process.cwd(), availableWorkers: ["pi", "codex"] });
const accepted = queue.submit({ proposalId: "smoke-1", title: "只读检查", description: "读取项目状态", proposedWorkerId: "pi", toolPolicy: ["read", "grep"], writeScope: "none" });
if (!accepted.accepted || !accepted.envelope) throw new Error(accepted.reasons.join("；"));
const queued = queue.queue(accepted.envelope.taskId);
if (queued.status !== "queued") throw new Error("任务未进入 queued");
const cancelled = queue.cancel(queued.taskId);
if (cancelled.status !== "cancelled") throw new Error("任务未取消");
const rejected = queue.submit({ proposalId: "smoke-2", title: "危险测试", description: "执行命令", proposedWorkerId: "pi", toolPolicy: ["terminal"], writeScope: "none" });
if (rejected.accepted) throw new Error("禁用工具未被拒绝");
console.log("task queue smoke test passed");
