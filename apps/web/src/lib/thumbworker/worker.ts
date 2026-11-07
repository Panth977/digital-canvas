/// <reference lib="webworker" />
/**
 * Page pictures off the main thread: the autosave's thumbnail and the page
 * strip render here, on this worker's own CanvasKit, so a save never stalls
 * the canvas (ORCH-44). The page mirrors fonts and pictures to it once each.
 *
 *   page → worker  { type: 'font', family, bytes, subset?, weight, italic } · { type: 'image', id, bytes }
 *                  { type: 'render', id, doc, pageId, scale }
 *   worker → page  { type: 'done', id, bytes } · { type: 'failed', id, error }
 */
import CanvasKitInit from 'canvaskit-wasm/bin/full/canvaskit.js';
import wasmUrl from 'canvaskit-wasm/bin/full/canvaskit.wasm?url';
import { FontLibrary, Renderer } from '@digital-canvas/render';
import type { Doc } from '@digital-canvas/scene';

declare const self: DedicatedWorkerGlobalScope;

type Msg =
  | { type: 'font'; family: string; bytes: Uint8Array; subset?: string; weight: number; italic: boolean }
  | { type: 'image'; id: string; bytes: Uint8Array }
  | { type: 'render'; id: number; doc: Doc; pageId: string; scale: number };

const base = new URL(import.meta.env.BASE_URL, self.location.origin).href;
const ready = (async () => {
  const ck = await CanvasKitInit({ locateFile: () => new URL(wasmUrl, self.location.origin).href });
  const fonts = new FontLibrary(ck);
  await fonts.loadBundled(`${base}fonts/`);
  return new Renderer(ck, fonts);
})();

// messages are handled strictly in order: fonts and pictures land before the render that needs them
let queue: Promise<unknown> = Promise.resolve();
self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  queue = queue.then(async () => {
    const r = await ready;
    if (m.type === 'font') r.fonts.add(m.family, m.bytes, m.subset, { weight: m.weight, italic: m.italic });
    else if (m.type === 'image') r.setImage(m.id, m.bytes);
    else {
      try {
        const page = m.doc.pages.find((p) => p.id === m.pageId) ?? m.doc.pages[0]!;
        const bytes = r.exportPage(m.doc, page, { format: 'png', scale: m.scale, preview: true });
        self.postMessage({ type: 'done', id: m.id, bytes }, [bytes.buffer]);
      } catch (err) {
        self.postMessage({ type: 'failed', id: m.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }).catch((err) => { if (m.type === 'render') self.postMessage({ type: 'failed', id: m.id, error: String(err) }); });
};
