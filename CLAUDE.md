# Digital Canvas — notes for agents

Open-source Canva alternative. Built on TaskManager ticket **ORCH-27** (ORCH board); progress and decisions live there.

## Decisions (Panth, 2026-10-26)

- Renderer: **CanvasKit** (Skia WASM). UI: **Svelte 5** + Vite + TypeScript. Licence: **Apache-2.0**.
- One **`.dcanvas` file per project** (zip). Projects go in an app folder, so a new project never asks for a path.
- Drive access: **`drive.file`** at sign-in (app folder + Open with + Picker). **Optional `drive.readonly`** (owner ask, 2026-10-27): Uploads → Google Drive asks for it by incremental consent (`account.connectWholeDrive()`, `prompt=consent` + `include_granted_scopes`); the backend keeps the new refresh token and `googleSignIn`/`driveToken` return the granted `scope`.
- Backend: **IceBase in firebase mode** on Firebase project `digital-canvas-p977` (created 2026-10-26, Drive + Picker APIs enabled). Backend stores almost nothing: user, login count, Drive refresh token. Designs never touch it.
- Phase 1 = the page editor (M1–M6 in README). No sharing/invites in phase 1.
- Canva's AI tools are out of scope; our own AI comes later via the open scene format.

## Rules

- `packages/scene` stays pure (no DOM, no CanvasKit). Every document change is a pure function returning a new Doc.
- `packages/render` has no DOM; it must keep working in Node (unit tests render real PNGs).
- Editor changes go through `EditorState.commit()` so undo, redraw and autosave stay correct. Coalesce drags/sliders with a key, `seal()` on release.
- Before pushing: `npm run check && npm test && npm run e2e` all green.

## M2 notes (2026-10-26)

- OAuth web client `753251746130-766vmq…` (Google Auth Platform, testing mode, test user ppanth977@gmail.com). ID + secret in `.env.local` (gitignored); secret also in Secret Manager.
- Firestore `asia-south1`; functions `asia-south1`; Firebase Auth used only for custom tokens (`uid = google:<sub>`).
- `backend/scripts/deploy-functions.mjs` replaces `icebase deploy --only functions`: IceBase 0.4.7's buildFunctions reads `peerDependencies` the JSR npm build lacks. It also aliases `@panth977/icebase` → `@jsr/panth977__icebase` so the bundle holds one copy (two copies break `instanceof Firestore`).
- Dev-only globals: `window.__account`, `window.__library`, `window.__dc`.

## M6 notes (2026-10-27)

- Lines, tables and charts are drawn from `decompose()` pieces (`packages/scene/src/vector.ts`: SVG path strings + text boxes), so the renderer, SVG export and vector PDF share one layout. Add a new vector element the same way.
- Connector ends store `attach: { elementId, point }`; `EditorState.commit()` runs `followConnectors()` on every change.
- Vector PDF embeds whole font files: pdf-lib's `subset: true` drops glyphs of Inter. Text effects, curved text and gradients are drawn as an image of that element only.
- Openverse allows `page_size` ≤ 20 without a key; photos are searched with `license_type=commercial,modification`, and the credit is kept in the asset `name`.

## Uploads panel notes (2026-10-27)

- `apps/web/src/editor/panels/UploadsPanel.svelte`, state in `lib/drivelib.svelte.ts`. Drive browsing is `DriveBrowser` in `packages/storage/src/drivebrowse.ts` (pure `listParams` query builder; cached pages).
- Computers (Drive for desktop): there is no API for that tab. A computer is a folder you own with no `parents`; `DriveBrowser.computers()` scans your folders for those. A pasted folder link opens any folder the scan misses.
- Uploads = `Digital Canvas/assets` (`DriveStore.listAssets`). Files carry `appProperties.dcName` (original name). "Remove" sets `dcHidden=1` only: designs that use the asset still need the file.
- Drops from the panel onto the page are caught in the capture phase (`application/x-dc-library`), downloaded, then re-dispatched to the stage as an ordinary `{kind:'asset'}` drop, so Canvas.svelte needs no Drive code.
- IceBase callables reject unknown output fields: when a function's output gains a field, deploy web before functions.
- e2e: `e2e/fake-drive.ts` is an in-memory Drive behind `page.route`; `fakeSignIn()` sets `window.__account` (user, token, scopes).
## Rail modules (r3, 2026-10-27)

- Panels live in `apps/web/src/editor/panels/` (AI, Templates, Brand, Tools, Projects, Apps); shared look in `panels.css` (`dp-` classes).
- Templates: author in `tools/templates/library.ts` (loose docs, see `packages/scene/src/loose.ts`), then `npx tsx tools/templates/build.ts [id…]` writes `apps/web/src/templates/*.json` + `index.json` and `apps/web/public/templates/*.png`. Icons are baked in from Iconify (Fluent Emoji flat, Phosphor, MDI). `packages/render/test/templates.test.ts` checks every template.
- Brand Kit: `packages/storage/src/brand.ts`; every store implements `loadBrand/saveBrand` (Drive: `Digital Canvas/brand.json` with `appProperties.dcBrand=1`, logos in `assets/`).
- AI is bring-your-own-key: key in `localStorage['dc.anthropicKey']`, sent only to api.anthropic.com via `@anthropic-ai/sdk` (`dangerouslyAllowBrowser`), model `claude-sonnet-5-5`. "Design for me" asks for a loose doc and validates it with `designFromReply` → `parseDoc`.
- Eraser brush: `addStroke` with brush `eraser` removes drawings (`erasedBy`, scene/erase.ts) instead of drawing.
## Content panels (r3-content, 2026-10-27)

- Elements / Text / Photos / Videos / Audio panels live in `apps/web/src/editor/panels/`; sources in `apps/web/src/lib/content/` (Iconify, Openverse, Wikimedia Commons, NASA; all keyless + CORS). `search.ts` merges sources per kind; a failing or slow (>8 s) source drops out.
- Iconify rate-limits per IP: never load one SVG per tile. Use `loadIcons()` (batched `/<prefix>.json?icons=`) and data: URL thumbnails.
- Openverse anonymous API is slow/flaky at times; JSON answers are cached in localStorage (`dc.content.*`, 6 h).
- Panel drops go through `handlePanelDrop()` (one line in Canvas `onDrop`). Credits are kept as the asset `name` (`creditLine()`).
- e2e: `newDesign()` answers the content hosts with 503; tests that need results `page.route` them after it (see `e2e/content.spec.ts`).
## Viewport (r4-view, 2026-10-27)

- Canva's scroll model lives in `Canvas.svelte` (`panRange`/`clampPan`): page width fits → x centred and locked; wider → scrolls between the page edges ± 40 px. Vertically the column runs from 56 px above page 1 (its header) to 88 px below the last page ("Add page"); a shorter column is centred. Every pan goes through `clampPan()`.
- Zoom state and commands are in `lib/view.svelte.ts` (`view.zoom`, `view.mode` 'fit'|'fill'|null, `view.zoomTo/zoomIn/zoomOut/fit/goToPage`); the canvas registers itself as `view.port`. Fit/Fill re-fit on resize until the user zooms; otherwise a resize keeps the middle of the view still. Range 10–500 %; ⌘0 100 %, ⌥⌘0 fit, ⇧⌘0 fill.
- Right-click menu: `editor/CanvasMenu.svelte`. Dev global `window.__dcView.get()` → `{ panX, panY, zoom, vw, vh, range, mode }` (pan = screen position of page 1's top-left).
## MCP server (r5-mcp, 2026-10-28)

- `packages/mcp`: tools in `src/tools/*.ts`, all over a `Workspace` (`DriveWorkspace` | `FolderWorkspace`, `src/workspace.ts`); `Context` opens/edits/saves designs (embeds fonts, prunes assets, thumbnails). Element specs → scene via `build.ts` (loose reader + media/icons/QR). Tests: `packages/mcp/test` against a temp folder, `DC_OFFLINE=1`.
- Scene gained `ElementBase.timing` (captions; `animateAt` hides outside the window), `Page.transition` + `frameAt`/`transitionLayers`, `AudioClip.fadeIn/fadeOut`. The MCP exporter renders all three; the web player/MP4 export render timing but not yet transitions or audio fades.
- Gradient `angle` is CSS (90 = left→right, 180 = top→bottom).
- Remote: `packages/mcp/src/remote` (OAuth 2.1 AS + stateless JSON `/mcp`), deployed by `npm run deploy:mcp` as functions `mcp` + `mcpExport` (codebase `mcp`, `backend/mcp`); hosting rewrites in `backend/icebase.config.ts`.
