import { CheckCircle2, CircleAlert, Download, Settings2 } from "lucide-react";

import type { CatalogAgent } from "../hooks/useSidecar";

interface AgentCatalogViewProps {
  agents: CatalogAgent[];
}

export function AgentCatalogView({ agents }: AgentCatalogViewProps) {
  return (
    <div className="catalog-view">
      <header className="app-header">
        <div>
          <h1>Agent / 智能体</h1>
          <p>这里统一查看和管理可接入 AgentHub 的真实 Agent。</p>
        </div>
        <Settings2 size={22} aria-hidden="true" />
      </header>

      <section className="catalog-intro">
        <strong>使用方式</strong>
        <span>先安装 Agent，再检查认证和路由，最后启用它。Hermes 会把任务派给已启用的 Agent。</span>
      </section>

      <section className="agent-catalog-grid" aria-label="Agent 列表">
        {agents.map((agent) => (
          <article className="agent-catalog-card" key={agent.id}>
            <div className="agent-catalog-card-header">
              <div>
                <h2>{agent.label}</h2>
                <span className="agent-id">{agent.id}</span>
              </div>
              {agent.configured ? (
                <CheckCircle2 className="catalog-ok" size={22} aria-label="已配置" />
              ) : (
                <CircleAlert className="catalog-warning" size={22} aria-label="不可用" />
              )}
            </div>
            <p className="catalog-status">
              {agent.configured ? "已配置，可进行启动测试" : agent.reason ?? "暂不可用"}
            </p>
            <div className="catalog-meta">
              <span>模型档次：{agent.modelAliases.length > 0 ? agent.modelAliases.join("、") : "未配置"}</span>
              <span>当前状态：等待真实 Agent 探针</span>
            </div>
            <button type="button" className="button button-secondary" disabled>
              <Download size={15} aria-hidden="true" />
              安装 / 修复引导（即将支持）
            </button>
          </article>
        ))}
      </section>
    </div>
  );
}
