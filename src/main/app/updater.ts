import { app, ipcMain, type BrowserWindow } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import type { AppUpdater } from "electron-updater";
import { dirname, join } from "path";
import { updaterLogger } from "../updater-log";

interface UpdaterDeps {
  getMainWindow: () => BrowserWindow | null;
}

let autoUpdaterInstance: AppUpdater | null = null;
/** True once a check reported a release that can actually be downloaded. */
let hasPendingUpdate = false;

function updatePreferencesPath(): string {
  return join(app.getPath("userData"), "update-preferences.json");
}

function getAutoUpgradeEnabled(): boolean {
  const file = updatePreferencesPath();
  if (!existsSync(file)) {
    return true;
  }

  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as {
      autoUpgrade?: unknown;
    };
    return parsed.autoUpgrade !== false;
  } catch {
    return true;
  }
}

function setAutoUpgradeEnabled(enabled: boolean): void {
  const file = updatePreferencesPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ autoUpgrade: enabled }, null, 2)}\n`);
}

export function setupUpdater({ getMainWindow }: UpdaterDeps): void {
  /** Whether a network failure rather than a real update problem. */
  function isOfflineError(message: string): boolean {
    return /ERR_CONNECTION|ERR_NETWORK|ERR_INTERNET|ENOTFOUND|ETIMEDOUT|ECONNRESET|ERR_NAME_NOT_RESOLVED|net::/i.test(
      message,
    );
  }

  ipcMain.handle("get-app-version", () => app.getVersion());
  ipcMain.handle("get-auto-upgrade-enabled", () => getAutoUpgradeEnabled());
  ipcMain.handle("set-auto-upgrade-enabled", (_event, enabled: boolean) => {
    setAutoUpgradeEnabled(enabled);
    if (autoUpdaterInstance) {
      autoUpdaterInstance.autoDownload = enabled;
    }
    return true;
  });

  const isPortableBuild = !!process.env.PORTABLE_EXECUTABLE_DIR;
  if (!app.isPackaged || isPortableBuild) {
    autoUpdaterInstance = null;
    ipcMain.handle("check-for-updates", async () => null);
    ipcMain.handle("download-update", () => true);
    ipcMain.handle("install-update", () => {});
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { autoUpdater } = require("electron-updater") as {
    autoUpdater: AppUpdater;
  };

  autoUpdaterInstance = autoUpdater;
  autoUpdater.logger = updaterLogger;
  autoUpdater.autoDownload = getAutoUpgradeEnabled();
  autoUpdater.autoInstallOnAppQuit = true;
  // Set while a check has produced a downloadable release. `downloadUpdate`
  // throws "Please check update first" without it, and the UI used to retry a
  // download on every error, looping that message forever (see updater.log).
  hasPendingUpdate = false;

  autoUpdater.on("update-available", (info) => {
    hasPendingUpdate = true;
    getMainWindow()?.webContents.send("update-available", {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });
  autoUpdater.on("update-not-available", () => {
    hasPendingUpdate = false;
  });
  autoUpdater.on("download-progress", (progress) => {
    getMainWindow()?.webContents.send("update-download-progress", {
      percent: Math.round(progress.percent),
    });
  });
  autoUpdater.on("update-downloaded", () => {
    getMainWindow()?.webContents.send("update-downloaded");
  });
  autoUpdater.on("error", (err) => {
    hasPendingUpdate = false;
    // A blocked or offline network is normal here (and expected on networks
    // that cannot reach GitHub). It carries no update to offer, so it is logged
    // instead of surfacing a banner the user can only dismiss.
    if (isOfflineError(err.message)) {
      updaterLogger.warn(`Update check unreachable: ${err.message}`);
      return;
    }
    getMainWindow()?.webContents.send("update-error", err.message);
  });

  ipcMain.handle("check-for-updates", async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      const version = result?.updateInfo?.version || null;
      hasPendingUpdate = Boolean(
        version && version !== app.getVersion() && result?.updateInfo,
      );
      return version;
    } catch (err) {
      hasPendingUpdate = false;
      updaterLogger.warn(
        `Update check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  });
  ipcMain.handle("download-update", async () => {
    // Nothing to download (check failed, went offline, or already current):
    // report it without raising an error, so the UI can re-check instead of
    // retrying a download that can never succeed.
    if (!hasPendingUpdate) {
      updaterLogger.warn(
        "Download requested with no pending update; re-check needed.",
      );
      return false;
    }
    try {
      await autoUpdater.downloadUpdate();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      getMainWindow()?.webContents.send("update-error", message);
      return false;
    }
  });
  ipcMain.handle("install-update", () => {
    updaterLogger.info(
      "Restart requested by user — calling quitAndInstall(isSilent=false, isForceRunAfter=true)",
    );
    autoUpdater.quitAndInstall(false, true);
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5000);
}
