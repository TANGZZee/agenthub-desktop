import { useEffect, useMemo, useState } from "react";
import { createConversation, createProject, type Conversation, type WorkspaceProject } from "../../shared/workspace";

const KEY = "agenthub.workspace.v2";

interface WorkspaceState {
  projects: WorkspaceProject[];
  conversations: Conversation[];
  currentId: string;
  currentProjectId: string;
}

function load(): WorkspaceState {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as WorkspaceState;
  } catch {
    /* ignore */
  }
  const project = createProject("Agent Hub Destop");
  const conversation = createConversation(project.id);
  return { projects: [project], conversations: [conversation], currentId: conversation.id, currentProjectId: project.id };
}

export function useWorkspace() {
  const [state, setState] = useState<WorkspaceState>(load);
  useEffect(() => {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  }, [state]);

  const current = state.conversations.find((item) => item.id === state.currentId) ?? state.conversations[0];
  const currentProject = state.projects.find((item) => item.id === state.currentProjectId) ?? state.projects[0];
  const projectConversations = useMemo(
    () => state.conversations.filter((item) => item.projectId === currentProject?.id),
    [state.conversations, currentProject?.id],
  );

  function newConversation() {
    const projectId = currentProject?.id ?? state.projects[0].id;
    const conversation = createConversation(projectId);
    setState((old) => ({ ...old, conversations: [conversation, ...old.conversations], currentId: conversation.id, currentProjectId: projectId }));
  }

  function selectConversation(id: string) {
    const conversation = state.conversations.find((item) => item.id === id);
    setState((old) => ({ ...old, currentId: id, currentProjectId: conversation?.projectId ?? old.currentProjectId }));
  }

  function selectProject(id: string) {
    const first = state.conversations.find((item) => item.projectId === id);
    setState((old) => ({ ...old, currentProjectId: id, ...(first ? { currentId: first.id } : {}) }));
  }

  function addMessage(role: "user" | "assistant", text: string) {
    const id = current?.id;
    if (!id) return;
    setState((old) => ({
      ...old,
      conversations: old.conversations.map((item) => {
        if (item.id !== id) return item;
        const title = item.messages.length === 0 && role === "user" ? text.slice(0, 24) : item.title;
        return {
          ...item,
          title,
          updatedAt: new Date().toISOString(),
          messages: [...item.messages, { id: `msg-${Date.now()}`, role, text, at: new Date().toISOString() }],
        };
      }),
    }));
  }

  function addProject() {
    const project = createProject("未命名项目");
    const conversation = createConversation(project.id);
    setState((old) => ({
      ...old,
      projects: [...old.projects, project],
      conversations: [conversation, ...old.conversations],
      currentProjectId: project.id,
      currentId: conversation.id,
    }));
  }

  return {
    ...state,
    current,
    currentProject,
    projectConversations,
    newConversation,
    selectConversation,
    selectProject,
    addMessage,
    addProject,
  };
}
