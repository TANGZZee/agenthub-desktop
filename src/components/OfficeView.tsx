import { useEffect, useState } from "react";
import { ExternalLink, MonitorPlay } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { CatalogAgent, AgentRuntime } from "../hooks/useSidecar";
import { TAURI_COMMANDS } from "../../shared/protocol";
import type { TaskRecordWire } from "../../shared/task-protocol";

interface OfficeViewProps { agents: CatalogAgent[]; runtimes: Record<string, AgentRuntime>; refreshSignal?: number; }
type OfficeState = "待命" | "同步中" | "工作中";

function liveState(runtime: AgentRuntime | undefined, task?: TaskRecordWire): OfficeState {
  if (task?.status === "running") return "工作中";
  if (task?.status === "queued") return "同步中";
  if (!runtime || runtime.phase === "idle") return "待命";
  if (runtime.phase === "starting" || runtime.phase === "terminating") return "同步中";
  if (runtime.phase === "running") return "工作中";
  return "待命";
}

function dotClass(state: OfficeState): string {
  if (state === "工作中") return "running";
  if (state === "同步中") return "starting";
  return "idle";
}

function detailFor(agent: CatalogAgent, runtime: AgentRuntime | undefined, task?: TaskRecordWire): { main: string; note?: string } {
  if (task?.status === "running") return { main: task.title };
  if (task?.status === "queued") return { main: `排队中：${task.title}` };
  if (agent.id === "claude") return { main: "入口不可用" };
  if (agent.id === "hermes") return { main: "总管待命", note: task?.status === "failed" ? `上次失败：${task.lastError ?? "未知"}` : undefined };
  if (task?.status === "failed") return { main: "待命", note: `上次失败：${task.lastError ?? "未知"}（可在任务栏重试）` };
  if (runtime?.lastError) return { main: "待命", note: runtime.lastError };
  return { main: "等待任务" };
}

export function OfficeView({ agents, runtimes, refreshSignal }: OfficeViewProps) {
  const [tasks, setTasks] = useState<TaskRecordWire[]>([]);
  const [pixelOn, setPixelOn] = useState(false);
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

  return (
    <div className="office-view">
      <section className="office-strip" aria-label="Agent 状态">
        {agents.map((agent) => {
          const runtime = runtimes[agent.id];
          const task = tasks.find((item) => item.assignedWorkerId === agent.id && (item.status === "running" || item.status === "queued"))
            ?? tasks.find((item) => item.assignedWorkerId === agent.id);
          const state = liveState(runtime, task);
          const detail = detailFor(agent, runtime, task);
          return (
            <article className="office-cell" key={agent.id}>
              <span className={`agent-status-dot ${dotClass(state)}`} />
              <div>
                <strong>{agent.label}</strong>
                <em>{state}</em>
                <p>{detail.main}</p>
                {detail.note && <small className="office-note">{detail.note}</small>}
              </div>
            </article>
          );
        })}
      </section>
      <section className="star-office-panel">
        <div className="star-office-header">
          <div>
            <h2><MonitorPlay size={16} aria-hidden="true" /> 像素办公室</h2>
            <p>可选模块。需要先在本机启动 Star Office 服务，再在这里打开。</p>
          </div>
          <div className="office-actions">
            <button type="button" className="button button-secondary" onClick={() => setPixelOn((value) => !value)}>
              {pixelOn ? "关闭像素办公室" : "打开像素办公室"}
            </button>
            <a className="text-button" href="http://127.0.0.1:19000" target="_blank" rel="noreferrer">
              <ExternalLink size={14} />单独打开
            </a>
          </div>
        </div>
        {pixelOn ? (
          <div className="star-office-frame-wrap">
            <iframe title="Star 像素办公室" src="http://127.0.0.1:19000" className="star-office-frame" />
          </div>
        ) : (
          <p className="office-idle">未打开。服务没启动时不会显示灰色失败页。</p>
        )}
      </section>
    </div>
  );
}
