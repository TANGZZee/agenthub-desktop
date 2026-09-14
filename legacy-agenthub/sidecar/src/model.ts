import type { InjectedEnv, InjectedValue } from "../../shared/protocol";
import type {
  ModelInjection,
  ResolvedAgentConfig,
  ResolvedCcSwitchConfig,
} from "./types";

const SECRET_ENVIRONMENT_NAME = /_TOKEN$|_API_KEY$|_KEY$/i;

/**
 * 判断一个环境变量是否应按密钥处理。
 *
 * 这里只决定“回传和打印时是否隐藏原文”，真正的 spawn env 仍保留完整值。
 */
export function isSecretEnvironmentName(name: string): boolean {
  return SECRET_ENVIRONMENT_NAME.test(name);
}

/** 把模型别名翻译成真实模型名。 */
export function resolveModelName(
  agent: ResolvedAgentConfig,
  requestedModel: string | null | undefined,
): { ok: true; alias: string; model: string } | { ok: false; message: string } {
  const alias =
    typeof requestedModel === "string" && requestedModel.trim().length > 0
      ? requestedModel.trim()
      : agent.defaultModel;

  if (!agent.modelAliases.includes(alias)) {
    return {
      ok: false,
      message: `Agent "${agent.id}" 不支持模型别名 "${alias}"`,
    };
  }

  const model = agent.modelsByAlias[alias];
  if (typeof model !== "string" || model.length === 0) {
    return {
      ok: false,
      message: `Agent "${idSafe(agent.id)}" 的模型别名 "${alias}" 没有对应模型名`,
    };
  }

  return { ok: true, alias, model };
}

function idSafe(id: string): string {
  return id || "unknown";
}

function interpolateTemplate(
  template: string,
  values: {
    model: string;
    baseUrl: string;
    apiKey: string;
  },
): string {
  return template
    .replaceAll("{model}", values.model)
    .replaceAll("{base_url}", values.baseUrl)
    .replaceAll("{api_key}", values.apiKey);
}

function toInjectedValue(name: string, value: string): InjectedValue {
  if (isSecretEnvironmentName(name)) {
    return {
      kind: "secret",
      set: value.length > 0,
      length: value.length,
    };
  }

  return {
    kind: "plain",
    value,
  };
}

/**
 * 组装三层环境变量：
 * 1. 继承宿主 process.env；
 * 2. 展开 env_injection 模板；
 * 3. 增加 AGENTHUB_* 上下文。
 *
 * 只有第 2、3 层进入 injectedEnv，避免把整台机器的环境变量送进 WebView。
 */
export function buildModelInjection(
  agent: ResolvedAgentConfig,
  alias: string,
  resolvedModel: string,
  prompt: string,
  runId: number,
  ccSwitch: ResolvedCcSwitchConfig,
): ModelInjection {
  const apiKey =
    process.env[ccSwitch.apiKeyEnvironmentName] ?? "";
  const spawnEnv: NodeJS.ProcessEnv = { ...process.env };
  const injectedEnv: InjectedEnv = {};
  const warnings: string[] = [];

  for (const [name, template] of Object.entries(agent.envTemplates)) {
    const value = interpolateTemplate(template, {
      model: resolvedModel,
      baseUrl: ccSwitch.baseUrl,
      apiKey,
    });

    spawnEnv[name] = value;
    injectedEnv[name] = toInjectedValue(name, value);
  }

  if (apiKey.length === 0) {
    warnings.push(`未设置环境变量 ${ccSwitch.apiKeyEnvironmentName}`);
  }

  const context: Record<string, string> = {
    AGENTHUB_AGENT_ID: agent.id,
    AGENTHUB_MODEL_ALIAS: alias,
    AGENTHUB_MODEL: resolvedModel,
    AGENTHUB_PROMPT: prompt,
    AGENTHUB_RUN_ID: String(runId),
  };

  for (const [name, value] of Object.entries(context)) {
    spawnEnv[name] = value;
    injectedEnv[name] = {
      kind: "plain",
      value,
    };
  }

  return {
    alias,
    resolvedModel,
    spawnEnv,
    injectedEnv,
    warnings,
  };
}
