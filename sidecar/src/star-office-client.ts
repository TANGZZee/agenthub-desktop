import type { OfficeState } from "../../shared/office-status";

/**
 * 可选的 Star Office 本地桥接器。
 * 只有用户明确配置本地 URL、Agent ID 与 Join Key 时才会推送。
 * 不传提示词、文件内容、密钥或环境变量。
 */
export class StarOfficeClient {
  private readonly baseUrl = process.env.AGENTHUB_STAR_OFFICE_URL?.replace(/\/$/, "");
  publish(agentId: string, state: OfficeState, detail: string): void {
    if (!this.baseUrl) return;
    const prefix = `AGENTHUB_STAR_OFFICE_${agentId.toUpperCase()}_`;
    const remoteAgentId = process.env[`${prefix}AGENT_ID`];
    const joinKey = process.env[`${prefix}JOIN_KEY`];
    if (!remoteAgentId || !joinKey) return;
    void fetch(`${this.baseUrl}/agent-push`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agentId: remoteAgentId, joinKey, state, detail }), signal: AbortSignal.timeout(1500) }).catch(() => undefined);
  }
}
