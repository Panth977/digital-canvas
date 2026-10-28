/**
 * The Node platform: CanvasKit from node_modules (or the wasm next to a
 * bundle), Inter and the templates from disk (src/paths.ts), ffmpeg for video
 * frames and MP4, DNS for URL-import checks.
 */
import { readFileSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { CanvasKit } from 'canvaskit-wasm';
import { canvasKitWasm, fontsDir, templatesDir } from '../paths.ts';
import type { Platform, TemplateEntry } from '../platform.ts';
import { ffmpeg, videoFrame } from './ffmpeg.ts';
import { exportMp4Ffmpeg } from './mp4.ts';

let index: TemplateEntry[] | null = null;

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
  lookup: async (host) => (await lookup(host, { all: true })).map((a) => a.address),
};
