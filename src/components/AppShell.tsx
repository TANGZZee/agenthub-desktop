import type { ReactNode } from "react";
import {
  Activity,
  Bot,
  LayoutDashboard,
  Terminal,
} from "lucide-react";

import type { SidecarDisplayStatus } from "../hooks/useSidecar";

interface AppShellProps {
  activeView: "run" | "diagnostic";
  onViewChange: (view: "run" | "diagnostic") => void;
  sidecar: SidecarDisplayStatus;
  statusList: ReactNode;
  promptInput: ReactNode;
  children: ReactNode;
}

export function AppShell({
  activeView,
  onViewChange,
  sidecar,
  statusList,
  promptInput,
  children,
}: AppShellProps) {
  const title = activeView === "run" ? "运行" : "诊断";

  return (
    <div className="primary-shell">
      <aside className="primary-sidebar" aria-label="主导航">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Bot size={18} />
          </span>
          <span className="brand-name">AgentHub</span>
        </div>

        <nav className="primary-nav">
          <button
            type="button"
            className={`nav-item ${activeView === "run" ? "active" : ""}`}
            onClick={() => onViewChange("run")}
          >
            <LayoutDashboard size={17} aria-hidden="true" />
            <span>运行</span>
          </button>
          <button
            type="button"
            className={`nav-item ${activeView === "diagnostic" ? "active" : ""}`}
            onClick={() => onViewChange("diagnostic")}
          >
            <Terminal size={17} aria-hidden="true" />
            <span>诊断</span>
          </button>
        </nav>

        <div className="sidebar-status">{statusList}</div>
      </aside>

      <section className="primary-main">
        <header className="primary-topbar">
          <div className="topbar-title">
            <Activity size={16} aria-hidden="true" />
            <span>{title}</span>
          </div>
          {sidecar.version && (
            <span className="sidecar-version">
              Sidecar {sidecar.version}
            </span>
          )}
        </header>

        {sidecar.jobObject === false && (
          <div className="degraded-banner" role="status">
            进程清理降级模式：未能接管子进程组，关闭应用后可能残留 node
            进程，请在任务管理器手动结束。
          </div>
        )}

        <main className="primary-content">{children}</main>
        {promptInput}
      </section>
    </div>
  );
}
