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

Digital Canvas only has per-file Drive access (`drive.file`): the agent sees the Digital Canvas folder and the files you picked in the app (**Uploads › Google Drive › Choose from Google Drive**). To give it more of your photos or videos, pick them there.

**Where the work runs.** With the remote connector, the tools run **on one of your own devices**: open Digital Canvas (browser, installed app or Android app) and turn on **File › Settings › AI and devices › Let AI use this device**. Our server is then only a relay (see [Device bridge](#device-bridge)). A few accounts on a server-side allowlist may instead choose **cloud processing**, where the tools run in our function as before.

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

On the first run a browser window opens so you can sign in with Google. Sign-in goes through the Digital Canvas server, so your computer never holds the Google client secret. The server keeps its own refresh token in `~/.config/digital-canvas/mcp-login.json` (mode 0600). `logout` and `status` do what they say.

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
| Assets & content | `list_assets` (Drive "Digital Canvas/assets"), `search_drive` (files the app may see: its folder plus files picked in the app; thumbnails), `import_from_drive`, `import_from_url`, `search_stock` (Openverse, Wikimedia Commons and NASA photos/video/audio; Iconify icons, graphics and stickers), `import_stock` (keeps the credit), `search_fonts` (about 2,000 Google Fonts, embedded on use) |
| Seeing | `render_page` (PNG image content; `show_ids` draws numbered outlines; `at` shows a moment of a video), `render_thumbnail_grid`, `check_design` |
| Video | `assemble_video` (clips/photos → pages, trims, per-clip text, transitions, music with fades, captions from a transcript, title and end cards), `set_audio` (add/update/remove; start, offset, volume, fades), `add_captions` (exact times or a transcript; captions can span page boundaries) |
| Export | `export_image` (PNG/JPG per page; links plus inline preview), `export_pdf` (vector, or raster at a DPI), `export_gif`, `export_video` (H.264/AAC MP4, runs as a job; returns the result when finished, else a `job_id`), `get_export` |
| Devices (remote connector) | `get_processing_mode` (device or cloud, device in use), `list_devices` (online/offline, which is chosen / in use), `use_device` (id, name or `auto`; stays chosen) |

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

- **Engine.** It uses the same document model (`@digital-canvas/scene`) and the same CanvasKit renderer (`@digital-canvas/render`) as the editor, in Node or in the browser (device bridge). Agents' pictures, exports and the editor are therefore pixel-identical.
- **Storage.** `@digital-canvas/storage`'s `DriveStore` keeps the layout the web app uses. Designs live in `Digital Canvas/`, shared assets in `Digital Canvas/assets/` (content-hash ids, stored once), and the brand kit in `brand.json`.
- **Video.** Frames come from scene `animateAt` (animations, element timing) and `frameAt` (page transitions). In Node, ffmpeg decodes the clips and mixes sound (trim, volume, fades); in a browser, WebCodecs (Mediabunny) does, with the mix in JS.
- **Remote.** The remote server (`./remote`) is framework-free Node HTTP:
  - OAuth 2.1 authorization server: DCR, PKCE S256, refresh rotation with reuse detection, and revocation.
  - The authorize step signs the user in with Google. The Drive refresh token is stored encrypted (AES-256-GCM) next to the web app's.
  - `/mcp` is stateless Streamable HTTP with JSON responses.
  - `/oauth/drive-token` serves local CLIs.
  - It is deployed as the Firebase function `mcp` (asia-south1, `minInstances: 0`). In cloud mode, long video exports go to the `mcpExport` task queue (see `backend/mcp`); in device mode it relays (see Device bridge).

## Device bridge

Claude's custom connectors talk to a URL, never peer to peer, so the remote server stays the MCP endpoint and becomes a thin **relay**; the work happens on the user's device. Code: `src/bridge/`.

```
Claude ──MCP──▶ /mcp (Cloud Function: OAuth, tool list, routing)
                  │ write job                     ▲ result (≤ 900 KB inline, else parts)
                  ▼                               │
        Firestore users/{uid}/bridgeJobs/{id} ◀── device (web app / PWA / Android app)
                                                  main thread: listens, heartbeats (users/{uid}/devices/{id})
                                                  Web Worker:  the same tools on the browser platform
```

- **Processing mode.** `users/{uid}.processing` is `'device' | 'cloud'`, set in the app (callable `aiSettings`). Cloud is allowed only for emails in `DC_CLOUD_ALLOWLIST` (default `ppanth977@gmail.com`); for everyone else the relay forces device, whatever is stored. Allowlisted users default to cloud and may pick device.
- **Routing** (`routing.ts`, pure): the chosen device (`users/{uid}.activeDevice`, set by `use_device` or the app) when it is online; else the only online device; else an error the agent can act on: *no device* (ask the user to open Digital Canvas and turn on "Let AI use this device") or *several devices* (ask the user which, then `use_device`). Online = enabled and a heartbeat in the last 60 s (server time).
- **Relay tools:** `get_processing_mode`, `list_devices`, `use_device` (always run in the relay). Catalogue tools that touch neither Drive nor the renderer (`list_size_presets`, `search_fonts`, `search_stock`, `list_templates` without a design) also stay in the relay. Every other call becomes a job.
- **Job lifecycle.** The relay writes `{device, tool, args, state: 'pending', expiresAt}` and watches it. The device marks it `running` at once (else after 20 s the relay reports that the device did not pick it up), runs the tool, and writes `done` with the result JSON, or `failed` with an error. Results over 900 KB (render_page PNGs, previews) are split into `parts/{n}` documents (Firestore's 1 MiB limit). Exports never travel this way: the device saves PNG/PDF/MP4 to the user's Drive and returns links. The relay deletes the job and its parts when it has the answer; a TTL policy on `expiresAt` (1 h) sweeps anything left. A call gives up after 240 s; while a job runs the relay checks every 30 s that the device is still online.
- **Security.** Devices sign in to Firebase with the custom token our `googleSignIn` function mints (`uid = google:<sub>`, the same uid the OAuth connector uses). Firestore rules let a user read and write only their own `devices`, read their own `bridgeJobs`, and only move a job forward (`pending → running → done | failed | cancelled`, result fields only); jobs are created and deleted by the relay (admin) alone. `lastSeen` must be the server's time.
- **Device side** (`device.ts`): `DeviceAgent` (registry + heartbeat + job queue, one job at a time) next to the mailbox; `ToolHost` (the tools over an in-memory MCP client, so arguments are validated as on a server) where the work happens. In the web app the agent is in `apps/web/src/lib/bridge/bridge.svelte.ts`, the tools in a module Web Worker (`worker.ts`), and the worker also drives the heartbeat (background tabs throttle page timers).
- **Platforms** (`src/platform.ts`): the tool core has no `node:*` imports. Node (`src/node/`): CanvasKit from node_modules, fonts and templates from disk, ffmpeg for frames and MP4, DNS checks for URL imports. Browser (`src/browser/`): CanvasKit WASM, WebCodecs through Mediabunny for clip frames and MP4 (H.264/AAC where available, else VP9/Opus), sound mixed in JS (no Web Audio, so it works in a worker).
- **Where devices can work.** Desktop browsers and the installed app: while the tab/window is open (a visible window answers fastest; background tabs are throttled but keep working). Android app: a foreground service with a notification keeps it running in the background while the toggle is on. iOS app and iOS Safari: only while Digital Canvas is open on screen (iOS suspends background apps; there is no equivalent of the Android service).

Package entry points: `@digital-canvas/mcp` (Node: sets the Node platform), `./core` (platform-neutral), `./browser` (core + browser platform + bridge), `./bridge`, `./remote`.

## Develop

```sh
npm start -w @digital-canvas/mcp -- --store folder /tmp/designs   # run from source (tsx)
npx vitest run packages/mcp                                        # tool + OAuth + bridge tests (no network)
npm run test:bridge-emu                                            # bridge mailbox + Firestore rules on the emulator
DC_PORT=5209 npx playwright test e2e/bridge.spec.ts                # MCP client → relay → a browser page as the device
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
| `DC_CLOUD_ALLOWLIST` | Functions only: emails allowed to process in the cloud (comma-separated; default `ppanth977@gmail.com`). Put it in `backend/mcp/.env` and `backend/functions/.env`; the deploy scripts copy them |
