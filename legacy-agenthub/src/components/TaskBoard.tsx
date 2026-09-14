import { useCallback, useEffect, useState } from "react";
import { RefreshCw, RotateCcw, Square } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { TaskTimeline } from "./TaskTimeline";
import { TAURI_COMMANDS } from "../../shared/protocol";
import type { TaskRecordWire } from "../../shared/task-protocol";

interface TaskBoardProps { onSelectAgent?: (agentId: string) => void; refreshSignal?: number; }
const labels: Record<string, string> = { created: "已创建", admitted: "已准入", queued: "排队", running: "运行", succeeded: "完成", failed: "失败", cancelled: "取消", rejected: "拒绝", escalated: "升级" };

export function TaskBoard({ onSelectAgent, refreshSignal }: TaskBoardProps) {
  const [tasks, setTasks] = useState<TaskRecordWire[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const result = await invoke<{ tasks: TaskRecordWire[] }>(TAURI_COMMANDS.listTasks);
      setTasks(result.tasks);
      setError(null);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [refresh, refreshSignal]);

  return (
    <aside className="task-rail" aria-label="任务队列">
      <header>
        <strong>任务</strong>
        <button type="button" className="icon-button" title="刷新" onClick={() => void refresh()}><RefreshCw size={14} /></button>
      </header>
      {error && <p className="inline-error">{error}</p>}
      {tasks.length === 0 ? (
        <p className="task-empty">还没有任务。在下方告诉 Hermes 要做什么。</p>
      ) : (
        <div className="task-list">
          {tasks.map((task) => (
            <article className={`task-row ${task.status}`} key={task.taskId}>
              <button type="button" className="task-row-main" onClick={() => setExpandedTask((value) => value === task.taskId ? null : task.taskId)}>
                <strong>{task.title}</strong>
                <span>{task.assignedWorkerId} · {labels[task.status] ?? task.status}</span>
              </button>
              <div className="task-row-actions">
                {(task.status === "queued" || task.status === "running") && (
                  <button type="button" className="text-button" onClick={() => void invoke(TAURI_COMMANDS.cancelTask, { taskId: task.taskId }).then(refresh)}><Square size={12} />取消</button>
                )}
                {task.status === "failed" && (
                  <button type="button" className="text-button" onClick={() => void invoke(TAURI_COMMANDS.retryTask, { taskId: task.taskId }).then(refresh)}><RotateCcw size={12} />重试</button>
                )}
                <button type="button" className="text-button" onClick={() => onSelectAgent?.(task.assignedWorkerId)}>查看</button>
              </div>
              {expandedTask === task.taskId ? <TaskTimeline taskId={task.taskId} /> : null}
            </article>
          ))}
        </div>
      )}
    </aside>
  );
}
