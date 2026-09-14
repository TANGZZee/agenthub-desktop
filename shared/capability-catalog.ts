/** AgentHub 内置能力目录的安全初始数据。仅用于界面登记，不代表已安装。 */
import type { AgentCapability, SharedMcpRegistration, SharedSkillRegistration } from "./agent-settings";

export const BUILTIN_PI_PLUGINS: AgentCapability[] = [
  { id: "pi-plugin-file-tools", name: "Pi 文件工具扩展", description: "Pi 专用的文件处理扩展，安装前需要单独确认权限。", kind: "pi_plugin", scope: "agent_native", ownerAgentId: "pi", supportedAgentIds: ["pi"], installed: false, enabled: false, permissionSummary: ["可能访问工作目录"] },
  { id: "pi-plugin-session-tools", name: "Pi 会话扩展", description: "增强 Pi 的会话管理能力。", kind: "pi_plugin", scope: "agent_native", ownerAgentId: "pi", supportedAgentIds: ["pi"], installed: false, enabled: false, permissionSummary: ["读取会话配置"] },
];

export const BUILTIN_SHARED_SKILLS: SharedSkillRegistration[] = [
  { id: "skill-document-summary", name: "文档整理 Skill", description: "把长文档整理成提纲、摘要和行动清单。", entrypoint: "待安装", enabled: false, compatibleAgentIds: ["hermes", "pi", "codex", "claude"], permissionSummary: ["读取用户选择的文件"] },
  { id: "skill-code-review", name: "代码审查 Skill", description: "检查代码中的错误、风险和可维护性问题。", entrypoint: "待安装", enabled: false, compatibleAgentIds: ["hermes", "pi", "codex", "claude"], permissionSummary: ["读取项目文件"] },
];

export const BUILTIN_SHARED_MCP: SharedMcpRegistration[] = [
  { id: "mcp-filesystem", name: "文件系统 MCP", description: "向已获授权的 Agent 提供受限文件访问。", transport: "stdio", command: "待配置", enabled: false, compatibleAgentIds: ["hermes", "pi", "codex", "claude"], authentication: "none", permissionSummary: ["仅允许用户指定目录"] },
  { id: "mcp-web-search", name: "网页搜索 MCP", description: "提供网页搜索能力；联网前需要单独确认。", transport: "streamable_http", url: "待配置", enabled: false, compatibleAgentIds: ["hermes", "pi", "codex", "claude"], authentication: "missing", permissionSummary: ["访问网络"] },
];
