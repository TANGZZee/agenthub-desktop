/**
 * Build-time decoder for the pixel-office sprite assets.
 *
 * The upstream project (MIT, `noya21th/996`) decodes its PNG sprites on demand
 * inside a Vite **dev-server middleware**. That is fine for `vite dev` but does
 * not exist in a packaged Electron app, where the renderer is served from
 * `file://` and there is no Node HTTP middleware at all.
 *
 * So this script does the decoding at build time instead: it reads the PNGs
 * under `assets/pixel-office/`, converts them into the engine's `SpriteData`
 * format (2D arrays of `#RRGGBB`/`#RRGGBBAA`), and writes a single
 * `public/pixel-office/sprites.json` that the renderer fetches like any other
 * static asset. No runtime PNG decoding, no middleware, no Node in the
 * renderer.
 *
 * Run via `npm run build:pixel-office` (wired into the electron-vite build).
 */
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { PNG } from "pngjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const assetsDir = join(root, "assets", "pixel-office");
// Emitted into the source tree so Vite bundles it as a module. A `public/`
// file fetched over HTTP would work in `electron-vite dev` but NOT in a
// packaged app, where the renderer runs from `file://` and `fetch` is blocked
// by the browser security model.
const outFile = join(
  root,
  "src",
  "renderer",
  "src",
  "screens",
  "Office",
  "pixel",
  "generated",
  "sprites.json",
);

// ── Geometry (must match the engine's expectations) ──────────────
const CHAR_FRAME_W = 16;
const CHAR_FRAME_H = 32;
const CHAR_FRAMES_PER_ROW = 7;
const CHARACTER_DIRECTIONS = ["down", "up", "right"];
const FLOOR_TILE_SIZE = 16;
const WALL_PIECE_WIDTH = 16;
const WALL_PIECE_HEIGHT = 32;
const WALL_GRID_COLS = 4;
const WALL_BITMASK_COUNT = 16;
/** Alpha at/below this is treated as fully transparent. */
const PNG_ALPHA_THRESHOLD = 2;

function rgbaToHex(r, g, b, a) {
  if (a <= PNG_ALPHA_THRESHOLD) return "";
  const hex = (n) => n.toString(16).padStart(2, "0");
  const base = `#${hex(r)}${hex(g)}${hex(b)}`;
  return a >= 255 ? base : `${base}${hex(a)}`;
}

function readPng(path) {
  return PNG.sync.read(readFileSync(path));
}

function spriteFrom(png, width, height, offsetX = 0, offsetY = 0) {
  const sprite = [];
  for (let y = 0; y < height; y += 1) {
    const row = [];
    for (let x = 0; x < width; x += 1) {
      const idx = ((offsetY + y) * png.width + (offsetX + x)) * 4;
      row.push(
        rgbaToHex(png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]),
      );
    }
    sprite.push(row);
  }
  return sprite;
}

/** Character sheets: 3 direction rows × 7 frames of 16×32. */
function decodeCharacters() {
  const dir = join(assetsDir, "characters");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^char_\d+\.png$/i.test(f))
    .sort((a, b) => parseInt(a.match(/(\d+)/)[1], 10) - parseInt(b.match(/(\d+)/)[1], 10))
    .map((file) => {
      const png = readPng(join(dir, file));
      const out = { down: [], up: [], right: [] };
      CHARACTER_DIRECTIONS.forEach((dirName, dirIdx) => {
        const frames = [];
        for (let f = 0; f < CHAR_FRAMES_PER_ROW; f += 1) {
          frames.push(
            spriteFrom(png, CHAR_FRAME_W, CHAR_FRAME_H, f * CHAR_FRAME_W, dirIdx * CHAR_FRAME_H),
          );
        }
        out[dirName] = frames;
      });
      return out;
    });
}

/** Floor tiles: one 16×16 grayscale pattern per file. */
function decodeFloors() {
  const dir = join(assetsDir, "floors");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^floor_\d+\.png$/i.test(f))
    .sort((a, b) => parseInt(a.match(/(\d+)/)[1], 10) - parseInt(b.match(/(\d+)/)[1], 10))
    .map((file) => {
      const png = readPng(join(dir, file));
      return spriteFrom(png, FLOOR_TILE_SIZE, FLOOR_TILE_SIZE);
    });
}

/** Wall sheets: 4×4 grid of 16×32 auto-tile pieces → 16 bitmask sprites. */
function decodeWalls() {
  const dir = join(assetsDir, "walls");
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
  const sheets = [];
  for (const file of files) {
    const png = readPng(join(dir, file));
    const masks = [];
    for (let mask = 0; mask < WALL_BITMASK_COUNT; mask += 1) {
      const ox = (mask % WALL_GRID_COLS) * WALL_PIECE_WIDTH;
      const oy = Math.floor(mask / WALL_GRID_COLS) * WALL_PIECE_HEIGHT;
      masks.push(spriteFrom(png, WALL_PIECE_WIDTH, WALL_PIECE_HEIGHT, ox, oy));
    }
    sheets.push(masks);
  }
  return sheets;
}

/** Furniture sprites: each PNG is one sprite at its natural size. */
function decodeFurniture() {
  const dir = join(assetsDir, "furniture");
  if (!existsSync(dir)) return { sprites: {}, catalog: [] };
  const sprites = {};
  const catalog = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const groupDir = join(dir, entry.name);
    const manifestPath = join(groupDir, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      console.warn(`[pixel-office] skipping unreadable manifest: ${entry.name}`);
      continue;
    }
    const members = Array.isArray(manifest.members) ? manifest.members : [];
    // Manifests come in two shapes: `type: "group"` lists `members`, while
    // `type: "asset"` describes a single sprite inline and names its PNG after
    // the group id. Normalise both into the same member list.
    const resolved =
      members.length > 0
        ? members
        : manifest.type === "asset"
          ? [
              {
                id: manifest.id,
                file: `${manifest.id}.png`,
                width: manifest.width,
                height: manifest.height,
                footprintW: manifest.footprintW,
                footprintH: manifest.footprintH,
                orientation: manifest.orientation,
                state: manifest.state,
                mirrorSide: manifest.mirrorSide,
                animationGroup: manifest.animationGroup,
                frame: manifest.frame,
              },
            ]
          : [];

    for (const member of resolved) {
      if (!member?.file) continue;
      const filePath = join(groupDir, member.file);
      if (!existsSync(filePath)) continue;
      const png = readPng(filePath);
      // The engine looks sprites up by the member id.
      sprites[member.id] = spriteFrom(png, png.width, png.height);
      catalog.push({
        id: member.id,
        label: manifest.name ?? member.id,
        category: manifest.category ?? "misc",
        width: member.width ?? png.width,
        height: member.height ?? png.height,
        footprintW: member.footprintW ?? 1,
        footprintH: member.footprintH ?? 1,
        isDesk: (manifest.category ?? "") === "desks",
        groupId: manifest.type === "group" ? manifest.id : undefined,
        orientation: member.orientation,
        state: member.state,
        canPlaceOnSurfaces: manifest.canPlaceOnSurfaces ?? false,
        backgroundTiles: manifest.backgroundTiles ?? 0,
        canPlaceOnWalls: manifest.canPlaceOnWalls ?? false,
        mirrorSide: member.mirrorSide ?? false,
        rotationScheme: manifest.rotationScheme,
        animationGroup: member.animationGroup,
        frame: member.frame,
      });
    }
  }
  return { sprites, catalog };
}

/**
 * Crop the VOID border off a layout.
 *
 * The shipped layout reserves a large empty margin — its room starts at row 9
 * of 22 — because upstream's camera auto-fits a much larger viewport. Here the
 * canvas is sized by its container, so that margin renders as a band of dead
 * space with the office squeezed into one corner. Cropping to the occupied
 * bounds makes the office fill the view.
 *
 * Furniture is shifted by the same offset, so nothing moves relative to the
 * room.
 */
function trimVoidBounds(layout) {
  const VOID = 255;
  const { cols, rows, tiles } = layout;
  const furniture = layout.furniture ?? [];

  let minRow = rows;
  let maxRow = -1;
  let minCol = cols;
  let maxCol = -1;
  const note = (col, row) => {
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
    if (col < minCol) minCol = col;
    if (col > maxCol) maxCol = col;
  };

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (tiles[r * cols + c] !== VOID) note(c, r);
    }
  }
  for (const item of furniture) {
    note(item.col, item.row);
    note(item.col + 1, item.row + 1);
  }

  if (maxRow < 0 || maxCol < 0) return layout; // nothing placed
  const alreadyTight =
    minRow === 0 && minCol === 0 && maxRow === rows - 1 && maxCol === cols - 1;
  if (alreadyTight) return layout;

  const nextTiles = [];
  const hasColors = Array.isArray(layout.tileColors);
  const nextColors = hasColors ? [] : undefined;
  for (let r = minRow; r <= maxRow; r += 1) {
    for (let c = minCol; c <= maxCol; c += 1) {
      nextTiles.push(tiles[r * cols + c]);
      if (nextColors) nextColors.push(layout.tileColors[r * cols + c] ?? null);
    }
  }

  return {
    ...layout,
    cols: maxCol - minCol + 1,
    rows: maxRow - minRow + 1,
    tiles: nextTiles,
    ...(nextColors ? { tileColors: nextColors } : {}),
    furniture: furniture.map((item) => ({
      ...item,
      col: item.col - minCol,
      row: item.row - minRow,
    })),
  };
}

function main() {
  if (!existsSync(assetsDir)) {
    console.error(`[pixel-office] asset directory missing: ${assetsDir}`);
    process.exit(1);
  }

  const furniture = decodeFurniture();

  // The engine's `createDefaultLayout()` is only a bare room (walls + floor,
  // no furniture) — upstream ships the real office as a layout JSON that its
  // extension host loads at runtime. A packaged Electron app has no such host,
  // and without the layout there are no chairs, so no seats, and every agent
  // would wander instead of sitting at a desk. Bundle it with the sprites.
  const layoutCandidates = ["default-layout-1.json", "default-layout-2.json"];
  let layout = null;
  for (const name of layoutCandidates) {
    const candidate = join(assetsDir, name);
    if (!existsSync(candidate)) continue;
    try {
      layout = JSON.parse(readFileSync(candidate, "utf8"));
      break;
    } catch {
      console.warn(`[pixel-office] unreadable layout: ${name}`);
    }
  }

  if (layout) layout = trimVoidBounds(layout);

  const payload = {
    characters: decodeCharacters(),
    floors: decodeFloors(),
    walls: decodeWalls(),
    furniture: furniture.sprites,
    catalog: furniture.catalog,
    layout,
  };

  mkdirSync(dirname(outFile), { recursive: true });
  const json = JSON.stringify(payload);
  writeFileSync(outFile, json);

  // A content hash lets callers cache-bust without reading the whole file.
  const hash = createHash("sha256").update(json).digest("hex").slice(0, 12);
  writeFileSync(
    join(dirname(outFile), "sprites.meta.json"),
    JSON.stringify({ hash, bytes: json.length }, null, 2),
  );

  const kb = (json.length / 1024).toFixed(0);
  console.log(
    `[pixel-office] sprites.json ${kb} KB — ` +
      `${payload.characters.length} characters, ${payload.floors.length} floors, ` +
      `${payload.walls.length} wall sheets, ${payload.catalog.length} furniture, ` +
      `layout ${layout ? `${layout.cols}×${layout.rows} with ${layout.furniture?.length ?? 0} items` : "MISSING"}`,
  );
}

main();
