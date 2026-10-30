# Digital Canvas — notes for agents

Open-source Canva alternative. Built on TaskManager ticket **ORCH-27** (ORCH board); progress and decisions live there.

## Decisions (Panth, 2026-10-26)

- Renderer: **CanvasKit** (Skia WASM). UI: **Svelte 5** + Vite + TypeScript. Licence: **Apache-2.0**.
- One **`.dcanvas` file per project** (zip). Projects go in an app folder, so a new project never asks for a path.
- Drive access: **`drive.file` only** (owner decision 2026-10-28: `drive.readonly` dropped, it caused Google's "unverified app" screens). The app sees its own folder plus files the user picks with **Google Picker** (Uploads → Google Drive) or opens with it. Never request another Drive scope (the only extra is `drive.install`, r12: lists the app under Drive's "Open with", no file access); `apps/web/test/drive-scope.test.ts` greps for it.
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

- `apps/web/src/editor/panels/UploadsPanel.svelte`, state in `lib/drivelib.svelte.ts`. `DriveBrowser` (`packages/storage/src/drivebrowse.ts`) only lists/downloads what drive.file allows (MCP search_drive, picked-file downloads).
- Google Drive tab = Google Picker (`lib/picker.ts`; views My Drive, Shared with me, Starred, Recent, Shared drives, Images, Videos, Audio; multi-select). Key `PICKER_API_KEY` + `GOOGLE_APP_ID` (project number) in `backend/google.ts`: API key "Digital Canvas Picker (browser)", Picker API only, referrers web.app/firebaseapp.com/localhost (override with `VITE_PICKER_API_KEY`). Picks are downloaded with progress and stored once in `assets/` with `appProperties.dcDrive=<Drive file id>`; "From Google Drive" = uploads with `driveFileId` (`packages/storage/src/picked.ts`, pure). A single pick is also placed on the page. The Capacitor app shows the system file picker instead (Google no longer renders Picker in embedded WebViews).
- Uploads = `Digital Canvas/assets` (`DriveStore.listAssets`). Files carry `appProperties.dcName` (original name). "Remove" sets `dcHidden=1` only: designs that use the asset still need the file.
- Drops from the panel onto the page are caught in the capture phase (`application/x-dc-library`), downloaded, then re-dispatched to the stage as an ordinary `{kind:'asset'}` drop, so Canvas.svelte needs no Drive code.
- IceBase callables reject unknown output fields: when a function's output gains a field, deploy web before functions.
- e2e: `e2e/fake-drive.ts` is an in-memory Drive behind `page.route`; `fakeSignIn()` sets `window.__account` (user, token). `e2e/fake-picker.ts` installs a fake `google.picker` (addInitScript) with an overlay; `respond(page, docs)` answers it.
## Rail modules (r3, 2026-10-27)

- Panels live in `apps/web/src/editor/panels/` (AI, Templates, Brand, Tools, Projects, Apps); shared look in `panels.css` (`dp-` classes).
- Templates: author in `tools/templates/library.ts` (loose docs, see `packages/scene/src/loose.ts`), then `npx tsx tools/templates/build.ts [id…]` writes `apps/web/src/templates/*.json` + `index.json` and `apps/web/public/templates/*.png`. Icons are baked in from Iconify (Fluent Emoji flat, Phosphor, MDI). `packages/render/test/templates.test.ts` checks every template.
- Brand Kit: `packages/storage/src/brand.ts`; every store implements `loadBrand/saveBrand` (Drive: `Digital Canvas/brand.json` with `appProperties.dcBrand=1`, logos in `assets/`).
- AI is bring-your-own-key on any provider (r10, below). "Design for me" asks for a loose doc and validates it with `designFromReply` → `parseDoc` (one retry with the error).
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
- Scene gained `ElementBase.timing` (captions; `animateAt` hides outside the window), `Page.transition` + `frameAt`/`transitionLayers`, `AudioClip.fadeIn/fadeOut`. The MCP exporter, the web MP4 export and the editor's live playback render all three (r9).
- Gradient `angle` is CSS (90 = left→right, 180 = top→bottom).
- Remote: `packages/mcp/src/remote` (OAuth 2.1 AS + stateless JSON `/mcp`), deployed by `npm run deploy:mcp` as functions `mcp` + `mcpExport` (codebase `mcp`, `backend/mcp`); hosting rewrites in `backend/icebase.config.ts`.
## Phone layout (r5-mobile, 2026-10-28)

- `< 768px` (`lib/mobile.svelte.ts`, `mobile.on`): `Editor.svelte` renders `editor/mobile/MobileEditor.svelte` (top bar, Canvas, `MobileToolbar`, `MobileSheet`). Desktop markup is untouched. The editor box follows `visualViewport` (`mobile.vh/top`) so the toolbar and edited text stay above the keyboard; Canvas keeps its zoom and calls `revealEditing()` on resize while editing.
- Sheets: `ui.panel` (rail sections via `PanelBody.svelte`, tool panels via `ToolPanels`) or `mobile.sheet` (small tools in `MobileTools.svelte`, Download/Resize/menu). On phones `ui.close()`/toggle go to `null`, not `lastRail`.
- Touch in Canvas: `touches` map → pinch (page spot under the midpoint stays put) and two-finger pan; one finger on empty space or an unselected element scrolls; a tap selects; long press (500 ms) opens `CanvasMenu` and eats the following click; double tap = dblclick; `TOUCH_HIT` 22 px handles. iOS keyboard: `focusKeyboard()` focuses a hidden textarea inside the tap, the rich editor then takes focus.
- e2e: `e2e/mobile.spec.ts` runs only in projects `iphone-15` and `pixel-8` (both Chromium; fingers are CDP `Input.dispatchTouchEvent`). The desktop `chromium` project ignores it.
## Design tabs (r7-tabs, 2026-10-28)

- `lib/tabs.svelte.ts` (state), `lib/tabmodel.ts` (pure: strip mode, reorder, cycle, close, eviction; `apps/web/test/tabmodel.test.ts`), `lib/TabStrip.svelte`, `lib/titlebar.svelte.ts` (WCO). The route is the truth: any `#/d/<id>` opens/focuses a tab (App effect → `tabs.ensure`), so Home, Projects, Drive "Open with" and deep links need no tab code. `router.go` updates `route` at once (quick Ctrl+Tab presses).
- Only the active Editor is mounted (background tabs never draw). Its `EditorState` stays in `tabs` sessions (≤ `MAX_LIVE` 8; older ones save + dispose, reload from the store when shown). Editor reuses `tabs.liveEditor()`; Canvas keeps zoom/pan in `session.view`, Editor keeps `ui.snapshot()`. Close/forget dispose; Home trash calls `tabs.forget` (no save back), Home rename of a live tab renames its editor.
- Svelte teardown reads state as it was before the change that unmounted it: teardown code uses `tabs.isOpen()` (a plain Set), not `tabs.list`.
- Strip: installed app with Window Controls Overlay (`display_override` in the manifest) → in the title bar (`--tb-x/y/w/h` in app.css = `env(titlebar-area-*)`, `-webkit-app-region: drag`, tabs/buttons no-drag); installed without WCO → thin bar always; browser tab → bar only with ≥ 2 designs; phones → none. e2e fakes WCO with `fakeWco()` (helpers.ts) since CDP's WCO emulation does not set env() in Playwright's Chromium.
- Keys (App, capture): ⌘T Home + create menu, ⌘W close, Ctrl+Tab / Ctrl+Shift+Tab (Home is a stop), ⌘1–8 / ⌘9 last. Browsers keep some of these for themselves in a normal tab; the installed app gets them. Dev global `window.__tabs`.
## Device bridge (r8-bridge, 2026-10-28)

- The remote MCP function is a relay: tool calls run on the user's device unless the user is on `DC_CLOUD_ALLOWLIST` (default ppanth977@gmail.com) and chose cloud (`users/{uid}.processing`, callable `aiSettings`). Code: `packages/mcp/src/bridge/` (routing, relay, codec, MemoryBridge, DeviceAgent/ToolHost); Firestore store `backend/mcp/src/bridge.ts`; schema `devices`, `bridgeJobs`, `bridgeParts` (TTL `expiresAt`) + rules.
- The tool core runs on a `Platform` (`packages/mcp/src/platform.ts`): no `node:*` outside `src/node/` (and `remote/`, `cli.ts`, `paths.ts`). Node code must import `src/node/index.ts` (or the package root) to set the Node platform. `loadTemplate` is async now.
- Web: `lib/bridge/bridgeUi.svelte.ts` (always loaded: toggle in localStorage `dc.bridge.enabled`, device id `dc.bridge.deviceId`, panel state), `bridge.svelte.ts` (lazy: DeviceAgent + worker RPC), `worker.ts` (module worker: browser platform + ToolHost on Drive; Vite `worker.format = 'es'`; not precached by the SW), `link-core.ts` (IceBase Firestore link), `AiDialog.svelte` (File › Settings › AI and devices, Help › Connect your AI, Home › AI), `BridgeIndicator.svelte`.
- Tests: `packages/mcp/test/bridge.test.ts` (routing, lifecycle, relayed calls), `npm run test:bridge-emu` (Firestore emulator + real rules + the web IceBase link), `e2e/bridge.spec.ts` (MCP client → relay in the test process → the page as device over HTTP (`__bridgeUi.testLink`), render_page PNG, reel MP4 by WebCodecs).
- Android: `BridgeKeepAlive` plugin + foreground service (specialUse). iOS: only while open.
## Video editor (r9-video, 2026-10-28)

- A video design (`isVideo`) switches the workspace to Canva's video mode: `Canvas.svelte` `videoMode` shows ONE scene (the current page; other pages are parked `FAR` away in `pageTop`, so draw/hit code is unchanged), no page headers / "Add page"; `Timeline.svelte` is the filmstrip timeline (scenes ∝ durations, playhead scrub, edge = duration, drag = reorder, scene menu, transition dots, element timing bar, sound lane with waveforms, zoom + collapse in `ui.timelineOpen/timelineZoom`). Non-video designs keep the page column.
- Live = export: while `player.live` (playing or `scrubbing`) the stage draws render `drawFrameAt` (animations, element timing, page transitions) — the same function the web MP4 export (`lib/mp4.ts` `frameSurface`/`ClipFrames`) and the MCP exporters (`drawAt`) use. Paused, the stage shows the editable design. `e2e/video-editor.spec.ts` compares a screenshot of the stage with `window.__dcExportFrame(t, W, H)` (the export path) at several times.
- The playhead stays inside the current scene (Timeline effect); `player.seek(t)` makes the scene at t current, `player.refresh()` re-fetches clip frames without moving the page. Keys (`lib/videokeys.ts`): Space play/pause, S split (`splitPage` in scene), ←/→ frame step when nothing is selected.
- Pure maths in `lib/timeline.ts` (tested in `apps/web/test/timeline.test.ts`); page thumbnails are one cache per editor (`ed.thumbs`, `lib/thumbs.svelte.ts`) shared by the Pages strip, grid view and filmstrip; waveforms `lib/waveform.ts`.

## AI providers (r10-ai, 2026-10-29)

- `apps/web/src/lib/ai/`: `types.ts` (Provider: chat / images / video / listModels / test), adapters `anthropic.ts`, `openai.ts` (Responses API, gpt-image, Sora jobs), `gemini.ts` (Interactions API `/v1beta/interactions` for text, images and Omni video; never send `Api-Revision`, it fails CORS preflight; Veo 3.1 preview was shut down 2026-10-22), `compat.ts` (OpenAI-compatible + OpenRouter), `kie.ts` (Market createTask/recordInfo jobs, base64 upload for image-to-video; errors are HTTP 200 + `code`), `registry.ts` (kinds, curated models, default model per task), `settings.svelte.ts` (localStorage `dc.ai.providers`, `dc.ai.key.<id>`, `dc.ai.defaults`, `dc.ai.models.<id>`; migrates `dc.anthropicKey`), `media.svelte.ts` (generate image/video jobs that outlive the panel; results → Uploads + `AssetMeta.ai`).
- `lib/ai.ts` = the features (Magic Write, Design for me, alt text) over `ask(task, …)`. A key goes only to its provider's host (unit tests `apps/web/test/ai-providers.test.ts` assert it; e2e `ai.spec.ts`, `ai-providers.spec.ts` watch every request).
- All provider APIs pass CORS from the browser (checked 2026-10-28: Anthropic with the direct-browser header, OpenAI, Gemini, OpenRouter, kie.ai + its file hosts, Groq, Together, Mistral, DeepSeek). Local Ollama/LM Studio need their CORS setting.
- MCP OAuth for non-Claude clients: loopback redirect URIs match on any port, RFC 8707 `resource` checked, lenient DCR (packages/mcp/src/remote/oauth.ts). Per-client steps: packages/mcp/README.md, apps/web/public/connect-ai.html.

## Share (r11-share, 2026-10-29)

- Share popover `editor/SharePopover.svelte` (top bar next to Download; phone: `mobile.sheet = 'share'`). Permissions client `packages/storage/src/share.ts` (`DriveSharing`: permissions.list/create/update/delete, `setLinkAccess` = `type: anyone` with `allowFileDiscovery: false`, `access()` = files.get owners/sharingUser/capabilities). Links `shareLink()`: `/d/<fileId>` (open), `/view/<fileId>` (public, no sign-in), `/template/<fileId>` (copy) on `SHARE_ORIGIN` (override `VITE_SHARE_ORIGIN`).
- Router has path routes besides the hash ones (`parseRoute`); `router.go` to a hash route from a path page rewrites the URL to `/#…`. Redirect sign-in keeps the path (`returnTo`).
- Assets for recipients: every Drive save writes `links.json` (asset id → Drive file id) into the `.dcanvas`. While a design is shared (`DriveStore.setShared`, from files.get `shared`), its own assets are made "anyone with the link: reader" and tagged `appProperties.dcPublic=1` (`publishAssets`, also on each save for new assets). Recipients read them with `readMedia` (`driveapi.ts`): OAuth first, then `?key=` on 401/403/404. Unsharing never un-publishes assets (other designs may share them).
- Recipient: `routes/SharedOpen.svelte` checks OAuth access, else "Shared with you: Open" → `pickSharedFile()` (Picker `DocsView.setFileIds`). `lib/shared.svelte.ts` `loadAccess` sets `ed.readOnly` when `!capabilities.canEdit`; `EditorState.readOnly` makes commit/save/select/edit no-ops and the UI hides side panel, context toolbar, page actions. Editors save back to the owner's file without copying the linked assets. Designs shared with you are remembered in localStorage `dc.sharedFiles` (doc id → file id).
- Public view `routes/PublicView.svelte` = `openPublicDesign()` (storage/public.ts) + a read-only EditorState on a MemoryStore + Canvas. Present = `editor/Present.svelte` (pages as PNGs, full screen; video pages show a still).
- **Console step:** the API key (`DRIVE_API_KEY` = Picker key, override `VITE_DRIVE_API_KEY`) must allow the Google Drive API. Checked 2026-10-29: the Picker key answers 403 "Requests to this API drive method … are blocked", so link-shared assets and /view fail in prod until Drive API is added to its API restrictions. Its referrer list also blocked `http://localhost:5221/`.
- e2e: `e2e/share.spec.ts`; `FakeDrive` has permissions, `noAccess` (drive.file not granted), `myRole`, API-key reads (`keyReads`, only files with an anyone permission).

## Sharing QA (r12-qa, 2026-10-29)

- Invite email: `inviteMessage()` (storage/share.ts) always puts `Open in Digital Canvas: <app>/d/<fileId>` before the sharer's note in Drive's `emailMessage` (Drive's own button goes to drive.google.com). The popover previews it and shows a Copy link / Send link hint after sending.
- Home "Shared with you" = `lib/sharedlist.svelte.ts` (localStorage `dc.sharedList`, per uid), fed by `KnownFiles.set(docId, fileId, info)` in `DriveStore.openFile` for files not owned by you. drive.file can't list "Shared with me": "Open a shared design" = `pickDesignFile(token, 'shared')` (picker.ts, `DESIGN_MIMES`), then the `/d/<id>` route. `SharedOpen` opens the Picker by itself after a sign-in started from its card (`dc.sharedAutoPick`).
- Drive "Open with"/"New": Cloud console Open/New URL = the site root; `openwith.svelte.ts` handles `?state=` (no extra routes). `drive.install` is in `GOOGLE_SCOPES`; accounts whose token lacks it get the Home banner "Show in Drive" once (`account.needsDriveInstall` / `addDriveInstall()` / `dismissDriveInstall`, localStorage `dc.driveInstall.<uid>`; `account.scope` comes from googleSignIn/driveToken). Drive's `userId` ≠ our `google:<sub>` → "Switch account" banner.
- Import: `prepareImport()` (storage/import.ts) fetches assets missing from the zip via `links.json` (own cache/assets first, then OAuth, then API key), new doc id on a clash or when anything came from someone else's Drive, no links in the copy. UI `lib/importdesign.svelte.ts` (progress card on Home, error toasts, `designAccept()` = no filter on phones, Home "From Drive" = Picker import).
- googleSignIn 403 (`permission-denied`) = the user unticked the Drive box on Google's granular consent screen; the app now says so.
- e2e two users: `FakeDrive.addUser(OWNER|RECIPIENT)`, `fakeSignIn(page, who, scope?)`; files with `owner` are per-caller (bearer token): visible only with a drive.file grant (`d.grant(email, id)`, i.e. Picker/Open with) and a permission, else 404; writes need writer. `d.calls`/`d.denied` record who did what. Cases: `e2e/qa-sharing.spec.ts` (titles start with QA-ids).
- QA doc: `tools/qa/sharing-cases.mjs` → `node tools/qa/build.mjs` writes `apps/web/public/qa/sharing.html`; `--results <playwright.json> --out <html>` writes a pass/fail report.

## Mockups (r13-ui, 2026-10-30)

- Format v1 (shared contract): `apps/web/public/mockups/index.json` + per mockup `base.jpg`, `uv-hi.png`, `uv-lo.png`, `shade.png`, `tint.png` (if `tint`), `thumb.jpg`. The library is generated elsewhere; never hand-edit it here. Test fixtures: `npx tsx tools/mockups/fixtures.ts` → `e2e/fixtures/mockups` (fx-poster, fx-mug cylinder wrap + tint, fx-billboard perspective).
- Compositor `packages/render/src/mockup.ts` (pure, also `@digital-canvas/render/mockup`): `prepareMockup(buffers, maxSide?)` once per mockup and size (small = 400 px box-filtered; print-area arrays are compact), `compositeMockup(prepared, designRgba, { aspect, color })` per design/colour. Bilinear sampling is alpha-weighted. Design cover-fitted to `aspect` (`mockupCrop`).
- Web: rail tab `mockups` (`editor/panels/MockupsPanel.svelte`, `MockupPreview.svelte`), state + worker client `lib/mockups/mockups.svelte.ts`, worker `lib/mockups/worker.ts` (decode with createImageBitmap `colorSpaceConversion: 'none'` + OffscreenCanvas). The page is rendered on the main thread (`ed.pageRgba`) and transferred once per edit (keys `grid` / `full`). Tiles render only in view (IntersectionObserver), 450 ms after an edit. "Add as new page" = `ed.addImagePage` (pages share the design size: the picture is fitted inside). The SW never precaches `mockups/`; thumbs are stale-while-revalidate.
- MCP: `list_mockups`, `render_mockup` (`packages/mcp/src/mockups.ts`, `tools/mockups.ts`). Files via `Platform.mockupFile` (Node: `DC_MOCKUPS_DIR` or local public/mockups, else `DC_MOCKUPS_URL`/the site with a disk cache in tmp; browser worker: the app's `/mockups/`). `list_mockups` runs in the relay.
- e2e: `routeMockups(page)` (`e2e/mockup-fixtures.ts`) serves the fixtures; route with the regex there, a `**/mockups/**` glob also catches the app's `src/lib/mockups` modules.
