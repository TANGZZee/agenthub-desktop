import type { AgentAdapter, AdapterTask, AgentProbeResult, AdapterLaunchSpec, ParsedTaskOutput, UsageResult } from "../adapter";
import type { AgentInfo } from "../../../shared/protocol";

/** Pi 的安全适配器：默认只允许 read/grep/find/ls。 */
export class PiAdapter implements AgentAdapter {
  readonly agentId = "pi";
  constructor(private readonly command = "pi.cmd") {}
  async probe(): Promise<AgentProbeResult> { return { agentId: this.agentId, installed: false, canStart: false, reason: "由 Sidecar 探针统一执行" }; }
  buildArgs(task: AdapterTask, agent: AgentInfo): string[] { return ["--offline", "--no-session", "--tools", (task.toolPolicy?.length ? task.toolPolicy : ["read", "grep", "find", "ls"]).join(","), "--model", agent.defaultModel, "-p", task.prompt]; }
  buildEnv(task: AdapterTask): NodeJS.ProcessEnv { return { AGENTHUB_TASK_ID: task.taskId, AGENTHUB_AGENT_ID: this.agentId }; }
  buildLaunchSpec(task: AdapterTask, agent: AgentInfo): AdapterLaunchSpec { return { command: this.command, args: this.buildArgs(task, agent), cwd: task.cwd, env: this.buildEnv(task) }; }
  parseOutput(text: string, stream: "stdout" | "stderr" = "stdout"): ParsedTaskOutput { return { text, events: [{ type: "output", taskId: "unknown", agentId: this.agentId, stream, text, at: new Date().toISOString() }], warnings: [] }; }
  async readUsage(): Promise<UsageResult> { return { source: "unavailable" }; }
  async cancel(_runId: number): Promise<void> { return; }
}
