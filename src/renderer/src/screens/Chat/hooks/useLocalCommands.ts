import { useCallback, useEffect, useMemo, useRef } from "react";
import { useI18n } from "../../../components/useI18n";
import { SLASH_COMMANDS } from "../slashCommands";
import {
  renderLocalizedSlashHelp,
  translateWithFallback,
} from "../slash/localizeSlashCommand";
import type { UsageState } from "../types";

interface UseLocalCommandsArgs {
  profile?: string;
  usage: UsageState | null;
  setFastMode: (next: boolean) => Promise<void>;
  onNewChat?: () => void;
  onClear: () => void;
  addAgentMessage: (content: string) => void;
}

interface UseLocalCommandsResult {
  /** Returns true if the text was handled locally and should not be sent to the backend. */
  executeLocal: (text: string) => Promise<boolean>;
  /** Synchronously checks whether a slash command would be handled locally. */
  isLocal: (text: string) => boolean;
}

function isLocallyHandled(text: string): boolean {
  if (!text.startsWith("/")) return false;
  const cmd = text.split(/\s+/)[0].toLowerCase();
  return SLASH_COMMANDS.some(
    (c) => c.name === cmd && (c.local || c.category === "info"),
  );
}

/**
 * Encapsulates slash commands that the desktop app handles without talking to
 * the agent. Captures `usage` via a ref so the returned callback stays stable
 * across streaming updates (avoids re-rendering memoized children).
 */
export function useLocalCommands({
  profile,
  usage,
  setFastMode,
  onNewChat,
  onClear,
  addAgentMessage,
}: UseLocalCommandsArgs): UseLocalCommandsResult {
  const { t } = useI18n();
  const usageRef = useRef(usage);
  useEffect(() => {
    usageRef.current = usage;
  });

  const executeLocal = useCallback(
    async (cmdText: string): Promise<boolean> => {
      const cmd = cmdText.trim().split(/\s+/)[0].toLowerCase();

      switch (cmd) {
        case "/new":
          onNewChat?.();
          return true;

        case "/clear":
          onClear();
          return true;

        case "/memory": {
          const mem = await window.hermesAPI.readMemory(profile);
          const lines: string[] = [
            `**${translateWithFallback(t, "chat.slash.memoryTitle", "Agent Memory")}**\n`,
          ];
          if (mem.memory.exists && mem.memory.content.trim()) {
            lines.push(mem.memory.content.trim());
          } else {
            lines.push(t("memory.noMemoryEntries"));
          }
          lines.push(
            `\n**${translateWithFallback(
              t,
              "chat.slash.memoryStats",
              `${mem.stats.totalSessions} sessions, ${mem.stats.totalMessages} messages`,
              {
                sessions: mem.stats.totalSessions,
                messages: mem.stats.totalMessages,
              },
            )}**`,
          );
          addAgentMessage(lines.join("\n"));
          return true;
        }

        case "/tools": {
          const tools = await window.hermesAPI.getToolsets(profile);
          if (!tools.length) {
            addAgentMessage(t("memory.noToolsetsFound"));
          } else {
            const rows = tools
              .map((tool) => {
                const state = translateWithFallback(
                  t,
                  tool.enabled
                    ? "chat.slash.toolEnabled"
                    : "chat.slash.toolDisabled",
                  tool.enabled ? "enabled" : "disabled",
                );
                return `- **${tool.label}** — ${tool.description} *(${state})*`;
              })
              .join("\n");
            addAgentMessage(
              `**${translateWithFallback(t, "chat.slash.toolsetsTitle", "Available Toolsets")}**\n\n${rows}`,
            );
          }
          return true;
        }

        case "/skills": {
          const skills = await window.hermesAPI.listInstalledSkills(profile);
          if (!skills.length) {
            addAgentMessage(
              translateWithFallback(
                t,
                "chat.slash.noSkills",
                "No skills installed.",
              ),
            );
          } else {
            const rows = skills
              .map((s) => `- **${s.name}** (${s.category}) — ${s.description}`)
              .join("\n");
            addAgentMessage(
              `**${translateWithFallback(t, "chat.slash.skillsTitle", "Installed Skills")}**\n\n${rows}`,
            );
          }
          return true;
        }

        case "/persona": {
          const soul = await window.hermesAPI.readSoul(profile);
          addAgentMessage(
            soul.trim()
              ? `**${translateWithFallback(t, "chat.slash.personaTitle", "Current Persona")}**\n\n${soul.trim()}`
              : `_${translateWithFallback(t, "chat.slash.noPersona", "No persona configured.")}_`,
          );
          return true;
        }

        case "/version": {
          const [hermesVer, appVer] = await Promise.all([
            window.hermesAPI.getHermesVersion(),
            window.hermesAPI.getAppVersion(),
          ]);
          const hermes =
            hermesVer ||
            translateWithFallback(t, "chat.slash.unknownVersion", "unknown");
          addAgentMessage(
            translateWithFallback(
              t,
              "chat.slash.versionSummary",
              `Hermes Agent: ${hermes}\nHermes One: v${appVer}`,
              { hermes, app: appVer },
            ),
          );
          return true;
        }

        case "/fast": {
          const current = await window.hermesAPI.getConfig(
            "agent.service_tier",
            profile,
          );
          const isOn = current === "fast" || current === "priority";
          const next = !isOn;
          await setFastMode(next);
          return true;
        }

        case "/usage": {
          const u = usageRef.current;
          if (u) {
            const lines = [
              `**${translateWithFallback(t, "chat.slash.usageTitle", "Token Usage")}**\n`,
              `- ${translateWithFallback(t, "chat.slash.usagePrompt", `Prompt: ${u.promptTokens.toLocaleString()} tokens`, { count: u.promptTokens.toLocaleString() })}`,
              `- ${translateWithFallback(t, "chat.slash.usageCompletion", `Completion: ${u.completionTokens.toLocaleString()} tokens`, { count: u.completionTokens.toLocaleString() })}`,
              `- ${translateWithFallback(t, "chat.slash.usageTotal", `Total: ${u.totalTokens.toLocaleString()} tokens`, { count: u.totalTokens.toLocaleString() })}`,
            ];
            if (u.cost != null) {
              lines.push(
                `- ${translateWithFallback(t, "chat.slash.usageCost", `Cost: $${u.cost.toFixed(4)}`, { amount: u.cost.toFixed(4) })}`,
              );
            }
            addAgentMessage(lines.join("\n"));
          } else {
            addAgentMessage(t("chat.noUsageData"));
          }
          return true;
        }

        case "/help": {
          addAgentMessage(renderLocalizedSlashHelp(SLASH_COMMANDS, t));
          return true;
        }

        default:
          return false;
      }
    },
    [profile, t, setFastMode, onNewChat, onClear, addAgentMessage],
  );

  return useMemo(
    () => ({ executeLocal, isLocal: isLocallyHandled }),
    [executeLocal],
  );
}
