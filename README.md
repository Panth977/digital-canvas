# Digital Canvas

A free, open-source design editor — everything you can make in Canva, with your designs stored as files **you** own (in your own Google Drive, a folder on your computer, or your browser).

- **Page editor**: social posts, business cards, A4 pages, posters, menus, presentations… one editor at any size.
- **WebAssembly renderer**: drawing is done by [CanvasKit](https://skia.org/docs/user/modules/canvaskit/) (Skia compiled to WASM), so the same engine can power native apps and headless export later.
- **Open file format**: one `.dcanvas` file per design — a zip with `document.json` (plain, documented JSON) plus the images it uses. Easy for scripts and AI agents to read and write.
- **No lock-in backend**: the server only signs you in and keeps your Drive connection (via [IceBase](https://github.com/Panth977/icebase)). Your designs never pass through it.

> Status: **phase 1, milestone 1** — editor core. See the roadmap below.

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
| `packages/storage` | `.dcanvas` pack/unpack and project stores: this browser (IndexedDB), a local folder (File System Access API); Google Drive in M2 |
| `apps/web` | The editor (Svelte 5 + Vite) |
| `e2e` | Playwright tests |

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
- [ ] **M2** Sign in (IceBase) + Google Drive: connect once, every device sees your designs; "Open with" from Drive
- [ ] **M3** Text & fonts: rich text, Google Fonts, custom font upload, text effects, curved text
- [ ] **M4** Image tools: crop, adjust, filters, shadows, effects, background remover
- [ ] **M5** Layout tools + ~200 presets: snapping, smart guides, rulers, bleed, groups, resize
- [ ] **M6** Elements + export: lines, connectors, draw, frames, grids, tables, charts, QR, icons, stock photos; PDF and SVG export

Later phases: presentations, whiteboards, video, data-bound designs (live menus), AI/MCP integration.

## License

[Apache-2.0](LICENSE). Bundled font: Inter (SIL Open Font License, `apps/web/public/fonts/OFL.txt`).
