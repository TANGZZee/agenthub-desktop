/**
 * 阶段3：Agent 适配器统一接口。
 *
 * 适配器就像“转换插头”：不同 Agent 的命令行参数不同，
 * 但 AgentHub 内部只使用这一套统一接口。
 */

import type { AgentInfo } from "../../shared/protocol";

/** 由 Sidecar 校验后的任务封装。先用最小字段，后续接入 TaskEnvelope 时扩展。 */
export interface AdapterTask {
  taskId: string;
  prompt: string;
  model?: string | null;
  cwd: string;
  toolPolicy?: string[];
}

/** Agent 启动前探测结果。不得包含密钥或完整环境变量。 */
export interface AgentProbeResult {
  agentId: string;
  installed: boolean;
  canStart: boolean;
  version?: string;
  executablePath?: string;
  reason?: string;
}

/** 传给 spawn 的启动计划。 */
export interface AdapterLaunchSpec {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/** 统一的任务事件，供前端时间线和日志使用。 */
export type TaskEvent =
  | { type: "task_started"; taskId: string; agentId: string; at: string }
  | { type: "output"; taskId: string; agentId: string; stream: "stdout" | "stderr"; text: string; at: string }
  | { type: "progress"; taskId: string; agentId: string; message: string; at: string }
  | { type: "usage"; taskId: string; agentId: string; inputTokens?: number; outputTokens?: number; cost?: number; at: string }
  | { type: "task_succeeded"; taskId: string; agentId: string; at: string }
  | { type: "task_failed"; taskId: string; agentId: string; message: string; at: string }
  | { type: "task_cancelled"; taskId: string; agentId: string; at: string };

/** 从 Agent 输出中提取的统一结果。 */
export interface ParsedTaskOutput {
  text: string;
  events: TaskEvent[];
  warnings: string[];
}

/** 用量读取结果。未知时明确标记 unavailable，不猜测费用。 */
export interface UsageResult {
  source: "agent_report" | "unavailable";
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
}

/**
 * 所有真实 Agent 都必须实现的接口。
 * 具体 Agent 的实现放在 sidecar/src/adapters/ 下。
 */
export interface AgentAdapter {
  readonly agentId: string;
  probe(): Promise<AgentProbeResult>;
  buildArgs(task: AdapterTask, agent: AgentInfo): string[];
  buildEnv(task: AdapterTask): NodeJS.ProcessEnv;
  parseOutput(text: string, stream?: "stdout" | "stderr"): ParsedTaskOutput;
  readUsage(): Promise<UsageResult>;
  cancel(runId: number): Promise<void>;
}
