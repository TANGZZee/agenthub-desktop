import { TaskQueue } from "./task-queue";

const queue = new TaskQueue({ cwd: process.cwd(), availableWorkers: ["pi", "codex"] });
const accepted = queue.submit({ proposalId: "smoke-1", title: "只读检查", description: "读取项目状态", proposedWorkerId: "pi", toolPolicy: ["read", "grep"], writeScope: "none" });
if (!accepted.accepted || !accepted.envelope) throw new Error(accepted.reasons.join("；"));
const queued = queue.queue(accepted.envelope.taskId);
if (queued.status !== "queued") throw new Error("任务未进入 queued");
const started = queue.start(queued.taskId, 1);
if (started.status !== "running") throw new Error("任务未进入 running");
if (!queue.isWorkerBusy("pi")) throw new Error("Pi 应变为忙碌");
const second = queue.submit({ proposalId: "smoke-1b", title: "第二个任务", description: "再读一次", proposedWorkerId: "pi", toolPolicy: ["read"], writeScope: "none" });
if (!second.accepted || !second.envelope) throw new Error("第二个任务应准入");
queue.queue(second.envelope.taskId);
if (queue.nextQueued()?.taskId === second.envelope.taskId) throw new Error("忙碌 Worker 不应再取出新任务");
const failed = queue.finish(started.taskId, "failed", "测试失败");
if (failed.status !== "failed") throw new Error("任务未失败");
const retried = queue.retry(failed.taskId);
if (retried.status !== "queued" || (retried.retryCount ?? 0) < 1) throw new Error("失败任务应可重试");
const cancelled = queue.cancel(retried.taskId);
if (cancelled.status !== "cancelled") throw new Error("任务未取消");
const rejected = queue.submit({ proposalId: "smoke-2", title: "危险测试", description: "执行命令", proposedWorkerId: "pi", toolPolicy: ["terminal"], writeScope: "none" });
if (rejected.accepted) throw new Error("禁用工具未被拒绝");
console.log("task queue smoke test passed");


