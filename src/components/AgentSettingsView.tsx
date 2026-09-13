import { useEffect, useState, type ReactNode } from "react";
import { Check, Plug, Puzzle, Save, ShieldCheck, Sparkles } from "lucide-react";
import type { CatalogAgent } from "../hooks/useSidecar";
import { createDefaultAgentHubSettings, type AgentHubAgentSettings } from "../../shared/agent-settings";
import { BUILTIN_PI_PLUGINS, BUILTIN_SHARED_MCP, BUILTIN_SHARED_SKILLS } from "../../shared/capability-catalog";

interface AgentSettingsViewProps { agents: CatalogAgent[]; }
type Section = "agent" | "plugins" | "skills" | "mcp";
type StoredSettings = Record<string, AgentHubAgentSettings>;
const STORAGE_KEY = "agenthub.agentHubSettings.v1";

function loadSettings(): StoredSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" ? value as StoredSettings : {};
  } catch { return {}; }
}

export function AgentSettingsView({ agents }: AgentSettingsViewProps) {
  const [selected, setSelected] = useState(agents[0]?.id ?? "hermes");
  const [section, setSection] = useState<Section>("agent");
  const [allSettings, setAllSettings] = useState<StoredSettings>(loadSettings);
  const [saved, setSaved] = useState(false);
  const settings = allSettings[selected] ?? createDefaultAgentHubSettings(selected);
  const selectedAgent = agents.find((agent) => agent.id === selected);

  useEffect(() => {
    if (agents.length > 0 && !agents.some((agent) => agent.id === selected)) setSelected(agents[0].id);
  }, [agents, selected]);

  const update = <K extends keyof AgentHubAgentSettings>(key: K, value: AgentHubAgentSettings[K]) => {
    setSaved(false);
    setAllSettings((old) => ({ ...old, [selected]: { ...settings, [key]: value } }));
  };
  const save = () => { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(allSettings)); setSaved(true); };
  const reset = () => { setAllSettings((old) => ({ ...old, [selected]: createDefaultAgentHubSettings(selected) })); setSaved(false); };
  const chooseAgent = (id: string) => { setSelected(id); setSection("agent"); setSaved(false); };

  return <div className="settings-view">
    <header className="app-header"><div><h1>Agent 设置中心</h1><p>分别管理每个 Agent，同时统一管理共享 Skill 和 MCP。</p></div><ShieldCheck size={22} aria-hidden="true" /></header>
    <div className="settings-layout">
      <aside className="settings-agent-list">
        <h2>Agent</h2>
        {agents.map((agent) => <button key={agent.id} type="button" className={`settings-agent-item ${selected === agent.id && section === "agent" ? "active" : ""}`} onClick={() => chooseAgent(agent.id)}><span className={`agent-catalog-dot ${agent.configured ? "ok" : "warning"}`} />{agent.label}<small>{agent.configured ? "可配置" : "需检查"}</small></button>)}
        {selected === "pi" && <button type="button" className={`settings-agent-item ${section === "plugins" ? "active" : ""}`} onClick={() => setSection("plugins")}><Puzzle size={15} />Pi 插件</button>}
        <h2 className="settings-group-title">共享能力</h2>
        <button type="button" className={`settings-agent-item ${section === "skills" ? "active" : ""}`} onClick={() => setSection("skills")}><Sparkles size={15} />共享 Skill</button>
        <button type="button" className={`settings-agent-item ${section === "mcp" ? "active" : ""}`} onClick={() => setSection("mcp")}><Plug size={15} />共享 MCP</button>
      </aside>
      <section className="settings-panel">
        {section === "agent" && <AgentHubForm agentName={selectedAgent?.label ?? selected} settings={settings} saved={saved} onUpdate={update} onSave={save} onReset={reset} />}
        {section === "plugins" && <CapabilityCatalog title="Pi 专属插件" icon={<Puzzle size={20} />} items={BUILTIN_PI_PLUGINS.map((item) => ({ id: item.id, name: item.name, description: item.description, status: item.installed ? "已安装" : "未安装", permissions: item.permissionSummary }))} />}
        {section === "skills" && <CapabilityCatalog title="共享 Skill" icon={<Sparkles size={20} />} items={BUILTIN_SHARED_SKILLS.map((item) => ({ id: item.id, name: item.name, description: item.description, status: item.enabled ? "已启用" : "未启用", permissions: item.permissionSummary }))} />}
        {section === "mcp" && <CapabilityCatalog title="共享 MCP" icon={<Plug size={20} />} items={BUILTIN_SHARED_MCP.map((item) => ({ id: item.id, name: item.name, description: item.description, status: item.authentication === "missing" ? "认证待配置" : item.enabled ? "已启用" : "未启用", permissions: item.permissionSummary }))} />}
      </section>
    </div>
  </div>;
}

function AgentHubForm({ agentName, settings, saved, onUpdate, onSave, onReset }: { agentName: string; settings: AgentHubAgentSettings; saved: boolean; onUpdate: <K extends keyof AgentHubAgentSettings>(key: K, value: AgentHubAgentSettings[K]) => void; onSave: () => void; onReset: () => void; }) {
  return <><div className="settings-panel-title"><div><h2>{agentName}</h2><p>这是 AgentHub 的调度设置，不会覆盖 Agent 原生桌面设置。</p></div><span className="settings-badge"><Check size={14} />安全默认值</span></div><div className="settings-form">
    <Toggle label="启用此 Agent" help="关闭后 Hermes 不会把新任务派给它。" value={settings.enabled} onChange={(value) => onUpdate("enabled", value)} />
    <Toggle label="允许 Hermes 调度" help="允许 Hermes 把后台任务交给这个 Agent。" value={settings.allowHermesDispatch} onChange={(value) => onUpdate("allowHermesDispatch", value)} />
    <Toggle label="允许写入文件" help="关闭时只允许进行只读型工作。" value={settings.allowWrite} onChange={(value) => onUpdate("allowWrite", value)} />
    <Toggle label="高风险操作需要确认" help="像实验室的安全开关，建议保持开启。" value={settings.requireConfirmation} onChange={(value) => onUpdate("requireConfirmation", value)} />
    <Toggle label="显示详细工作日志" help="允许你查看后台 Agent 的工作过程。" value={settings.showDetailedLogs} onChange={(value) => onUpdate("showDetailedLogs", value)} />
    <label className="setting-number"><span>任务超时（秒）</span><input type="number" min={30} max={86400} value={settings.timeoutSeconds} onChange={(e) => onUpdate("timeoutSeconds", Number(e.currentTarget.value))} /></label>
    <label className="setting-number"><span>调度优先级</span><input type="number" min={0} max={100} value={settings.priority} onChange={(e) => onUpdate("priority", Number(e.currentTarget.value))} /></label>
  </div><div className="settings-actions"><button type="button" className="button button-primary settings-save" onClick={onSave}><Save size={15} />保存设置</button><button type="button" className="button button-secondary" onClick={onReset}>恢复安全默认值</button>{saved && <span className="settings-saved">已保存到本机</span>}</div></>;
}
function Toggle({ label, help, value, onChange }: { label: string; help: string; value: boolean; onChange: (value: boolean) => void }) { return <label className="setting-toggle"><span><strong>{label}</strong><small>{help}</small></span><input type="checkbox" checked={value} onChange={(e) => onChange(e.currentTarget.checked)} /></label>; }
function CapabilityCatalog({ title, icon, items }: { title: string; icon: ReactNode; items: Array<{ id: string; name: string; description: string; status: string; permissions: string[] }> }) { return <div className="capability-catalog"><div className="settings-panel-title"><div><h2>{title}</h2><p>这里只登记能力和权限，不代表已经安装或已经连接。</p></div><div className="capability-icon">{icon}</div></div><div className="capability-list">{items.map((item) => <article className="capability-card" key={item.id}><div><h3>{item.name}</h3><p>{item.description}</p><small>权限：{item.permissions.join("、")}</small></div><div className="capability-card-side"><span className="settings-badge">{item.status}</span><button type="button" className="button button-secondary" disabled>安装引导</button></div></article>)}</div><p className="catalog-note">安全提示：安装功能开放前，AgentHub 会先显示来源、版本、权限和兼容 Agent，并要求确认。</p></div>; }

