/**
 * AgentHub Desktop 阶段2共享协议。
 *
 * 这份文件是 TypeScript 侧唯一一份协议定义：
 * - Sidecar 从这里导入 Rust <-> Sidecar 的 RPC 类型；
 * - 前端从这里导入 Rust <-> 前端的命令与事件类型；
 * - Rust 侧需要手写对应的 serde 结构，改字段时必须同步修改。
 */

// ---------------------------------------------------------------------------
// 通用类型
// ---------------------------------------------------------------------------

/** Sidecar 返回的业务错误，以及 Rust 自己产生的链路错误。 */
export type ErrorKind =
  | "nodeMissing"
  | "sidecarCrashed"
  | "sidecarTimeout"
  | "internal"
  | "configInvalid"
  | "agentNotFound"
  | "alreadyRunning"
  | "agentStartFailed"
  | "stopFailed";

/** Rust 命令统一返回给前端的结构化错误。 */
export interface CmdError {
  kind: ErrorKind;
  message: string;
}

/** Agent 的运行相位。idle 表示当前没有实例。 */
export type AgentPhase = "idle" | "starting" | "running" | "terminating";

/** 通知里只会出现非 idle 相位，因为 idle 表示记录已经不存在。 */
export type ActiveAgentPhase = Exclude<AgentPhase, "idle">;

/** Agent 输出流类型。 */
export type OutputStream = "stdout" | "stderr";

/**
 * 注入环境变量在回传时的安全结构。
 *
 * 普通值可以直接显示；密钥只报告是否设置以及长度，
 * 避免把 API Key 等敏感内容送进 WebView。
 */
export type InjectedValue =
  | { kind: "plain"; value: string }
  | { kind: "secret"; set: boolean; length: number };

/** 注入环境变量的完整摘要。 */
export type InjectedEnv = Record<string, InjectedValue>;

// ---------------------------------------------------------------------------
// Sidecar 返回给 Rust / 前端的 Agent 清单
// ---------------------------------------------------------------------------

/** 配置整体是否可用。配置有误时通过数据返回，不让 listAgents 整体失败。 */
export type ConfigStatus =
  | { ok: true; error?: never }
  | { ok: false; error: CmdError };

/**
 * 一个 Agent 的静态配置信息与当前运行时状态。
 *
 * 即使 Agent 已从配置中删除或配置整体解析失败，也仍然返回完整形状；
 * 此时 defaultModel 使用空字符串，modelAliases 使用空数组。
 */
export interface AgentInfo {
  id: string;
  label: string;
  defaultModel: string;
  /** 这个 Agent 可选模型别名，由配置算出。 */
  modelAliases: string[];
  /** 配置里的 command、别名和 cwd 是否都可用。 */
  configured: boolean;
  /** configured 为 false 时给出可直接展示的原因。 */
  reason?: string;
  /** 运行时状态。没有实例时为 idle。 */
  phase: AgentPhase;
  /** phase 不为 idle 时的本轮运行编号，否则为 null。 */
  runId: number | null;
  /** phase 不为 idle 时本轮实际使用的模型，否则为 null。 */
  resolvedModel: string | null;
  /** 最近一次只读版本探测结果。 */
  probe?: { installed: boolean; canStart: boolean; version: string | null; executablePath: string | null; status: "confirmed" | "unavailable" | "failed"; reason?: string };
}

// ---------------------------------------------------------------------------
// Rust <-> Sidecar：JSON-RPC 2.0
// ---------------------------------------------------------------------------

/** Sidecar 支持的 RPC 方法名。 */
export const RPC_METHODS = {
  ping: "ping",
  configReload: "configReload",
  startAgent: "startAgent",
  stopAgent: "stopAgent",
  listAgents: "listAgents",
  shutdown: "shutdown",
  taskSubmit: "taskSubmit",
  taskList: "taskList",
  taskCancel: "taskCancel",
} as const;

export type RpcMethod = (typeof RPC_METHODS)[keyof typeof RPC_METHODS];

export interface PingParams {}

export interface PingResult {
  ok: true;
  version: string;
}

export interface ConfigReloadParams {}

export interface ConfigReloadResult {
  ok: true;
  agents: string[];
  path: string;
}

export interface StartAgentParams {
  agentId: string;
  prompt: string;
  /** 省略或传 null 时，Sidecar 使用该 Agent 的 default_model。 */
  model?: string | null;
  runId: number;
}

export interface StartAck {
  agentId: string;
  runId: number;
  resolvedModel: string;
  injectedEnv: InjectedEnv;
  cwd: string;
}

export interface StopAgentParams {
  agentId: string;
  runId: number;
}

export interface StopAgentResult {
  stopped: boolean;
}

export interface ListAgentsParams {}

export interface ListAgentsRpcResult {
  agents: AgentInfo[];
  config: ConfigStatus;
  version: string;
}

export interface TaskSubmitParams { proposal: import("./task-protocol").TaskProposal; }
export interface TaskListParams {}
export interface TaskCancelParams { taskId: string; }

export interface ShutdownParams {}

export interface ShutdownResult {
  ok: true;
}

export interface RpcParamsMap {
  ping: PingParams;
  configReload: ConfigReloadParams;
  startAgent: StartAgentParams;
  stopAgent: StopAgentParams;
  listAgents: ListAgentsParams;
  shutdown: ShutdownParams;
  taskSubmit: TaskSubmitParams;
  taskList: TaskListParams;
  taskCancel: TaskCancelParams;
}

export interface RpcResultMap {
  ping: PingResult;
  configReload: ConfigReloadResult;
  startAgent: StartAck;
  stopAgent: StopAgentResult;
  listAgents: ListAgentsRpcResult;
  shutdown: ShutdownResult;
  taskSubmit: { accepted: boolean; reasons: string[]; envelope?: import("./task-protocol").TaskEnvelope };
  taskList: { tasks: Array<import("./task-protocol").TaskRecordWire> };
  taskCancel: { task: import("./task-protocol").TaskRecordWire };
}

export interface RpcError {
  code: number;
  message: string;
  data: {
    kind: ErrorKind;
  };
}

export interface JsonRpcRequest<M extends RpcMethod = RpcMethod> {
  jsonrpc: "2.0";
  id: number;
  method: M;
  params: RpcParamsMap[M];
}

export interface JsonRpcSuccessResponse<M extends RpcMethod = RpcMethod> {
  jsonrpc: "2.0";
  id: number;
  result: RpcResultMap[M];
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: number;
  error: RpcError;
}

export type JsonRpcResponse<M extends RpcMethod = RpcMethod> =
  | JsonRpcSuccessResponse<M>
  | JsonRpcErrorResponse;

// ---------------------------------------------------------------------------
// Sidecar -> Rust -> 前端：通知 payload
// ---------------------------------------------------------------------------

/** Sidecar 主动发送的 JSON-RPC 通知方法名。 */
export const SIDECAR_NOTIFICATIONS = {
  agentOutput: "agent/output",
  agentState: "agent/state",
  agentExit: "agent/exit",
  agentError: "agent/error",
  sidecarLog: "sidecar/log",
} as const;

export type SidecarNotificationMethod =
  (typeof SIDECAR_NOTIFICATIONS)[keyof typeof SIDECAR_NOTIFICATIONS];

export interface AgentOutputNotification {
  runId: number;
  agentId: string;
  stream: OutputStream;
  line: string;
}

export interface AgentStateNotification {
  runId: number;
  agentId: string;
  phase: ActiveAgentPhase;
  /**
   * 本轮模型名必须随事件一起发送。
   * 刷新后的页面可能只收到事件、收不到快照，事件必须能独立建出完整记录。
   */
  resolvedModel: string;
}

export interface AgentExitNotification {
  runId: number;
  agentId: string;
  code: number | null;
  killed: boolean;
  /** 终态事件同样自带模型名，避免进程退出后快照再也补不回该字段。 */
  resolvedModel: string;
}

export interface AgentErrorNotification {
  runId: number;
  agentId: string;
  kind: ErrorKind;
  message: string;
  /** 终态事件同样自带模型名，保证事件可以独立形成完整记录。 */
  resolvedModel: string;
}

export interface SidecarLogNotification {
  level: "info" | "warn";
  message: string;
}

export interface SidecarNotificationParamsMap {
  "agent/output": AgentOutputNotification;
  "agent/state": AgentStateNotification;
  "agent/exit": AgentExitNotification;
  "agent/error": AgentErrorNotification;
  "sidecar/log": SidecarLogNotification;
}

export interface JsonRpcNotification<
  M extends SidecarNotificationMethod = SidecarNotificationMethod,
> {
  jsonrpc: "2.0";
  method: M;
  params: SidecarNotificationParamsMap[M];
}

// ---------------------------------------------------------------------------
// Rust <-> 前端：Tauri 命令和事件
// ---------------------------------------------------------------------------

/** Rust 注册给前端调用的三个命令名。 */
export const TAURI_COMMANDS = {
  startAgent: "start_agent",
  stopAgent: "stop_agent",
  listAgents: "list_agents",
  submitTask: "submit_task",
  listTasks: "list_tasks",
  cancelTask: "cancel_task",
} as const;

export type TauriCommand = (typeof TAURI_COMMANDS)[keyof typeof TAURI_COMMANDS];

export interface StartAgentCommandParams {
  agentId: string;
  prompt: string;
  model?: string | null;
  runId: number;
}

export interface StopAgentCommandParams {
  agentId: string;
  runId: number;
}

export interface SidecarStatus {
  /** Rust 判断的 Sidecar 存活性。 */
  available: boolean;
  /** Windows Job Object 是否成功接管子进程。 */
  jobObject: boolean;
  /** Sidecar 的 ping.version。 */
  version: string;
}

/** list_agents 命令的完整返回值。 */
export interface ListAgentsResult {
  /** 池记录与能解析出来的配置项合并后的结果。 */
  agents: AgentInfo[];
  /** 配置问题作为数据返回，而不是让整条命令失败。 */
  config: ConfigStatus;
  /** Sidecar 的可用性、Job Object 状态与版本。 */
  sidecar: SidecarStatus;
}

/** Rust 通过 Tauri 发给前端的事件名。 */
export const TAURI_EVENTS = {
  agentOutput: "agent-output",
  agentState: "agent-state",
  agentExit: "agent-exit",
  agentError: "agent-error",
  sidecarStatus: "sidecar-status",
} as const;

export type TauriEvent = (typeof TAURI_EVENTS)[keyof typeof TAURI_EVENTS];

export interface SidecarStatusEvent {
  available: boolean;
  message?: string;
  /** 即使 Sidecar 已经存活，刷新后的页面也必须能通过事件和快照获知该状态。 */
  jobObject: boolean;
}

export interface TauriEventPayloadMap {
  "agent-output": AgentOutputNotification;
  "agent-state": AgentStateNotification;
  "agent-exit": AgentExitNotification;
  "agent-error": AgentErrorNotification;
  "sidecar-status": SidecarStatusEvent;
}
