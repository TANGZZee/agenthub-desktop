import { useEffect, useState } from "react";
import { ExternalLink, MonitorPlay, Radio } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { CatalogAgent, AgentRuntime } from "../hooks/useSidecar";
import { TAURI_COMMANDS } from "../../shared/protocol";
import type { TaskRecordWire } from "../../shared/task-protocol";

interface OfficeViewProps { agents: CatalogAgent[]; runtimes: Record<string, AgentRuntime>; refreshSignal?: number; }
type OfficeState = "待命中" | "正在同步" | "正在工作" | "出现问题";
const statusLabels: Record<string, string> = { queued: "排队中", running: "正在工作", succeeded: "刚完成", failed: "出现问题", cancelled: "已取消" };

function stateFor(runtime: AgentRuntime | undefined, task?: TaskRecordWire): OfficeState {
  if (task?.status === "running") return "正在工作";
  if (task?.status === "queued") return "正在同步";
  if (task?.status === "failed") return "出现问题";
  if (!runtime || runtime.phase === "idle") return "待命中";
  if (runtime.phase === "starting" || runtime.phase === "terminating") return "正在同步";
  if (runtime.phase === "running") return "正在工作";
  return runtime.result === "failed" ? "出现问题" : "待命中";
}

function detailFor(agent: CatalogAgent, runtime: AgentRuntime | undefined, task?: TaskRecordWire): string {
  if (task?.status === "running") return `正在处理：${task.title}`;
  if (task?.status === "queued") return `已排队：${task.title}`;
  if (task?.status === "failed") return task.lastError ?? "最近一次任务失败";
  if (runtime?.phase === "running") return `${agent.label} 正在执行已准入任务`;
  if (runtime?.phase === "starting") return "正在准备安全运行环境";
  if (runtime?.phase === "terminating") return "正在停止任务并清理进程";
  if (runtime?.result === "failed") return runtime.lastError ?? "最近一次任务失败";
  if (agent.id === "claude") return "当前安装入口不可用";
  if (agent.id === "hermes") return "总控待命；你把任务交给 Hermes，它再派给 Pi 或 Codex";
  return "等待经过安全检查的任务";
}

export function OfficeView({ agents, runtimes, refreshSignal }: OfficeViewProps) {
  const [tasks, setTasks] = useState<TaskRecordWire[]>([]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const result = await invoke<{ tasks: TaskRecordWire[] }>(TAURI_COMMANDS.listTasks);
        if (active) setTasks(result.tasks);
      } catch {
        if (active) setTasks([]);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [refreshSignal]);

  const officeUrl = "http://127.0.0.1:19000";
  return (
    <div className="office-view">
      <header className="app-header">
        <div>
          <h1>AI 办公室</h1>
          <p>你主要和 Hermes 对话；这里用于观察后台 Agent 的真实工作状态。</p>
        </div>
        <MonitorPlay size={22} aria-hidden="true" />
      </header>
      <section className="office-status-guide">
        <Radio size={17} />
        <span>状态来自 AgentHub 任务与进程状态，不是单纯动画。Star Office 像素看板未启动时，下面仍可查看 AgentHub 看板。</span>
      </section>
      <section className="office-agent-grid">
        {agents.map((agent) => {
          const runtime = runtimes[agent.id];
          const task = tasks.find((item) => item.assignedWorkerId === agent.id && (item.status === "running" || item.status === "queued"))
            ?? tasks.find((item) => item.assignedWorkerId === agent.id);
          const state = stateFor(runtime, task);
          return (
            <article className={`office-agent-card ${state === "出现问题" ? "error" : ""}`} key={agent.id}>
              <div className="office-avatar">{agent.label.slice(0, 1)}</div>
              <div>
                <h2>{agent.label}</h2>
                <span className="office-state">{state}{task ? ` · ${statusLabels[task.status] ?? task.status}` : ""}</span>
                <p>{detailFor(agent, runtime, task)}</p>
              </div>
            </article>
          );
        })}
      </section>
      <section className="star-office-panel">
        <div className="star-office-header">
          <div>
            <h2>Star 像素办公室</h2>
            <p>已作为可选本地模块加入。启动它的本地服务后，此处会显示中文像素办公室。</p>
          </div>
          <a className="button button-secondary" href={officeUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={15} />单独打开
          </a>
        </div>
        <div className="star-office-frame-wrap">
          <iframe title="Star 像素办公室" src={officeUrl} className="star-office-frame" />
          <div className="star-office-fallback">
            <strong>若这里暂时是空白或连接失败</strong>
            <span>表示 Star Office 本地服务尚未启动；AgentHub 的上方状态卡仍然可正常使用。</span>
          </div>
        </div>
        <p className="office-credit">Star Office UI：代码遵循 MIT；像素美术资产仅用于个人、非商业学习与演示。原作者署名和许可证保留在 <code>third_party/Star-Office-UI/LICENSE</code>。</p>
      </section>
    </div>
  );
}
