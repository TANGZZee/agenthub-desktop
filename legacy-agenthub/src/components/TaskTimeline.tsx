import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { TAURI_COMMANDS } from "../../shared/protocol";

export interface TaskTimelineEvent { eventId: string; taskId: string; eventType: string; payload: Record<string, unknown>; createdAt: string; }
const labels: Record<string, string> = { taskCreated: "已创建", taskAdmitted: "已通过安全检查", taskQueued: "已排队", taskStarted: "开始运行", taskOutput: "产生输出", taskSucceeded: "已完成", taskFailed: "执行失败", taskCancelled: "已取消" };

function detail(event: TaskTimelineEvent): string {
  const text = typeof event.payload.text === "string" ? event.payload.text : "";
  const message = typeof event.payload.message === "string" ? event.payload.message : "";
  const worker = typeof event.payload.workerId === "string" ? event.payload.workerId : "";
  return [message, text, worker].filter(Boolean).join(" · ").slice(0, 180);
}

export function TaskTimeline({ taskId }: { taskId: string }) {
  const [events, setEvents] = useState<TaskTimelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const result = await invoke<{ events: TaskTimelineEvent[] }>(TAURI_COMMANDS.listTaskEvents, { taskId, limit: 100 });
        if (active) { setEvents(result.events); setError(null); }
      } catch (value) {
        if (active) setError(value instanceof Error ? value.message : String(value));
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [taskId]);

  return (
    <div className="task-timeline">
      <h4><Clock3 size={14} />执行过程</h4>
      {error ? <p className="inline-error">时间线暂不可用：{error}</p> : events.length === 0 ? <p className="task-empty">暂时还没有过程记录。</p> : (
        <ol>
          {events.map((event) => (
            <li key={event.eventId}>
              <div>
                <span>{labels[event.eventType] ?? event.eventType}</span>
                {detail(event) && <small>{detail(event)}</small>}
              </div>
              <time>{new Date(event.createdAt).toLocaleTimeString()}</time>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
