export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
}

export interface Conversation {
  id: string;
  title: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface WorkspaceProject {
  id: string;
  name: string;
}

export function createConversation(projectId: string, title = "新对话"): Conversation {
  const now = new Date().toISOString();
  return { id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, title, projectId, createdAt: now, updatedAt: now, messages: [] };
}

export function createProject(name: string): WorkspaceProject {
  return { id: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name };
}
