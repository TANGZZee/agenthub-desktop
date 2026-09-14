import type { ReactNode } from "react";
import { Bot, Building2, LayoutDashboard, Terminal, UsersRound } from "lucide-react";
import type { SidecarDisplayStatus } from "../hooks/useSidecar";

export type AppView = "run" | "office" | "diagnostic" | "agents";

interface AppShellProps {
  activeView: AppView;
  onViewChange: (view: AppView) => void;
  sidecar: SidecarDisplayStatus;
  statusList: ReactNode;
  promptInput: ReactNode;
  children: ReactNode;
}

const TITLES: Record<AppView, string> = {
  run: "工作台",
  office: "办公室",
  agents: "智能体",
  diagnostic: "诊断",
};

export function AppShell({ activeView, onViewChange, sidecar, statusList, promptInput, children }: AppShellProps) {
  return (
    <div className="primary-shell">
      <aside className="primary-sidebar" aria-label="主导航">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><Bot size={16} /></span>
          <span className="brand-name">AgentHub</span>
        </div>
        <nav className="primary-nav">
          <button type="button" className={`nav-item ${activeView === "run" ? "active" : ""}`} onClick={() => onViewChange("run")}>
            <LayoutDashboard size={16} aria-hidden="true" /><span>工作台</span>
          </button>
          <button type="button" className={`nav-item ${activeView === "office" ? "active" : ""}`} onClick={() => onViewChange("office")}>
            <Building2 size={16} aria-hidden="true" /><span>办公室</span>
          </button>
          <button type="button" className={`nav-item ${activeView === "agents" ? "active" : ""}`} onClick={() => onViewChange("agents")}>
            <UsersRound size={16} aria-hidden="true" /><span>智能体</span>
          </button>
          <button type="button" className={`nav-item ${activeView === "diagnostic" ? "active" : ""}`} onClick={() => onViewChange("diagnostic")}>
            <Terminal size={16} aria-hidden="true" /><span>诊断</span>
          </button>
        </nav>
        <div className="sidebar-status">{statusList}</div>
      </aside>
      <section className="primary-main">
        <header className="primary-topbar">
          <div className="topbar-title">{TITLES[activeView]}</div>
          {sidecar.version && <span className="sidecar-version">{sidecar.available === false ? "Sidecar 未连接" : `Sidecar ${sidecar.version}`}</span>}
        </header>
        {sidecar.jobObject === false && (
          <div className="degraded-banner" role="status">未能接管进程组。关闭软件后如果还有残留进程，请在任务管理器里结束。</div>
        )}
        <main className={`primary-content ${activeView}`}>{children}</main>
        {promptInput}
      </section>
    </div>
  );
}
