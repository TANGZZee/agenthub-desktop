/**
 * Loads the pre-decoded pixel-office sprite bundle.
 *
 * `scripts/build-pixel-office-assets.mjs` decodes the upstream PNGs at build
 * time into a single JSON payload that Vite bundles like any other module.
 * That build-time approach is deliberate: upstream (MIT, `noya21th/996`)
 * decodes PNGs in a Vite **dev-server middleware**, which does not exist in a
 * packaged Electron app, and a runtime `fetch` of a `public/` asset would fail
 * there too because the renderer runs from `file://`. Bundling the decoded
 * data sidesteps both — no Node, no PNG decoder, no network at runtime.
 *
 * Loading is best-effort: the engine ships built-in fallback sprites, so a
 * missing bundle degrades to placeholder graphics rather than a blank office.
 */
import { setCharacterTemplates } from "./sprites/spriteData";
import { setFloorSprites } from "./floorTiles";
import { setWallSprites } from "./wallTiles";
import { buildDynamicCatalog } from "./layout/furnitureCatalog";
import { deserializeLayout } from "./layout/layoutSerializer";
import type { OfficeLayout } from "./types";
import bundle from "./generated/sprites.json";

export interface PixelOfficeAssets {
  loaded: boolean;
  /** Present when loading failed, for diagnostics. */
  error?: string;
}

let applied = false;

/**
 * The bundled office layout.
 *
 * Upstream's engine falls back to a bare room (walls + floor, no furniture),
 * which has no chairs — so no seats — and every agent would wander instead of
 * sitting. The real layout ships alongside the sprites; `null` only if the
 * build-time export is missing, in which case callers fall back to the engine's
 * own minimal room.
 */
export function bundledLayout(): OfficeLayout | null {
  const raw = (bundle as { layout?: unknown }).layout;
  if (!raw) return null;
  // `deserializeLayout` validates the shape; a malformed payload yields null
  // rather than a half-built map.
  return deserializeLayout(JSON.stringify(raw));
}

/**
 * Install the sprite bundle into the engine's module-level stores.
 *
 * Idempotent: the stores are process-global, so re-applying on every mount
 * would pointlessly rebuild the sprite cache.
 */
export function ensurePixelOfficeAssets(): PixelOfficeAssets {
  if (applied) return { loaded: true };
  try {
    const data = bundle as {
      characters: unknown[];
      floors: unknown[];
      walls: unknown[][];
      furniture: Record<string, unknown>;
      catalog: unknown[];
    };

    if (Array.isArray(data.characters) && data.characters.length > 0) {
      // Structurally identical to what the decoder emitted; the cast bridges
      // the JSON module boundary.
      setCharacterTemplates(data.characters as never);
    }
    if (Array.isArray(data.floors) && data.floors.length > 0) {
      setFloorSprites(data.floors as never);
    }
    if (Array.isArray(data.walls) && data.walls.length > 0) {
      setWallSprites(data.walls as never);
    }
    if (data.catalog && data.furniture) {
      buildDynamicCatalog({
        catalog: data.catalog as never,
        sprites: data.furniture as never,
      });
    }
    applied = true;
    return { loaded: true };
  } catch (err) {
    return {
      loaded: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Test seam: forget that the bundle was applied (assets are process-global). */
export function resetPixelOfficeAssets(): void {
  applied = false;
}
