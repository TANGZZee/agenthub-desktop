/**
 * Hermes 入口的安全固定规划器。
 *
 * 这里不会启动 Hermes 进程，也不会绕过审批。
 * 它只根据用户文字，把任务交给 Pi 或 Codex 这两个后台 Worker。
 */
export type PlannedWorkerId = "pi" | "codex";

export interface TaskPlan {
  workerId: PlannedWorkerId;
  reason: string;
  toolPolicy: string[];
}

const CODE_HINT =
  /代码|程序|函数|编译|bug|修复|重构|typescript|javascript|rust|python|codex|patch|compile|refactor|function|class /i;

export function planWorker(text: string): TaskPlan {
  const description = text.trim();
  if (CODE_HINT.test(description)) {
    return {
      workerId: "codex",
      reason: "这段任务更像写代码或改代码，交给 Codex 只读沙箱处理。",
      toolPolicy: ["read"],
    };
  }

  return {
    workerId: "pi",
    reason: "这段任务更像阅读、整理或查找，交给 Pi 的只读工具处理。",
    toolPolicy: ["read", "grep", "find", "ls"],
  };
}

export function buildReadOnlyProposal(
  description: string,
  workerId?: PlannedWorkerId,
) {
  const plan = workerId
    ? {
        workerId,
        reason: workerId === "codex" ? "你指定由 Codex 处理。" : "你指定由 Pi 处理。",
        toolPolicy: workerId === "codex" ? ["read"] : ["read", "grep", "find", "ls"],
      }
    : planWorker(description);

  return {
    proposalId: `hermes-${Date.now()}`,
    title: description.slice(0, 40) || "未命名任务",
    description,
    proposedWorkerId: plan.workerId,
    toolPolicy: plan.toolPolicy,
    writeScope: "none" as const,
    budget: { maxSeconds: 1800 },
    planReason: plan.reason,
  };
}
