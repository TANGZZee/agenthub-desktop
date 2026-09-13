/** 阶段3任务协议：Hermes 只提出方案，Sidecar 才能准入执行。 */
export type TaskStatus = "created" | "admitted" | "rejected" | "queued" | "running" | "succeeded" | "failed" | "cancelled" | "escalated";
export type WriteScope = "none" | "exclusive" | "shared";
export interface TaskProposal { proposalId: string; title: string; description: string; proposedWorkerId: string; toolPolicy: string[]; writeScope: WriteScope; allowedPaths?: string[]; dependsOn?: string[]; budget?: { maxSeconds?: number; maxCost?: number }; }
export interface TaskEnvelope extends TaskProposal { taskId: string; cwd: string; allowedPaths: string[]; forbidden: string[]; createdAt: string; assignedWorkerId: string; status: "admitted" | "queued"; }
export interface AdmissionResult { accepted: boolean; envelope?: TaskEnvelope; reasons: string[]; }
export const FORBIDDEN_TOOLS = ["terminal", "bash", "browser", "computer_use", "delegation"] as const;
