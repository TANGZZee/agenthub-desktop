import { useEffect, useState } from "react";
import { ExternalLink, MonitorPlay, Power } from "lucide-react";
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

  const [checking, setChecking] = useState(false);
  const [pixelNote, setPixelNote] = useState<string | null>(null);

  const [starting, setStarting] = useState(false);

  async function startPixel() {
    setStarting(true);
    setPixelNote(null);
    try {
      const message = await invoke<string>("start_star_office");
      setPixelNote(message);
      window.setTimeout(() => void togglePixel(), 2500);
    } catch (error) {
      setPixelNote(error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  }

  async function togglePixel() {
    if (pixelOn) {
      setPixelOn(false);
      return;
    }
    setChecking(true);
    setPixelNote(null);
    try {
      await fetch("http://127.0.0.1:19000/health", { mode: "no-cors" });
      setPixelOn(true);
    } catch {
      setPixelNote("还没连上 19000 端口。如果刚点过启动，请再等几秒；若一直连不上，说明 Python 或依赖还没装好。");
    } finally {
      setChecking(false);
    }
  }
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
            <button type="button" className="button button-secondary" disabled={starting} onClick={() => void startPixel()}>
              <Power size={14} />{starting ? "启动中" : "启动像素办公室"}
            </button>
            <button type="button" className="button button-secondary" disabled={checking} onClick={() => void togglePixel()}>
              {checking ? "检查中" : pixelOn ? "关闭像素办公室" : "打开像素办公室"}
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
          <>
            {pixelNote && <p className="office-note">{pixelNote}</p>}
            <p className="office-idle">未打开。像素办公室是 Python 服务：先点「启动像素办公室」，再点「打开」。本机没装 Python 时会直接告诉你缺什么。</p>
          </>
        )}
      </section>
    </div>
  );
}
