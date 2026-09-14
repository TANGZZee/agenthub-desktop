import { CheckCircle2, CircleAlert, Download, ExternalLink, Settings2 } from "lucide-react";
import type { CatalogAgent } from "../hooks/useSidecar";

interface AgentCatalogViewProps { agents: CatalogAgent[]; }

const MARKET = [
  { id: "hermes", name: "Hermes", role: "总管家入口", docs: "https://hermes-agent.nousresearch.com/", note: "已探测到本机入口，但自动规划保持关闭。你通过 AgentHub 把任务交给它的调度层。" },
  { id: "pi", name: "Pi", role: "后台阅读 Worker", docs: "https://pi.dev/", note: "已接入只读工具：read、grep、find、ls。" },
  { id: "codex", name: "Codex", role: "后台代码 Worker", docs: "https://github.com/openai/codex", note: "已接入官方 read-only 沙箱，不使用危险绕过参数。" },
  { id: "claude", name: "Claude Code", role: "暂不可用", docs: "https://docs.anthropic.com/en/docs/claude-code", note: "本机入口不完整，当前不能接入。" },
];

export function AgentCatalogView({ agents }: AgentCatalogViewProps) {
  return (
    <div className="catalog-view">
      <header className="app-header">
        <div>
          <h1>Agent / 智能体</h1>
          <p>这里统一查看可接入 AgentHub 的真实 Agent。安装需要你确认，软件不会自动下载。</p>
        </div>
        <Settings2 size={22} aria-hidden="true" />
      </header>
      <section className="catalog-intro">
        <strong>使用方式</strong>
        <span>先安装 Agent，再检查认证和路由，最后启用它。Hermes 会把任务派给已启用的 Worker。</span>
      </section>
      <section className="agent-catalog-grid" aria-label="Agent 列表">
        {MARKET.map((item) => {
          const agent = agents.find((entry) => entry.id === item.id);
          const ready = agent?.configured === true && item.id !== "claude" && item.id !== "hermes";
          return (
            <article className="agent-catalog-card" key={item.id}>
              <div className="agent-catalog-card-header">
                <div>
                  <h2>{agent?.label ?? item.name}</h2>
                  <span className="agent-id">{item.role}</span>
                </div>
                {ready ? <CheckCircle2 className="catalog-ok" size={22} aria-label="已配置" /> : <CircleAlert className="catalog-warning" size={22} aria-label="需确认" />}
              </div>
              <p className="catalog-status">{item.note}</p>
              <div className="catalog-meta">
                <span>探测：{agent?.probe?.status === "confirmed" ? agent.probe.version ?? "已确认" : agent?.probe?.reason ?? "待检查"}</span>
                <span>入口：{agent?.probe?.executablePath ?? "未获取"}</span>
              </div>
              <div className="catalog-actions">
                <a className="button button-secondary" href={item.docs} target="_blank" rel="noreferrer">
                  <ExternalLink size={15} />查看安装说明
                </a>
                <button type="button" className="button button-secondary" disabled>
                  <Download size={15} />自动安装（需你下次确认）
                </button>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
