# Digital Canvas

A free, open-source design editor — everything you can make in Canva, with your designs stored as files **you** own (in your own Google Drive, a folder on your computer, or your browser).

- **Page editor**: social posts, business cards, A4 pages, posters, menus, presentations… one editor at any size.
- **WebAssembly renderer**: drawing is done by [CanvasKit](https://skia.org/docs/user/modules/canvaskit/) (Skia compiled to WASM), so the same engine can power native apps and headless export later.
- **Open file format**: one `.dcanvas` file per design — a zip with `document.json` (plain, documented JSON) plus the images it uses. Easy for scripts and AI agents to read and write.
- **No lock-in backend**: the server only signs you in and keeps your Drive connection (via [IceBase](https://github.com/Panth977/icebase)). Your designs never pass through it.

> Status: **phase 1, milestone 4** — editor core, sign in with Google (designs saved in your Drive), text & fonts, image tools. Live: https://digital-canvas-p977.web.app (Google sign-in is in testing mode: invited test users only).

## Run it

```sh
npm install
npm run dev          # http://localhost:5181
npm test             # unit tests (scene, renderer, file format)
npm run e2e          # Playwright tests against the dev server
npm run check        # TypeScript + svelte-check
```

Node 22+. The first `npm run e2e` may need `npx playwright install chromium`.

## Layout

| Path | What |
| --- | --- |
| `packages/scene` | The document format (`types.ts`), pure operations, geometry, undo history, presets, validation |
| `packages/render` | CanvasKit renderer: pages, shapes, text (Skia Paragraph), images with adjustments/filters/effects (colour matrices, SkSL), PNG/JPG, SVG and PDF (raster or vector) export — no DOM, runs in Node too |
| `packages/storage` | `.dcanvas` pack/unpack and project stores: Google Drive (`drive.file`, one app folder), this browser (IndexedDB), a local folder (File System Access API) |
| `packages/mcp` | MCP server for AI agents (Claude.ai connector at `https://digital-canvas-p977.web.app/mcp`, or `npx @digital-canvas/mcp`): design, see, critique and export posters and reels — see [its README](packages/mcp/README.md) |
| `backend` | IceBase config (schema, API, rules) and two Cloud Functions: `googleSignIn` (code → custom token, keeps the encrypted Drive refresh token) and `driveToken` |
| `tools` | `canva-import.ts` (Canva connector JSON → `.dcanvas`, for comparisons) and `render.ts` (render a page to PNG in Node) |
| `apps/web` | The editor (Svelte 5 + Vite) |
| `e2e` | Playwright tests |

## Backend and deploy

Firebase project `digital-canvas-p977` (IceBase in firebase mode). One Google popup (or redirect) signs you in **and** grants
`drive.file`; the `googleSignIn` function exchanges the code, stores the refresh token encrypted (AES-256-GCM, key in
Secret Manager `TOKEN_KEY`) and returns a Firebase custom token. Other devices only sign in; `driveToken` mints Drive
access tokens. Designs go browser ⇄ Drive directly and never touch the backend.

```sh
npm run deploy:functions   # bundles backend/functions and runs firebase deploy (secrets: GOOGLE_CLIENT_SECRET, TOKEN_KEY)
npm run deploy:rules       # Firestore rules + indexes from the IceBase schema
npm run deploy:web         # builds apps/web and uploads it to Firebase Hosting (also the /mcp, /oauth/** rewrites)
npm run deploy:mcp         # the MCP connector function (backend/mcp, own codebase)
```

## The `.dcanvas` file

```
mimetype         application/vnd.digital-canvas+zip
document.json    { format: "digital-canvas", version: 1, width, height, unit, pages: [...], assets: {...} }
assets/<hash>    image bytes, named by content hash (stored once)
thumbnail.png    preview of page 1
```

All lengths are CSS pixels (96 per inch); `unit` only says how sizes are shown. Elements are `shape`, `text`, `image` (a frame when it has a `mask`), `video`, `path` (vector graphics: drawings, icons, QR codes), `group`, `line`, `table` and `chart`, each with `x, y, w, h, rotation, opacity`. See `packages/scene/src/types.ts`.

## Roadmap (phase 1: the page editor)

- [x] **M1** Scene format, CanvasKit renderer, editor core (select, move, resize, rotate, multi-select, undo, pages, layers, text editing, image upload, PNG/JPG download), browser + folder storage
- [x] **M2** Sign in with Google (IceBase backend) + Google Drive: connect once, every device sees your designs
- [x] **M2.1** "Open with" from Drive (open .dcanvas files, New › Digital Canvas), OAuth app published; assets stored once in `Digital Canvas/assets/`, not inside each design
- [x] **M3** Text & fonts: rich text (style part of a box), 2,000+ Google Fonts (via Fontsource, embedded in the file), font upload, 9 text effects, curved text, lists, gradient text
- [x] **Video (early)**: video clips, page durations, timeline playback, sounds, MP4 export (WebCodecs via [Mediabunny](https://mediabunny.dev), MPL-2.0)
- [x] **M4** Image tools: crop mode, 11 adjustments, 12 filters with intensity, effects (shadow, glow, duotone, pixelate, outline), background remover in the browser ([MODNet](https://github.com/ZHKKKe/MODNet), Apache-2.0, via onnxruntime-web), set as page background, eyedropper — for images and video clips
- [x] **M5** Layout tools + 270+ presets: snapping and smart guides (edges, centres, equal spacing; Alt/⌘ to place freely), rulers with draggable guides, print bleed and safe margins, groups (⌘G / ⇧⌘G, double-click into a group), distribute and tidy up, aspect-ratio lock, searchable preset picker (social, video, presentations, documents, print, marketing, web and IAB ads), resize a copy to other sizes
- [x] **M6** Elements + export: lines & arrows, connectors that follow shapes, freehand draw (pen/marker/highlighter), 13 frames, 12 photo grids, tables, charts (column/bar/line/area/pie/donut), QR codes, icon search ([Iconify](https://iconify.design)), CC photo search ([Openverse](https://openverse.org)); SVG export and vector PDF (real text in embedded fonts)

- [x] **MCP**: connect Claude or any agent (`packages/mcp`): 42 tools to create, edit, look at, critique and export designs and video reels

Later phases: presentations, whiteboards, video, data-bound designs (live menus).

## License

[Apache-2.0](LICENSE). Bundled font: Inter (SIL Open Font License, `apps/web/public/fonts/OFL.txt`).
