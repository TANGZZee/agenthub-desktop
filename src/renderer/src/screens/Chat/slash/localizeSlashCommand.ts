export type SlashTranslate = (
  key: string,
  options?: Record<string, unknown>,
) => string;

/**
 * In-repo slash commands keep English `description` as the source of truth
 * (tests assert those strings). The palette, `/help`, and error bubbles look
 * up a key by command name and fall back to that English text when the active
 * locale has no translation.
 */
const DESCRIPTION_KEYS: Record<string, string> = {
  settings: "chat.slash.settings",
  "explain-selection": "chat.slash.explainSelection",
  help: "chat.slash.help",
  model: "chat.slash.model",
  agents: "chat.slash.openAgents",
  office: "chat.slash.openOffice",
  discover: "chat.slash.openDiscover",
  providers: "chat.slash.openProviders",
  schedules: "chat.slash.openSchedules",
  kanban: "chat.slash.openKanban",
  workers: "chat.slash.openWorkers",
  gateway: "chat.slash.openGateway",
  new: "chat.slash.new",
  clear: "chat.slash.clear",
  persona: "chat.slash.persona",
  memory: "chat.slash.memory",
  tools: "chat.slash.tools",
  skills: "chat.slash.skills",
  version: "chat.slash.version",
  fast: "chat.slash.fast",
  usage: "chat.slash.usage",
  btw: "chat.commands.btw",
  approve: "chat.commands.approve",
  deny: "chat.commands.deny",
  status: "chat.commands.status",
  reset: "chat.commands.reset",
  compact: "chat.commands.compact",
  undo: "chat.commands.undo",
  retry: "chat.commands.retry",
  web: "chat.commands.web",
  image: "chat.commands.image",
  browse: "chat.commands.browse",
  code: "chat.commands.code",
  file: "chat.commands.file",
  shell: "chat.commands.shell",
  compress: "chat.commands.compress",
  debug: "chat.commands.debug",
  goal: "chat.commands.goal",
  learn: "chat.commands.learn",
  steer: "chat.commands.steer",
  queue: "chat.commands.queue",
  update: "chat.commands.update",
  "reload-skills": "chat.commands.reloadSkills",
  curator: "chat.commands.curator",
};

const CATEGORY_LABELS: Record<string, { key: string; fallback: string }> = {
  chat: { key: "chat.slash.categoryChat", fallback: "Chat" },
  info: { key: "chat.slash.categoryPages", fallback: "Pages & settings" },
  tools: { key: "chat.slash.categoryToolsSkills", fallback: "Tools & skills" },
  agent: { key: "chat.slash.categoryHermesAgent", fallback: "Hermes Agent" },
  Desktop: { key: "chat.slash.categoryDesktop", fallback: "Desktop" },
  Navigation: { key: "chat.slash.categoryNavigation", fallback: "Navigation" },
  "Hermes Agent": {
    key: "chat.slash.categoryHermesAgent",
    fallback: "Hermes Agent",
  },
};

export function slashCommandNameKey(name: string): string {
  return name.trim().replace(/^\//, "").toLowerCase();
}

export function slashDescriptionKey(name: string): string | undefined {
  return DESCRIPTION_KEYS[slashCommandNameKey(name)];
}

export function translateWithFallback(
  t: SlashTranslate | undefined,
  key: string,
  fallback: string,
  options?: Record<string, unknown>,
): string {
  if (!t) return fallback;
  const translated = t(key, options);
  return translated && translated !== key ? translated : fallback;
}

export function localizedSlashDescription(
  command: { name: string; description: string },
  t?: SlashTranslate,
): string {
  const key = slashDescriptionKey(command.name);
  if (!key) return command.description;
  return translateWithFallback(t, key, command.description);
}

export function localizedSlashCategory(
  category: string,
  t?: SlashTranslate,
): string {
  const mapping = CATEGORY_LABELS[category];
  if (!mapping) return category;
  return translateWithFallback(t, mapping.key, mapping.fallback);
}

export function slashHelpDisplayName(name: string): string {
  return name.startsWith("/") ? name : `/${name}`;
}

export function renderLocalizedSlashHelp(
  commands: Array<{ name: string; description: string; category: string }>,
  t?: SlashTranslate,
): string {
  const grouped = new Map<string, typeof commands>();
  for (const command of commands) {
    const category = localizedSlashCategory(command.category, t);
    const rows = grouped.get(category) ?? [];
    rows.push(command);
    grouped.set(category, rows);
  }
  const sections = Array.from(grouped.entries()).map(
    ([category, rows]) =>
      `**${category}**\n${rows
        .map(
          (command) =>
            `\`${slashHelpDisplayName(command.name)}\` — ${localizedSlashDescription(command, t)}`,
        )
        .join("\n")}`,
  );
  const title = translateWithFallback(
    t,
    "chat.availableCommands",
    "Available Commands",
  );
  return `**${title}**\n\n${sections.join("\n\n")}`;
}
