import { createInterface } from "node:readline";

import type {
  JsonRpcErrorResponse,
  JsonRpcSuccessResponse,
  RpcError,
  RpcMethod,
  RpcParamsMap,
  RpcResultMap,
  SidecarNotificationMethod,
  SidecarNotificationParamsMap,
} from "../../shared/protocol";
import { RpcError as SidecarError } from "./pool";

export type RpcHandlers = {
  [M in RpcMethod]: (
    params: RpcParamsMap[M],
  ) => Promise<RpcResultMap[M]> | RpcResultMap[M];
};

export interface JsonRpcServerOptions {
  onAfterResponse?: (method: RpcMethod) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fallbackError(error: unknown): RpcError {
  if (error instanceof SidecarError) {
    return {
      code: -32000,
      message: error.message,
      data: { kind: error.kind },
    };
  }

  return {
    code: -32000,
    message: error instanceof Error ? error.message : String(error),
    data: { kind: "internal" },
  };
}

export class JsonRpcServer {
  private readonly readline;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly handlers: RpcHandlers,
    private readonly options: JsonRpcServerOptions = {},
  ) {
    this.readline = createInterface({
      input: process.stdin,
      terminal: false,
      crlfDelay: Infinity,
    });
  }

  start(): void {
    this.readline.on("line", (line) => {
      void this.handleLine(line);
    });
  }

  async sendNotification<M extends SidecarNotificationMethod>(
    method: M,
    params: SidecarNotificationParamsMap[M],
  ): Promise<void> {
    await this.writeFrame({
      jsonrpc: "2.0",
      method,
      params,
    });
  }

  private writeFrame(value: unknown): Promise<void> {
    const frame = `${JSON.stringify(value)}\n`;

    this.writeChain = this.writeChain.then(
      () =>
        new Promise<void>((resolve) => {
          process.stdout.write(frame, () => resolve());
        }),
    );

    return this.writeChain;
  }

  private async sendResult(
    id: number,
    result: unknown,
    method: RpcMethod,
  ): Promise<void> {
    const response: JsonRpcSuccessResponse = {
      jsonrpc: "2.0",
      id,
      result: result as never,
    };
    await this.writeFrame(response);
    this.options.onAfterResponse?.(method);
  }

  private async sendError(id: number, error: RpcError): Promise<void> {
    const response: JsonRpcErrorResponse = {
      jsonrpc: "2.0",
      id,
      error,
    };
    await this.writeFrame(response);
  }

  private async handleLine(line: string): Promise<void> {
    let parsed: unknown;

    try {
      parsed = JSON.parse(line);
    } catch (error) {
      console.error(`[sidecar] 丢弃无法解析的请求行：${String(error)}`);
      return;
    }

    if (
      !isRecord(parsed) ||
      parsed.jsonrpc !== "2.0" ||
      typeof parsed.id !== "number" ||
      typeof parsed.method !== "string" ||
      !isRecord(parsed.params)
    ) {
      console.error("[sidecar] 丢弃格式不合法的 JSON-RPC 请求");
      return;
    }

    const method = parsed.method as RpcMethod;
    const handler = this.handlers[method] as
      | ((params: unknown) => unknown)
      | undefined;

    if (!handler) {
      await this.sendError(parsed.id, {
        code: -32601,
        message: `未知 RPC 方法：${method}`,
        data: { kind: "internal" },
      });
      return;
    }

    try {
      const result = await handler(parsed.params);
      await this.sendResult(parsed.id, result, method);
    } catch (error) {
      await this.sendError(parsed.id, fallbackError(error));
    }
  }
}
