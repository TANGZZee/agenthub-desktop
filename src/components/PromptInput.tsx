import { useEffect, useState } from "react";
import { ChevronDown, Send } from "lucide-react";

import type {
  AgentRuntime,
  CatalogAgent,
  ChannelPhase,
} from "../hooks/useSidecar";

interface PromptInputProps {
  agents: CatalogAgent[];
  runtimes: Record<string, AgentRuntime>;
  channelPhase: ChannelPhase;
  selectedAgentId: string;
  onSelectAgent: (agentId: string) => void;
  onRefreshRoster: () => Promise<void>;
  onStart: (
    agentId: string,
    prompt: string,
    model: string | null,
  ) => Promise<void>;
}

function canStartPhase(runtime: AgentRuntime | undefined): boolean {
  return !runtime || runtime.phase === "idle" || runtime.phase === "finished";
}

export function PromptInput({
  agents,
  runtimes,
  channelPhase,
  selectedAgentId,
  onSelectAgent,
  onRefreshRoster,
  onStart,
}: PromptInputProps) {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");

  const selectedAgent =
    agents.find((agent) => agent.id === selectedAgentId) ?? agents[0];
  const aliases = selectedAgent?.modelAliases ?? [];
  const runtime = selectedAgent ? runtimes[selectedAgent.id] : undefined;

  useEffect(() => {
    if (!selectedAgent) {
      setModel("");
      return;
    }

    setModel((current) =>
      aliases.includes(current)
        ? current
        : selectedAgent.defaultModel || aliases[0] || "",
    );
  }, [aliases, selectedAgent]);

  const enabled =
    channelPhase === "ready" &&
    selectedAgent?.configured === true &&
    canStartPhase(runtime) &&
    prompt.trim().length > 0 &&
    model.length > 0;

  async function submit() {
    if (!enabled || !selectedAgent) return;

    const task = prompt.trim();
    setPrompt("");
    await onStart(selectedAgent.id, task, model || null);
  }

  return (
    <footer className="prompt-area">
      <div className="prompt-meta">
        <label className="compact-field">
          <span>Agent</span>
          <span className="compact-select">
            <select
              value={selectedAgent?.id ?? ""}
              disabled={agents.length === 0}
              onFocus={() => void onRefreshRoster()}
              onMouseDown={() => void onRefreshRoster()}
              onChange={(event) => onSelectAgent(event.currentTarget.value)}
            >
              {agents.map((agent) => (
                <option
                  key={agent.id}
                  value={agent.id}
                  disabled={!agent.configured}
                >
                  {agent.label}
                </option>
              ))}
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </span>
        </label>

        {aliases.length > 0 && (
          <label className="compact-field">
            <span>模型</span>
            <span className="compact-select">
              <select
                value={model}
                onChange={(event) => setModel(event.currentTarget.value)}
              >
                {aliases.map((alias) => (
                  <option key={alias} value={alias}>
                    {alias}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </span>
          </label>
        )}

        {selectedAgent?.configured === false && selectedAgent.reason && (
          <span className="prompt-agent-reason">{selectedAgent.reason}</span>
        )}
      </div>

      <div className="prompt-box">
        <textarea
          value={prompt}
          rows={1}
          placeholder={`向 ${selectedAgent?.label ?? "Agent"} 提问`}
          onChange={(event) => setPrompt(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <button
          type="button"
          className="send-button"
          aria-label="启动任务"
          title="启动任务"
          disabled={!enabled}
          onClick={() => void submit()}
        >
          <Send size={17} aria-hidden="true" />
        </button>
      </div>
    </footer>
  );
}
