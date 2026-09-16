/**
 * Pixel office canvas — the AgentHub-hosted replacement for the 3D office.
 *
 * The rendering engine is a port of the upstream pixel office (MIT,
 * `noya21th/996`); see `pixel/LICENSE-996.txt`. This component is the adapter
 * layer that upstream got from its VS Code extension messaging, rebuilt on
 * AgentHub's own sources:
 *
 *   - **who exists**   ← `agenthubOfficeActivity()` (catalog + worker roster)
 *   - **what they do** ← the same call's journal-derived tool activity
 *
 * Upstream coupled the canvas to a VS Code `postMessage` protocol and a
 * layout-editor mode; neither exists here, so this drives the engine directly
 * through its imperative `OfficeState` API and renders read-only.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { AgentActivitySnapshot } from "../../../../../shared/agenthub";
import type { CanonicalTool } from "../../../../../shared/agent-activity";
import { OfficeState } from "./engine/officeState";
import { startGameLoop } from "./engine/gameLoop";
import { renderFrame } from "./engine/renderer";
import { setTeamMode } from "./engine/npcManager";
import { ZOOM_MAX, ZOOM_MIN, TILE_SIZE } from "./constants";
import { ensurePixelOfficeAssets, bundledLayout } from "./assets";
import { engineToolFor } from "./toolBridge";

/**
 * Stable numeric id for an agent.
 *
 * The engine keys characters by number (`Map<number, Character>`) while
 * AgentHub ids are strings. Hashing keeps a given agent on the same character —
 * and therefore the same seat — across reconciles and restarts, which a
 * positional index would not.
 */
export function agentNumericId(agentId: string): number {
  let hash = 0;
  for (let i = 0; i < agentId.length; i += 1) {
    hash = (hash * 31 + agentId.charCodeAt(i)) | 0;
  }
  // Keep ids positive: the engine reserves negative ids for sub-agents.
  return (Math.abs(hash) % 1_000_000) + 1;
}

interface PixelOfficeProps {
  activity: AgentActivitySnapshot[];
  /** Whether the Office tab is the visible one. */
  selectedAgentId?: string | null;
  onSelectAgent?: (agentId: string | null) => void;
  statusFontSize?: number;
}

export default function PixelOffice({
  activity,
  selectedAgentId,
  onSelectAgent,
  statusFontSize,
}: PixelOfficeProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<OfficeState | null>(null);
  const offsetRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  /** Pan offset in device pixels, applied by the renderer. */
  const panRef = useRef({ x: 0, y: 0 });
  const activityRef = useRef(activity);

  useEffect(() => {
    activityRef.current = activity;
  }, [activity]);

  // Sprites must be installed before the first character is created, or the
  // engine caches fallback-looking sprites for every early agent. The bundle
  // is a bundled module, so this is synchronous.
  const assetsReady = useMemo(() => ensurePixelOfficeAssets().loaded, []);

  /**
   * Add/remove characters and push each agent's current animation.
   *
   * Called both from the loop and whenever the activity list changes, so a
   * roster change never waits for the next frame.
   */
  const reconcile = useCallback(() => {
    const state = stateRef.current;
    if (!state) return;
    const wanted = new Set(activityRef.current.map((a) => agentNumericId(a.agentId)));
    for (const ch of state.getCharacters()) {
      if (!wanted.has(ch.id)) state.removeAgent(ch.id);
    }
    const present = new Set(state.getCharacters().map((c) => c.id));
    for (const entry of activityRef.current) {
      const id = agentNumericId(entry.agentId);
      if (!present.has(id)) {
        // `skipSpawnEffect` keeps a poll-driven re-add from replaying the
        // spawn animation for an agent that never actually left.
        state.addAgent(id, undefined, undefined, undefined, true);
        present.add(id);
      }
      // `engineToolFor` translates the shared canonical vocabulary into the
      // engine's own names; a null (unmapped tool, or idle) leaves the
      // character resting rather than pretending to work.
      state.setAgentTool(
        id,
        engineToolFor(entry.currentTool as CanonicalTool | null),
      );
    }
  }, []);

  useEffect(() => {
    if (!assetsReady) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // A fresh state per mount: the engine holds characters in a Map, so
    // reusing one across mounts would leak a previous session's roster in.
    // The bundled layout carries the desks and chairs; the engine's own
    // fallback is a bare room with no seats.
    const state = new OfficeState(bundledLayout() ?? undefined);
    stateRef.current = state;
    // Seeded so a render before the first resize still has a sane scale; the
    // resize handler immediately replaces it with the fit-to-viewport value.
    zoomRef.current = ZOOM_MIN;

    // Upstream seeds six decorative "coworker" NPCs that real agents take
    // over. Here every character must correspond to an actual AgentHub agent —
    // a decorative colleague would read as an agent that doesn't exist — so
    // team mode is off and the roster is the only source of characters.
    setTeamMode(false, state.characters, state.seats);

    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      // Fit the office to the viewport instead of using a fixed zoom.
      //
      // Upstream's default (`round(2 * devicePixelRatio)`) is tuned for a
      // webview panel; in this window it left the room occupying barely half
      // the canvas with dead space on every side.
      //
      // The fit value is then quantised to a whole number of device pixels per
      // *tile* (`TILE_SIZE` is 16). The renderer draws each tile at
      // `offsetX + col * TILE_SIZE * zoom` with image smoothing off, so a
      // fractional tile size lands tiles on non-integer coordinates and the
      // browser drops or duplicates pixel columns — which shows up as a dotted
      // seam grid across the floor. Snapping to 1/16 keeps every tile an exact
      // integer size and position while still filling the viewport.
      const layout = state.getLayout();
      const mapW = layout.cols * TILE_SIZE;
      const mapH = layout.rows * TILE_SIZE;
      if (mapW > 0 && mapH > 0) {
        // A small margin keeps the outer wall from touching the window edge.
        const fit = Math.min((w * dpr) / mapW, (h * dpr) / mapH) * 0.94;
        const quantised = Math.floor(fit * TILE_SIZE) / TILE_SIZE;
        zoomRef.current = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, quantised));
      }
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    reconcile();

    /** True while the office is actually on screen. */
    const isVisible = (): boolean =>
      canvas.isConnected && canvas.offsetParent !== null;

    const stop = startGameLoop(canvas, {
      update: (dt) => {
        // Time does not advance while the office is off-screen.
        if (!isVisible()) return;
        state.update(dt);
      },
      render: (ctx) => {
        // Skip the paint too, not just the simulation. Upstream's loop renders
        // unconditionally, so a hidden office still redrew every sprite on
        // every frame — the same off-screen cost that made the 3D version
        // stutter, and the reason the tab-switch penalty survived the port.
        // Skipping leaves the canvas holding its last painted frame, so
        // switching back shows the office immediately rather than a blank.
        if (!isVisible()) return;
        const { offsetX, offsetY } = renderFrame(
          ctx,
          canvas.width,
          canvas.height,
          state.tileMap,
          state.furniture,
          state.getCharacters(),
          zoomRef.current,
          panRef.current.x,
          panRef.current.y,
          // Selection state drives only the outline; this office is read-only,
          // so hover/seat-reassignment visuals stay inert.
          {
            selectedAgentId: state.selectedAgentId,
            hoveredAgentId: null,
            hoveredTile: null,
            seats: state.seats,
            characters: state.characters,
          },
          undefined,
          state.getLayout().tileColors,
          state.getLayout().cols,
          state.getLayout().rows,
          statusFontSize,
        );
        offsetRef.current = { x: offsetX, y: offsetY };
      },
    });

    const onClick = (event: MouseEvent): void => {
      if (!onSelectAgent) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      // Canvas-space point, then into the engine's map space.
      const x = (event.clientX - rect.left) * dpr - offsetRef.current.x;
      const y = (event.clientY - rect.top) * dpr - offsetRef.current.y;
      const hit = state.getCharacterAt(x, y);
      const match = activityRef.current.find(
        (a) => agentNumericId(a.agentId) === hit,
      );
      onSelectAgent(match ? match.agentId : null);
    };
    canvas.addEventListener("click", onClick);

    // Wheel zoom + drag pan. The auto-fit above picks a sensible starting
    // scale, but the room is dense (monitors and nameplates are a few pixels
    // tall at fit scale), so the user needs to zoom in to read it.
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      const next = zoomRef.current * factor;
      zoomRef.current = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onPointerDown = (event: PointerEvent): void => {
      // Middle button, or left button with the picker's modifier, pans. Plain
      // left-click stays selection.
      if (event.button !== 1) return;
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent): void => {
      if (!dragging) return;
      const dpr = window.devicePixelRatio || 1;
      panRef.current.x += (event.clientX - lastX) * dpr;
      panRef.current.y += (event.clientY - lastY) * dpr;
      lastX = event.clientX;
      lastY = event.clientY;
    };
    const onPointerUp = (event: PointerEvent): void => {
      dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    return () => {
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      observer.disconnect();
      stop();
      stateRef.current = null;
    };
  }, [assetsReady, onSelectAgent, statusFontSize, reconcile]);

  // Roster/activity changes apply immediately rather than waiting for a frame.
  useEffect(() => {
    activityRef.current = activity;
    reconcile();
  }, [activity, reconcile]);

  // Reflect the Office screen's selection onto the engine's own field, which
  // the renderer reads for the selection outline.
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    state.selectedAgentId =
      selectedAgentId != null ? agentNumericId(selectedAgentId) : null;
  }, [selectedAgentId]);

  return (
    // `absolute inset-0` fills the parent box, which the Office screen already
    // positions. A flow-layout root would instead size itself to its content:
    // a fresh <canvas> defaults to 300×150, so the office would lock at 150px
    // tall and the resize observer would only ever re-measure its own output.
    <div
      ref={containerRef}
      style={{ position: "absolute", inset: 0, overflow: "hidden" }}
    >
      <canvas ref={canvasRef} style={{ display: "block" }} />
    </div>
  );
}
