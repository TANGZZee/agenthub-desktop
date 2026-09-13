import type { ChildProcess } from "node:child_process";

import type {
  AgentErrorNotification,
  AgentExitNotification,
  AgentInfo,
  AgentOutputNotification,
  AgentStateNotification,
  ConfigReloadResult,
  ErrorKind,
  ListAgentsRpcResult,
  SidecarLogNotification,
  StartAck,
  StartAgentParams,
  StopAgentParams,
  StopAgentResult,
} from "../../shared/protocol";
import { startAgentProcess } from "./agent-process";
import { ConfigStore } from "./config";
import {
  buildModelInjection,
  resolveModelName,
} from "./model";
import type { ResolvedAgentConfig } from "./types";

export const STOP_TIMEOUT_MS = 3_000;

interface StartingEntry {
  status: "starting";
  runId: number;
  resolvedModel: string;
  cwd: string;
  label: string;
}

interface RunningEntry {
  status: "running";
  runId: number;
  resolvedModel: string;
  cwd: string;
  label: string;
  child: ChildProcess;
  killed: boolean;
  termSeq: number;
  stopDelayMs: number;
  startedAt: number;
}

type PoolEntry = StartingEntry | RunningEntry;

export interface PoolNotifications {
  output: (payload: AgentOutputNotification) => void;
  state: (payload: AgentStateNotification) => void;
  exit: (payload: AgentExitNotification) => void;
  error: (payload: AgentErrorNotification) => void;
  log: (payload: SidecarLogNotification) => void;
}

export class RpcError extends Error {
  readonly kind: ErrorKind;

  constructor(kind: ErrorKind, message: string) {
    super(message);
    this.name = "RpcError";
    this.kind = kind;
  }
}

function sleep(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function childHasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (childHasExited(child)) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let settled = false;

    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("exit", onExit);
      resolve(exited);
    };

    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), Math.max(0, timeoutMs));

    child.once("exit", onExit);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Agent 池。
 *
 * Node 的事件循环是单线程的，因此“检查池 + 插入 starting 占位”只要放在
 * 同一个同步代码块里，就不会在两步之间被另一个请求插队。
 */
export class AgentPool {
  private readonly entries = new Map<string, PoolEntry>();
  private shuttingDown = false;

  constructor(
    private readonly configStore: ConfigStore,
    private readonly notify: PoolNotifications,
  ) {}

  private currentConfig() {
    return this.configStore.getSnapshot();
  }

  private requireConfiguredAgent(agentId: string): {
    agent: ResolvedAgentConfig;
    config: ReturnType<ConfigStore["getSnapshot"]>;
  } {
    const config = this.currentConfig();

    if (!config.status.ok) {
      throw new RpcError("configInvalid", config.status.error.message);
    }

    const agent = config.agents.get(agentId);
    if (!agent) {
      throw new RpcError(
        "agentNotFound",
        `配置中不存在 Agent "${agentId}"`,
      );
    }

    if (!agent.configured) {
      throw new RpcError(
        "agentNotFound",
        agent.reason ?? `Agent "${agentId}" 当前不可用`,
      );
    }

    return { agent, config };
  }

  private removeStaleEntry(agentId: string, entry: PoolEntry): void {
    if (entry.status !== "running") return;
    if (!childHasExited(entry.child)) return;

    const current = this.entries.get(agentId);
    if (current === entry) {
      this.entries.delete(agentId);
    }
  }

  private handleExit(
    agentId: string,
    runId: number,
    child: ChildProcess,
    code: number | null,
  ): void {
    const current = this.entries.get(agentId);

    if (!current || current.runId !== runId) {
      return;
    }

    if (current.status === "running" && current.child !== child) {
      return;
    }

    const resolvedModel = current.resolvedModel;
    const killed =
      current.status === "running" ? current.killed : false;

    // 先删记录、后发事件：页面收到终态后可以立刻重新启动同一个 Agent。
    this.entries.delete(agentId);

    this.notify.exit({
      runId,
      agentId,
      code,
      killed,
      resolvedModel,
    });
  }

  async startAgent(params: StartAgentParams): Promise<StartAck> {
    if (this.shuttingDown) {
      throw new RpcError("internal", "Sidecar 正在关闭，不能启动新 Agent");
    }

    const existing = this.entries.get(params.agentId);
    if (existing) {
      this.removeStaleEntry(params.agentId, existing);
    }

    const { agent, config } = this.requireConfiguredAgent(params.agentId);
    const resolved = resolveModelName(agent, params.model);

    if (!resolved.ok) {
      throw new RpcError("agentNotFound", resolved.message);
    }

    const injection = buildModelInjection(
      agent,
      resolved.alias,
      resolved.model,
      params.prompt,
      params.runId,
      config.ccSwitch,
    );

    // 从这里到 entries.set 之间没有任何 await，这就是并发保护的关键窗口。
    if (this.entries.has(params.agentId)) {
      throw new RpcError(
        "alreadyRunning",
        `Agent "${params.agentId}" 已有实例正在运行`,
      );
    }

    const startingEntry: StartingEntry = {
      status: "starting",
      runId: params.runId,
      resolvedModel: resolved.model,
      cwd: agent.cwd,
      label: agent.label,
    };
    this.entries.set(params.agentId, startingEntry);

    for (const warning of injection.warnings) {
      this.notify.log({ level: "warn", message: warning });
    }

    if (agent.startDelayMs > 0) {
      await sleep(agent.startDelayMs);
    }

    if (
      this.shuttingDown ||
      this.entries.get(params.agentId) !== startingEntry
    ) {
      this.entries.delete(params.agentId);
      throw new RpcError("internal", "启动请求已被取消");
    }

    const processHandle = startAgentProcess(agent, injection.spawnEnv, {
      onOutput: (stream, line) => {
        this.notify.output({
          runId: params.runId,
          agentId: params.agentId,
          stream,
          line,
        });
      },
      onError: (error) => {
        this.notify.log({
          level: "warn",
          message: `Agent "${params.agentId}" 进程错误：${error.message}`,
        });
      },
      onExit: (child, code) => {
        this.handleExit(params.agentId, params.runId, child, code);
      },
    });

    try {
      await processHandle.spawned;
    } catch (error) {
      const message = errorMessage(error);

      if (this.entries.get(params.agentId) === startingEntry) {
        this.entries.delete(params.agentId);
      }

      this.notify.error({
        runId: params.runId,
        agentId: params.agentId,
        kind: "agentStartFailed",
        message,
        resolvedModel: resolved.model,
      });

      throw new RpcError("agentStartFailed", message);
    }

    const current = this.entries.get(params.agentId);
    if (current === startingEntry) {
      this.entries.set(params.agentId, {
        status: "running",
        runId: params.runId,
        resolvedModel: resolved.model,
        cwd: agent.cwd,
        label: agent.label,
        child: processHandle.child,
        killed: false,
        termSeq: 0,
        stopDelayMs: agent.stopDelayMs,
        startedAt: Date.now(),
      });

      this.notify.state({
        runId: params.runId,
        agentId: params.agentId,
        phase: "running",
        resolvedModel: resolved.model,
      });
    }

    return {
      agentId: params.agentId,
      runId: params.runId,
      resolvedModel: resolved.model,
      injectedEnv: injection.injectedEnv,
      cwd: agent.cwd,
    };
  }

  /**
   * 请求 TerminateProcess。
   *
   * stop_delay_ms 的定时器在醒来后会重新核对 runId / killed / termSeq，
   * 避免一次已经回滚的旧终止在几秒后突然把仍在运行的进程杀掉。
   */
  private async attemptKill(
    agentId: string,
    runId: number,
    termSeq: number,
    stopDelayMs: number,
  ): Promise<"sent" | "ended" | "abandoned"> {
    await sleep(stopDelayMs);

    const current = this.entries.get(agentId);
    if (
      !current ||
      current.status !== "running" ||
      current.runId !== runId ||
      current.killed !== true ||
      current.termSeq !== termSeq
    ) {
      return "abandoned";
    }

    if (childHasExited(current.child)) {
      current.killed = false;
      return "ended";
    }

    try {
      const sent = current.child.kill();
      if (!sent && !childHasExited(current.child)) {
        throw new Error("child.kill() 返回 false");
      }
      return "sent";
    } catch (error) {
      if (childHasExited(current.child)) {
        current.killed = false;
        return "ended";
      }
      throw error;
    }
  }

  private rollbackTermination(
    agentId: string,
    runId: number,
    termSeq: number,
  ): boolean {
    const current = this.entries.get(agentId);
    if (
      !current ||
      current.status !== "running" ||
      current.runId !== runId ||
      current.killed !== true ||
      current.termSeq !== termSeq
    ) {
      return false;
    }

    current.killed = false;
    this.notify.state({
      runId,
      agentId,
      phase: "running",
      resolvedModel: current.resolvedModel,
    });
    return true;
  }

  async stopAgent(params: StopAgentParams): Promise<StopAgentResult> {
    const current = this.entries.get(params.agentId);

    if (!current || current.status !== "running") {
      return { stopped: false };
    }

    if (current.runId !== params.runId) {
      return { stopped: false };
    }

    if (current.killed) {
      // 第二次终止不再碰 child；用户的意图已经处于处理中。
      return { stopped: true };
    }

    const requestStartedAt = Date.now();
    current.killed = true;
    current.termSeq += 1;
    const termSeq = current.termSeq;
    const resolvedModel = current.resolvedModel;

    this.notify.state({
      runId: params.runId,
      agentId: params.agentId,
      phase: "terminating",
      resolvedModel,
    });

    const remainingBeforeKill = Math.max(
      0,
      STOP_TIMEOUT_MS - (Date.now() - requestStartedAt),
    );

    let killOutcome:
      | "sent"
      | "ended"
      | "abandoned"
      | "timeout"
      | { kind: "error"; error: unknown };

    try {
      killOutcome = await Promise.race([
        this.attemptKill(
          params.agentId,
          params.runId,
          termSeq,
          current.stopDelayMs,
        ),
        sleep(remainingBeforeKill).then(() => "timeout" as const),
      ]);
    } catch (error) {
      killOutcome = { kind: "error", error };
    }

    if (killOutcome === "timeout") {
      if (this.rollbackTermination(params.agentId, params.runId, termSeq)) {
        throw new RpcError(
          "stopFailed",
          `Agent "${params.agentId}" 在 3 秒内没有结束，已恢复为运行中`,
        );
      }
      return { stopped: true };
    }

    if (
      typeof killOutcome === "object" &&
      killOutcome.kind === "error"
    ) {
      if (this.rollbackTermination(params.agentId, params.runId, termSeq)) {
        throw new RpcError(
          "stopFailed",
          `终止 Agent "${params.agentId}" 失败：${errorMessage(killOutcome.error)}`,
        );
      }
      return { stopped: true };
    }

    if (killOutcome === "abandoned") {
      return { stopped: this.entries.get(params.agentId) === current };
    }

    if (killOutcome === "ended") {
      return { stopped: true };
    }

    const remaining = Math.max(
      0,
      STOP_TIMEOUT_MS - (Date.now() - requestStartedAt),
    );
    const exited = await waitForExit(current.child, remaining);

    if (exited) {
      return { stopped: true };
    }

    if (this.rollbackTermination(params.agentId, params.runId, termSeq)) {
      throw new RpcError(
        "stopFailed",
        `Agent "${params.agentId}" 在 3 秒内没有结束，已恢复为运行中`,
      );
    }

    return { stopped: true };
  }

  private phaseFor(
    entry: PoolEntry | undefined,
  ): AgentInfo["phase"] {
    if (!entry) return "idle";
    if (entry.status === "starting") return "starting";
    if (entry.killed) return "terminating";
    return "running";
  }

  listAgents(version: string): ListAgentsRpcResult {
    const config = this.currentConfig();
    const agents: AgentInfo[] = [];

    for (const agent of config.agents.values()) {
      const entry = this.entries.get(agent.id);
      agents.push({
        id: agent.id,
        label: agent.label,
        defaultModel: agent.defaultModel,
        modelAliases: agent.modelAliases,
        configured: agent.configured,
        ...(agent.reason ? { reason: agent.reason } : {}),
        phase: this.phaseFor(entry),
        runId: entry?.runId ?? null,
        resolvedModel: entry?.resolvedModel ?? null,
      });
    }

    for (const [agentId, entry] of this.entries) {
      if (config.agents.has(agentId)) continue;

      const configuredNow = config.status.ok;
      agents.push({
        id: agentId,
        label: entry.label,
        defaultModel: "",
        modelAliases: [],
        configured: false,
        reason: configuredNow
          ? "该 Agent 已从 config/agents.json 中移除，但这个实例仍在运行；终止它之后再保存一次配置即可让它从列表里消失"
          : "配置当前无法解析",
        phase: this.phaseFor(entry),
        runId: entry.runId,
        resolvedModel: entry.resolvedModel,
      });
    }

    return {
      agents,
      config: config.status,
      version,
    };
  }

  reloadConfig(): ConfigReloadResult {
    const config = this.configStore.reload();
    if (!config.status.ok) {
      throw new RpcError("configInvalid", config.status.error.message);
    }

    return {
      ok: true,
      agents: [...config.agents.keys()],
      path: config.path,
    };
  }

  shutdownAll(): void {
    this.shuttingDown = true;

    for (const entry of this.entries.values()) {
      if (entry.status !== "running") continue;

      entry.killed = true;
      try {
        entry.child.kill();
      } catch {
        // 关闭应用不等待退出，也无需让清理失败阻塞进程结束。
      }
    }

    this.entries.clear();
  }
}
