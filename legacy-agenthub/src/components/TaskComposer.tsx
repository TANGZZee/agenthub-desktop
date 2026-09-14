import { useMemo, useState } from "react";
import { Send } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { buildReadOnlyProposal, type PlannedWorkerId } from "../../shared/planner";
import { TAURI_COMMANDS } from "../../shared/protocol";
import type { TaskProposal } from "../../shared/task-protocol";

interface TaskComposerProps { onSubmitted: () => void; }

export function TaskComposer({ onSubmitted }: TaskComposerProps) {
  const [worker, setWorker] = useState<"hermes" | PlannedWorkerId>("hermes");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const preview = useMemo(() => text.trim() ? buildReadOnlyProposal(text, worker === "hermes" ? undefined : worker) : null, [text, worker]);

  async function submit() {
    const description = text.trim();
    if (!description || submitting) return;
    const planned = buildReadOnlyProposal(description, worker === "hermes" ? undefined : worker);
    const proposal: TaskProposal = {
      proposalId: planned.proposalId,
      title: planned.title,
      description: planned.description,
      proposedWorkerId: planned.proposedWorkerId,
      toolPolicy: planned.toolPolicy,
      writeScope: planned.writeScope,
      budget: planned.budget,
    };
    setSubmitting(true);
    try {
      const result = await invoke<{ accepted: boolean; reasons: string[] }>(TAURI_COMMANDS.submitTask, { proposal });
      if (!result.accepted) throw new Error(result.reasons.join("；") || "任务未通过安全准入");
      setText("");
      setError(null);
      onSubmitted();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="task-composer">
      <div>
        <h2>向 Hermes 布置任务</h2>
        <p>你只需要告诉 Hermes 要做什么。Sidecar 会做安全检查，再把只读任务交给 Pi 或 Codex。</p>
      </div>
      <div className="task-compose-row">
        <select value={worker} onChange={(event) => setWorker(event.currentTarget.value as "hermes" | PlannedWorkerId)}>
          <option value="hermes">Hermes 自动分配</option>
          <option value="pi">指定 Pi</option>
          <option value="codex">指定 Codex</option>
        </select>
        <textarea value={text} rows={2} placeholder="例如：整理当前项目的文件结构，并指出主要模块。" onChange={(event) => setText(event.currentTarget.value)} />
        <button type="button" className="button button-primary" disabled={!text.trim() || submitting} onClick={() => void submit()}>
          <Send size={15} />
          {submitting ? "提交中" : "安全提交"}
        </button>
      </div>
      {preview && <p className="task-plan-hint">{preview.planReason} 将交给 {preview.proposedWorkerId === "pi" ? "Pi" : "Codex"}。</p>}
      {error && <p className="inline-error">任务未提交：{error}</p>}
    </section>
  );
}
