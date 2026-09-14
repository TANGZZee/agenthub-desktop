import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Send } from "lucide-react";
import type { AgentRuntime, CatalogAgent, ChannelPhase } from "../hooks/useSidecar";
import { buildReadOnlyProposal } from "../../shared/planner";

interface PromptInputProps {
  agents: CatalogAgent[];
  runtimes: Record<string, AgentRuntime>;
  channelPhase: ChannelPhase;
  selectedAgentId: string;
  connectionError?: string | null;
  onSelectAgent: (agentId: string) => void;
  onRefreshRoster: () => Promise<void>;
  onStart: (agentId: string, prompt: string, model: string | null) => Promise<void>;
  onSubmitTask?: (prompt: string, workerId?: "pi" | "codex", model?: string) => Promise<void>;
}

function canStartPhase(runtime: AgentRuntime | undefined): boolean {
  return !runtime || runtime.phase === "idle" || runtime.phase === "finished";
}

export function PromptInput({
  agents,
  runtimes,
  channelPhase,
  selectedAgentId,
  connectionError,
  onSelectAgent,
  onRefreshRoster,
  onStart,
  onSubmitTask,
}: PromptInputProps) {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0];
  const aliases = selectedAgent?.modelAliases ?? [];
  const runtime = selectedAgent ? runtimes[selectedAgent.id] : undefined;
  const isHermesEntry = selectedAgent?.id === "hermes";
  const preview = useMemo(() => isHermesEntry && prompt.trim() ? buildReadOnlyProposal(prompt) : null, [isHermesEntry, prompt]);

  useEffect(() => {
    if (!selectedAgent) {
      setModel("");
      return;
    }
    setModel((current) => aliases.includes(current) ? current : selectedAgent.defaultModel || aliases[0] || "");
  }, [aliases, selectedAgent]);

  const blockReason = useMemo(() => {
    if (selectedAgent?.id === "claude") return "Claude Code 当前不可接入";
    if (channelPhase !== "ready") return connectionError ? `后台还没连上：${connectionError}` : "后台还在连接，请稍等几秒后再发送";
    if (!prompt.trim()) return "请先输入任务内容";
    if (isHermesEntry) return onSubmitTask ? null : "任务入口未接好";
    if (selectedAgent?.configured !== true) return selectedAgent?.reason ?? "这个 Agent 当前不能启动";
    if (!canStartPhase(runtime)) return "这个 Agent 正在运行，请等它结束或先终止";
    if (!model) return "请先选择模型";
    return null;
  }, [selectedAgent, channelPhase, connectionError, prompt, isHermesEntry, onSubmitTask, runtime, model]);

  const enabled = blockReason === null;

  async function submit() {
    if (!enabled || !selectedAgent) return;
    const task = prompt.trim();
    setPrompt("");
    if (onSubmitTask) {
      await onSubmitTask(task, isHermesEntry ? undefined : (selectedAgent.id as "pi" | "codex"), model || undefined);
      return;
    }
    await onStart(selectedAgent.id, task, model || null);
  }

  return (
    <footer className="prompt-area">
      <div className="prompt-meta">
        <label className="compact-field">
          <span>入口</span>
          <span className="compact-select">
            <select
              value={selectedAgent?.id ?? ""}
              disabled={agents.length === 0}
              onFocus={() => void onRefreshRoster()}
              onMouseDown={() => void onRefreshRoster()}
              onChange={(event) => onSelectAgent(event.currentTarget.value)}
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id} disabled={agent.id === "claude"}>
                  {agent.label}
                </option>
              ))}
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </span>
        </label>
        {!isHermesEntry && aliases.length > 0 && (
          <label className="compact-field">
            <span>模型</span>
            <span className="compact-select">
              <select value={model} onChange={(event) => setModel(event.currentTarget.value)}>
                {aliases.map((alias) => <option key={alias} value={alias}>{alias}</option>)}
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </span>
          </label>
        )}
        {isHermesEntry && preview && <span className="prompt-agent-reason">{preview.planReason}</span>}
        {channelPhase !== "ready" && (
          <button type="button" className="text-button" onClick={() => void onRefreshRoster()}>重新连接后台</button>
        )}
      </div>
      <div className="prompt-box">
        <textarea
          value={prompt}
          rows={1}
          placeholder={isHermesEntry ? "向 Hermes 布置任务，它会交给 Pi 或 Codex" : `向 ${selectedAgent?.label ?? "Agent"} 提问`}
          onChange={(event) => setPrompt(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <button type="button" className="send-button" aria-label="启动任务" title={blockReason ?? "启动任务"} disabled={!enabled} onClick={() => void submit()}>
          <Send size={17} aria-hidden="true" />
        </button>
      </div>
      {blockReason && prompt.trim() && <p className="prompt-block-reason">{blockReason}</p>}
    </footer>
  );
}
