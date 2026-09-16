/**
 * Local type shim for the ported 996 office engine.
 *
 * Upstream (MIT, `noya21th/996`) imported this from `components/ui/types.ts`.
 * Only the color type is needed here — the editor/UI components that made up
 * the rest of that module are not ported — so this keeps the engine's import
 * graph self-contained under `pixel/`.
 */

/** HSBC color value used for colorizing sprites, floor tiles, walls, and furniture. */
export interface ColorValue {
  /** Hue: 0-360 in colorize mode, -180 to +180 in adjust mode */
  h: number;
  /** Saturation: 0-100 in colorize mode, -100 to +100 in adjust mode */
  s: number;
  /** Brightness -100 to 100 */
  b: number;
  /** Contrast -100 to 100 */
  c: number;
  /** When true, use Photoshop-style Colorize (grayscale → fixed HSL). Default: adjust mode. */
  colorize?: boolean;
}
