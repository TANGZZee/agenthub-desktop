import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("../useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: vi.fn(),
  }),
}));

// Records what the pane actually passes down to the health check.
const configHealthProfiles: Array<string | undefined> = [];
vi.mock("../../screens/Settings/ConfigHealth", () => ({
  ConfigHealth: ({ profile }: { profile?: string }) => {
    configHealthProfiles.push(profile);
    return null;
  },
}));

import AboutPane from "./AboutPane";
import { SettingsDataContext } from "./SettingsDataContext";
import type { SettingsData } from "./useSettingsData";

function settingsData(profile: string | undefined): SettingsData {
  return {
    profile,
    hermesHome: "/home/hermes",
    hermesVersion: "Hermes Agent v0.21.2",
    agentCapabilities: null,
    appVersion: "0.7.7",
    parsedVersion: { version: "0.21.2" },
    doctorOutput: null,
    doctorRunning: false,
    updating: false,
    updateResult: null,
    updateResultType: null,
    updateLog: "",
    autoUpgradeEnabled: true,
    autoUpgradeSaved: false,
    dumpOutput: null,
    dumpRunning: false,
    setDumpOutput: vi.fn(),
    setDumpRunning: vi.fn(),
    handleUpdateHermes: vi.fn(),
    handleDoctor: vi.fn(),
    handleAutoUpgradeChange: vi.fn(),
    desktopUpdateState: null,
    desktopUpdateVersion: null,
    desktopUpdatePercent: 0,
    desktopUpdateError: null,
    checkDesktopUpdate: vi.fn(),
    handleDesktopUpdate: vi.fn(),
  } as unknown as SettingsData;
}

function renderAbout(profile: string | undefined): void {
  render(
    (
      <SettingsDataContext.Provider value={settingsData(profile)}>
        <AboutPane />
      </SettingsDataContext.Provider>
    ) as ReactNode,
  );
}

afterEach(() => {
  cleanup();
  configHealthProfiles.length = 0;
});

describe("AboutPane config health", () => {
  // @lat: [[provider-setup#Config health is per-profile]]
  it("runs the health check against the active profile", () => {
    // Regression: the pane rendered `<ConfigHealth />` with no profile, so a
    // user on a named profile was audited against the *default* profile's
    // .env and saw a false "no API_SERVER_KEY" warning for a key their own
    // profile already had.
    renderAbout("gj");
    expect(configHealthProfiles).toContain("gj");
  });

  it("still allows the default profile", () => {
    renderAbout(undefined);
    expect(configHealthProfiles).toContain(undefined);
  });
});
