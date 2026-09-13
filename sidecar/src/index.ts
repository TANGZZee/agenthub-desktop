import { resolve } from "node:path";

import { ConfigStore } from "./config";
import { AgentPool } from "./pool";
import { JsonRpcServer, type RpcHandlers } from "./rpc";

const VERSION = "0.2.0";

// stdout 是 JSON-RPC 专用通道。把 console.log 重定向到 stderr，
// 避免以后有人误用调试输出污染协议流。
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

let server: JsonRpcServer;
let shuttingDown = false;

function shutdownAndExit(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  pool.shutdownAll();
  process.exit(0);
}

const pool = new AgentPool(configStore, {
  output: (payload) => {
    void server.sendNotification("agent/output", payload);
  },
  state: (payload) => {
    void server.sendNotification("agent/state", payload);
  },
  exit: (payload) => {
    void server.sendNotification("agent/exit", payload);
  },
  error: (payload) => {
    void server.sendNotification("agent/error", payload);
  },
  log: (payload) => {
    void server.sendNotification("sidecar/log", payload);
  },
});

const handlers: RpcHandlers = {
  ping: () => ({
    ok: true,
    version: VERSION,
  }),
  configReload: () => pool.reloadConfig(),
  startAgent: (params) => pool.startAgent(params),
  stopAgent: (params) => pool.stopAgent(params),
  listAgents: () => pool.listAgents(VERSION),
  shutdown: () => ({
    ok: true,
  }),
};

server = new JsonRpcServer(handlers, {
  onAfterResponse: (method) => {
    if (method === "shutdown") {
      shutdownAndExit();
    }
  },
});
server.start();

process.stdin.once("end", shutdownAndExit);
process.once("SIGINT", shutdownAndExit);
process.once("SIGTERM", shutdownAndExit);
process.once("SIGHUP", shutdownAndExit);
