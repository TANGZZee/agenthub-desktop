import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AgentSettingsView } from "./components/AgentSettingsView";
import { AgentStatusList } from "./components/AgentStatusList";
import { AppShell, type AppView } from "./components/AppShell";
import { ChatNav } from "./components/ChatNav";
import { ChatThread } from "./components/ChatThread";
import { DiagnosticView } from "./components/DiagnosticView";
import { OfficeView } from "./components/OfficeView";
import { PromptInput } from "./components/PromptInput";
import { TaskBoard } from "./components/TaskBoard";
import { useSidecar } from "./hooks/useSidecar";
import { useWorkspace } from "./hooks/useWorkspace";
import { buildReadOnlyProposal } from "../shared/planner";
import { TAURI_COMMANDS } from "../shared/protocol";
import type { TaskProposal } from "../shared/task-protocol";

function App() {
  const sidecarState = useSidecar();
  const workspace = useWorkspace();
  const [activeView, setActiveView] = useState<AppView>("run");
  const [selectedAgentId, setSelectedAgentId] = useState("hermes");
  const [taskRefreshSignal, setTaskRefreshSignal] = useState(0);
  const [tasksOpen, setTasksOpen] = useState(true);
  const prevPhases = useRef<Record<string, string | undefined>>({});

  useEffect(() => {
    for (const agent of sidecarState.agents) {
      const runtime = sidecarState.runtimes[agent.id];
      const previous = prevPhases.current[agent.id];
      const now = runtime?.phase;
      if (previous === "running" && now === "finished") {
        const ok = runtime?.result === "success";
        workspace.addMessage("assistant", ok ? `${agent.label} 已完成这轮工作。` : `${agent.label} 这轮失败了：${runtime?.lastError ?? "原因未知，可在任务栏查看过程。"}`);
      }
      prevPhases.current[agent.id] = now;
    }
  }, [sidecarState.runtimes, sidecarState.agents]);

  useEffect(() => {
    if (sidecarState.agents.length === 0) return;
    if (sidecarState.agents.some((agent) => agent.id === selectedAgentId)) return;
    const fallback = sidecarState.agents.find((agent) => agent.id === "hermes") ?? sidecarState.agents[0];
    setSelectedAgentId(fallback.id);
  }, [selectedAgentId, sidecarState.agents]);

  async function submitPlannedTask(prompt: string, workerId?: "pi" | "codex", model?: string) {
    workspace.addMessage("user", prompt);
    const planned = buildReadOnlyProposal(prompt, workerId);
    const proposal: TaskProposal = {
      proposalId: planned.proposalId,
      title: planned.title,
      description: planned.description,
      proposedWorkerId: planned.proposedWorkerId,
      toolPolicy: planned.toolPolicy,
      writeScope: planned.writeScope,
      budget: planned.budget,
      ...(model ? { model } : {}),
    };
    try {
      const result = await invoke<{ accepted: boolean; reasons: string[] }>(TAURI_COMMANDS.submitTask, { proposal });
      if (!result.accepted) throw new Error(result.reasons.join("；") || "任务未通过安全准入");
      workspace.addMessage("assistant", `已交给 ${planned.proposedWorkerId === "pi" ? "Pi" : "Codex"}。右侧任务栏可以查看过程。`);
      setTaskRefreshSignal((value) => value + 1);
      setActiveView("run");
    } catch (error) {
      workspace.addMessage("assistant", `没有发送成功：${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  return (
    <AppShell
      activeView={activeView}
      onViewChange={setActiveView}
      sidecar={sidecarState.sidecar}
      statusList={<AgentStatusList agents={sidecarState.agents} runtimes={sidecarState.runtimes} onSelect={(agentId) => { setSelectedAgentId(agentId); setActiveView("run"); }} />}
      promptInput={activeView === "run" ? (
        <PromptInput
          agents={sidecarState.agents}
          runtimes={sidecarState.runtimes}
          channelPhase={sidecarState.channelPhase}
          selectedAgentId={selectedAgentId}
          connectionError={sidecarState.connectionError}
          onSelectAgent={setSelectedAgentId}
          onRefreshRoster={sidecarState.refreshRoster}
          onStart={async (agentId, prompt, model) => {
            workspace.addMessage("user", prompt);
            await sidecarState.startAgent(agentId, prompt, model);
            workspace.addMessage("assistant", "已启动该 Agent。");
          }}
          onSubmitTask={submitPlannedTask}
        />
      ) : null}
    >
      {activeView === "run" ? (
        <div className={`workspace chat-workspace ${tasksOpen ? "with-tasks" : ""}`}>
          <ChatNav
            projects={workspace.projects}
            conversations={workspace.conversations}
            currentId={workspace.current?.id}
            currentProjectId={workspace.currentProject?.id}
            onNew={() => workspace.newConversation()}
            onSelect={workspace.selectConversation}
            onSelectProject={workspace.selectProject}
            onAddProject={workspace.addProject}
          />
          <section className="chat-main">
            <header className="chat-main-bar">
              <strong>{workspace.current?.title ?? "新对话"}</strong>
              <button type="button" className="text-button" onClick={() => setTasksOpen((value) => !value)}>
                {tasksOpen ? "隐藏任务" : "显示任务"}
              </button>
            </header>
            {sidecarState.connectionError && <p className="inline-error">{sidecarState.connectionError}</p>}
            <ChatThread conversation={workspace.current} projectName={workspace.currentProject?.name} />
          </section>
          {tasksOpen ? <TaskBoard onSelectAgent={setSelectedAgentId} refreshSignal={taskRefreshSignal} /> : null}
        </div>
      ) : activeView === "office" ? (
        <OfficeView agents={sidecarState.agents} runtimes={sidecarState.runtimes} refreshSignal={taskRefreshSignal} />
      ) : activeView === "agents" ? (
        <AgentSettingsView agents={sidecarState.agents} />
      ) : (
        <DiagnosticView />
      )}
    </AppShell>
  );
}

export default App;
