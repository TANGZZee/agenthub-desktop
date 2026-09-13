import { resolve } from "node:path";
import { officeDetailForPhase, officeStateForPhase } from "../../shared/office-status";
import { ConfigStore } from "./config";
import { AgentPool } from "./pool";
import { StarOfficeClient } from "./star-office-client";
import { TaskQueue } from "./task-queue";
import { JsonRpcServer, type RpcHandlers } from "./rpc";
const VERSION = "0.2.0";
console.log = (...args: unknown[]) => { console.error(...args); };
function readConfigPath(): string | null { const args = process.argv.slice(2); const index = args.indexOf("--config"); const value = index >= 0 ? args[index + 1] : undefined; return value ? resolve(value) : null; }
const configPath = readConfigPath();
if (!configPath) { console.error("[sidecar] 缺少 --config <path> 参数"); process.exit(2); }
const configStore = new ConfigStore(configPath);
const initialConfig = configStore.getSnapshot();
const taskQueue = new TaskQueue({ cwd: process.cwd(), availableWorkers: [...initialConfig.agents.keys()] });
const starOffice = new StarOfficeClient();
let server: JsonRpcServer; let shuttingDown = false;
function shutdownAndExit(): void { if (shuttingDown) return; shuttingDown = true; pool.shutdownAll(); process.exit(0); }
const pool = new AgentPool(configStore, {
  output: (payload) => { void server.sendNotification("agent/output", payload); },
  state: (payload) => { starOffice.publish(payload.agentId, officeStateForPhase(payload.phase), officeDetailForPhase(payload.phase)); void server.sendNotification("agent/state", payload); },
  exit: (payload) => { starOffice.publish(payload.agentId, payload.code === 0 ? "idle" : "error", payload.code === 0 ? "任务已完成，待命中" : "任务执行出现问题"); void server.sendNotification("agent/exit", payload); },
  error: (payload) => { starOffice.publish(payload.agentId, "error", "Agent 运行出现问题"); void server.sendNotification("agent/error", payload); },
  log: (payload) => { void server.sendNotification("sidecar/log", payload); },
});
const handlers: RpcHandlers = { ping: () => ({ ok: true, version: VERSION }), configReload: () => pool.reloadConfig(), startAgent: (params) => pool.startAgent(params), stopAgent: (params) => pool.stopAgent(params), listAgents: () => pool.listAgents(VERSION), taskSubmit: (params) => taskQueue.submit(params.proposal), taskList: () => ({ tasks: taskQueue.list() }), taskCancel: (params) => ({ task: taskQueue.cancel(params.taskId) }), shutdown: () => ({ ok: true }) };
server = new JsonRpcServer(handlers, { onAfterResponse: (method) => { if (method === "shutdown") shutdownAndExit(); } });
server.start(); process.stdin.once("end", shutdownAndExit); process.once("SIGINT", shutdownAndExit); process.once("SIGTERM", shutdownAndExit); process.once("SIGHUP", shutdownAndExit);
