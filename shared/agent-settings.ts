/**
 * AgentHub 的 Agent 能力与设置模型。
 *
 * 重要原则：
 * 1. Pi 插件是 Pi 专属能力，不自动共享给其它 Agent。
 * 2. Skill 和 MCP 是可共享能力，但每个 Agent 仍需单独确认兼容性与权限。
 * 3. API Key、Token 等敏感信息不放进这些普通设置对象。
 */

export type AgentId = "hermes" | "pi" | "codex" | "claude" | (string & {});

/** 能力来源：属于某个 Agent，或属于 AgentHub 共享目录。 */
export type CapabilityScope = "agent_native" | "shared";

/** 能力类别。 */
export type CapabilityKind = "pi_plugin" | "skill" | "mcp_server";

/** 一个可安装、可启用或可共享的能力登记项。 */
export interface AgentCapability {
  id: string;
  name: string;
  description: string;
  kind: CapabilityKind;
  scope: CapabilityScope;
  /** pi_plugin 必须填写 pi；共享能力可以填写多个支持的 Agent。 */
  ownerAgentId?: "pi";
  supportedAgentIds: AgentId[];
  installed: boolean;
  enabled: boolean;
  version?: string;
  source?: string;
  permissionSummary: string[];
  reason?: string;
}

/** AgentHub 对每个 Agent 的统一调度设置。 */
export interface AgentHubAgentSettings {
  agentId: AgentId;
  enabled: boolean;
  allowHermesDispatch: boolean;
  allowWrite: boolean;
  requireConfirmation: boolean;
  showDetailedLogs: boolean;
  timeoutSeconds: number;
  priority: number;
}

/** Agent 的“原生设置”只保留非敏感、与工作能力有关的字段。 */
export interface AgentNativeSettings {
  agentId: AgentId;
  model?: string;
  baseUrl?: string;
  workDirectory?: string;
  toolPolicy?: string[];
  memoryEnabled?: boolean;
  autoApproval?: boolean;
  networkEnabled?: boolean;
  /** 原生设置文件是否找到；找不到时不能猜测默认值。 */
  sourceFound: boolean;
  sourcePath?: string;
  warnings: string[];
}

/** 共享 Skill 的注册信息。 */
export interface SharedSkillRegistration {
  id: string;
  name: string;
  description: string;
  entrypoint: string;
  enabled: boolean;
  compatibleAgentIds: AgentId[];
  permissionSummary: string[];
}

/** 共享 MCP 服务的注册信息，不保存密钥本身。 */
export interface SharedMcpRegistration {
  id: string;
  name: string;
  description: string;
  transport: "stdio" | "sse" | "streamable_http";
  command?: string;
  url?: string;
  enabled: boolean;
  compatibleAgentIds: AgentId[];
  authentication: "none" | "configured" | "missing";
  permissionSummary: string[];
}

/** Agent 设置中心读取结果。 */
export interface AgentSettingsSnapshot {
  agentHub: AgentHubAgentSettings;
  native: AgentNativeSettings;
  nativeCapabilities: AgentCapability[];
  sharedSkills: SharedSkillRegistration[];
  sharedMcpServers: SharedMcpRegistration[];
}

/** 默认的安全调度设置：写入和高风险操作默认需要确认。 */
export function createDefaultAgentHubSettings(
  agentId: AgentId,
): AgentHubAgentSettings {
  return {
    agentId,
    enabled: true,
    allowHermesDispatch: agentId !== "hermes",
    allowWrite: false,
    requireConfirmation: true,
    showDetailedLogs: true,
    timeoutSeconds: 1_800,
    priority: agentId === "pi" ? 10 : 5,
  };
}

/** 判断能力是否可以被共享：Pi 插件明确不能通过此规则共享。 */
export function isShareableCapability(capability: AgentCapability): boolean {
  return capability.kind !== "pi_plugin" && capability.scope === "shared";
}
