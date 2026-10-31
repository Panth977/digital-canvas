/// <reference lib="webworker" />
/** MP4 export and video frames for the desktop app's MCP server (browser platform, WebCodecs). */
import CanvasKitInit from 'canvaskit-wasm/bin/full/canvaskit.js';
import wasmUrl from 'canvaskit-wasm/bin/full/canvaskit.wasm?url';
import { browserPlatform, exportMp4Browser, setPlatform, videoFrameWebCodecs, type TemplateEntry } from '@digital-canvas/mcp/browser';
import { unpack } from '@digital-canvas/storage';

declare const self: DedicatedWorkerGlobalScope;
const base = `${self.location.origin}/`;

setPlatform(browserPlatform({
  canvasKit: () => CanvasKitInit({ locateFile: () => new URL(wasmUrl, self.location.origin).href }),
  fontsBase: `${base}fonts/`, mockupsBase: `${base}mockups/`, templateAssetsBase: `${base}templates/assets/`,
  templateIndex: [] as TemplateEntry[], templateDoc: async (id) => { throw new Error(`no template ${id}`); },
}));

self.onmessage = async (e: MessageEvent<{ id: number; op: string; args: { bytes: Uint8Array; opts?: object; at?: number } }>) => {
  const { id, op, args } = e.data;
  try {
    const value = op === 'video.export' ? await exportMp4Browser(unpack(args.bytes), args.opts) : await videoFrameWebCodecs(args.bytes, args.at ?? 0);
    self.postMessage({ id, value });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
