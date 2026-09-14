import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

import JSON5 from "json5";

import type { CmdError, ConfigStatus } from "../../shared/protocol";
import type {
  ResolvedAgentConfig,
  ResolvedConfig,
  TemplateVariable,
} from "./types";

const CONFIG_INVALID_KIND = "configInvalid";
const DEFAULT_API_KEY_ENV = "CC_SWITCH_API_KEY";

const PREFERRED_ALIAS_ORDER = ["fast", "balanced", "powerful"] as const;
const TEMPLATE_VARIABLES = new Set<TemplateVariable>([
  "model",
  "base_url",
  "api_key",
]);

interface Json5ParseError extends Error {
  lineNumber?: number;
  columnNumber?: number;
}

function configError(message: string): CmdError {
  return {
    kind: CONFIG_INVALID_KIND,
    message,
  };
}

function failedConfig(path: string, message: string): ResolvedConfig {
  return {
    path,
    agents: new Map(),
    ccSwitch: {
      baseUrl: "",
      apiKeyEnvironmentName: DEFAULT_API_KEY_ENV,
    },
    status: {
      ok: false,
      error: configError(message),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function formatJson5Error(error: unknown): string {
  const parseError = error as Json5ParseError;
  const message = parseError.message || String(error);

  if (
    typeof parseError.lineNumber === "number" &&
    typeof parseError.columnNumber === "number"
  ) {
    return `第 ${parseError.lineNumber} 行，第 ${parseError.columnNumber} 列：${message}`;
  }

  return message;
}

function unknownPlaceholder(template: string): string | null {
  const matches = template.matchAll(/\{([^}]*)\}/g);

  for (const match of matches) {
    const variable = match[1] as TemplateVariable;
    if (!TEMPLATE_VARIABLES.has(variable)) {
      return match[0];
    }
  }

  return null;
}

function readDelay(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.floor(value);
}

function modelsFor(
  modelAliases: Record<string, unknown>,
  agentId: string,
): Record<string, string> {
  const available = new Map<string, string>();

  for (const [alias, mapping] of Object.entries(modelAliases)) {
    if (isRecord(mapping) && typeof mapping[agentId] === "string") {
      available.set(alias, mapping[agentId]);
    }
  }

  const preferred = PREFERRED_ALIAS_ORDER.filter((alias) =>
    available.has(alias),
  );
  const remaining = [...available.keys()]
    .filter(
      (alias) =>
        !preferred.includes(alias as (typeof PREFERRED_ALIAS_ORDER)[number]),
    )
    .sort((left, right) => left.localeCompare(right));

  const ordered: Record<string, string> = {};
  for (const alias of [...preferred, ...remaining]) {
    ordered[alias] = available.get(alias) as string;
  }

  return ordered;
}

function getStringMap(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;

  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") return null;
    result[key] = item;
  }

  return result;
}

function resolveAgent(
  id: string,
  rawAgent: unknown,
  modelAliases: Record<string, unknown>,
  rawEnvTemplates: Record<string, unknown>,
  configDirectory: string,
): ResolvedAgentConfig {
  const agent = isRecord(rawAgent) ? rawAgent : {};
  const modelsByAlias = modelsFor(modelAliases, id);
  const aliases = Object.keys(modelsByAlias);
  const envTemplates = getStringMap(rawEnvTemplates[id]);

  const label = isNonEmptyString(agent.label) ? agent.label.trim() : id;
  const command = isNonEmptyString(agent.command) ? agent.command : "";
  const args = Array.isArray(agent.args)
    ? agent.args.filter((item): item is string => typeof item === "string")
    : [];
  const enabled = agent.enabled !== false;
  const defaultModel = isNonEmptyString(agent.default_model)
    ? agent.default_model
    : "";

  const rawCwd = isNonEmptyString(agent.cwd) ? agent.cwd : "";
  const cwd = rawCwd ? resolve(configDirectory, rawCwd) : "";

  let reason: string | undefined;

  if (!command) {
    reason = `Agent "${id}" 缺少 command`;
  } else if (aliases.length === 0) {
    reason = `Agent "${id}" 没有配置任何模型别名`;
  } else if (!defaultModel) {
    reason = `Agent "${id}" 缺少 default_model`;
  } else if (!aliases.includes(defaultModel)) {
    reason = `Agent "${id}" 的 default_model "${defaultModel}" 不在它自己的模型别名中`;
  } else if (envTemplates === null) {
    reason = `Agent "${id}" 缺少 env_injection 配置，或模板值不是字符串`;
  } else if (!rawCwd) {
    reason = `Agent "${id}" 缺少 cwd`;
  } else if (!cwd) {
    reason = `Agent "${id}" 的 cwd 无法解析`;
  } else {
    try {
      if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
        reason = `Agent "${id}" 的 cwd 不存在或不是目录：${cwd}`;
      }
    } catch (error) {
      reason = `Agent "${id}" 的 cwd 无法访问：${cwd}（${String(error)}）`;
    }
  }

  if (!reason && envTemplates) {
    for (const [name, template] of Object.entries(envTemplates)) {
      const placeholder = unknownPlaceholder(template);
      if (placeholder) {
        reason = `Agent "${id}" 的环境变量 ${name} 引用了无法解析的占位符 ${placeholder}`;
        break;
      }
    }
  }

  return {
    id,
    label,
    command,
    args,
    defaultModel,
    modelAliases: aliases,
    modelsByAlias,
    cwd,
    enabled,
    startDelayMs: readDelay(agent.start_delay_ms),
    stopDelayMs: readDelay(agent.stop_delay_ms),
    envTemplates: envTemplates ?? {},
    configured: reason === undefined,
    ...(reason ? { reason } : {}),
  };
}

/**
 * 读取并校验一份配置文件。
 *
 * 这里故意不抛异常：语法错误和致命字段缺失都作为 config.error 返回，
 * 让 listAgents 仍能保留池里的运行记录。
 */
export function loadConfig(configPath: string): ResolvedConfig {
  const absolutePath = resolve(configPath);
  let text: string;

  try {
    text = readFileSync(absolutePath, "utf8");
  } catch (error) {
    return failedConfig(
      absolutePath,
      `无法读取配置文件 "${absolutePath}"：${String(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON5.parse(text);
  } catch (error) {
    return failedConfig(
      absolutePath,
      `配置文件语法错误：${formatJson5Error(error)}`,
    );
  }

  if (!isRecord(parsed)) {
    return failedConfig(absolutePath, "配置文件顶层必须是一个对象");
  }

  if (!isRecord(parsed.agents) || Object.keys(parsed.agents).length === 0) {
    return failedConfig(
      absolutePath,
      '配置字段 "agents" 缺失、不是对象或为空',
    );
  }

  if (!isRecord(parsed.model_aliases)) {
    return failedConfig(
      absolutePath,
      '配置字段 "model_aliases" 缺失或不是对象',
    );
  }

  if (!isRecord(parsed.cc_switch) || !isNonEmptyString(parsed.cc_switch.base_url)) {
    return failedConfig(
      absolutePath,
      '配置字段 "cc_switch.base_url" 缺失或不是非空字符串',
    );
  }

  if (!isRecord(parsed.env_injection)) {
    return failedConfig(
      absolutePath,
      '配置字段 "env_injection" 缺失或不是对象',
    );
  }

  const configDirectory = dirname(absolutePath);
  const agents = new Map<string, ResolvedAgentConfig>();

  for (const [id, rawAgent] of Object.entries(parsed.agents)) {
    agents.set(
      id,
      resolveAgent(
        id,
        rawAgent,
        parsed.model_aliases,
        parsed.env_injection,
        configDirectory,
      ),
    );
  }

  const status: ConfigStatus = { ok: true };
  const apiKeyEnvironmentName =
    isNonEmptyString(parsed.cc_switch.api_key_env)
      ? parsed.cc_switch.api_key_env
      : DEFAULT_API_KEY_ENV;

  return {
    path: absolutePath,
    agents,
    ccSwitch: {
      baseUrl: parsed.cc_switch.base_url,
      apiKeyEnvironmentName,
    },
    status,
  };
}

/**
 * 带 mtime 缓存的配置仓库。
 *
 * 热重载只替换配置快照，不清空 Agent 池；正在运行的实例因此不会因为
 * 用户修改配置文件而被强行终止。
 */
export class ConfigStore {
  private readonly configPath: string;
  private snapshot: ResolvedConfig | null = null;
  private lastMtimeMs: number | null = null;
  private hasSnapshot = false;

  constructor(configPath: string) {
    this.configPath = resolve(configPath);
  }

  /**
   * 检查文件 mtime，变化时重新加载。
   *
   * 返回值表示本次是否真的重载，调用方可用于决定是否刷新 roster。
   */
  ensureFresh(): boolean {
    let mtimeMs: number | null = null;

    try {
      mtimeMs = statSync(this.configPath).mtimeMs;
    } catch {
      // 文件暂时读不到时，loadConfig 会给出更具体、可展示的错误。
    }

    if (this.hasSnapshot && this.lastMtimeMs === mtimeMs) {
      return false;
    }

    this.lastMtimeMs = mtimeMs;
    this.snapshot = loadConfig(this.configPath);
    this.hasSnapshot = true;
    return true;
  }

  /** 强制重载，供 configReload 使用。 */
  reload(): ResolvedConfig {
    try {
      this.lastMtimeMs = statSync(this.configPath).mtimeMs;
    } catch {
      this.lastMtimeMs = null;
    }

    this.snapshot = loadConfig(this.configPath);
    this.hasSnapshot = true;
    return this.snapshot;
  }

  /** 取当前快照，必要时先做一次 mtime 检查。 */
  getSnapshot(): ResolvedConfig {
    this.ensureFresh();
    return this.snapshot as ResolvedConfig;
  }

  get path(): string {
    return this.configPath;
  }

  /** 配置加载器只使用这一种默认值；这里集中定义，避免各处写散。 */
  get apiKeyEnvironmentName(): string {
    return this.getSnapshot().ccSwitch.apiKeyEnvironmentName;
  }
}
