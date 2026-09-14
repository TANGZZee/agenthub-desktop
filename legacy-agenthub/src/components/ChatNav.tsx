import { useMemo, useState } from "react";
import { FolderClosed, FolderPlus, MessageSquarePlus, Search } from "lucide-react";
import type { Conversation, WorkspaceProject } from "../../shared/workspace";

interface ChatNavProps {
  projects: WorkspaceProject[];
  conversations: Conversation[];
  currentId?: string;
  currentProjectId?: string;
  onNew: () => void;
  onSelect: (id: string) => void;
  onSelectProject: (id: string) => void;
  onAddProject: () => void;
}

type NavTab = "chats" | "projects";

export function ChatNav({
  projects,
  conversations,
  currentId,
  currentProjectId,
  onNew,
  onSelect,
  onSelectProject,
  onAddProject,
}: ChatNavProps) {
  const [tab, setTab] = useState<NavTab>("projects");
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return conversations;
    return conversations.filter((item) => item.title.toLowerCase().includes(text));
  }, [conversations, query]);

  return (
    <aside className="chat-nav" aria-label="对话与项目">
      <button type="button" className="chat-new" onClick={onNew}>
        <MessageSquarePlus size={16} aria-hidden="true" />
        新建会话
      </button>
      <label className="chat-search">
        <Search size={14} aria-hidden="true" />
        <input value={query} placeholder="搜索会话" onChange={(event) => setQuery(event.currentTarget.value)} />
      </label>
      <div className="chat-tabs" role="tablist">
        <button type="button" className={tab === "chats" ? "active" : ""} onClick={() => setTab("chats")}>聊天</button>
        <button type="button" className={tab === "projects" ? "active" : ""} onClick={() => setTab("projects")}>项目</button>
      </div>

      {tab === "chats" ? (
        <div className="chat-nav-list">
          {filtered.map((conversation) => (
            <button type="button" key={conversation.id} className={`chat-conv ${conversation.id === currentId ? "active" : ""}`} onClick={() => onSelect(conversation.id)}>
              {conversation.title}
            </button>
          ))}
        </div>
      ) : (
        <div className="chat-nav-list">
          <div className="chat-nav-heading">
            <span>项目</span>
            <button type="button" className="icon-button" title="新建项目" onClick={onAddProject}><FolderPlus size={14} /></button>
          </div>
          {projects.map((project) => {
            const open = project.id === currentProjectId;
            const items = filtered.filter((item) => item.projectId === project.id);
            return (
              <div key={project.id} className="chat-folder">
                <button type="button" className={`chat-project ${open ? "active" : ""}`} onClick={() => onSelectProject(project.id)}>
                  <FolderClosed size={15} aria-hidden="true" />
                  <span>{project.name}</span>
                </button>
                {open && items.map((conversation) => (
                  <button type="button" key={conversation.id} className={`chat-conv nested ${conversation.id === currentId ? "active" : ""}`} onClick={() => onSelect(conversation.id)}>
                    {conversation.title}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
