# Digital Canvas

A free, open-source design editor — everything you can make in Canva, with your designs stored as files **you** own (in your own Google Drive, a folder on your computer, or your browser).

- **Page editor**: social posts, business cards, A4 pages, posters, menus, presentations… one editor at any size.
- **WebAssembly renderer**: drawing is done by [CanvasKit](https://skia.org/docs/user/modules/canvaskit/) (Skia compiled to WASM), so the same engine can power native apps and headless export later.
- **Open file format**: one `.dcanvas` file per design — a zip with `document.json` (plain, documented JSON) plus the images it uses. Easy for scripts and AI agents to read and write.
- **No lock-in backend**: the server only signs you in and keeps your Drive connection (via [IceBase](https://github.com/Panth977/icebase)). Your designs never pass through it.

> Status: **phase 1, milestone 3** — editor core, sign in with Google (designs saved in your Drive), text & fonts. Live: https://digital-canvas-p977.web.app (Google sign-in is in testing mode: invited test users only).

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
| `packages/render` | CanvasKit renderer: pages, shapes, text (Skia Paragraph), images, PNG/JPG export — no DOM, runs in Node too |
| `packages/storage` | `.dcanvas` pack/unpack and project stores: Google Drive (`drive.file`, one app folder), this browser (IndexedDB), a local folder (File System Access API) |
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
npm run deploy:web         # builds apps/web and uploads it to Firebase Hosting
```

## The `.dcanvas` file

```
mimetype         application/vnd.digital-canvas+zip
document.json    { format: "digital-canvas", version: 1, width, height, unit, pages: [...], assets: {...} }
assets/<hash>    image bytes, named by content hash (stored once)
thumbnail.png    preview of page 1
```

All lengths are CSS pixels (96 per inch); `unit` only says how sizes are shown. Elements are `shape`, `text` and `image`, each with `x, y, w, h, rotation, opacity`. See `packages/scene/src/types.ts`.

## Roadmap (phase 1: the page editor)

- [x] **M1** Scene format, CanvasKit renderer, editor core (select, move, resize, rotate, multi-select, undo, pages, layers, text editing, image upload, PNG/JPG download), browser + folder storage
- [x] **M2** Sign in with Google (IceBase backend) + Google Drive: connect once, every device sees your designs
- [ ] **M2.1** "Open with" from Drive, publish the OAuth app
- [x] **M3** Text & fonts: rich text (style part of a box), 2,000+ Google Fonts (via Fontsource, embedded in the file), font upload, 9 text effects, curved text, lists, gradient text
- [x] **Video (early)**: video clips, page durations, timeline playback, sounds, MP4 export (WebCodecs via [Mediabunny](https://mediabunny.dev), MPL-2.0)
- [ ] **M4** Image tools: crop, adjust, filters, shadows, effects, background remover
- [ ] **M5** Layout tools + ~200 presets: snapping, smart guides, rulers, bleed, groups, resize
- [ ] **M6** Elements + export: lines, connectors, draw, frames, grids, tables, charts, QR, icons, stock photos; PDF and SVG export

Later phases: presentations, whiteboards, video, data-bound designs (live menus), AI/MCP integration.

## License

[Apache-2.0](LICENSE). Bundled font: Inter (SIL Open Font License, `apps/web/public/fonts/OFL.txt`).
