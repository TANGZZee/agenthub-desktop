import type { AgentAdapter, AdapterTask, AgentProbeResult, AdapterLaunchSpec, ParsedTaskOutput, UsageResult } from "../adapter";
import type { AgentInfo } from "../../../shared/protocol";

/** Hermes 适配器目前只保留安全占位，不自动开启规划。 */
export class HermesAdapter implements AgentAdapter {
  readonly agentId = "hermes";
  constructor(private readonly command = "hermes.exe") {}
  async probe(): Promise<AgentProbeResult> { return { agentId: this.agentId, installed: false, canStart: false, reason: "Hermes 自动规划需完成安全复验后启用" }; }
  buildArgs(_task: AdapterTask, _agent: AgentInfo): string[] { return []; }
  buildEnv(task: AdapterTask): NodeJS.ProcessEnv { return { AGENTHUB_TASK_ID: task.taskId, AGENTHUB_AGENT_ID: this.agentId }; }
  buildLaunchSpec(task: AdapterTask, agent: AgentInfo): AdapterLaunchSpec { return { command: this.command, args: this.buildArgs(task, agent), cwd: task.cwd, env: this.buildEnv(task) }; }
  parseOutput(text: string, stream: "stdout" | "stderr" = "stdout"): ParsedTaskOutput { return { text, events: [{ type: "output", taskId: "unknown", agentId: this.agentId, stream, text, at: new Date().toISOString() }], warnings: ["Hermes 自动规划尚未启用"] }; }
  async readUsage(): Promise<UsageResult> { return { source: "unavailable" }; }
  async cancel(_runId: number): Promise<void> { return; }
}
