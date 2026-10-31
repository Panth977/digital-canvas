/**
 * Digital Canvas desktop: window, settings, folder choice, Drive connection.
 * The app itself is the shared web build, served by the utility process
 * (server-entry.ts) on http://digital-canvas.localhost:<port>.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow, app, dialog, ipcMain, session, shell, utilityProcess, type IpcMainInvokeEvent, type UtilityProcess } from 'electron';
import { DriveAuth } from './drive.ts';
import { clientConfigs } from './mcpconfig.ts';
import { isNewer } from './version.ts';

const RELEASES = 'https://github.com/Panth977/digital-canvas/releases/latest';
const RELEASES_API = 'https://api.github.com/repos/Panth977/digital-canvas/releases/latest';

app.setName('Digital Canvas');
if (process.env.DC_DESKTOP_USER_DATA) app.setPath('userData', process.env.DC_DESKTOP_USER_DATA);
if (!app.requestSingleInstanceLock()) app.exit(0);

interface Settings { folder: string | null; active: 'folder' | 'drive'; port?: number; mcp: boolean; mcpToken: string }

const settingsFile = () => join(app.getPath('userData'), 'settings.json');
let settings: Settings;
function loadSettings(): Settings {
  let s: Partial<Settings> = {};
  try { s = JSON.parse(readFileSync(settingsFile(), 'utf8')) as Partial<Settings>; } catch { /* first run */ }
  return { folder: s.folder ?? null, active: s.active === 'drive' ? 'drive' : 'folder', ...(s.port ? { port: s.port } : {}), mcp: s.mcp ?? true, mcpToken: s.mcpToken || newToken() };
}
function newToken(): string { return `dc_${randomBytes(32).toString('base64url')}`; }
function saveSettings(): void {
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify(settings, null, 1), { mode: 0o600 });
  try { chmodSync(settingsFile(), 0o600); } catch { /* Windows */ }
}

let win: BrowserWindow | null = null;
let server: UtilityProcess | null = null;
let local: { port: number; url: string; fallbackUrl: string } | null = null;
let drive: DriveAuth;
let update: { version: string; url: string } | null = null;
const blocked: string[] = [];

// ---- the utility process

let seq = 0;
const pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>();
function rpc<T>(op: string, args?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!server) return reject(new Error('The local server is not running.'));
    const id = ++seq;
    pending.set(id, { resolve: resolve as (v: never) => void, reject });
    server.postMessage({ id, op, args });
  });
}

const pickerWaits = new Map<string, (r: unknown) => void>();

function onServerMessage(m: { id?: number; ok?: boolean; value?: never; error?: string; event?: string; ask?: number; op?: string; args?: never; nonce?: string; result?: unknown }): void {
  if (m.id !== undefined) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    if (m.ok) p?.resolve(m.value as never); else p?.reject(new Error(m.error ?? 'failed'));
  } else if (m.ask !== undefined) {
    answerServer(m.op!, m.args).then(
      (value) => server?.postMessage({ answer: m.ask, ok: true, value }),
      (e: Error) => server?.postMessage({ answer: m.ask, ok: false, error: e.message }),
    );
  } else if (m.event === 'folder-changed') {
    win?.webContents.send('dc:changed');
  } else if (m.event === 'picker-done') {
    pickerWaits.get(m.nonce!)?.(m.result);
  }
}

async function answerServer(op: string, args?: { force?: boolean }): Promise<unknown> {
  if (op === 'drive.token') return drive.token(args?.force);
  if (op === 'video.export' || op === 'video.frame') return askWindow(op, args);
  throw new Error(`unknown request ${op}`);
}

// ---- asking the window (video runs on its WebCodecs)

const windowWaits = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
async function askWindow(op: string, args: unknown): Promise<unknown> {
  const w = await ensureWindow();
  return new Promise((resolve, reject) => {
    const id = ++seq;
    windowWaits.set(id, { resolve, reject });
    w.webContents.send('dc:request', { id, op, args });
  });
}

async function ensureWindow(): Promise<BrowserWindow> {
  if (win && !win.isDestroyed()) return win;
  return createWindow(false);
}

// ---- state for the page

function appState() {
  const url = local ? `${local.url}/mcp` : '';
  return {
    version: app.getVersion(), platform: process.platform, port: local?.port ?? 0, folder: settings.folder, defaultFolder: join(app.getPath('documents'), 'Digital Canvas'),
    active: settings.active,
    drive: { configured: drive.configured, connected: drive.connected, connecting: drive.connecting, persisted: drive.persisted, account: drive.account },
    mcp: {
      enabled: settings.mcp, url, fallbackUrl: local ? `${local.fallbackUrl}/mcp` : '', token: settings.mcpToken,
      configs: clientConfigs(url, settings.mcpToken),
    },
    update,
  };
}
const broadcast = () => win?.webContents.send('dc:state', appState());

// ---- what the page may do

/** A top-level frame of our window on our origin. A frame's URL is empty until its first load commits. */
function isOurs(e: IpcMainInvokeEvent | Electron.IpcMainEvent, loading = false): boolean {
  const f = e.senderFrame;
  if (!f || f.parent || !local || e.sender !== win?.webContents) return false;
  if (loading && !f.url) return true;
  try { return new URL(f.url).origin === local.url; } catch { return false; }
}

async function chooseFolder(): Promise<string | null> {
  const opts: Electron.OpenDialogOptions = { title: 'Choose a folder for your designs', properties: ['openDirectory', 'createDirectory'], defaultPath: settings.folder ?? homedir(), buttonLabel: 'Use this folder' };
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return r.canceled ? null : r.filePaths[0] ?? null;
}

async function setFolder(dir: string): Promise<void> {
  await rpc('setFolder', { dir });
  settings.folder = dir;
  saveSettings();
  broadcast();
}

async function setActive(active: 'folder' | 'drive'): Promise<void> {
  if (active === 'drive' && !drive.connected) throw new Error('Connect Google Drive first.');
  settings.active = active;
  saveSettings();
  await rpc('setActive', { active });
  broadcast();
}

async function pick(mode: string, arg?: string): Promise<unknown> {
  if (!local) throw new Error('The local server is not running.');
  const token = await drive.token();
  const nonce = randomBytes(24).toString('base64url');
  await rpc('pickerOpen', { nonce, session: { mode, ...(arg ? { arg } : {}), token } });
  // Google doesn't show the Picker in embedded webviews, so it opens in the real browser at the same local origin.
  await shell.openExternal(`${local.url}/desktop/picker?n=${nonce}`);
  return new Promise((resolve) => {
    const finish = (r: unknown) => {
      clearTimeout(timer);
      pickerWaits.delete(nonce);
      void rpc('pickerClose', { nonce }).catch(() => {});
      win?.show();
      resolve(r);
    };
    const timer = setTimeout(() => finish(null), 15 * 60_000);
    pickerWaits.set(nonce, finish);
  });
}

const handlers: Record<string, (a: never) => unknown> = {
  state: () => appState(),
  useDefaultFolder: async () => {
    const dir = join(app.getPath('documents'), 'Digital Canvas');
    mkdirSync(dir, { recursive: true });
    await setFolder(dir);
    return dir;
  },
  chooseFolder: async () => {
    const dir = await chooseFolder();
    if (dir) await setFolder(dir);
    return dir;
  },
  revealFolder: () => (settings.folder ? shell.openPath(settings.folder) : ''),
  setActive: (a: { active: 'folder' | 'drive' }) => setActive(a.active),
  'drive.connect': async (a: { hint?: string }) => {
    await drive.connect(a?.hint);
    await rpc('setDrive', { connected: true });
    await setActive('drive');
  },
  'drive.cancel': () => drive.cancel(),
  'drive.disconnect': async () => {
    if (settings.active === 'drive') await setActive('folder');
    await drive.disconnect();
    await rpc('setDrive', { connected: false });
  },
  'drive.token': (a: { force?: boolean }) => drive.token(a?.force),
  'drive.pick': (a: { mode: string; arg?: string }) => pick(a.mode, a.arg),
  'mcp.set': async (a: { on: boolean }) => {
    settings.mcp = a.on;
    saveSettings();
    await rpc('setMcp', { on: a.on });
    broadcast();
  },
  'mcp.newToken': async () => {
    settings.mcpToken = newToken();
    saveSettings();
    await rpc('setToken', { token: settings.mcpToken });
    broadcast();
  },
  openExternal: (a: { url: string }) => {
    const u = new URL(a.url);
    if (u.protocol !== 'https:') throw new Error('https links only');
    return shell.openExternal(u.href);
  },
  respond: (a: { id: number; ok: boolean; value?: unknown; error?: string }) => {
    const w = windowWaits.get(a.id);
    windowWaits.delete(a.id);
    if (a.ok) w?.resolve(a.value); else w?.reject(new Error(a.error ?? 'failed'));
  },
};

function installIpc(): void {
  // Synchronous, from the preload: it must always answer, or the page hangs on it for good.
  ipcMain.on('dc:state', (e) => { e.returnValue = isOurs(e, true) ? appState() : null; });
  ipcMain.handle('dc', (e, op: string, args: unknown) => {
    if (!isOurs(e)) throw new Error('not allowed');
    if (op.startsWith('store.')) return rpc(op, args);
    const fn = handlers[op];
    if (!fn) throw new Error(`unknown call ${op}`);
    return fn(args as never);
  });
}

// ---- window

async function createWindow(show = true): Promise<BrowserWindow> {
  const w = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600, show: false, title: 'Digital Canvas', backgroundColor: '#ffffff',
    icon: join(__dirname, 'icon.png'),
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });
  win = w;
  w.on('closed', () => { if (win === w) win = null; });
  // The window stays on the local app; everything else belongs in the browser.
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url) && !url.startsWith(`${local!.url}/`)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    if (new URL(url).origin === local!.url) return;
    e.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
  if (show) w.once('ready-to-show', () => w.show());
  await w.loadURL(`${local!.url}/`);
  return w;
}

// ---- start

function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const resources = __dirname;
    server = utilityProcess.fork(join(resources, 'server.mjs'), [], {
      serviceName: 'Digital Canvas server',
      env: {
        ...process.env, DC_CANVASKIT_JS: join(resources, 'canvaskit.cjs'), DC_FONTS_DIR: join(resources, 'web/fonts'),
        DC_TEMPLATE_ASSETS_DIR: join(resources, 'web/templates/assets'), DC_MOCKUPS_DIR: join(resources, 'web/mockups'),
      },
    });
    server.on('message', (m) => {
      if (m.event === 'up') {
        rpc<typeof local>('start', {
          root: join(resources, 'web'), preferredPort: Number(process.env.DC_DESKTOP_PORT) || settings.port, token: settings.mcpToken, mcp: settings.mcp,
          folder: settings.folder, active: settings.active, driveConnected: drive.connected,
        }).then((l) => {
          local = l;
          settings.port = l!.port;
          saveSettings();
          resolve();
        }, reject);
      } else onServerMessage(m);
    });
    server.on('exit', (code) => {
      for (const p of pending.values()) p.reject(new Error('The local server stopped.'));
      pending.clear();
      server = null;
      if (quitting || !local) return;
      console.error('[server] exited', code);
      local = null;
      void startServer().then(broadcast, (e) => dialog.showErrorBox('Digital Canvas', String(e)));
    });
  });
}

/** Tests: refuse everything off this machine, and keep a list of what was tried. */
function blockNetwork(): void {
  session.defaultSession.webRequest.onBeforeRequest((d, cb) => {
    const h = new URL(d.url).hostname;
    const ok = h === 'digital-canvas.localhost' || h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || !/^https?:|^wss?:/.test(d.url);
    if (!ok) blocked.push(d.url);
    cb({ cancel: !ok });
  });
  (globalThis as { __dcBlocked?: string[] }).__dcBlocked = blocked;
}

/** Notify only: an unsigned app can't replace itself safely, and nothing runs without the user. */
async function checkUpdate(): Promise<void> {
  if (process.env.DC_DESKTOP_BLOCK_NETWORK) return;
  try {
    const r = await fetch(RELEASES_API, { headers: { accept: 'application/vnd.github+json' } });
    if (!r.ok) return;
    const j = (await r.json()) as { tag_name?: string; html_url?: string };
    if (j.tag_name && isNewer(j.tag_name, app.getVersion())) {
      update = { version: j.tag_name.replace(/^v/, ''), url: j.html_url ?? RELEASES };
      broadcast();
    }
  } catch { /* offline */ }
}

let quitting = false;
app.on('before-quit', () => { quitting = true; server?.kill(); });
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
// On a Mac the app (and its MCP server) stays up with no window, as Mac apps do.
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!win && local) void createWindow(); });
void app.whenReady().then(async () => {
  settings = loadSettings();
  saveSettings();
  drive = new DriveAuth(app.getPath('userData'), broadcast);
  if (settings.active === 'drive' && !drive.connected) settings.active = 'folder';
  if (process.env.DC_DESKTOP_BLOCK_NETWORK) blockNetwork();
  installIpc();
  try {
    await startServer();
  } catch (e) {
    dialog.showErrorBox('Digital Canvas could not start', e instanceof Error ? e.message : String(e));
    app.exit(1);
    return;
  }
  await createWindow();
  setTimeout(() => void checkUpdate(), 8000);
});

