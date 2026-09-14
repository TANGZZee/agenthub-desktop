import type { AgentAdapter, AdapterTask, AgentProbeResult, AdapterLaunchSpec, ParsedTaskOutput, UsageResult } from "../adapter";
import type { AgentInfo } from "../../../shared/protocol";

/** Claude Code 当前安装入口不可用，因此只提供明确的不可用桩。 */
export class ClaudeAdapter implements AgentAdapter {
  readonly agentId = "claude";
  async probe(): Promise<AgentProbeResult> { return { agentId: this.agentId, installed: false, canStart: false, reason: "Claude Code 当前安装入口不可用，请修复安装后重新探测" }; }
  buildArgs(_task: AdapterTask, _agent: AgentInfo): string[] { return []; }
  buildEnv(_task: AdapterTask): NodeJS.ProcessEnv { return {}; }
  buildLaunchSpec(task: AdapterTask, agent: AgentInfo): AdapterLaunchSpec { return { command: "claude", args: this.buildArgs(task, agent), cwd: task.cwd, env: this.buildEnv(task) }; }
  parseOutput(text: string, _stream: "stdout" | "stderr" = "stdout"): ParsedTaskOutput { return { text, events: [], warnings: ["Claude Code 当前不可用"] }; }
  async readUsage(): Promise<UsageResult> { return { source: "unavailable" }; }
  async cancel(_runId: number): Promise<void> { return; }
}
