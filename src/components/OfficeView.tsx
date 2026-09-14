import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { CatalogAgent, AgentRuntime } from "../hooks/useSidecar";
import { TAURI_COMMANDS } from "../../shared/protocol";
import type { TaskRecordWire } from "../../shared/task-protocol";

interface OfficeViewProps { agents: CatalogAgent[]; runtimes: Record<string, AgentRuntime>; refreshSignal?: number; }
type OfficeState = "待命" | "同步中" | "工作中" | "异常";

function stateFor(runtime: AgentRuntime | undefined, task?: TaskRecordWire): OfficeState {
  if (task?.status === "running") return "工作中";
  if (task?.status === "queued") return "同步中";
  if (task?.status === "failed") return "异常";
  if (!runtime || runtime.phase === "idle") return "待命";
  if (runtime.phase === "starting" || runtime.phase === "terminating") return "同步中";
  if (runtime.phase === "running") return "工作中";
  return runtime.result === "failed" ? "异常" : "待命";
}

function detailFor(agent: CatalogAgent, runtime: AgentRuntime | undefined, task?: TaskRecordWire): string {
  if (task?.status === "running") return task.title;
  if (task?.status === "queued") return `排队：${task.title}`;
  if (task?.status === "failed") return task.lastError ?? "最近一次失败";
  if (agent.id === "claude") return "入口不可用";
  if (agent.id === "hermes") return "总管待命";
  if (runtime?.lastError) return runtime.lastError;
  return "等待任务";
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

  return (
    <div className="office-view">
      <section className="office-strip" aria-label="Agent 状态">
        {agents.map((agent) => {
          const runtime = runtimes[agent.id];
          const task = tasks.find((item) => item.assignedWorkerId === agent.id && (item.status === "running" || item.status === "queued"))
            ?? tasks.find((item) => item.assignedWorkerId === agent.id);
          const state = stateFor(runtime, task);
          return (
            <article className={`office-cell ${state === "异常" ? "error" : ""}`} key={agent.id}>
              <span className={`agent-status-dot ${state === "工作中" ? "running" : state === "异常" ? "finished failed" : "idle"}`} />
              <div>
                <strong>{agent.label}</strong>
                <em>{state}</em>
                <p>{detailFor(agent, runtime, task)}</p>
              </div>
            </article>
          );
        })}
      </section>
      <section className="star-office-panel">
        <div className="star-office-header">
          <div>
            <h2>像素办公室</h2>
            <p>可选模块。未启动本地服务时，上方状态条仍然可用。</p>
          </div>
          <a className="text-button" href="http://127.0.0.1:19000" target="_blank" rel="noreferrer">
            <ExternalLink size={14} />单独打开
          </a>
        </div>
        <div className="star-office-frame-wrap">
          <iframe title="Star 像素办公室" src="http://127.0.0.1:19000" className="star-office-frame" />
        </div>
      </section>
    </div>
  );
}
