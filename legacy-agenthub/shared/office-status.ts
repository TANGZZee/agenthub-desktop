/** AgentHub 内部状态到 Star Office 状态的统一映射。 */
export type OfficeState = "idle" | "writing" | "researching" | "executing" | "syncing" | "error";
export function officeStateForPhase(phase: "idle" | "starting" | "running" | "terminating"): OfficeState { if (phase === "idle") return "idle"; if (phase === "starting" || phase === "terminating") return "syncing"; return "executing"; }
export function officeDetailForPhase(phase: "idle" | "starting" | "running" | "terminating"): string { if (phase === "idle") return "待命中"; if (phase === "starting") return "正在准备安全运行环境"; if (phase === "terminating") return "正在停止任务并清理进程"; return "正在执行已准入任务"; }
