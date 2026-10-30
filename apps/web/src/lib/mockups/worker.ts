/// <reference lib="webworker" />
/** Mockup compositing off the main thread: see engine.ts. Messages from client.ts. */
import { MockupEngine, type RenderRequest } from './engine.ts';
import type { Rgba } from '@digital-canvas/render/mockup';

declare const self: DedicatedWorkerGlobalScope;

type In =
  | { type: 'init'; base: string }
  | { type: 'design'; key: string; design: Rgba }
  | { type: 'render'; id: number; req: RenderRequest };

let engine: MockupEngine | null = null;

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  if (m.type === 'init') engine = new MockupEngine(m.base);
  else if (m.type === 'design') engine?.setDesign(m.key, m.design);
  else if (m.type === 'render') {
    try {
      if (!engine) throw new Error('not started');
      const r = await engine.render(m.req);
      self.postMessage({ id: m.id, ok: true, width: r.width, height: r.height, data: r.data, ms: r.ms }, [r.data.buffer]);
    } catch (err) {
      self.postMessage({ id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
};
