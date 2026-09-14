import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  RotateCcw,
  Square,
  Wrench,
} from "lucide-react";

import type {
  AgentRuntime,
  CatalogAgent,
  ChannelPhase,
  OutputLine,
} from "../hooks/useSidecar";
import { OutputView } from "./OutputView";

interface RunViewProps {
  agent: CatalogAgent | undefined;
  runtime: AgentRuntime | undefined;
  outputs: OutputLine[];
  channelPhase: ChannelPhase;
  rosterLoading: boolean;
  configError: string | null;
  connectionError: string | null;
  onStop: (agentId: string) => Promise<void>;
  onRefreshRoster: () => Promise<void>;
}

function phaseText(runtime: AgentRuntime | undefined): string {
  if (!runtime || runtime.phase === "idle") return "空闲";
  if (runtime.phase === "starting") return "正在启动";
  if (runtime.phase === "running") return "工作中";
  if (runtime.phase === "terminating") return "正在终止";
  if (runtime.result === "success") return "已完成";
  if (runtime.result === "failed") return "运行失败";
  if (runtime.result === "terminated") return "已终止";
  return "已结束";
}

function phaseClass(runtime: AgentRuntime | undefined): string {
  if (!runtime || runtime.phase === "idle") return "idle";
  if (runtime.phase === "finished") {
    return `finished ${runtime.result ?? "terminated"}`;
  }
  return runtime.phase;
}

function formatElapsed(runtime: AgentRuntime | undefined): string | null {
  if (!runtime?.runId || runtime.phase !== "running") return null;
  const seconds = Math.max(0, Math.floor((Date.now() - runtime.runId) / 1000));
  if (seconds < 60) return `${seconds} 秒`;

  const minutes = Math.floor(seconds / 60);
  return `${minutes} 分 ${seconds % 60} 秒`;
}

function injectedSummary(runtime: AgentRuntime | undefined) {
  const entries = Object.entries(runtime?.injectedEnv ?? {});
  const baseUrl = entries.find(
    ([name, value]) =>
      name.endsWith("_BASE_URL") && value.kind === "plain",
  );
  const secret = entries.find(([, value]) => value.kind === "secret");

  return {
    baseUrl:
      baseUrl && baseUrl[1].kind === "plain" ? baseUrl[1].value : null,
    secret:
      secret && secret[1].kind === "secret"
        ? secret[1].set
          ? `已设置（共 ${secret[1].length} 位）`
          : "未设置"
        : null,
  };
}

export function RunView({
  agent,
  runtime,
  outputs,
  channelPhase,
  rosterLoading,
  configError,
  connectionError,
  onStop,
  onRefreshRoster,
}: RunViewProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [, setClock] = useState(0);

  useEffect(() => {
    if (runtime?.phase !== "running") return;
    const timer = window.setInterval(
      () => setClock((value) => value + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [runtime?.phase]);

  useEffect(() => {
    setShowDetails(false);
  }, [agent?.id, runtime?.runId]);

  if (rosterLoading && !agent) {
    return (
      <div className="run-skeleton" aria-label="正在加载 Agent">
        <span />
        <span />
        <span />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="run-empty">
        <CircleAlert size={36} strokeWidth={1.5} aria-hidden="true" />
        <span>没有可显示的 Agent</span>
      </div>
    );
  }

  const elapsed = formatElapsed(runtime);
  const summary = injectedSummary(runtime);
  const visibleOutputs = outputs.filter((line) => line.agentId === agent.id);

  return (
    <div className="run-view">
      <section className="run-status-line">
        <div className="run-agent-heading">
          <span className={`agent-status-dot ${phaseClass(runtime)}`} />
          <div>
            <h1>{agent.label}</h1>
            <p>
              {(runtime?.modelAlias ?? agent.defaultModel) ||
                "未选择模型"}
              {runtime?.resolvedModel
                ? ` → ${runtime.resolvedModel}`
                : ""}
            </p>
          </div>
        </div>

        <div className="run-status-actions">
          {elapsed && <span className="run-elapsed">{elapsed}</span>}
          <span className="run-phase">{phaseText(runtime)}</span>
          {channelPhase === "ready" && runtime?.phase === "running" && (
            <button
              type="button"
              className="stop-run-button"
              onClick={() => void onStop(agent.id)}
            >
              <Square size={14} aria-hidden="true" />
              终止
            </button>
          )}
        </div>
      </section>

      {connectionError && (
        <div className="inline-error" role="alert">
          <span>{connectionError}</span>
          <button
            type="button"
            className="text-button"
            onClick={() => void onRefreshRoster()}
          >
            <RotateCcw size={14} aria-hidden="true" />
            重新同步
          </button>
        </div>
      )}

      {configError && (
        <div className="inline-error" role="alert">
          <span>{configError}</span>
          <button
            type="button"
            className="text-button"
            onClick={() => void onRefreshRoster()}
          >
            <RotateCcw size={14} aria-hidden="true" />
            重新加载配置
          </button>
        </div>
      )}

      {runtime?.lastError && (
        <div className="inline-error" role="alert">
          {runtime.lastError}
        </div>
      )}

      <OutputView lines={visibleOutputs} />

      <section className="injection-panel">
        <button
          type="button"
          className="injection-summary"
          onClick={() => setShowDetails((value) => !value)}
        >
          <span className="injection-title">
            <Wrench size={15} aria-hidden="true" />
            注入摘要
          </span>
          {runtime?.injectedEnv ? (
            <span className="injection-brief">
              {runtime.resolvedModel
                ? `模型 ${runtime.resolvedModel}`
                : "模型未记录"}
              {summary.baseUrl ? ` · Base URL ${summary.baseUrl}` : ""}
              {summary.secret ? ` · 密钥 ${summary.secret}` : ""}
            </span>
          ) : (
            <span className="injection-brief">
              {runtime?.runId
                ? "刷新后可重新启动一次查看"
                : "启动后可见"}
            </span>
          )}
          {showDetails ? (
            <ChevronDown size={15} aria-hidden="true" />
          ) : (
            <ChevronRight size={15} aria-hidden="true" />
          )}
        </button>

        {showDetails && runtime?.injectedEnv && (
          <dl className="injection-details">
            {Object.entries(runtime.injectedEnv).map(([name, value]) => (
              <div className="injection-row" key={name}>
                <dt>{name}</dt>
                <dd>
                  {value.kind === "plain"
                    ? value.value
                    : value.set
                      ? `已设置（共 ${value.length} 位）`
                      : "未设置"}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}
