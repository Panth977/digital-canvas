/**
 * The Node platform: CanvasKit from node_modules (or the wasm next to a
 * bundle), Inter and the templates from disk (src/paths.ts), ffmpeg for video
 * frames and MP4, DNS for URL-import checks.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { lookup } from 'node:dns/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { CanvasKit } from 'canvaskit-wasm';
import { canvasKitWasm, fontsDir, mockupsDir, templateAssetsDir, templatesDir } from '../paths.ts';
import { MOCKUPS_URL, fetchMockupFile } from '../mockupfetch.ts';
import type { Platform, TemplateEntry } from '../platform.ts';
import { ffmpeg, videoFrame } from './ffmpeg.ts';
import { exportMp4Ffmpeg } from './mp4.ts';

let index: TemplateEntry[] | null = null;

/**
 * Mockup files: a local library (DC_MOCKUPS_DIR or the web app's
 * public/mockups) when there is one, else the deployed site
 * (DC_MOCKUPS_URL) cached on disk (the index for an hour, the maps a day).
 */
async function mockupFile(path: string): Promise<Uint8Array> {
  const dir = mockupsDir();
  if (dir) return new Uint8Array(await readFile(join(dir, path)));
  const cache = join(process.env.DC_MOCKUPS_CACHE ?? join(tmpdir(), 'digital-canvas-mockups'), path);
  try {
    const st = statSync(cache);
    if (Date.now() - st.mtimeMs < (path === 'index.json' ? 3600_000 : 86_400_000)) return new Uint8Array(readFileSync(cache));
  } catch { /* not cached */ }
  const bytes = await fetchMockupFile(process.env.DC_MOCKUPS_URL ?? MOCKUPS_URL, path);
  try {
    mkdirSync(dirname(cache), { recursive: true });
    writeFileSync(cache, bytes);
  } catch { /* read-only disk: fine */ }
  return bytes;
}

export const nodePlatform: Platform = {
  name: 'node',
  get offline() { return !!process.env.DC_OFFLINE; },
  async canvasKit() {
    const require = createRequire(import.meta.url);
    const init = require('canvaskit-wasm/bin/full/canvaskit.js') as (opts?: { locateFile?: (f: string) => string }) => Promise<CanvasKit>;
    const wasm = canvasKitWasm();
    return init(wasm ? { locateFile: () => wasm } : undefined);
  },
  async loadBundledFonts(fonts) {
    const dir = fontsDir();
    await fonts.loadBundled('bundled:', async (u) => {
      const b = readFileSync(join(dir, u.slice('bundled:'.length)));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    });
  },
  templateIndex() {
    index ??= JSON.parse(readFileSync(join(templatesDir(), 'index.json'), 'utf8')) as TemplateEntry[];
    return index;
  },
  async templateDoc(id) {
    return JSON.parse(readFileSync(join(templatesDir(), `${id}.json`), 'utf8'));
  },
  videoFrame: (bytes, at) => videoFrame(bytes, at),
  videoProblem: () => (ffmpeg() ? null : 'video export needs ffmpeg on this machine: install it (macOS: brew install ffmpeg; Debian/Ubuntu: apt install ffmpeg) or run `npm i -g ffmpeg-static`, or set DC_FFMPEG=/path/to/ffmpeg'),
  exportMp4: (file, opts) => exportMp4Ffmpeg(file, opts),
  mockupFile,
  templateAsset: async (id) => {
    const dir = templateAssetsDir();
    if (dir) return new Uint8Array(await readFile(join(dir, id)));
    const r = await fetch(`${process.env.DC_TEMPLATE_ASSETS_URL ?? new URL('/templates/assets/', MOCKUPS_URL).href}${id}`);
    if (!r.ok) throw new Error(`template picture ${id}: HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  },
  lookup: async (host) => (await lookup(host, { all: true })).map((a) => a.address),
};
