/**
 * The utility process: serves the app and MCP, keeps the folder store. CanvasKit
 * renders block whatever thread they run on, so this is not the main process:
 * an agent's render must never freeze the windows. Talks to main over
 * parentPort with { id, op, args } / { id, ok, value | error }.
 */
import { watch, type FSWatcher } from 'node:fs';
import { DriveWorkspace, FolderWorkspace, nodePlatform, setPlatform, type Workspace } from '@digital-canvas/mcp';
import { pack, type ProjectFile } from '@digital-canvas/storage';
import { folderApi, type FolderApi } from './folderops.ts';
import { startLocalServer, type LocalServer, type PickerSession } from './localserver.ts';

const port = (process as unknown as { parentPort: { postMessage(m: unknown): void; on(e: 'message', cb: (m: { data: never }) => void): void } }).parentPort;

let seq = 0;
const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
/** Ask the main process for something (Drive token, video and speech through the window). */
function ask<T>(op: string, args?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
    port.postMessage({ ask: id, op, args });
  });
}

// Video goes through the window's WebCodecs (Chromium's own H.264 and AAC): no ffmpeg in the app, so no GPL binary to ship.
setPlatform({
  ...nodePlatform,
  videoProblem: () => null,
  exportMp4: (file: ProjectFile, opts) => {
    const { onProgress: _p, ...rest } = opts;
    return ask<Uint8Array>('video.export', { bytes: pack(file), opts: rest });
  },
  videoFrame: (bytes: Uint8Array, at: number, mime?: string) => ask<Uint8Array | null>('video.frame', { bytes, at, mime }),
  // speech also runs in the window: its worker has WebGPU and the model cache
  speak: (text: string, o: { voice: string; speed: number }) => ask<{ pcm: Float32Array; rate: number }>('speech.say', { text, ...o }),
});

const state = { token: '', mcp: true, active: 'folder' as 'folder' | 'drive' };
let folder: FolderWorkspace | null = null;
let api: FolderApi | null = null;
let drive: DriveWorkspace | null = null;
let server: LocalServer | null = null;
let watchers: FSWatcher[] = [];
let debounce: NodeJS.Timeout | undefined;
const pickers = new Map<string, PickerSession | null>();

function setFolder(dir: string | null): void {
  for (const w of watchers) w.close();
  watchers = [];
  folder = dir ? new FolderWorkspace(dir) : null;
  api = folder ? folderApi(folder) : null;
  if (!dir) return;
  // Agents write here too (and so can Finder): the window refreshes from this.
  const changed = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => port.postMessage({ event: 'folder-changed' }), 250);
  };
  try {
    const w = watch(dir, changed);
    w.on('error', () => {});
    watchers.push(w);
  } catch (e) { console.error('[folder] not watched', e); }
}

const workspace = (): Workspace | null => (state.active === 'drive' ? drive : folder);

const needFolder = (): FolderApi => {
  if (!api) throw new Error('No folder chosen yet.');
  return api;
};

const ops: Record<string, (a: never) => unknown> = {
  async start(a: { root: string; preferredPort?: number; token: string; mcp: boolean; folder: string | null; active: 'folder' | 'drive'; driveConnected: boolean }) {
    Object.assign(state, { token: a.token, mcp: a.mcp, active: a.active });
    setFolder(a.folder);
    if (a.driveConnected) drive = new DriveWorkspace((force) => ask<string>('drive.token', { force }));
    server = await startLocalServer({
      root: a.root, ...(a.preferredPort ? { preferredPort: a.preferredPort } : {}), token: () => state.token, mcpEnabled: () => state.mcp, workspace,
      takePicker: (n) => { const s = pickers.get(n) ?? null; if (s) pickers.set(n, null); return s; },
      pickerDone: (n, result) => { if (pickers.has(n)) { pickers.delete(n); port.postMessage({ event: 'picker-done', nonce: n, result }); } },
    });
    return { port: server.port, url: server.url, fallbackUrl: server.fallbackUrl };
  },
  setFolder: (a: { dir: string }) => setFolder(a.dir),
  setActive: (a: { active: 'folder' | 'drive' }) => { state.active = a.active; },
  setDrive: (a: { connected: boolean }) => { drive = a.connected ? new DriveWorkspace((force) => ask<string>('drive.token', { force })) : null; },
  setMcp: (a: { on: boolean }) => { state.mcp = a.on; },
  setToken: (a: { token: string }) => { state.token = a.token; },
  pickerOpen: (a: { nonce: string; session: PickerSession }) => { pickers.set(a.nonce, a.session); },
  pickerClose: (a: { nonce: string }) => { pickers.delete(a.nonce); },
  'store.list': () => needFolder().list(),
  'store.read': (a: { id: string }) => needFolder().read(a.id),
  'store.save': (a: { bytes: Uint8Array }) => needFolder().save(a.bytes),
  'store.remove': (a: { id: string }) => needFolder().remove(a.id),
  'store.restore': (a: { id: string }) => needFolder().restore(a.id),
  'store.listAssets': () => needFolder().listAssets(),
  'store.getAsset': (a: { id: string }) => needFolder().getAsset(a.id),
  'store.addAsset': (a: { bytes: Uint8Array; mime: string; name?: string }) => needFolder().addAsset(a.bytes, a.mime, a.name),
  'store.hideAsset': (a: { id: string }) => needFolder().hideAsset(a.id),
  'store.loadBrand': () => needFolder().loadBrand(),
  'store.saveBrand': (a: { json: string; assets: [string, Uint8Array][] }) => needFolder().saveBrand(a.json, a.assets),
  'store.loadPlugins': () => needFolder().loadPlugins(),
  'store.savePlugins': (a: { json: string; assets: [string, Uint8Array][] }) => needFolder().savePlugins(a.json, a.assets),
  'store.pluginAsset': (a: { id: string }) => needFolder().pluginAsset(a.id),
  'store.readComments': (a: { id: string }) => needFolder().readComments(a.id),
  'store.writeComments': (a: { id: string; json: string }) => needFolder().writeComments(a.id, a.json),
};

port.on('message', (e: { data: never }) => {
  const m = e.data as { id?: number; op?: string; args?: unknown; answer?: number; ok?: boolean; value?: unknown; error?: string };
  if (m.answer !== undefined) {
    const w = waiting.get(m.answer);
    waiting.delete(m.answer);
    if (m.ok) w?.resolve(m.value); else w?.reject(new Error(m.error ?? 'failed'));
    return;
  }
  const fn = ops[m.op!];
  Promise.resolve().then(() => {
    if (!fn) throw new Error(`unknown op ${m.op}`);
    return fn(m.args as never);
  }).then((value) => port.postMessage({ id: m.id, ok: true, value }), (e: Error) => port.postMessage({ id: m.id, ok: false, error: e.message }));
});
port.postMessage({ event: 'up' });
