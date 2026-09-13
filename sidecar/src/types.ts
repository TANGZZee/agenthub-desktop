/**
 * Sidecar 内部使用的配置类型。
 *
 * 这里只描述 config/agents.json 的结构，不定义前后端协议。
 * RPC、事件和 AgentInfo 等协议类型统一从 shared/protocol.ts 导入。
 */

import type { ConfigStatus, InjectedEnv } from "../../shared/protocol";

/** 环境变量模板目前只支持这三个占位符。 */
export type TemplateVariable = "model" | "base_url" | "api_key";

/**
 * 一个 Agent 在 config/agents.json 里的配置。
 *
 * cwd 的相对路径以配置文件所在目录为基准；
 * command 和 args 会原样交给 Node 的 spawn，不做路径替换。
 */
export interface AgentConfig {
  label: string;
  command: string;
  args: string[];
  default_model: string;
  cwd: string;
  /** 仅用于测试和演示，把“正在启动”状态延长指定毫秒数；日常应保持 0。 */
  start_delay_ms?: number;
  /** 仅用于测试和演示，把终止动作推迟指定毫秒数；日常应保持 0。 */
  stop_delay_ms?: number;
}

/** 模型别名映射：别名 -> 各 Agent 对应的真实模型名。 */
export type ModelAliases = Record<string, Record<string, string>>;

/** 环境变量注入模板：Agent ID -> 环境变量名 -> 模板字符串。 */
export type EnvInjectionTemplates = Record<string, Record<string, string>>;

/** CC Switch 路由配置。 */
export interface CcSwitchConfig {
  base_url: string;
  /**
   * 保存 API Key 的系统环境变量名。
   *
   * 校验时只有 base_url 被规定为致命必需项；这里允许省略，
   * 后续配置加载器可以补一个默认环境变量名。
   */
  api_key_env?: string;
}

/** config/agents.json 的完整结构。 */
export interface AgentsConfig {
  agents: Record<string, AgentConfig>;
  model_aliases: ModelAliases;
  env_injection: EnvInjectionTemplates;
  cc_switch: CcSwitchConfig;
}

/**
 * 经过解析和校验后、可供 Agent 池直接使用的 Agent 配置。
 *
 * cwd 已经是绝对路径；延迟字段已经有确定的数值；
 * configured=false 时其余可执行字段仍保留为安全默认值，便于界面完整展示。
 */
export interface ResolvedAgentConfig {
  id: string;
  label: string;
  command: string;
  args: string[];
  defaultModel: string;
  modelAliases: string[];
  /** 别名 -> 真实模型名，启动时不再重新读取原始 JSON。 */
  modelsByAlias: Record<string, string>;
  cwd: string;
  startDelayMs: number;
  stopDelayMs: number;
  envTemplates: Record<string, string>;
  configured: boolean;
  reason?: string;
}

/** 经过默认值补全后的 CC Switch 配置。 */
export interface ResolvedCcSwitchConfig {
  baseUrl: string;
  apiKeyEnvironmentName: string;
}

/** 一次完整配置读取的结果：Agent 表与可供 listAgents 返回的状态。 */
export interface ResolvedConfig {
  path: string;
  agents: Map<string, ResolvedAgentConfig>;
  ccSwitch: ResolvedCcSwitchConfig;
  status: ConfigStatus;
}

/** 一次模型解析与环境变量注入的结果。 */
export interface ModelInjection {
  alias: string;
  resolvedModel: string;
  /** 传给 spawn 的完整三层环境变量。 */
  spawnEnv: NodeJS.ProcessEnv;
  /** 只回传给界面的第二、三层变量。 */
  injectedEnv: InjectedEnv;
  /** 不影响启动、但需要提示用户的非致命问题。 */
  warnings: string[];
}
