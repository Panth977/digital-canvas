/**
 * The browser platform (the device worker): CanvasKit WASM from a URL, the
 * fonts and templates the web app ships, WebCodecs for frames and MP4. Works
 * in a Web Worker (no DOM, no Web Audio).
 */
import type { CanvasKit } from 'canvaskit-wasm';
import type { Platform, TemplateEntry } from '../platform.ts';
import { fetchMockupFile } from '../mockupfetch.ts';
import { videoFrameWebCodecs } from './media.ts';
import { exportMp4Browser, webCodecsProblem } from './mp4.ts';

export interface BrowserPlatformOptions {
  /** e.g. () => CanvasKitInit({ locateFile: () => wasmUrl }) */
  canvasKit: () => Promise<CanvasKit>;
  /** Absolute URL of the folder with Inter-*.ttf (ends with /). */
  fontsBase: string;
  templateIndex: TemplateEntry[];
  templateDoc: (id: string) => Promise<unknown>;
  /** Absolute URL of the mockup library (ends with /), e.g. the app's own `/mockups/`. Default: the deployed site. */
  mockupsBase?: string;
}

export function browserPlatform(o: BrowserPlatformOptions): Platform {
  return {
    name: 'browser',
    canvasKit: o.canvasKit,
    loadBundledFonts: (fonts) => fonts.loadBundled(o.fontsBase),
    templateIndex: () => o.templateIndex,
    templateDoc: o.templateDoc,
    videoFrame: (bytes, at) => videoFrameWebCodecs(bytes, at),
    videoProblem: webCodecsProblem,
    exportMp4: exportMp4Browser,
    ...(o.mockupsBase ? { mockupFile: cachedFetch(o.mockupsBase) } : {}),
  };
}

/** Mockup files over HTTP, kept in memory (a few, the maps are big). */
function cachedFetch(base: string): (path: string) => Promise<Uint8Array> {
  const cache = new Map<string, Promise<Uint8Array>>();
  return (path) => {
    let hit = cache.get(path);
    if (!hit) {
      hit = fetchMockupFile(base, path);
      hit.catch(() => cache.delete(path));
      cache.set(path, hit);
      if (cache.size > 24) cache.delete(cache.keys().next().value!);
    }
    return hit;
  };
}
