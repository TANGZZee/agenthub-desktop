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

export function probeAgent(agent: ResolvedAgentConfig): Promise<AgentProbe> {
  if (!agent.configured || !agent.command) {
    return Promise.resolve({ installed: false, canStart: false, version: null, executablePath: null, status: "unavailable", reason: agent.reason ?? "配置不可用" });
  }
  return new Promise((resolveProbe) => {
    const child = spawn(agent.command, ["--version"], { cwd: agent.cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: AgentProbe) => { if (settled) return; settled = true; clearTimeout(timer); resolveProbe(result); };
    const timer = setTimeout(() => { child.kill(); finish({ installed: true, canStart: false, version: null, executablePath: null, status: "failed", reason: "版本探测超时" }); }, TIMEOUT_MS);
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", (error: NodeJS.ErrnoException) => finish({ installed: false, canStart: false, version: null, executablePath: null, status: "unavailable", reason: error.code === "ENOENT" ? "命令入口不存在" : "启动探测失败" }));
    child.once("close", (code) => {
      const output = cleanOutput(stdout || stderr);
      const version = output || null;
      finish({ installed: true, canStart: code === 0, version, executablePath: agent.command, status: code === 0 ? "confirmed" : "failed", ...(code === 0 ? {} : { reason: `版本命令退出码 ${code ?? "未知"}` }) });
    });
  });
}
