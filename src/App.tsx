import { useEffect, useState } from "react";
import { AgentSettingsView } from "./components/AgentSettingsView";
import { AgentStatusList } from "./components/AgentStatusList";
import { AppShell, type AppView } from "./components/AppShell";
import { DiagnosticView } from "./components/DiagnosticView";
import { OfficeView } from "./components/OfficeView";
import { PromptInput } from "./components/PromptInput";
import { RunView } from "./components/RunView";
import { TaskBoard } from "./components/TaskBoard";
import { TaskComposer } from "./components/TaskComposer";
import { useSidecar } from "./hooks/useSidecar";

function App() {
  const sidecarState = useSidecar();
  const [activeView, setActiveView] = useState<AppView>("run");
  const [selectedAgentId, setSelectedAgentId] = useState("hermes");
  const [taskRefreshSignal, setTaskRefreshSignal] = useState(0);
  useEffect(() => { if (sidecarState.agents.length === 0) return; if (sidecarState.agents.some((agent) => agent.id === selectedAgentId)) return; const fallback = sidecarState.agents.find((agent) => agent.configured) ?? sidecarState.agents[0]; setSelectedAgentId(fallback.id); }, [selectedAgentId, sidecarState.agents]);
  const selectedAgent = sidecarState.agents.find((agent) => agent.id === selectedAgentId);
  const selectedRuntime = sidecarState.runtimes[selectedAgentId];
  return <AppShell activeView={activeView} onViewChange={setActiveView} sidecar={sidecarState.sidecar} statusList={<AgentStatusList agents={sidecarState.agents} runtimes={sidecarState.runtimes} onSelect={(agentId) => { setSelectedAgentId(agentId); setActiveView("run"); }} />} promptInput={activeView === "run" ? <PromptInput agents={sidecarState.agents} runtimes={sidecarState.runtimes} channelPhase={sidecarState.channelPhase} selectedAgentId={selectedAgentId} onSelectAgent={setSelectedAgentId} onRefreshRoster={sidecarState.refreshRoster} onStart={sidecarState.startAgent} /> : null}>{activeView === "run" ? <><RunView agent={selectedAgent} runtime={selectedRuntime} outputs={sidecarState.outputs} channelPhase={sidecarState.channelPhase} rosterLoading={sidecarState.rosterLoading} configError={sidecarState.configError} connectionError={sidecarState.connectionError} onStop={sidecarState.stopAgent} onRefreshRoster={sidecarState.refreshRoster} /><TaskComposer onSubmitted={() => setTaskRefreshSignal((value) => value + 1)} /><TaskBoard onSelectAgent={setSelectedAgentId} refreshSignal={taskRefreshSignal} /></> : activeView === "office" ? <OfficeView agents={sidecarState.agents} runtimes={sidecarState.runtimes} /> : activeView === "agents" ? <AgentSettingsView agents={sidecarState.agents} /> : <DiagnosticView />}</AppShell>;
}
export default App;
