import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import type {
  AgentRuntime,
  CatalogAgent,
} from "../hooks/useSidecar";

interface AgentStatusListProps {
  agents: CatalogAgent[];
  runtimes: Record<string, AgentRuntime>;
  onSelect: (agentId: string) => void;
}

function statusText(runtime: AgentRuntime | undefined): string {
  if (!runtime || runtime.phase === "idle") return "空闲";
  if (runtime.phase === "starting") return "正在启动";
  if (runtime.phase === "running") return "工作中";
  if (runtime.phase === "terminating") return "正在终止";
  if (runtime.result === "success") return "已完成";
  if (runtime.result === "failed") return "运行失败";
  if (runtime.result === "terminated") return "已终止";
  return "已结束";
}

function statusClass(runtime: AgentRuntime | undefined): string {
  if (!runtime || runtime.phase === "idle") return "idle";
  if (runtime.phase === "finished") {
    return `finished ${runtime.result ?? "terminated"}`;
  }
  return runtime.phase;
}

export function AgentStatusList({
  agents,
  runtimes,
  onSelect,
}: AgentStatusListProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (agents.length === 0) {
    return <p className="sidebar-empty">暂无 Agent</p>;
  }

  return (
    <div className="agent-status-list" aria-label="Agent 状态">
      {agents.map((agent) => {
        const runtime = runtimes[agent.id];
        const hasError = Boolean(runtime?.lastError);
        const isExpanded = expanded === agent.id;

        return (
          <div className="agent-status-item" key={agent.id}>
            <button
              type="button"
              className="agent-status-row"
              title={
                hasError ? runtime?.lastError ?? undefined : agent.reason
              }
              onClick={() => {
                onSelect(agent.id);
                if (hasError) {
                  setExpanded(isExpanded ? null : agent.id);
                }
              }}
            >
              <span
                className={`agent-status-dot ${statusClass(runtime)}`}
                aria-hidden="true"
              />
              <span className="agent-status-copy">
                <span className="agent-status-name">
                  {agent.label}
                  {runtime?.phase === "running" && runtime.resolvedModel
                    ? ` · ${runtime.resolvedModel}`
                    : ""}
                </span>
                <span className="agent-status-text">
                  {statusText(runtime)}
                </span>
              </span>
              {hasError &&
                (isExpanded ? (
                  <ChevronDown size={14} aria-hidden="true" />
                ) : (
                  <ChevronRight size={14} aria-hidden="true" />
                ))}
            </button>
            {isExpanded && hasError && (
              <p className="agent-status-error">{runtime?.lastError}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
