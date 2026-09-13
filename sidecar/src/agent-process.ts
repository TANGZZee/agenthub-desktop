import { spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";

import type { OutputStream } from "../../shared/protocol";
import type { ResolvedAgentConfig } from "./types";

export interface AgentProcessCallbacks {
  onOutput: (stream: OutputStream, line: string) => void;
  onError: (error: Error) => void;
  onExit: (
    child: ChildProcess,
    code: number | null,
    signal: NodeJS.Signals | null,
  ) => void;
}

export interface AgentProcessHandle {
  child: ChildProcess;
  /** 收到 spawn 事件即完成；命令不存在等启动错误会在这里拒绝。 */
  spawned: Promise<void>;
}

let gbkDecoder: TextDecoder | null | undefined;

function decodeBuffer(buffer: Buffer): string {
  const utf8 = buffer.toString("utf8");

  // 只有明确出现替换字符时才尝试 GBK，避免把正常 Unicode 输出误判。
  if (!utf8.includes("\uFFFD")) {
    return utf8;
  }

  try {
    if (gbkDecoder === undefined) {
      gbkDecoder = new TextDecoder("gbk");
    }
    return gbkDecoder === null ? utf8 : gbkDecoder.decode(buffer);
  } catch {
    // 某些 Node 构建可能没有 GBK ICU 数据；退回 UTF-8 的可见结果，
    // 但绝不能因为解码能力缺失让整个 Sidecar 崩溃。
    gbkDecoder = null;
    return utf8;
  }
}

function pipeLines(
  stream: Readable,
  streamName: OutputStream,
  onLine: (stream: OutputStream, line: string) => void,
): Promise<void> {
  return new Promise((resolve) => {
    let pending = Buffer.alloc(0);

    function emitLine(lineBuffer: Buffer) {
      let end = lineBuffer.length;
      if (end > 0 && lineBuffer[end - 1] === 0x0d) {
        end -= 1;
      }
      onLine(streamName, decodeBuffer(lineBuffer.subarray(0, end)));
    }

    stream.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);

      let newlineIndex = pending.indexOf(0x0a);
      while (newlineIndex !== -1) {
        emitLine(pending.subarray(0, newlineIndex));
        pending = pending.subarray(newlineIndex + 1);
        newlineIndex = pending.indexOf(0x0a);
      }
    });

    stream.on("error", () => {
      // 管道错误通常伴随进程退出；等待 close，确保退出通知仍然送达。
    });

    stream.on("close", () => {
      if (pending.length > 0) {
        emitLine(pending);
        pending = Buffer.alloc(0);
      }
      resolve();
    });
  });
}

/**
 * 启动一个 Agent 子进程。
 *
 * 返回时进程可能还处于 spawning 状态；调用方必须等待 handle.spawned，
 * 才能把池记录从 starting 升级为 running。
 */
export function startAgentProcess(
  agent: ResolvedAgentConfig,
  env: NodeJS.ProcessEnv,
  callbacks: AgentProcessCallbacks,
): AgentProcessHandle {
  const child = spawn(agent.command, agent.args, {
    cwd: agent.cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const stdout = child.stdout;
  const stderr = child.stderr;

  if (!stdout || !stderr) {
    child.kill();
    return {
      child,
      spawned: Promise.reject(new Error("无法读取 Agent 的标准输出或错误输出")),
    };
  }

  const outputDrained = Promise.all([
    pipeLines(stdout, "stdout", callbacks.onOutput),
    pipeLines(stderr, "stderr", callbacks.onOutput),
  ]);

  const spawned = new Promise<void>((resolve, reject) => {
    let didSpawn = false;

    child.once("spawn", () => {
      didSpawn = true;
      resolve();
    });

    child.once("error", (error) => {
      if (!didSpawn) {
        reject(error);
        return;
      }
      callbacks.onError(error);
    });
  });

  child.once("exit", (code, signal) => {
    // 先等 stdout/stderr 管道排空，确保最后几行输出排在退出事件之前。
    void outputDrained.then(() => {
      callbacks.onExit(child, code, signal);
    });
  });

  return { child, spawned };
}
