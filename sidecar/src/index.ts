import { resolve } from "node:path";
import { officeDetailForPhase, officeStateForPhase } from "../../shared/office-status";
import { planWorker } from "../../shared/planner";
import { ConfigStore } from "./config";
import { AgentPool } from "./pool";
import { defaultDatabasePath, persistTask, restoreTasks, taskPayload } from "./persistence";
import { TaskRepository } from "./persistence/repository";
import { JsonRpcServer, type RpcHandlers } from "./rpc";
import { StarOfficeClient } from "./star-office-client";
import { TaskQueue, type TaskRecord } from "./task-queue";

const VERSION = "0.3.0";
const DISABLED_WORKERS = new Set(["hermes", "claude"]);
const timeouts = new Map<string, ReturnType<typeof setTimeout>>();

console.log = (...args: unknown[]) => {
  console.error(...args);
};

function readConfigPath(): string | null {
  const args = process.argv.slice(2);
  const index = args.indexOf("--config");
  const value = index >= 0 ? args[index + 1] : undefined;
  return value ? resolve(value) : null;
}

const configPath = readConfigPath();
if (!configPath) {
  console.error("[sidecar] 缺少 --config <path> 参数");
  process.exit(2);
}

const configStore = new ConfigStore(configPath);
const initialConfig = configStore.getSnapshot();
const availableWorkers = [...initialConfig.agents.values()]
  .filter((agent) => agent.enabled && agent.configured && !DISABLED_WORKERS.has(agent.id))
  .map((agent) => agent.id);
const taskQueue = new TaskQueue({
  cwd: process.cwd(),
  availableWorkers: availableWorkers.length > 0 ? availableWorkers : ["pi", "codex"],
});
const repository = new TaskRepository(defaultDatabasePath());
const starOffice = new StarOfficeClient();

function recordTask(task: TaskRecord | undefined, eventType: string, payload: Record<string, unknown> = {}): void {
  if (!task) return;
  persistTask(repository, task);
  repository.addEvent(task.taskId, eventType, { ...taskPayload(task), ...payload });
}

function audit(action: string, task: TaskRecord | undefined, detail: Record<string, unknown> = {}): void {
  repository.addAudit(action, task?.taskId ?? null, { workerId: task?.assignedWorkerId, status: task?.status, ...detail });
}

function clearTimeoutFor(taskId: string): void {
  const timer = timeouts.get(taskId);
  if (timer) clearTimeout(timer);
  timeouts.delete(taskId);
}

function armTimeout(task: TaskRecord): void {
  clearTimeoutFor(task.taskId);
  const seconds = Math.max(30, Math.min(86400, task.budget?.maxSeconds ?? 1800));
  timeouts.set(
    task.taskId,
    setTimeout(() => {
      const current = taskQueue.get(task.taskId);
      if (!current || current.status !== "running") return;
      if (current.runId !== undefined) {
        void pool.stopAgent({ agentId: current.assignedWorkerId, runId: current.runId });
      }
      try {
        const failed = taskQueue.finish(task.taskId, "failed", "任务超时");
        recordTask(failed, "taskFailed", { message: "任务超时" });
        repository.finishAttempt(task.taskId, current.runId ?? 0, "failed", null, "任务超时");
        audit("taskTimeout", failed);
      } catch {
        /* already terminal */
      }
      pumpQueue();
    }, seconds * 1000),
  );
}

function startQueuedTask(taskId: string): void {
  const task = taskQueue.get(taskId);
  if (!task || task.status !== "queued") return;
  if (DISABLED_WORKERS.has(task.assignedWorkerId)) {
    const failed = taskQueue.finish(taskId, "failed", "该 Agent 当前不能作为后台 Worker");
    recordTask(failed, "taskFailed", { message: failed.lastError });
    audit("taskRejectedWorker", failed);
    return;
  }
  const runId = Date.now();
  try {
    const started = taskQueue.start(taskId, runId);
    recordTask(started, "taskStarted");
    repository.addAttempt(taskId, task.assignedWorkerId, runId);
    audit("taskStarted", started);
    armTimeout(started);
    void pool
      .startAgent({
        agentId: task.assignedWorkerId,
        prompt: task.description,
        model: task.model ?? null,
        runId,
      })
      .catch((error) => {
        try {
          const failed = taskQueue.finish(taskId, "failed", error instanceof Error ? error.message : String(error));
          recordTask(failed, "taskFailed", { message: failed.lastError });
          repository.finishAttempt(taskId, runId, "failed", null, failed.lastError ?? null);
          audit("taskStartFailed", failed);
        } catch {
          /* already terminal */
        }
        pumpQueue();
      });
  } catch (error) {
    try {
      const failed = taskQueue.finish(taskId, "failed", error instanceof Error ? error.message : String(error));
      recordTask(failed, "taskFailed", { message: failed.lastError });
      audit("taskStartFailed", failed);
    } catch {
      /* already terminal */
    }
  }
}

function pumpQueue(): void {
  let next = taskQueue.nextQueued();
  while (next) {
    startQueuedTask(next.taskId);
    next = taskQueue.nextQueued();
  }
}

function restorePersistedTasks(): void {
  for (const restored of restoreTasks(repository)) {
    if (restored.status === "running") {
      restored.status = "failed";
      restored.lastError = "软件关闭时任务中断";
      persistTask(repository, restored);
      repository.addEvent(restored.taskId, "taskFailed", { message: restored.lastError });
    } else if (restored.status === "admitted") {
      restored.status = "queued";
      persistTask(repository, restored);
    }
    taskQueue.hydrate(restored);
  }
}

let server: JsonRpcServer;
let shuttingDown = false;

function shutdownAndExit(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const timer of timeouts.values()) clearTimeout(timer);
  timeouts.clear();
  pool.shutdownAll();
  process.exit(0);
}

const pool = new AgentPool(configStore, {
  output: (payload) => {
    const task = taskQueue.findRunningByAgent(payload.agentId);
    if (task) repository.addEvent(task.taskId, "taskOutput", { stream: payload.stream, text: payload.line });
    void server.sendNotification("agent/output", payload);
  },
  state: (payload) => {
    const task = taskQueue.findRunningByAgent(payload.agentId);
    const detail = task
      ? `${officeDetailForPhase(payload.phase)}：${task.title}`
      : officeDetailForPhase(payload.phase);
    starOffice.publish(payload.agentId, officeStateForPhase(payload.phase), detail);
    void server.sendNotification("agent/state", payload);
  },
  exit: (payload) => {
    const task = taskQueue.findRunningByAgent(payload.agentId);
    if (task) {
      try {
        const finished = taskQueue.finish(
          task.taskId,
          payload.killed ? "cancelled" : payload.code === 0 ? "succeeded" : "failed",
        );
        clearTimeoutFor(task.taskId);
        recordTask(
          finished,
          finished.status === "succeeded"
            ? "taskSucceeded"
            : finished.status === "cancelled"
              ? "taskCancelled"
              : "taskFailed",
        );
        repository.finishAttempt(task.taskId, payload.runId, finished.status, payload.code);
        audit("taskFinished", finished, { exitCode: payload.code, killed: payload.killed });
      } catch {
        /* already terminal */
      }
    }
    starOffice.publish(
      payload.agentId,
      payload.code === 0 ? "idle" : "error",
      payload.code === 0 ? "任务已完成，待命中" : "任务执行出现问题",
    );
    void server.sendNotification("agent/exit", payload);
    pumpQueue();
  },
  error: (payload) => {
    const task = taskQueue.findRunningByAgent(payload.agentId);
    if (task) {
      try {
        const failed = taskQueue.finish(task.taskId, "failed", payload.message);
        clearTimeoutFor(task.taskId);
        recordTask(failed, "taskFailed", { message: payload.message });
        repository.finishAttempt(task.taskId, task.runId ?? 0, "failed", null, payload.message);
        audit("taskError", failed, { message: payload.message });
      } catch {
        /* already terminal */
      }
    }
    starOffice.publish(payload.agentId, "error", "Agent 运行出现问题");
    void server.sendNotification("agent/error", payload);
    pumpQueue();
  },
  log: (payload) => {
    void server.sendNotification("sidecar/log", payload);
  },
});

restorePersistedTasks();
pumpQueue();

const handlers: RpcHandlers = {
  ping: () => ({ ok: true, version: VERSION }),
  configReload: () => pool.reloadConfig(),
  startAgent: (params) => pool.startAgent(params),
  stopAgent: (params) => pool.stopAgent(params),
  listAgents: () => pool.listAgents(VERSION),
  taskSubmit: (params) => {
    let proposal = params.proposal;
    if (proposal.proposedWorkerId === "hermes") {
      const plan = planWorker(proposal.description);
      proposal = {
        ...proposal,
        proposedWorkerId: plan.workerId,
        toolPolicy: plan.toolPolicy,
      };
    }
    const result = taskQueue.submit(proposal);
    if (result.accepted && result.envelope) {
      repository.saveTask({
        taskId: result.envelope.taskId,
        proposalId: result.envelope.proposalId,
        title: result.envelope.title,
        description: result.envelope.description,
        assignedWorkerId: result.envelope.assignedWorkerId,
        status: "admitted",
        writeScope: result.envelope.writeScope,
        createdAt: result.envelope.createdAt,
        updatedAt: new Date().toISOString(),
      });
      repository.addEvent(result.envelope.taskId, "taskCreated", { title: result.envelope.title });
      repository.addEvent(result.envelope.taskId, "taskAdmitted", { workerId: result.envelope.assignedWorkerId });
      const queued = taskQueue.queue(result.envelope.taskId);
      recordTask(queued, "taskQueued");
      audit("taskQueued", queued);
      pumpQueue();
      return { ...result, envelope: { ...result.envelope, status: "queued" } };
    }
    audit("taskRejected", undefined, { reasons: result.reasons, workerId: proposal.proposedWorkerId });
    return result;
  },
  taskList: () => ({ tasks: taskQueue.list() }),
  taskEvents: (params) => ({ events: repository.listEvents(params.taskId, params.limit) }),
  taskCancel: (params) => {
    const task = taskQueue.get(params.taskId);
    if (task?.status === "running" && task.runId !== undefined) {
      void pool.stopAgent({ agentId: task.assignedWorkerId, runId: task.runId });
    }
    const cancelled = taskQueue.cancel(params.taskId);
    clearTimeoutFor(params.taskId);
    recordTask(cancelled, "taskCancelled");
    audit("taskCancelled", cancelled);
    pumpQueue();
    return { task: cancelled };
  },
  taskRetry: (params) => {
    const retried = taskQueue.retry(params.taskId);
    recordTask(retried, "taskQueued", { retryCount: retried.retryCount });
    audit("taskRetry", retried);
    pumpQueue();
    return { task: retried };
  },
  providerModels: async (params) => {
    const base = params.baseUrl.replace(/\/+$/, "");
    try {
      const response = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${params.apiKey}` } });
      if (!response.ok) return { models: [], error: `服务返回 ${response.status}` };
      const json = (await response.json()) as unknown;
      const list = Array.isArray(json) ? json : (json as { data?: unknown }).data ?? (json as { models?: unknown }).models;
      const models = Array.isArray(list)
        ? list.map((item) => (typeof item === "string" ? item : String((item as { id?: unknown }).id ?? ""))).filter(Boolean)
        : [];
      return { models };
    } catch (error) {
      return { models: [], error: error instanceof Error ? error.message : String(error) };
    }
  },  shutdown: () => ({ ok: true }),
};

server = new JsonRpcServer(handlers, {
  onAfterResponse: (method) => {
    if (method === "shutdown") shutdownAndExit();
  },
});
server.start();
process.stdin.once("end", shutdownAndExit);
process.once("SIGINT", shutdownAndExit);
process.once("SIGTERM", shutdownAndExit);
process.once("SIGHUP", shutdownAndExit);
