/// <reference lib="webworker" />
/**
 * The device worker: the Digital Canvas MCP tools (packages/mcp, browser
 * platform) running in a Web Worker, so an AI's renders and exports never
 * block the editor. It works on the user's Google Drive with the token the
 * page lends it; the page (bridge.svelte.ts) talks to the mailbox.
 *
 *   page → worker   { type: 'call', id, tool, args } · { type: 'token', req, token?, error? }
 *   worker → page   { type: 'result', id, result } · { type: 'failed', id, error } · { type: 'token?', req, force }
 */
import CanvasKitInit from 'canvaskit-wasm/bin/full/canvaskit.js';
import wasmUrl from 'canvaskit-wasm/bin/full/canvaskit.wasm?url';
import { DEFAULT_EDITOR_URL, DriveWorkspace, HEARTBEAT_MS, MemoryAssetCache, ToolHost, browserPlatform, setPlatform, type TemplateEntry } from '@digital-canvas/mcp/browser';
import INDEX from '../../templates/index.json';

declare const self: DedicatedWorkerGlobalScope;

const templates = import.meta.glob<unknown>(['../../templates/*.json', '!../../templates/index.json'], { import: 'default' });
const base = new URL(import.meta.env.BASE_URL, self.location.origin).href;

setPlatform(browserPlatform({
  canvasKit: () => CanvasKitInit({ locateFile: () => new URL(wasmUrl, self.location.origin).href }),
  fontsBase: `${base}fonts/`,
  mockupsBase: `${base}mockups/`,
  templateAssetsBase: `${base}templates/assets/`,
  templateIndex: INDEX as TemplateEntry[],
  templateDoc: async (id) => {
    const load = templates[`../../templates/${id}.json`];
    if (!load) throw new Error(`no template ${id}`);
    return load();
  },
}));

let req = 0;
const waiting = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();

/** A Drive access token from the page (it refreshes through the backend). */
function token(force?: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const id = ++req;
    waiting.set(id, { resolve, reject });
    self.postMessage({ type: 'token?', req: id, force: !!force });
  });
}

let host: ToolHost | null = null;
// Links the agent hands out (open_in_editor) point at the hosted app, also from the native shells.
const editorUrl = import.meta.env.DEV ? self.location.origin : DEFAULT_EDITOR_URL;
// 'remote': URL imports may not reach private network addresses (an agent can't make this device poke the LAN).
// Dev builds allow them (the e2e test serves its media from 127.0.0.1).
// A smaller asset cache than the server's: this may be a phone.
const hostFor = () => (host ??= new ToolHost(new DriveWorkspace(token, undefined, new MemoryAssetCache(96 * 1024 * 1024)), { editorUrl, mode: import.meta.env.DEV ? 'local' : 'remote' }));

self.onmessage = async (e: MessageEvent) => {
  const m = e.data as { type: string; id?: string; tool?: string; args?: Record<string, unknown>; req?: number; token?: string; error?: string };
  if (m.type === 'token') {
    const w = waiting.get(m.req!);
    waiting.delete(m.req!);
    if (m.token) w?.resolve(m.token); else w?.reject(new Error(m.error ?? 'no Drive token'));
    return;
  }
  if (m.type === 'call') {
    try {
      const result = await hostFor().call(m.tool!, m.args ?? {});
      self.postMessage({ type: 'result', id: m.id, result });
    } catch (err) {
      self.postMessage({ type: 'failed', id: m.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
};

// The page's heartbeat clock: worker timers keep running when the browser throttles a background tab's timers.
setInterval(() => self.postMessage({ type: 'tick' }), HEARTBEAT_MS);
self.postMessage({ type: 'ready' });
