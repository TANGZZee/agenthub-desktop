import { useState } from "react";
import { Check, Plug, Puzzle, Save, ShieldCheck } from "lucide-react";
import type { CatalogAgent } from "../hooks/useSidecar";
import { createDefaultAgentHubSettings, type AgentHubAgentSettings } from "../../shared/agent-settings";

interface AgentSettingsViewProps { agents: CatalogAgent[]; }
type Section = "agent" | "skills" | "mcp";

export function AgentSettingsView({ agents }: AgentSettingsViewProps) {
  const [selected, setSelected] = useState(agents[0]?.id ?? "hermes");
  const [section, setSection] = useState<Section>("agent");
  const [settings, setSettings] = useState<AgentHubAgentSettings>(() => createDefaultAgentHubSettings(selected));
  const selectedAgent = agents.find((agent) => agent.id === selected);
  const chooseAgent = (id: string) => { setSelected(id); setSettings(createDefaultAgentHubSettings(id)); setSection("agent"); };
  const update = <K extends keyof AgentHubAgentSettings>(key: K, value: AgentHubAgentSettings[K]) => setSettings((old) => ({ ...old, [key]: value }));
  return <div className="settings-view">
    <header className="app-header"><div><h1>Agent 设置中心</h1><p>分别管理每个 Agent，同时统一管理共享 Skill 和 MCP。</p></div><ShieldCheck size={22} aria-hidden="true" /></header>
    <div className="settings-layout">
      <aside className="settings-agent-list"><h2>Agent</h2>{agents.map((agent) => <button key={agent.id} type="button" className={`settings-agent-item ${selected === agent.id ? "active" : ""}`} onClick={() => chooseAgent(agent.id)}><span className={`agent-catalog-dot ${agent.configured ? "ok" : "warning"}`} />{agent.label}<small>{agent.configured ? "可配置" : "需检查"}</small></button>)}<h2 className="settings-group-title">共享能力</h2><button type="button" className={`settings-agent-item ${section === "skills" ? "active" : ""}`} onClick={() => setSection("skills")}><Puzzle size={15} />共享 Skill</button><button type="button" className={`settings-agent-item ${section === "mcp" ? "active" : ""}`} onClick={() => setSection("mcp")}><Plug size={15} />共享 MCP</button></aside>
      <section className="settings-panel">
        {section === "agent" && <><div className="settings-panel-title"><div><h2>{selectedAgent?.label ?? selected}</h2><p>这里是 AgentHub 的调度设置，不会覆盖 Agent 原生桌面设置。</p></div><span className="settings-badge"><Check size={14} />安全默认值</span></div><div className="settings-form"><label className="setting-toggle"><span><strong>启用此 Agent</strong><small>关闭后 Hermes 不会把新任务派给它。</small></span><input type="checkbox" checked={settings.enabled} onChange={(e) => update("enabled", e.currentTarget.checked)} /></label><label className="setting-toggle"><span><strong>允许 Hermes 调度</strong><small>允许 Hermes 把后台任务交给这个 Agent。</small></span><input type="checkbox" checked={settings.allowHermesDispatch} onChange={(e) => update("allowHermesDispatch", e.currentTarget.checked)} /></label><label className="setting-toggle"><span><strong>允许写入文件</strong><small>关闭时只允许进行只读型工作。</small></span><input type="checkbox" checked={settings.allowWrite} onChange={(e) => update("allowWrite", e.currentTarget.checked)} /></label><label className="setting-toggle"><span><strong>高风险操作需要确认</strong><small>像实验室的安全开关，建议保持开启。</small></span><input type="checkbox" checked={settings.requireConfirmation} onChange={(e) => update("requireConfirmation", e.currentTarget.checked)} /></label><label className="setting-toggle"><span><strong>显示详细工作日志</strong><small>允许你查看后台 Agent 的工作过程。</small></span><input type="checkbox" checked={settings.showDetailedLogs} onChange={(e) => update("showDetailedLogs", e.currentTarget.checked)} /></label><label className="setting-number"><span>任务超时（秒）</span><input type="number" min={30} max={86400} value={settings.timeoutSeconds} onChange={(e) => update("timeoutSeconds", Number(e.currentTarget.value))} /></label><label className="setting-number"><span>调度优先级</span><input type="number" min={0} max={100} value={settings.priority} onChange={(e) => update("priority", Number(e.currentTarget.value))} /></label></div><button type="button" className="button button-primary settings-save" onClick={() => window.alert("设置已暂存在本次运行中；持久化保存将在下一步接入。")}><Save size={15} />保存设置</button></>}
        {section === "skills" && <CapabilityPlaceholder title="共享 Skill" icon={<Puzzle size={20} />} text="这里将统一安装和启用多个 Agent 都能使用的 Skill。每个 Skill 仍会逐个检查兼容性和权限。" />}
        {section === "mcp" && <CapabilityPlaceholder title="共享 MCP" icon={<Plug size={20} />} text="这里将统一登记 MCP 服务连接。密钥只保存状态，不在界面中显示真实内容。" />}
      </section>
    </div>
  </div>;
}
function CapabilityPlaceholder({ title, icon, text }: { title: string; icon: React.ReactNode; text: string }) { return <div className="capability-placeholder"><div className="capability-icon">{icon}</div><h2>{title}</h2><p>{text}</p><button type="button" className="button button-secondary" disabled>即将支持安装与管理</button></div>; }
