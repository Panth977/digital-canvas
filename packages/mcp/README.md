# @digital-canvas/mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server for [Digital Canvas](https://digital-canvas-p977.web.app), the open-source Canva alternative. With it, Claude or any MCP agent can make posters, social graphics, carousels, thumbnails, slides and **video reels** from your own photos, clips and brand kit, and do the whole job:

1. **Find material.** Search your uploads, your Google Drive and free stock (photos, video, music, icons).
2. **Compose.** Start from a template or a blank size preset and add text, shapes, pictures, clips, icons, charts and QR codes.
3. **Look at the result.** `render_page` returns the page as an image.
4. **Critique it.** `check_design` measures overflow, contrast on the real pixels, cut-off and overlapping text, tiny fonts and Reels safe zones.
5. **Fix it, then export.** Export PNG/JPG/PDF/GIF/MP4 into your Drive.

Designs are ordinary `.dcanvas` files in your Drive, so you can open any of them in the editor and finish it by hand.

Licence: Apache-2.0.

## Connect

### Claude.ai (web, desktop app, phone): custom connector

1. Go to **Settings › Connectors › Add custom connector**.
2. Enter the URL `https://digital-canvas-p977.web.app/mcp` and click **Connect**.
3. Sign in with Google. The connector uses OAuth 2.1 with dynamic client registration and PKCE, so there is no key to paste.

To let the agent search your whole Drive (read-only) and not only the files Digital Canvas created, connect the whole Drive once in the app (**Uploads › Google Drive**). Clients that send `scope=drive.readonly` get asked for it directly.

### Claude Code

```sh
claude mcp add --transport http digital-canvas https://digital-canvas-p977.web.app/mcp   # remote
claude mcp add digital-canvas -- npx -y @digital-canvas/mcp                               # local (stdio)
```

### Claude Desktop (local)

```json
{
  "mcpServers": {
    "digital-canvas": { "command": "npx", "args": ["-y", "@digital-canvas/mcp"] }
  }
}
```

On the first run a browser window opens so you can sign in with Google. Sign-in goes through the Digital Canvas server, so your computer never holds the Google client secret. The server keeps its own refresh token in `~/.config/digital-canvas/mcp-login.json` (mode 0600). `npx @digital-canvas/mcp login --whole-drive` also asks for read-only access to your whole Drive. `logout` and `status` do what they say.

### Without a Google account

```sh
npx @digital-canvas/mcp --store folder ~/Designs
```

This keeps designs as `.dcanvas` files in the folder, uploads in `assets/` and exports in `Exports/`. The web editor can open the same folder (**Open › a folder on this computer**).

### Other agents

Any MCP client works:

- **stdio:** `npx @digital-canvas/mcp`
- **Streamable HTTP on localhost:** `npx @digital-canvas/mcp --http 8787`, then use `http://127.0.0.1:8787/mcp`
- **Remote:** the URL above. Discovery starts from the `401` and its `WWW-Authenticate: resource_metadata=…` header (RFC 9728 → RFC 8414 → RFC 7591).

### Video export and ffmpeg

MP4 export needs **ffmpeg**:

- Install it with `brew install ffmpeg` or `apt install ffmpeg`, or run `npm i -g ffmpeg-static`.
- You can also point `DC_FFMPEG` at a binary.
- ffmpeg is not bundled because its binaries are GPL. The hosted connector has its own copy.

Everything else (rendering, PDF, GIF) is pure WebAssembly ([CanvasKit](https://skia.org/docs/user/modules/canvaskit/)).

## Tools

| Group | Tools |
| --- | --- |
| Designs | `list_designs`, `open_design` (compact outline: pages, element ids, boxes, text, fonts, colours), `create_design` (preset or w×h, optional template; video presets start timed), `duplicate_design`, `rename_design`, `resize_design` (Magic-Resize-style copy to another size), `delete_design` (to the Drive bin), `open_in_editor`, `list_size_presets` (270+ sizes) |
| Editing | `add_elements` (batch: text with any Google Font, effects and mixed runs; shapes and gradients; lines/arrows; images and videos by asset id, URL or Drive id with cover/contain fit, focus point, masks, filters, adjustments and effects; Iconify icons; QR codes; charts; tables; SVG paths; groups; animations; timing), `update_elements` (batch patches; text re-measures), `delete_elements`, `arrange_elements`, `align_elements` (align + distribute), `group_elements`, `add_page`, `duplicate_page`, `delete_page`, `move_page`, `set_page` (background colour/gradient or photo/video with tint, duration, transition, page animation, notes) |
| Templates & brand | `list_templates`, `apply_template` (scaled to the design, `replace_text` slots), `get_brand_kit`, `apply_brand` (brand colours replace accents, brand fonts by role, logo in a corner) |
| Assets & content | `list_assets` (Drive "Digital Canvas/assets"), `search_drive` (whole Drive with `drive.readonly`, else app files; folders, thumbnails), `import_from_drive`, `import_from_url`, `search_stock` (Openverse, Wikimedia Commons and NASA photos/video/audio; Iconify icons, graphics and stickers), `import_stock` (keeps the credit), `search_fonts` (about 2,000 Google Fonts, embedded on use) |
| Seeing | `render_page` (PNG image content; `show_ids` draws numbered outlines; `at` shows a moment of a video), `render_thumbnail_grid`, `check_design` |
| Video | `assemble_video` (clips/photos → pages, trims, per-clip text, transitions, music with fades, captions from a transcript, title and end cards), `set_audio` (add/update/remove; start, offset, volume, fades), `add_captions` (exact times or a transcript; captions can span page boundaries) |
| Export | `export_image` (PNG/JPG per page; links plus inline preview), `export_pdf` (vector, or raster at a DPI), `export_gif`, `export_video` (H.264/AAC MP4, runs as a job; returns the result when finished, else a `job_id`), `get_export` |

All exports are saved to **Google Drive › Digital Canvas › Exports** (or `Exports/` in a folder store) and come back as links (`resource_link`), plus an inline image where that makes sense.

Errors say what was wrong and how to call the tool instead. For example:

```
Error: no size preset "sqare"
How to fix: try one of: instagram-post, …
```

Unknown fields are reported back as warnings.

## Resources and prompts

**Resources:**

- `dcanvas://guide`: the design guide. It covers workflow, coordinates, sizes, type scales, font pairings, colour, filters, effects, video tips and the Reels safe zone.
- `dcanvas://templates`: the template catalogue.
- `dcanvas://template/{id}`: a template's outline, with element ids to use in `replace_text`.
- `dcanvas://design/{id}`: a design's full `document.json`.

**Prompts:**

- `make-poster`
- `make-reel-from-folder`
- `brand-social-pack`
- `improve-design`

Each prompt walks the agent through: gather assets → pick a template or layout → compose → render → critique → fix → export.

## How it works

- **Engine.** It uses the same document model (`@digital-canvas/scene`) and the same CanvasKit renderer (`@digital-canvas/render`) as the editor, running in Node. Agents' pictures, exports and the editor are therefore pixel-identical.
- **Storage.** `@digital-canvas/storage`'s `DriveStore` keeps the layout the web app uses. Designs live in `Digital Canvas/`, shared assets in `Digital Canvas/assets/` (content-hash ids, stored once), and the brand kit in `brand.json`.
- **Video.** Frames come from scene `animateAt` (animations, element timing) and `frameAt` (page transitions). ffmpeg decodes the clips and mixes sound (trim, volume, fades).
- **Remote.** The remote server (`./remote`) is framework-free Node HTTP:
  - OAuth 2.1 authorization server: DCR, PKCE S256, refresh rotation with reuse detection, and revocation.
  - The authorize step signs the user in with Google. The Drive refresh token is stored encrypted (AES-256-GCM) next to the web app's.
  - `/mcp` is stateless Streamable HTTP with JSON responses.
  - `/oauth/drive-token` serves local CLIs.
  - It is deployed as the Firebase function `mcp` (asia-south1, `minInstances: 0`). Long video exports go to the `mcpExport` task queue (see `backend/mcp`).

## Develop

```sh
npm start -w @digital-canvas/mcp -- --store folder /tmp/designs   # run from source (tsx)
npx vitest run packages/mcp                                        # tool + OAuth tests (no network)
npx tsx tools/mcp-demo.ts /tmp/out                                 # end-to-end demo over stdio
npm run build:mcp                                                  # bundle to packages/mcp/dist for npm
npm run deploy:mcp                                                 # Cloud Function (then npm run deploy:web for the /mcp rewrite)
```

Environment variables:

| Variable | Purpose |
| --- | --- |
| `DC_SERVER` | Sign-in server for the local CLI |
| `DC_CONFIG_DIR` | Where the login file is kept |
| `DC_FFMPEG` | Path to an ffmpeg binary |
| `DC_GOOGLE_ACCESS_TOKEN` | Use a raw Drive token, for testing |
| `DC_OFFLINE=1` | Turn off font downloads (tests) |
| `DC_FONTS_DIR` / `DC_TEMPLATES_DIR` | Override the bundled resources |
