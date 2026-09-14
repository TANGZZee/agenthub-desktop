import { useCallback, useEffect, useState } from "react";
import { ClipboardList, RefreshCw, Square } from "lucide-react";
import { TaskTimeline } from "./TaskTimeline";
import { invoke } from "@tauri-apps/api/core";
import { TAURI_COMMANDS } from "../../shared/protocol";
import type { TaskRecordWire } from "../../shared/task-protocol";

interface TaskBoardProps { onSelectAgent?: (agentId: string) => void; refreshSignal?: number; }
const labels: Record<string, string> = { created: "已创建", admitted: "已准入", queued: "排队中", running: "运行中", succeeded: "已完成", failed: "失败", cancelled: "已取消", rejected: "已拒绝", escalated: "需人工处理" };

export function TaskBoard({ onSelectAgent, refreshSignal }: TaskBoardProps) {
  const [tasks, setTasks] = useState<TaskRecordWire[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const refresh = useCallback(async () => { try { const result = await invoke<{ tasks: TaskRecordWire[] }>(TAURI_COMMANDS.listTasks); setTasks(result.tasks); setError(null); } catch (value) { setError(value instanceof Error ? value.message : String(value)); } }, []);
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 2000); return () => window.clearInterval(timer); }, [refresh, refreshSignal]);
  async function cancel(taskId: string) { try { await invoke(TAURI_COMMANDS.cancelTask, { taskId }); await refresh(); } catch (value) { setError(value instanceof Error ? value.message : String(value)); } }
  return <section className="task-board"><header className="task-board-header"><div><h2><ClipboardList size={18} />任务队列</h2><p>这里显示经过 Sidecar 安全检查的任务。</p></div><button type="button" className="text-button" onClick={() => void refresh()}><RefreshCw size={14} />刷新</button></header>{error && <p className="inline-error">任务队列暂不可用：{error}</p>}{tasks.length === 0 ? <p className="task-empty">还没有提交过结构化任务。普通运行按钮仍可用于阶段2进程测试。</p> : <div className="task-list">{tasks.map((task) => <article className="task-card" key={task.taskId}><div><strong>{task.title}</strong><span>{task.assignedWorkerId} · {labels[task.status] ?? task.status}</span><small>{task.description}</small></div><div className="task-card-actions">{task.status === "queued" || task.status === "running" ? <button type="button" className="button button-secondary" onClick={() => void cancel(task.taskId)}><Square size={13} />取消</button> : null}<button type="button" className="text-button" onClick={() => setExpandedTask((value) => value === task.taskId ? null : task.taskId)}>查看过程</button><button type="button" className="text-button" onClick={() => onSelectAgent?.(task.assignedWorkerId)}>查看 Agent</button>{expandedTask === task.taskId ? <TaskTimeline taskId={task.taskId} /> : null}</div></article>)}</div>}</section>;
}
