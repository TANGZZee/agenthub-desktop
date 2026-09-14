import { useEffect, useState, type ReactNode } from "react";
import { Check, Plug, Puzzle, Save, ShieldCheck, Sparkles } from "lucide-react";
import type { CatalogAgent } from "../hooks/useSidecar";
import { createDefaultAgentHubSettings, type AgentHubAgentSettings } from "../../shared/agent-settings";
import { BUILTIN_PI_PLUGINS, BUILTIN_SHARED_MCP, BUILTIN_SHARED_SKILLS } from "../../shared/capability-catalog";
import { DEFAULT_MODEL_CATALOG, loadModelCatalog, saveModelCatalog, type CatalogModel } from "../../shared/model-catalog";
import {
  createDefaultNativeSettings,
  HERMES_TOOLSETS,
  PI_TOOLS,
  nativeConfigHint,
  type AgentNativeWorkSettings,
  type ClaudeNativeSettings,
  type CodexNativeSettings,
  type HermesNativeSettings,
  type NativeSettingsTab,
  type PiNativeSettings,
} from "../../shared/native-settings";

interface AgentSettingsViewProps { agents: CatalogAgent[]; }
type Section = "agent" | "models" | "plugins" | "skills" | "mcp";
type StoredHubSettings = Record<string, AgentHubAgentSettings>;
type StoredNativeSettings = Record<string, AgentNativeWorkSettings>;
type CapabilityState = Record<string, boolean>;

const HUB_KEY = "agenthub.agentHubSettings.v1";
const NATIVE_KEY = "agenthub.nativeSettings.v1";
const CAPABILITIES_KEY = "agenthub.capabilities.v1";

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

export function AgentSettingsView({ agents }: AgentSettingsViewProps) {
  const [selected, setSelected] = useState(agents[0]?.id ?? "hermes");
  const [section, setSection] = useState<Section>("agent");
  const [tab, setTab] = useState<NativeSettingsTab>("native");
  const [allHub, setAllHub] = useState<StoredHubSettings>(() => loadJson(HUB_KEY, {}));
  const [allNative, setAllNative] = useState<StoredNativeSettings>(() => loadJson(NATIVE_KEY, {}));
  const [capabilityState, setCapabilityState] = useState<CapabilityState>(() => loadJson(CAPABILITIES_KEY, {}));
  const [saved, setSaved] = useState(false);
  const [guide, setGuide] = useState<{ name: string; permissions: string[] } | null>(null);
  const [catalog, setCatalog] = useState<CatalogModel[]>(() => loadModelCatalog());

  const hub = allHub[selected] ?? createDefaultAgentHubSettings(selected);
  const native = allNative[selected] ?? createDefaultNativeSettings(selected);
  const selectedAgent = agents.find((agent) => agent.id === selected);

  useEffect(() => {
    if (agents.length > 0 && !agents.some((agent) => agent.id === selected)) setSelected(agents[0].id);
  }, [agents, selected]);

  function save() {
    window.localStorage.setItem(HUB_KEY, JSON.stringify(allHub));
    window.localStorage.setItem(NATIVE_KEY, JSON.stringify(allNative));
    setSaved(true);
  }

  function reset() {
    setAllHub((old) => ({ ...old, [selected]: createDefaultAgentHubSettings(selected) }));
    setAllNative((old) => ({ ...old, [selected]: createDefaultNativeSettings(selected) }));
    setSaved(false);
  }

  function updateHub<K extends keyof AgentHubAgentSettings>(key: K, value: AgentHubAgentSettings[K]) {
    setSaved(false);
    setAllHub((old) => ({ ...old, [selected]: { ...hub, [key]: value } }));
  }

  function updateNative(next: AgentNativeWorkSettings) {
    setSaved(false);
    setAllNative((old) => ({ ...old, [selected]: next }));
  }

  function chooseAgent(id: string) {
    setSelected(id);
    setSection("agent");
    setTab("native");
    setSaved(false);
  }

  const toggleCapability = (id: string, enabled: boolean) => {
    const next = { ...capabilityState, [id]: enabled };
    setCapabilityState(next);
    window.localStorage.setItem(CAPABILITIES_KEY, JSON.stringify(next));
  };

  const piItems = BUILTIN_PI_PLUGINS.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    status: item.installed ? "已安装" : "未安装",
    permissions: item.permissionSummary,
    canToggle: item.installed,
    enabled: item.installed && (capabilityState[item.id] ?? item.enabled),
  }));
  const skillItems = BUILTIN_SHARED_SKILLS.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    status: capabilityState[item.id] ? "已启用" : item.enabled ? "已启用" : "未启用",
    permissions: item.permissionSummary,
    canToggle: true,
    enabled: capabilityState[item.id] ?? item.enabled,
  }));
  const mcpItems = BUILTIN_SHARED_MCP.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    status: item.authentication === "missing" ? "认证待配置" : capabilityState[item.id] ? "已启用" : "未启用",
    permissions: item.permissionSummary,
    canToggle: item.authentication !== "missing",
    enabled: capabilityState[item.id] ?? item.enabled,
  }));

  return (
    <div className="settings-view">
      <header className="page-kicker">
        <ShieldCheck size={16} aria-hidden="true" />
        <span>每个智能体单独配置。不改原桌面窗口设置，也不显示密钥。</span>
      </header>
      <div className="settings-layout">
        <aside className="settings-agent-list">
          <h2>Agent</h2>
          {agents.map((agent) => (
            <button key={agent.id} type="button" className={`settings-agent-item ${selected === agent.id && section === "agent" ? "active" : ""}`} onClick={() => chooseAgent(agent.id)}>
              <span className={`agent-catalog-dot ${agent.configured ? "ok" : "warning"}`} />
              {agent.label}
              <small>{agent.configured ? "可配置" : "需检查"}</small>
            </button>
          ))}
          {selected === "pi" && (
            <button type="button" className={`settings-agent-item ${section === "plugins" ? "active" : ""}`} onClick={() => setSection("plugins")}>
              <Puzzle size={15} />Pi 插件
            </button>
          )}
          <h2 className="settings-group-title">公共配置</h2>
          <button type="button" className={`settings-agent-item ${section === "models" ? "active" : ""}`} onClick={() => setSection("models")}>
            <Sparkles size={15} />模型配置
          </button>
          <h2 className="settings-group-title">共享能力</h2>
          <button type="button" className={`settings-agent-item ${section === "skills" ? "active" : ""}`} onClick={() => setSection("skills")}>
            <Sparkles size={15} />共享 Skill
          </button>
          <button type="button" className={`settings-agent-item ${section === "mcp" ? "active" : ""}`} onClick={() => setSection("mcp")}>
            <Plug size={15} />共享 MCP
          </button>
        </aside>
        <section className="settings-panel">
          {section === "agent" && (
            <AgentSettingsPanel
              agentName={selectedAgent?.label ?? selected}
              agent={selectedAgent}
              tab={tab}
              onTabChange={setTab}
              hub={hub}
              native={native}
              saved={saved}
              onUpdateHub={updateHub}
              onUpdateNative={updateNative}
              catalog={catalog}
              onSave={save}
              onReset={reset}
            />
          )}
          {section === "models" && <ModelCatalogPanel catalog={catalog} onChange={(next) => { setCatalog(next); saveModelCatalog(next); }} />}
          {section === "plugins" && <CapabilityCatalog title="Pi 插件" icon={<Puzzle size={20} />} items={piItems} onToggle={toggleCapability} onGuide={setGuide} />}
          {section === "skills" && <CapabilityCatalog title="共享 Skill" icon={<Sparkles size={20} />} items={skillItems} onToggle={toggleCapability} onGuide={setGuide} />}
          {section === "mcp" && <CapabilityCatalog title="共享 MCP" icon={<Plug size={20} />} items={mcpItems} onToggle={toggleCapability} onGuide={setGuide} />}
        </section>
      </div>
      {guide && <InstallGuide name={guide.name} permissions={guide.permissions} onClose={() => setGuide(null)} />}
    </div>
  );
}

function AgentSettingsPanel(props: {
  agentName: string;
  agent?: CatalogAgent;
  tab: NativeSettingsTab;
  onTabChange: (tab: NativeSettingsTab) => void;
  hub: AgentHubAgentSettings;
  native: AgentNativeWorkSettings;
  saved: boolean;
  onUpdateHub: <K extends keyof AgentHubAgentSettings>(key: K, value: AgentHubAgentSettings[K]) => void;
  onUpdateNative: (next: AgentNativeWorkSettings) => void;
  catalog: CatalogModel[];
  onSave: () => void;
  onReset: () => void;
}) {
  const { agentName, agent, tab, onTabChange, hub, native, saved, onUpdateHub, onUpdateNative, onSave, onReset, catalog } = props;
  return (
    <>
      <div className="settings-panel-title">
        <div>
          <h2>{agentName}</h2>
          <p>原生设置对应这个 Agent 自己的工作能力；调度设置只属于 AgentHub。</p>
        </div>
        <span className="settings-badge"><Check size={14} />不改原桌面配置文件</span>
      </div>
      <div className="native-info">
        <strong>原生信息（只读）</strong>
        <span>探测状态：{agent?.probe?.status === "confirmed" ? "已确认可启动" : agent?.probe?.status === "failed" ? "探测失败" : agent?.probe?.status === "unavailable" ? "未安装或入口不存在" : "尚未探测"}</span>
        <span>版本：{agent?.probe?.version ?? "未获取"}</span>
        <span>实际入口：{agent?.probe?.executablePath ?? "未获取"}</span>
        <span>状态：{agent?.configured ? "配置已登记" : "配置不可用"}</span>
        <span>默认模型档次：{agent?.defaultModel || "未配置"}</span>
        {agent?.reason && <span>说明：{agent.reason}</span>}
        <span>原配置位置：{nativeConfigHint(agent?.id ?? "hermes").path}</span>
        <span>{nativeConfigHint(agent?.id ?? "hermes").note}</span>
      </div>
      <div className="settings-tabs" role="tablist">
        <button type="button" className={tab === "native" ? "active" : ""} onClick={() => onTabChange("native")}>原生工作设置</button>
        <button type="button" className={tab === "hub" ? "active" : ""} onClick={() => onTabChange("hub")}>AgentHub 调度设置</button>
      </div>
      {tab === "native" ? (
        <NativeSettingsForm native={native} onChange={onUpdateNative} catalog={catalog} />
      ) : (
        <div className="settings-form">
          <Toggle label="启用此 Agent" help="关闭后 Hermes 不会把新任务派给它。" value={hub.enabled} onChange={(value) => onUpdateHub("enabled", value)} />
          <Toggle label="允许 Hermes 调度" help="允许 Hermes 把后台任务交给这个 Agent。" value={hub.allowHermesDispatch} onChange={(value) => onUpdateHub("allowHermesDispatch", value)} />
          <Toggle label="允许写入文件" help="关闭时只允许进行只读型工作。" value={hub.allowWrite} onChange={(value) => onUpdateHub("allowWrite", value)} />
          <Toggle label="高风险操作需要确认" help="像实验室的安全开关，建议保持开启。" value={hub.requireConfirmation} onChange={(value) => onUpdateHub("requireConfirmation", value)} />
          <Toggle label="显示详细工作日志" help="允许你查看后台 Agent 的工作过程。" value={hub.showDetailedLogs} onChange={(value) => onUpdateHub("showDetailedLogs", value)} />
          <NumberField label="任务超时（秒）" value={hub.timeoutSeconds} min={30} max={86400} onChange={(value) => onUpdateHub("timeoutSeconds", value)} />
          <NumberField label="调度优先级" value={hub.priority} min={0} max={100} onChange={(value) => onUpdateHub("priority", value)} />
        </div>
      )}
      <p className="catalog-note">当前这些设置保存在 AgentHub 本机，不会改写 Hermes、Pi、Codex 或 Claude Code 原来的桌面配置文件，也不会显示密钥。</p>
      <div className="settings-actions">
        <button type="button" className="button button-primary settings-save" onClick={onSave}><Save size={15} />保存设置</button>
        <button type="button" className="button button-secondary" onClick={onReset}>恢复安全默认值</button>
        {saved && <span className="settings-saved">已保存到本机</span>}
      </div>
    </>
  );
}

function modelOptions(catalog: CatalogModel[]): Array<{ value: string; label: string }> {
  return [{ value: "", label: "跟随公共默认" }, ...catalog.map((item) => ({ value: item.id, label: `${item.label}（${item.provider}）` }))];
}

function NativeSettingsForm({ native, onChange, catalog }: { native: AgentNativeWorkSettings; onChange: (next: AgentNativeWorkSettings) => void; catalog: CatalogModel[] }) {
  if (native.agentId === "hermes") return <HermesNativeForm value={native} onChange={onChange} catalog={catalog} />;
  if (native.agentId === "pi") return <PiNativeForm value={native} onChange={onChange} catalog={catalog} />;
  if (native.agentId === "codex") return <CodexNativeForm value={native} onChange={onChange} catalog={catalog} />;
  return <ClaudeNativeForm value={native} onChange={onChange} />;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="settings-section"><h3>{title}</h3>{children}</section>;
}

function toggleList(current: string[], id: string, enabled: boolean): string[] {
  if (enabled) return current.includes(id) ? current : [...current, id];
  return current.filter((item) => item !== id);
}

function HermesNativeForm({ value, onChange, catalog }: { value: HermesNativeSettings; onChange: (next: HermesNativeSettings) => void; catalog: CatalogModel[] }) {
  const set = (key: keyof HermesNativeSettings, next: HermesNativeSettings[keyof HermesNativeSettings]) => onChange({ ...value, [key]: next } as HermesNativeSettings);
  return (
    <div className="settings-form">
      <Section title="模型与服务">
        <SelectField label="默认模型" help="从公共模型配置里选。密钥不放在这里。" value={value.modelId} options={modelOptions(catalog)} onChange={(next) => set("modelId", next)} />
        <TextField label="服务提供方" help="例如 openrouter、anthropic、openai。密钥仍放在 Hermes 自己的保险柜里。" value={value.provider} onChange={(next) => set("provider", next)} />
        <SelectField label="推理强度" help="none / low / medium / high。" value={value.reasoningEffort} options={[{ value: "none", label: "关闭" }, { value: "low", label: "低" }, { value: "medium", label: "中" }, { value: "high", label: "高" }]} onChange={(next) => set("reasoningEffort", next as HermesNativeSettings["reasoningEffort"])} />
        <NumberField label="单次最大回合" value={value.maxTurns} min={1} max={200} onChange={(next) => set("maxTurns", next)} />
      </Section>
      <Section title="记忆与人格">
        <Toggle label="启用记忆" help="对应 memory.memory_enabled。" value={value.memoryEnabled} onChange={(next) => set("memoryEnabled", next)} />
        <Toggle label="用户画像" help="对应 memory.user_profile_enabled。" value={value.userProfileEnabled} onChange={(next) => set("userProfileEnabled", next)} />
        <Toggle label="记忆写入需要审批" help="建议开启，避免 Hermes 自己偷偷改记忆。" value={value.memoryWriteApproval} onChange={(next) => set("memoryWriteApproval", next)} />
        <Toggle label="人格 / SOUL" help="是否使用 Hermes 的人格说明。不是桌面主题。" value={value.personalityEnabled} onChange={(next) => set("personalityEnabled", next)} />
      </Section>
      <Section title="工具权限">
        {HERMES_TOOLSETS.map((tool) => (
          <Toggle key={tool.id} label={tool.label} help={tool.help} value={value.enabledToolsets.includes(tool.id)} onChange={(enabled) => set("enabledToolsets", toggleList(value.enabledToolsets, tool.id, enabled))} />
        ))}
      </Section>
      <Section title="工作目录">
        <TextField label="工作目录" help="对应 Hermes 的 workspace / terminal.cwd。" value={value.workDirectory} onChange={(next) => set("workDirectory", next)} />
      </Section>
      <Section title="自动审批">
        <SelectField label="审批模式" help="manual：每次危险操作都问你。smart：低风险可自动过。这里不提供 YOLO / off。" value={value.approvalsMode} options={[{ value: "manual", label: "手动审批" }, { value: "smart", label: "智能审批" }]} onChange={(next) => set("approvalsMode", next as HermesNativeSettings["approvalsMode"])} />
      </Section>
      <Section title="规划与调度">
        <SelectField label="规划方式" help="关闭 / 仅建议 / 你确认后再执行。当前不会自动绕过审批。" value={value.planningMode} options={[{ value: "off", label: "关闭" }, { value: "suggest", label: "仅建议" }, { value: "confirm", label: "用户确认后执行" }]} onChange={(next) => set("planningMode", next as HermesNativeSettings["planningMode"])} />
        <Toggle label="允许调用其他 Agent" help="允许 Hermes 把任务交给 Pi 或 Codex。" value={value.allowDelegation} onChange={(next) => set("allowDelegation", next)} />
        <NumberField label="规划最大步数" value={value.maxPlanSteps} min={1} max={20} onChange={(next) => set("maxPlanSteps", next)} />
      </Section>
      <Section title="网络访问">
        <Toggle label="允许联网工具" help="打开后才会考虑 web / browser 工具。" value={value.networkEnabled} onChange={(next) => set("networkEnabled", next)} />
      </Section>
      <Section title="日志与记录">
        <Toggle label="保存工作日志" help="记录任务过程，不保存密钥。" value={value.showLogs} onChange={(next) => set("showLogs", next)} />
      </Section>
      <Section title="成本与用量">
        <Toggle label="显示用量与费用" help="对应 Hermes 的 show_cost。没有数字时会显示“未知”，不会猜测。" value={value.showCost} onChange={(next) => set("showCost", next)} />
      </Section>
    </div>
  );
}

function PiNativeForm({ value, onChange, catalog }: { value: PiNativeSettings; onChange: (next: PiNativeSettings) => void; catalog: CatalogModel[] }) {
  const set = (key: keyof PiNativeSettings, next: PiNativeSettings[keyof PiNativeSettings]) => onChange({ ...value, [key]: next } as PiNativeSettings);
  return (
    <div className="settings-form">
      <Section title="模型与服务">
        <TextField label="默认提供方" help="对应 Pi 的 defaultProvider。不填写密钥。" value={value.defaultProvider} onChange={(next) => set("defaultProvider", next)} />
        <SelectField label="默认模型" help="从公共模型配置里选。" value={value.modelId} options={modelOptions(catalog)} onChange={(next) => set("modelId", next)} />
      </Section>
      <Section title="会话设置">
        <Toggle label="保留会话" help="关闭时相当于 --no-session，每次任务单独进行。" value={value.sessionEnabled} onChange={(next) => set("sessionEnabled", next)} />
      </Section>
      <Section title="只读工具">
        {PI_TOOLS.map((tool) => (
          <Toggle key={tool.id} label={tool.label} help={tool.help} value={value.enabledTools.includes(tool.id)} onChange={(enabled) => set("enabledTools", toggleList(value.enabledTools, tool.id, enabled))} />
        ))}
      </Section>
      <Section title="插件">
        <p className="catalog-note">Pi 插件只属于 Pi，请在左侧打开“Pi 插件”。这里不把插件共享给 Hermes 或 Codex。</p>
      </Section>
    </div>
  );
}

function CodexNativeForm({ value, onChange, catalog }: { value: CodexNativeSettings; onChange: (next: CodexNativeSettings) => void; catalog: CatalogModel[] }) {
  const set = (key: keyof CodexNativeSettings, next: CodexNativeSettings[keyof CodexNativeSettings]) => onChange({ ...value, [key]: next } as CodexNativeSettings);
  return (
    <div className="settings-form">
      <Section title="模型与服务">
        <SelectField label="默认模型" help="从公共模型配置里选。" value={value.modelId} options={modelOptions(catalog)} onChange={(next) => set("modelId", next)} />
      </Section>
      <Section title="沙箱权限">
        <SelectField label="沙箱" help="AgentHub 后台运行默认只读。工作区写入以后才会接到启动参数。不提供危险绕过。" value={value.sandbox} options={[{ value: "read-only", label: "只读" }, { value: "workspace-write", label: "允许写入工作区" }]} onChange={(next) => set("sandbox", next as CodexNativeSettings["sandbox"])} />
      </Section>
      <Section title="工作目录">
        <TextField label="工作目录" help="Codex 执行任务时的项目目录。" value={value.workDirectory} onChange={(next) => set("workDirectory", next)} />
      </Section>
      <p className="catalog-note">审批策略由 AgentHub 统一管理，不再单独设置 Codex 桌面端的审批弹窗。</p>
    </div>
  );
}

function ClaudeNativeForm({ value: _value }: { value: ClaudeNativeSettings; onChange: (next: ClaudeNativeSettings) => void }) {
  return (
    <div className="settings-form">
      <Section title="当前状态">
        <p className="inline-error">Claude Code 本机入口不完整，暂时不能接入 AgentHub。</p>
        <p className="catalog-note">等入口修复后，再开放权限模式、工具权限和非交互运行。现在不会保存一套空的 Claude 权限旋钮，避免以后和 AgentHub 总闸门打架。</p>
      </Section>
    </div>
  );
}
function Toggle({ label, help, value, onChange }: { label: string; help: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="setting-toggle">
      <span><strong>{label}</strong><small>{help}</small></span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.currentTarget.checked)} />
    </label>
  );
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="setting-number">
      <span>{label}</span>
      <input type="number" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.currentTarget.value))} />
    </label>
  );
}

function TextField({ label, help, value, onChange }: { label: string; help: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="setting-text">
      <span><strong>{label}</strong><small>{help}</small></span>
      <input type="text" value={value} onChange={(e) => onChange(e.currentTarget.value)} />
    </label>
  );
}

function SelectField({ label, help, value, options, onChange }: { label: string; help: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return (
    <label className="setting-text">
      <span><strong>{label}</strong><small>{help}</small></span>
      <select value={value} onChange={(e) => onChange(e.currentTarget.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function CapabilityCatalog({ title, icon, items, onToggle, onGuide }: { title: string; icon: ReactNode; items: Array<{ id: string; name: string; description: string; status: string; permissions: string[]; canToggle: boolean; enabled: boolean }>; onToggle: (id: string, enabled: boolean) => void; onGuide: (item: { name: string; permissions: string[] }) => void }) {
  return (
    <div className="capability-catalog">
      <div className="settings-panel-title">
        <div>
          <h2>{title}</h2>
          <p>这里只登记能力和权限，不代表已经安装或已经连接。</p>
        </div>
        <div className="capability-icon">{icon}</div>
      </div>
      <div className="capability-list">
        {items.map((item) => (
          <article className="capability-card" key={item.id}>
            <div>
              <h3>{item.name}</h3>
              <p>{item.description}</p>
              <small>权限：{item.permissions.join("、")}</small>
            </div>
            <div className="capability-card-side">
              <span className="settings-badge">{item.status}</span>
              <button type="button" className="button button-secondary" disabled={!item.canToggle} onClick={() => onToggle(item.id, !item.enabled)}>
                {item.canToggle ? item.enabled ? "停用" : "启用" : "等待安装"}
              </button>
              <button type="button" className="text-button" onClick={() => onGuide({ name: item.name, permissions: item.permissions })}>查看安装要求</button>
            </div>
          </article>
        ))}
      </div>
      <p className="catalog-note">安全提示：Pi 插件永远只属于 Pi；共享 Skill 和 MCP 也会逐项检查兼容性与权限。</p>
    </div>
  );
}

function InstallGuide({ name, permissions, onClose }: { name: string; permissions: string[]; onClose: () => void }) {
  return (
    <div className="guide-backdrop" role="presentation" onClick={onClose}>
      <div className="guide-dialog" role="dialog" aria-modal="true" aria-label="安装要求" onClick={(e) => e.stopPropagation()}>
        <h2>安装前确认</h2>
        <p><strong>{name}</strong> 尚未自动安装。</p>
        <p>正式安装前，AgentHub 会检查来源、版本和兼容性，并要求你确认。</p>
        <h3>可能需要的权限</h3>
        <ul>{permissions.map((permission) => <li key={permission}>{permission}</li>)}</ul>
        <div className="settings-actions">
          <button type="button" className="button button-secondary" onClick={onClose}>关闭</button>
          <button type="button" className="button button-primary" disabled>开始安装（即将支持）</button>
        </div>
      </div>
    </div>
  );
}

function ModelCatalogPanel({ catalog, onChange }: { catalog: CatalogModel[]; onChange: (next: CatalogModel[]) => void }) {
  const [draft, setDraft] = useState({ id: "", label: "", provider: "cc-switch" });
  function update(index: number, patch: Partial<CatalogModel>) {
    onChange(catalog.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }
  function remove(index: number) {
    onChange(catalog.filter((_, i) => i !== index));
  }
  function add() {
    const id = draft.id.trim() || draft.label.trim().toLowerCase().replace(/\s+/g, "-");
    if (!id) return;
    onChange([...catalog, { id, label: draft.label.trim() || id, provider: draft.provider.trim() || "custom" }]);
    setDraft({ id: "", label: "", provider: "cc-switch" });
  }
  return (
    <div className="capability-catalog">
      <div className="settings-panel-title">
        <div>
          <h2>公共模型配置</h2>
          <p>所有 Agent 的单独模型设置都从这里选。这里不保存密钥。</p>
        </div>
      </div>
      <div className="capability-list">
        {catalog.map((item, index) => (
          <article className="capability-card" key={item.id}>
            <div className="model-card-fields">
              <label><span>显示名</span><input value={item.label} onChange={(e) => update(index, { label: e.currentTarget.value })} /></label>
              <label><span>模型 ID</span><input value={item.id} onChange={(e) => update(index, { id: e.currentTarget.value })} /></label>
              <label><span>提供方</span><input value={item.provider} onChange={(e) => update(index, { provider: e.currentTarget.value })} /></label>
            </div>
            <div className="capability-card-side">
              <button type="button" className="button button-secondary" onClick={() => remove(index)}>移除</button>
            </div>
          </article>
        ))}
      </div>
      <div className="model-add-row">
        <input placeholder="模型 ID，如 gpt-5.6" value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.currentTarget.value })} />
        <input placeholder="显示名，如 GPT-5.6" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.currentTarget.value })} />
        <input placeholder="提供方" value={draft.provider} onChange={(e) => setDraft({ ...draft, provider: e.currentTarget.value })} />
        <button type="button" className="button button-primary" onClick={add}>加入公共模型</button>
      </div>
      <p className="catalog-note">默认提供 {DEFAULT_MODEL_CATALOG.length} 个常用模型。移除只影响 AgentHub 的选择列表，不会删除真实服务里的模型。</p>
    </div>
  );
}