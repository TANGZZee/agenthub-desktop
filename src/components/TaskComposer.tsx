import { useState } from "react";
import { Send } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { TAURI_COMMANDS } from "../../shared/protocol";
import type { TaskProposal } from "../../shared/task-protocol";

interface TaskComposerProps { onSubmitted: () => void; }
export function TaskComposer({ onSubmitted }: TaskComposerProps) {
  const [worker, setWorker] = useState<"pi" | "codex">("pi");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  async function submit() {
    const description = text.trim();
    if (!description || submitting) return;
    const proposal: TaskProposal = { proposalId: `manual-${Date.now()}`, title: description.slice(0, 40), description, proposedWorkerId: worker, toolPolicy: worker === "pi" ? ["read", "grep", "find", "ls"] : ["read"], writeScope: "none", budget: { maxSeconds: 1800 } };
    setSubmitting(true);
    try { const result = await invoke<{ accepted: boolean; reasons: string[] }>(TAURI_COMMANDS.submitTask, { proposal }); if (!result.accepted) throw new Error(result.reasons.join("；") || "任务未通过安全准入"); setText(""); setError(null); onSubmitted(); } catch (value) { setError(value instanceof Error ? value.message : String(value)); } finally { setSubmitting(false); }
  }
  return <section className="task-composer"><div><h2>提交只读任务</h2><p>任务会先经过 Sidecar 安全准入，再进入队列；当前不会直接启动模型。</p></div><div className="task-compose-row"><select value={worker} onChange={(event) => setWorker(event.currentTarget.value as "pi" | "codex")}><option value="pi">Pi（只读工具）</option><option value="codex">Codex（只读沙箱）</option></select><textarea value={text} rows={2} placeholder="例如：整理当前项目的文件结构，并指出主要模块。" onChange={(event) => setText(event.currentTarget.value)} /><button type="button" className="button button-primary" disabled={!text.trim() || submitting} onClick={() => void submit()}><Send size={15} />{submitting ? "提交中" : "安全提交"}</button></div>{error && <p className="inline-error">任务未提交：{error}</p>}</section>;
}
