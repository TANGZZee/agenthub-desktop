# Pixel Office

The Office tab renders your agents as pixel-art coworkers, using a port of the upstream 996 pixel office (MIT, `noya21th/996`; licence retained at `src/renderer/src/screens/Office/pixel/LICENSE-996.txt`). It replaces the previous 3D office.

The engine is a Canvas 2D sprite renderer, which is why the swap also removes the old office's off-screen cost: the 3D version kept a WebGL scene running behind every other tab.

## The 3D office is gone, not just bypassed

The previous 3D office was deleted outright rather than left dormant: 75 files and five rendering dependencies went with it.

Gone are its screen, the `office3d/` tree, the bank/showroom panels, and 12.6 MB of GLB models, along with `three`, `@react-three/fiber`, `@react-three/drei`, `troika-three-text` and `@types/three`. Leaving them in place would have kept shipping a dead WebGL stack and an obsolete second office. Removing them dropped `app.asar` from 200.7 MB to **89.4 MB** even though the GLBs were never bundled — the saving is the dependency tree (`three` alone is ~35 MB on disk). The full history is 7,869 MB → 200.7 MB (packaging excludes) → 89.4 MB (3D removal).

Two consequences worth recording:

- **The wallet backend IPC outlived its UI.** `getWalletPortfolio` / `provisionCloudWallet` existed for the bank teller panel. They remain a tested main-process capability with no renderer caller; see [[wallet-token-balances#Wallet Sync#Backend wallet actions]] for why they were kept rather than deleted.
- **`officeUrl.ts` went with it.** It built the remote office webview URL for the old screen and had no other consumer.

The pixel office does not implement the deleted interactions (bank teller, car showroom, walk mode, chat-commanded errands) — that was the deliberate scope of the replacement.

## Characters are agents, not profiles

Every character on screen is an AgentHub worker. The old office drew Hermes **profiles** and treated AgentHub workers as read-only scenery; here the worker layer is the subject, which matches what the screen is for — watching independent agents work.

Two sources are joined by [[src/main/agent-activity/index.ts#collectOfficeActivity]]:

- **Who exists** — the connected-worker roster (the Capabilities screen), which owns identity and display names.
- **What they are doing** — the CLI's JSONL journal, via [[agent-activity]].

The journal **adds** to the roster rather than replacing it. A working agent is often absent from the connected list (it can be configured in `config/agents.json` without ever being hooked up through the Capabilities screen), and showing an empty office while agents are demonstrably busy would be wrong. Journal-derived agents are only admitted while their journal is fresh, so a stopped agent disappears instead of lingering as a ghost.

Upstream seeds six decorative "coworker" NPCs that real agents take over. That is disabled ([[src/renderer/src/screens/Office/pixel/engine/npcManager.ts#setTeamMode]]) because a decorative colleague would read as an agent that does not exist.

## Sprite pipeline

PNG sprites are decoded at **build time**, not runtime.

Upstream decodes them in a Vite dev-server middleware, which does not exist in a packaged Electron app, and a runtime `fetch` of a `public/` asset would also fail because the renderer runs from `file://`. `scripts/build-pixel-office-assets.mjs` therefore decodes the PNGs into one JSON payload that Vite bundles like any other module — no PNG decoder, no Node, and no network at runtime.

The script also emits the furniture catalog from the per-directory `manifest.json` files, and **trims the layout's empty VOID border**. That last step matters visually: the shipped layout starts its room at row 9 of 22 because upstream's camera auto-fits a much larger viewport, so without trimming the office rendered as a small room in a band of dead space.

Regenerate with `npm run pixel-office:assets`, which `npm run build` already runs before `electron-vite build`.

## Viewport fitting and navigation

The zoom is computed to fit the room to the canvas rather than using upstream's fixed `round(2 * devicePixelRatio)` default, which left the office occupying barely half the viewport.

The fitted value is quantised to a whole number of device pixels per tile (1/16 steps). The renderer draws each tile at `col * TILE_SIZE * zoom` with image smoothing off, so a fractional tile size lands tiles on non-integer coordinates and the browser drops or duplicates pixel columns. Snapping keeps every tile an exact integer size while still filling the view — measured at 94% of the canvas width on a 833×685 viewport, up from ~77%.

Wheel zooms (clamped to the engine's `ZOOM_MIN`/`ZOOM_MAX`) and middle-drag pans, because the room is dense at fit scale and nameplates are only legible when zoomed in.

## The loop stops when the office is off-screen

Nothing is simulated *or painted* while the Office tab is hidden.

The ported loop is a plain `requestAnimationFrame` wrapper that redraws unconditionally, so a hidden office still re-rendered every sprite on every frame — the same off-screen cost that made the 3D version stutter, and the reason that penalty would have survived the port. [[src/renderer/src/screens/Office/pixel/PixelOffice.tsx]] therefore gates **both** callbacks on the canvas being connected and having an `offsetParent` (i.e. not `display: none`). The canvas keeps its last painted frame, so returning to the tab shows the office immediately instead of a blank surface.

## The canvas must fill a positioned parent

The canvas container is rendered as `position: absolute; inset: 0`, so it fills whatever box the Office pane provides.

A flow-layout root would size itself to its content instead. A fresh `<canvas>` defaults to 300×150, so the office locked at 150px tall and the resize observer only ever re-measured its own output.

## Animation mapping

The engine switches on its own tool names (`Read`/`Grep`/`Bash`/…) to choose between typing and reading animations, so those names must be translated at the boundary.

[[src/renderer/src/screens/Office/pixel/toolBridge.ts]] maps the shared canonical vocabulary from [[agent-activity]] onto them, keeping the shared layer free of one renderer's spelling so a future renderer can map the same canonical tools its own way. An unmapped tool (`other`) yields null and the character rests rather than inventing an animation.

## Testing

Two suites cover the seams most likely to fail silently, since the engine renders *something* even when asset loading fails:

- [[tests/pixel-office-integration.test.ts]] asserts the real bundle reached the engine (characters, floors, walls, catalog), that the layout produced **seats** — without them every agent wanders instead of sitting — that a roster agent is placed on one, and that no decorative coworkers appear.
- [[tests/pixel-office-adapter.test.ts]] pins agent-id hashing (stable, distinct, never in the engine's reserved negative sub-agent range) and the tool bridge (every mapping is a name the engine recognizes; unmapped tools rest).
