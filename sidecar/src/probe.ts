import { spawn } from "node:child_process";
import type { ResolvedAgentConfig } from "./types";

export interface AgentProbe {
  installed: boolean;
  canStart: boolean;
  version: string | null;
  executablePath: string | null;
  status: "confirmed" | "unavailable" | "failed";
  reason?: string;
}

const TIMEOUT_MS = 2500;

function cleanOutput(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
}

function needsShell(command: string): boolean {
  return /\.(cmd|bat)$/i.test(command);
}

export function probeAgent(agent: ResolvedAgentConfig): Promise<AgentProbe> {
  if (!agent.configured || !agent.command) {
    return Promise.resolve({ installed: false, canStart: false, version: null, executablePath: null, status: "unavailable", reason: agent.reason ?? "配置不可用" });
  }

  return new Promise((resolveProbe) => {
    let settled = false;
    const finish = (result: AgentProbe) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveProbe(result);
    };
    const timer = setTimeout(() => finish({ installed: true, canStart: false, version: null, executablePath: agent.command, status: "failed", reason: "版本探测超时" }), TIMEOUT_MS);

    let child;
    try {
      child = spawn(agent.command, ["--version"], {
        cwd: agent.cwd,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        shell: needsShell(agent.command),
      });
    } catch (error) {
      finish({ installed: false, canStart: false, version: null, executablePath: agent.command, status: "failed", reason: `无法启动探测：${error instanceof Error ? error.message : String(error)}` });
      return;
    }

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", (error: NodeJS.ErrnoException) => finish({ installed: false, canStart: false, version: null, executablePath: agent.command, status: "unavailable", reason: error.code === "ENOENT" ? "命令入口不存在" : `探测失败：${error.code ?? error.message}` }));
    child.once("close", (code) => {
      const output = cleanOutput(stdout || stderr);
      finish({
        installed: true,
        canStart: code === 0,
        version: output || null,
        executablePath: agent.command,
        status: code === 0 ? "confirmed" : "failed",
        ...(code === 0 ? {} : { reason: `版本命令退出码 ${code ?? "未知"}` }),
      });
    });
  });
}
