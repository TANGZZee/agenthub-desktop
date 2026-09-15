// GENERATED FILE — do not edit by hand.
//
// Source: docs/catalog/agenthub-market.json
// Regenerate: npm run catalog:sync
//
// This is the desktop's offline fallback for the market catalog. It is the same
// data the remote document carries; which agents are *runnable* is decided in
// profiles.ts, not here.

import type { MarketEntryDraft } from "../../shared/agenthub-market";

/** Date the catalog was last edited upstream, for display only. */
export const MARKET_UPDATED_AT = "2026-09-15";

export const MARKET_ENTRIES: readonly MarketEntryDraft[] = [
  {
    id: "claude-code",
    rank: 1,
    name: "Claude Code",
    vendor: "Anthropic",
    category: "official",
    role: { zh: "代码智能体", en: "Coding agent" },
    description: {
      zh: "Anthropic 官方命令行编码智能体，用户量最大；等待只读参数与凭据隔离验证后接入。",
      en: "Anthropic's official coding CLI and the most widely used agent today; waiting for read-only flag and credential-isolation verification.",
    },
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code",
    installHint: "npm install -g @anthropic-ai/claude-code",
    binaries: {
      win: ["claude.cmd", "claude.exe", "claude"],
      unix: ["claude"],
    },
    permissions: ["planned"],
  },
  {
    id: "codex",
    rank: 2,
    name: "Codex CLI",
    vendor: "OpenAI",
    category: "official",
    role: { zh: "代码智能体", en: "Coding agent" },
    description: {
      zh: "OpenAI 官方命令行编码智能体，计划使用官方 read-only 沙箱接入，不使用绕过审批的开关。",
      en: "OpenAI's official coding CLI. AgentHub plans to use its official read-only sandbox and never a bypass-approvals flag.",
    },
    docsUrl: "https://github.com/openai/codex",
    installHint: "npm install -g @openai/codex",
    binaries: {
      win: ["codex.cmd", "codex.exe", "codex"],
      unix: ["codex"],
    },
    permissions: ["read-only-sandbox", "no-write", "planned"],
  },
  {
    id: "gemini-cli",
    rank: 3,
    name: "Gemini CLI",
    vendor: "Google",
    category: "official",
    role: { zh: "终端智能体", en: "Terminal agent" },
    description: {
      zh: "Google 官方开源终端智能体，支持工具白名单与 MCP，计划用只读参数接入。",
      en: "Google's official open-source terminal agent with tool allowlists and MCP support; planned read-only integration.",
    },
    docsUrl: "https://github.com/google-gemini/gemini-cli",
    installHint: "npm install -g @google/gemini-cli",
    binaries: {
      win: ["gemini.cmd", "gemini.exe", "gemini"],
      unix: ["gemini"],
    },
    permissions: ["no-write", "planned"],
  },
  {
    id: "copilot-cli",
    rank: 4,
    name: "GitHub Copilot CLI",
    vendor: "GitHub",
    category: "vendor-cli",
    role: { zh: "厂商编码智能体", en: "Vendor coding agent" },
    description: {
      zh: "GitHub 官方命令行编码智能体，可直接复用已有的 Copilot 订阅。",
      en: "GitHub's official coding CLI; reuses an existing Copilot subscription.",
    },
    docsUrl: "https://github.com/github/copilot-cli",
    installHint: "npm install -g @github/copilot",
    binaries: {
      win: ["copilot.cmd", "copilot.exe", "copilot"],
      unix: ["copilot"],
    },
    permissions: ["no-write", "planned"],
  },
  {
    id: "cursor-agent",
    rank: 5,
    name: "Cursor CLI",
    vendor: "Cursor",
    category: "vendor-cli",
    role: { zh: "厂商编码智能体", en: "Vendor coding agent" },
    description: {
      zh: "Cursor 的命令行智能体，可在终端复用编辑器账号与项目规则。",
      en: "Cursor's command-line agent; reuses the editor account and project rules from the terminal.",
    },
    docsUrl: "https://cursor.com/cli",
    installHint: "按 Cursor CLI 官方文档安装",
    binaries: {
      win: ["cursor-agent.cmd", "cursor-agent"],
      unix: ["cursor-agent"],
    },
    permissions: ["no-write", "planned"],
  },
  {
    id: "opencode",
    rank: 6,
    name: "OpenCode",
    vendor: "SST",
    category: "open-source",
    role: { zh: "开源终端智能体", en: "Open-source terminal agent" },
    description: {
      zh: "开源终端编码智能体，可自由切换模型提供商，社区活跃。",
      en: "Open-source terminal coding agent with pluggable model providers and an active community.",
    },
    docsUrl: "https://github.com/sst/opencode",
    installHint: "按 OpenCode 官方文档安装",
    binaries: {
      win: ["opencode.cmd", "opencode.exe", "opencode"],
      unix: ["opencode"],
    },
    permissions: ["no-write", "planned"],
  },
  {
    id: "cline",
    rank: 7,
    name: "Cline CLI",
    vendor: "Cline",
    category: "open-source",
    role: { zh: "开源编码智能体", en: "Open-source coding agent" },
    description: {
      zh: "知名开源编码智能体的命令行版本，行为透明、可逐步确认。",
      en: "The command-line build of a well-known open-source coding agent; transparent and step-confirmable.",
    },
    docsUrl: "https://github.com/cline/cline",
    installHint: "npm install -g cline",
    binaries: {
      win: ["cline.cmd", "cline"],
      unix: ["cline"],
    },
    permissions: ["no-write", "planned"],
  },
  {
    id: "aider",
    rank: 8,
    name: "Aider",
    vendor: "Aider",
    category: "open-source",
    role: { zh: "开源代码助手", en: "Open-source pair programmer" },
    description: {
      zh: "以 Git 为中心的配对编程工具，每步改动都可回退，适合审查型任务。",
      en: "A git-centric pair programmer whose every change is revertible — well suited to review-style tasks.",
    },
    docsUrl: "https://aider.chat/",
    installHint: "python -m pip install aider-install && aider-install",
    binaries: {
      win: ["aider.exe", "aider"],
      unix: ["aider"],
    },
    permissions: ["no-write", "planned"],
  },
  {
    id: "qwen-code",
    rank: 9,
    name: "Qwen Code",
    vendor: "阿里云",
    category: "china-ecosystem",
    role: { zh: "终端智能体", en: "Terminal agent" },
    description: {
      zh: "通义千问官方命令行智能体，中文场景与国内模型接入更顺畅。",
      en: "Alibaba's official Qwen terminal agent; smoother Chinese-language and mainland-model setup.",
    },
    docsUrl: "https://github.com/QwenLM/qwen-code",
    installHint: "npm install -g @qwen-code/qwen-code",
    binaries: {
      win: ["qwen.cmd", "qwen.exe", "qwen"],
      unix: ["qwen"],
    },
    permissions: ["no-write", "planned"],
  },
  {
    id: "goose",
    rank: 10,
    name: "Goose",
    vendor: "Block",
    category: "open-source",
    role: { zh: "开源本地智能体", en: "Open-source local agent" },
    description: {
      zh: "Block 开源的本地执行智能体，扩展生态成熟，可完全本地运行。",
      en: "Block's open-source local agent with a mature extension ecosystem and fully local operation.",
    },
    docsUrl: "https://github.com/block/goose",
    installHint: "按 Goose 官方文档安装 CLI",
    binaries: {
      win: ["goose.exe", "goose"],
      unix: ["goose"],
    },
    permissions: ["no-write", "planned"],
  },
];
