import { describe, expect, it } from "vitest";
import {
  DESKTOP_SLASH_COMMANDS,
  LOCAL_DESKTOP_SLASH_COMMANDS,
} from "./desktopCommands";
import {
  localizedSlashCategory,
  localizedSlashDescription,
  slashDescriptionKey,
  translateWithFallback,
} from "./localizeSlashCommand";
import { SLASH_COMMANDS } from "../slashCommands";

const mark: (key: string) => string = (key) => `translated:${key}`;

describe("slash command localization", () => {
  // @lat: [[localization#Slash command labels]]
  it("maps every in-repo slash command onto a translation key", () => {
    const catalog = [
      ...DESKTOP_SLASH_COMMANDS,
      ...LOCAL_DESKTOP_SLASH_COMMANDS,
      ...SLASH_COMMANDS,
    ];
    const missing = catalog
      .map((command) => command.name)
      .filter((name) => !slashDescriptionKey(name));
    expect(missing).toEqual([]);
    for (const command of catalog) {
      expect(localizedSlashDescription(command, mark)).toMatch(/^translated:/);
    }
  });

  it("falls back to the English source when no translator is provided", () => {
    expect(
      localizedSlashDescription({
        name: "settings",
        description: "Open Desktop settings",
      }),
    ).toBe("Open Desktop settings");
    expect(localizedSlashCategory("info")).toBe("Pages & settings");
    expect(localizedSlashCategory("Desktop")).toBe("Desktop");
  });

  it("keeps unknown backend descriptions unchanged", () => {
    expect(
      localizedSlashDescription(
        { name: "custom-plugin-cmd", description: "A plugin command" },
        mark,
      ),
    ).toBe("A plugin command");
  });

  it("uses the fallback when t echoes the key", () => {
    expect(translateWithFallback((key) => key, "chat.slash.help", "Help")).toBe(
      "Help",
    );
  });
});
