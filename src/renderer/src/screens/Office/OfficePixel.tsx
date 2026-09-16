/**
 * Office screen — pixel-office edition.
 *
 * Replaces the 3D office with the ported pixel office (MIT, `noya21th/996`).
 * See [[office-pixel]] for why the swap removes the off-screen render cost.
 *
 * Presentation boundary: this screen owns the AgentHub data (who exists, what
 * each one is doing) and the selection UI; `pixel/PixelOffice.tsx` owns the
 * canvas and the engine. The old 3D screen deliberately stays in the tree
 * while this one beds in — see the migration note in [[office-pixel]].
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Users } from "lucide-react";
import type { AgentActivitySnapshot } from "../../../../shared/agenthub";
import { useI18n } from "../../components/useI18n";
import PixelOffice from "./pixel/PixelOffice";

interface OfficeProps {
  profile?: string;
  visible?: boolean;
}

/** Poll cadence for journal-derived activity. */
const ACTIVITY_POLL_MS = 3000;

export default function OfficePixel({
  visible = true,
}: OfficeProps): React.JSX.Element {
  const { t } = useI18n();
  const [activity, setActivity] = useState<AgentActivitySnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    // Never stack polls: a slow journal read must not queue up behind itself.
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await window.hermesAPI.agenthubOfficeActivity();
      setActivity(next);
    } catch {
      // Transient IPC failure — keep the previous roster rather than blanking
      // the office; the next tick retries.
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    void load();
    const timer = window.setInterval(() => void load(), ACTIVITY_POLL_MS);
    return () => window.clearInterval(timer);
  }, [visible, load]);

  // Drop a selection whose agent disappeared from the roster.
  useEffect(() => {
    if (selectedId && !activity.some((a) => a.agentId === selectedId)) {
      setSelectedId(null);
    }
  }, [activity, selectedId]);

  const selected = useMemo(
    () => activity.find((a) => a.agentId === selectedId) ?? null,
    [activity, selectedId],
  );

  const onSelectAgent = useCallback((agentId: string | null) => {
    setSelectedId(agentId);
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        position: "relative",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>
            {t("office.title")}
          </span>
          <span style={{ fontSize: 12, opacity: 0.6 }}>
            {t("office.pixelSubtitle")}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              opacity: 0.75,
            }}
          >
            <Users size={15} />
            {t("office.agentCount", { count: activity.length })}
          </span>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            title={t("office.refresh")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid var(--border, rgba(0,0,0,0.12))",
              background: "transparent",
              // A native <button> doesn't inherit `color`; without this it
              // falls back to the UA default (black) and disappears on the
              // dark header.
              color: "var(--text-secondary)",
              cursor: loading ? "default" : "pointer",
              fontSize: 13,
            }}
          >
            <RefreshCw
              size={14}
              style={{
                animation: loading ? "spin 1s linear infinite" : undefined,
              }}
            />
            {t("office.refresh")}
          </button>
        </div>
      </header>

      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        {activity.length === 0 && !loading ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              fontSize: 13,
              opacity: 0.6,
            }}
          >
            {t("office.pixelNoAgents")}
          </div>
        ) : (
          <PixelOffice
            activity={activity}
            selectedAgentId={selectedId}
            onSelectAgent={onSelectAgent}
          />
        )}

        {/* Selected-agent detail: the journal's live tool is the whole point of
            this view, so it stays visible without hovering the canvas. */}
        {selected && (
          <div
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              minWidth: 200,
              maxWidth: 280,
              padding: "12px 14px",
              borderRadius: 10,
              border: "1px solid var(--border, rgba(0,0,0,0.12))",
              background: "var(--bg-elevated, rgba(20,20,24,0.92))",
              color: "var(--text-primary)",
              fontSize: 12,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 13 }}>
              {selected.agentId}
            </span>
            <span style={{ opacity: 0.75 }}>
              {selected.rawToolName ?? t("office.status_idle")}
            </span>
            {selected.failedCount > 0 && (
              <span style={{ color: "#ef4444" }}>
                {t("office.pixelFailures", { count: selected.failedCount })}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
