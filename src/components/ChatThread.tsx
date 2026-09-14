import { Bot } from "lucide-react";
import type { Conversation } from "../../shared/workspace";

export function ChatThread({ conversation, projectName }: { conversation?: Conversation; projectName?: string }) {
  if (!conversation || conversation.messages.length === 0) {
    return (
      <div className="chat-empty">
        <span className="chat-mark" aria-hidden="true"><Bot size={36} /></span>
        <h1>新会话</h1>
        <p>当前项目：{projectName ?? "未选择"}</p>
        <p>在下方告诉 Hermes 要做什么，它会把任务交给 Pi 或 Codex。</p>
      </div>
    );
  }
  return (
    <div className="chat-thread">
      {conversation.messages.map((message) => (
        <article className={`chat-bubble ${message.role}`} key={message.id}>
          <span>{message.role === "user" ? "你" : "Hermes"}</span>
          <p>{message.text}</p>
        </article>
      ))}
    </div>
  );
}
