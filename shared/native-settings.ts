/**
 * 每个 Agent 的原生工作设置。
 * Hermes 做完整工作设置；Pi / Codex 只保留 AgentHub 真正会用到的项；
 * Claude Code 暂不可用，只显示说明。
 * 不包括窗口、主题、字体、快捷键；不改写原配置文件；不保存密钥。
 */
import type { AgentId } from "./agent-settings";

export type NativeSettingsTab = "native" | "hub";
export type HermesPlanningMode = "off" | "suggest" | "confirm";
export type HermesApprovalMode = "manual" | "smart";
export type HermesReasoningEffort = "none" | "low" | "medium" | "high";
export type CodexSandboxMode = "read-only" | "workspace-write";

export const HERMES_TOOLSETS = [
  { id: "web", label: "网页搜索", help: "允许 Hermes 搜索网页。", risky: false },
  { id: "browser", label: "浏览器", help: "允许控制浏览器。风险较高。", risky: true },
  { id: "file", label: "文件工具", help: "Hermes 的 file 工具集包含写入，默认关闭。", risky: true },
  { id: "terminal", label: "终端", help: "允许执行命令。风险很高。", risky: true },
  { id: "memory", label: "记忆工具", help: "允许读写 Hermes 记忆。", risky: false },
  { id: "delegation", label: "委派", help: "允许 Hermes 自己再派任务。AgentHub 调度不依赖这项。", risky: true },
  { id: "code_execution", label: "代码执行", help: "允许运行代码。", risky: true },
] as const;

export const PI_TOOLS = [
  { id: "read", label: "read", help: "读取文件" },
  { id: "grep", label: "grep", help: "搜索文件内容" },
  { id: "find", label: "find", help: "按名称查找文件" },
  { id: "ls", label: "ls", help: "列出目录" },
] as const;

export interface HermesNativeSettings {
  agentId: "hermes";
  modelId: string;
  provider: string;
  reasoningEffort: HermesReasoningEffort;
  maxTurns: number;
  workDirectory: string;
  memoryEnabled: boolean;
  userProfileEnabled: boolean;
  memoryWriteApproval: boolean;
  personalityEnabled: boolean;
  enabledToolsets: string[];
  planningMode: HermesPlanningMode;
  allowDelegation: boolean;
  maxPlanSteps: number;
  approvalsMode: HermesApprovalMode;
  networkEnabled: boolean;
  showLogs: boolean;
  showCost: boolean;
}

export interface PiNativeSettings {
  agentId: "pi";
  defaultProvider: string;
  modelId: string;
  enabledTools: string[];
  sessionEnabled: boolean;
}

export interface CodexNativeSettings {
  agentId: "codex";
  modelId: string;
  workDirectory: string;
  sandbox: CodexSandboxMode;
}

export interface ClaudeNativeSettings {
  agentId: "claude";
}

export type AgentNativeWorkSettings =
  | HermesNativeSettings
  | PiNativeSettings
  | CodexNativeSettings
  | ClaudeNativeSettings;

export function createDefaultNativeSettings(agentId: AgentId): AgentNativeWorkSettings {
  if (agentId === "pi") {
    return {
      agentId: "pi",
      defaultProvider: "",
      modelId: "",
      enabledTools: ["read", "grep", "find", "ls"],
      sessionEnabled: false,
    };
  }
  if (agentId === "codex") {
    return {
      agentId: "codex",
      modelId: "",
      workDirectory: "",
      sandbox: "read-only",
    };
  }
  if (agentId === "claude") {
    return { agentId: "claude" };
  }
  return {
    agentId: "hermes",
    modelId: "",
    provider: "",
    reasoningEffort: "medium",
    maxTurns: 90,
    workDirectory: "",
    memoryEnabled: true,
    userProfileEnabled: true,
    memoryWriteApproval: true,
    personalityEnabled: true,
    enabledToolsets: ["memory"],
    planningMode: "suggest",
    allowDelegation: true,
    maxPlanSteps: 5,
    approvalsMode: "manual",
    networkEnabled: false,
    showLogs: true,
    showCost: true,
  };
}

export function nativeConfigHint(agentId: string): { path: string; note: string } {
  if (agentId === "pi") {
    return { path: "%USERPROFILE%\\.pi\\agent\\settings.json", note: "Pi 的工作设置在这里。插件只属于 Pi。" };
  }
  if (agentId === "codex") {
    return { path: "%USERPROFILE%\\.codex\\config.toml", note: "Codex CLI 与桌面端共用这份配置。AgentHub 启动时仍使用只读沙箱。" };
  }
  if (agentId === "claude") {
    return { path: "%USERPROFILE%\\.claude\\settings.json", note: "Claude Code 当前不可接入，设置暂不开放。" };
  }
  return { path: "%LOCALAPPDATA%\\hermes\\config.yaml", note: "Hermes Desktop 与 CLI 共用这份配置。密钥在 .env，不会在这里显示。" };
}
