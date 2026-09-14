import type { AgentAdapter, AdapterTask, AgentProbeResult, AdapterLaunchSpec, ParsedTaskOutput, UsageResult } from "../adapter";
import type { AgentInfo } from "../../../shared/protocol";

/** Codex 适配器：使用官方 read-only 沙箱，不使用危险绕过参数。 */
export class CodexAdapter implements AgentAdapter {
  readonly agentId = "codex";
  constructor(private readonly command = "codex.exe") {}
  async probe(): Promise<AgentProbeResult> { return { agentId: this.agentId, installed: false, canStart: false, reason: "由 Sidecar 探针统一执行" }; }
  buildArgs(task: AdapterTask, _agent: AgentInfo): string[] { return ["exec", "--sandbox", "read-only", "--ephemeral", task.prompt]; }
  buildEnv(task: AdapterTask): NodeJS.ProcessEnv { return { AGENTHUB_TASK_ID: task.taskId, AGENTHUB_AGENT_ID: this.agentId }; }
  buildLaunchSpec(task: AdapterTask, agent: AgentInfo): AdapterLaunchSpec { return { command: this.command, args: this.buildArgs(task, agent), cwd: task.cwd, env: this.buildEnv(task) }; }
  parseOutput(text: string, stream: "stdout" | "stderr" = "stdout"): ParsedTaskOutput { return { text, events: [{ type: "output", taskId: "unknown", agentId: this.agentId, stream, text, at: new Date().toISOString() }], warnings: [] }; }
  async readUsage(): Promise<UsageResult> { return { source: "unavailable" }; }
  async cancel(_runId: number): Promise<void> { return; }
}
