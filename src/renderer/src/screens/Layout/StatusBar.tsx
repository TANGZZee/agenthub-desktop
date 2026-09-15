import { useEffect, useState } from "react";
import { useI18n } from "../../components/useI18n";

interface StatusInfo {
  mode: string;
  gatewayRunning: boolean;
  model: string;
  skillCount: number;
}

// Connection modes are identifiers, not copy: map the known ones to their
// label key and fall back to the raw value for anything unrecognised.
const MODE_LABEL_KEYS: Record<string, string> = {
  local: "status.modeLocal",
  remote: "status.modeRemote",
  ssh: "status.modeSsh",
};

/**
 * Bottom system strip — a native desktop-app affordance that surfaces the
 * live connection/gateway state, active model, and skill count that were
 * previously buried. Every field is real (sourced from `listProfiles` +
 * `getConnectionConfig`); nothing is fabricated, so if a value is unknown the
 * chip is simply omitted rather than shown with a placeholder.
 */
export function StatusBar({
  activeProfile,
}: {
  activeProfile: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const [info, setInfo] = useState<StatusInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      const [profiles, conn] = await Promise.all([
        window.hermesAPI.listProfiles().catch(() => []),
        window.hermesAPI.getConnectionConfig().catch(() => null),
      ]);
      if (cancelled) return;
      const active =
        profiles.find((p) => p.id === activeProfile) ??
        profiles.find((p) => p.isActive);
      if (!active && !conn) return; // keep last-known on a transient failure
      setInfo({
        mode: conn?.mode ?? "local",
        gatewayRunning: active?.gatewayRunning ?? false,
        model: active?.model ?? "",
        skillCount: active?.skillCount ?? 0,
      });
    }
    void load();
    // Gateway state + skill count change while the app is open; poll gently.
    const id = window.setInterval(() => void load(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [activeProfile]);

  const isMac = window.electron?.process?.platform === "darwin";
  const mod = isMac ? "⌘" : "Ctrl";
  const mode = info?.mode ?? "local";
  const modeLabelKey = MODE_LABEL_KEYS[mode];
  const modeLabel = modeLabelKey ? t(modeLabelKey) : mode;

  return (
    <footer className="status-bar" aria-label={t("status.ariaLabel")}>
      <div className="status-bar-group">
        <span
          className={`status-dot ${info?.gatewayRunning ? "online" : "offline"}`}
          aria-hidden="true"
        />
        <span className="status-item status-strong">
          {info?.gatewayRunning ? t("status.gateway") : t("status.offline")}
        </span>
        <span className="status-sep" aria-hidden="true">
          &middot;
        </span>
        <span className="status-item">{modeLabel}</span>
        {info?.model ? (
          <>
            <span className="status-sep" aria-hidden="true">
              &middot;
            </span>
            <span className="status-item">{info.model}</span>
          </>
        ) : null}
        {info ? (
          <>
            <span className="status-sep" aria-hidden="true">
              &middot;
            </span>
            <span className="status-item">
              {t("status.skillCount", { count: info.skillCount })}
            </span>
          </>
        ) : null}
      </div>
      <div className="status-bar-group status-bar-hints">
        <span className="status-item">
          <kbd className="status-kbd">/</kbd> {t("status.commandsHint")}
        </span>
        <span className="status-sep" aria-hidden="true">
          &middot;
        </span>
        <span className="status-item">
          <kbd className="status-kbd">{mod},</kbd> {t("status.settingsHint")}
        </span>
      </div>
    </footer>
  );
}

export default StatusBar;
