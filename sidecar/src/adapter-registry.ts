import type { AgentAdapter } from "./adapter";
import { ClaudeAdapter } from "./adapters/claude";
import { CodexAdapter } from "./adapters/codex";
import { HermesAdapter } from "./adapters/hermes";
import { PiAdapter } from "./adapters/pi";

/**
 * Agent 适配器注册中心。
 * 调度器只从这里取得适配器，不直接写死各 Agent 的参数。
 */
export class AdapterRegistry {
  private readonly adapters = new Map<string, AgentAdapter>([
    ["hermes", new HermesAdapter()],
    ["pi", new PiAdapter()],
    ["codex", new CodexAdapter()],
    ["claude", new ClaudeAdapter()],
  ]);

  get(agentId: string): AgentAdapter | undefined {
    return this.adapters.get(agentId);
  }

  list(): AgentAdapter[] {
    return [...this.adapters.values()];
  }
}

export const adapterRegistry = new AdapterRegistry();
