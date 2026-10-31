/**
 * The desktop app, for real: Electron launching the built bundle. The network
 * is blocked (DC_DESKTOP_BLOCK_NETWORK): everything leaving this machine is
 * refused and listed, and the test checks that list. Needs `npm run build:desktop`;
 * beforeAll builds it when missing.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const APP = join(ROOT, 'apps/desktop');
const SHOTS = process.env.DC_DESKTOP_SHOTS;
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `r16-desktop-${name}.png`) }); };

test.describe.configure({ mode: 'serial' });
test.skip(process.platform === 'linux' && !process.env.DISPLAY, 'Electron needs a display (CI: xvfb-run)');

let app: ElectronApplication, page: Page, dir: string, folder: string, userData: string;
let url = '', token = '';

const blocked = () => app.evaluate(() => (globalThis as unknown as { __dcBlocked: string[] }).__dcBlocked);
const mcp = async (t = token) => {
  const c = new Client({ name: 'e2e', version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${t}` } } }));
  return c;
};
const listDesigns = async () => {
  const c = await mcp();
  const r = await c.callTool({ name: 'list_designs', arguments: {} }) as { content: { type: string; text: string }[] };
  await c.close();
  return r.content.filter((x) => x.type === 'text').map((x) => x.text).join('\n');
};
const launch = () => electron.launch({ args: [APP], env: { ...process.env, DC_DESKTOP_USER_DATA: userData, DC_DESKTOP_PORT: '5297', DC_DESKTOP_BLOCK_NETWORK: '1', DC_OFFLINE: '1' } as Record<string, string> });

test.beforeAll(async () => {
  test.setTimeout(300_000);
  if (!existsSync(join(APP, 'dist/main.cjs'))) execSync('npm run build:desktop', { cwd: ROOT, stdio: 'inherit' });
  dir = mkdtempSync(join(tmpdir(), 'dc-r16-'));
  folder = join(dir, 'My Designs');
  userData = join(dir, 'userdata');
  app = await launch();
  page = await app.firstWindow();
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
});

test('first run asks for a folder, with no sign-in', async () => {
  expect(page.url()).toMatch(/^http:\/\/digital-canvas\.localhost:\d+\/$/);
  await expect(page.getByTestId('folder-setup')).toBeVisible({ timeout: 20_000 });
  await shot(page, 'first-run');
  await app.evaluate(async ({ dialog }, path) => {
    const { mkdirSync } = process.getBuiltinModule('node:fs');
    mkdirSync(path, { recursive: true });
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog;
  }, folder);
  await page.getByTestId('choose-folder').click();
  await expect(page.getByTestId('store-label')).toContainText('My Designs');
  await expect(page.getByTestId('sign-in')).toHaveCount(0);
  await expect(page.getByTestId('download-app')).toHaveCount(0); // hidden inside the app
  await shot(page, 'home');
});

test('a new design is a file in the folder, and the MCP sees it', async () => {
  await page.getByTestId('create-design').click();
  await page.getByTestId('create-popover').locator('.pitem').first().click();
  await expect(page).toHaveURL(/#\/d\//, { timeout: 15_000 });
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => readdirSync(folder).filter((f) => f.endsWith('.dcanvas')).length, { timeout: 10_000 }).toBe(1);
  const name = readdirSync(folder).find((f) => f.endsWith('.dcanvas'))!;
  expect(statSync(join(folder, name)).size).toBeGreaterThan(100);
  await shot(page, 'editor');

  const state = await page.evaluate(() => (window as unknown as { dcDesktop: { call(op: string): Promise<{ mcp: { url: string; token: string; fallbackUrl: string } }> } }).dcDesktop.call('state'));
  url = state.mcp.url;
  token = state.mcp.token;
  expect(url).toMatch(/^http:\/\/digital-canvas\.localhost:\d+\/mcp$/);
  expect(await listDesigns()).toContain(name.replace('.dcanvas', ''));
});

test('without the token, or from another site, MCP says no', async () => {
  await expect(mcp('wrong')).rejects.toThrow();
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' });
  expect(r.status).toBe(403);
});

test('settings show the URL, the configs and the switch', async () => {
  await page.evaluate(() => { location.hash = '#/'; });
  await page.getByTestId('desktop-settings-btn').click();
  const s = page.getByTestId('desktop-settings');
  await expect(s.getByTestId('mcp-url')).toHaveText(url);
  await expect(s.getByTestId('settings-folder')).toHaveText(folder);
  await expect(s.getByTestId('client-config')).toContainText(`claude mcp add --transport http digital-canvas ${url}`);
  await s.getByTestId('client-cursor').click();
  await expect(s.getByTestId('client-config')).toContainText('"mcpServers"');
  await expect(s.getByTestId('connect-drive')).toBeVisible();
  await shot(page, 'settings');
  await s.getByTestId('mcp-switch').uncheck();
  await expect.poll(async () => (await fetch(url, { method: 'POST' })).status).toBe(503);
  await s.getByTestId('mcp-switch').check();
  await expect.poll(async () => (await fetch(url, { method: 'POST' })).status).toBe(401);
  await s.getByLabel('Close').click();
});

test('an agent\'s design shows up on Home by itself', async () => {
  const c = await mcp();
  await c.callTool({ name: 'create_design', arguments: { title: 'Agent poster', preset: 'instagram-post' } });
  await c.close();
  await expect(page.getByText('Agent poster').first()).toBeVisible({ timeout: 10_000 });
});

test('a template opens offline, with its fonts from the app', async () => {
  await page.locator('[data-testid^="home-template-"]').first().click();
  await expect(page).toHaveURL(/#\/d\//, { timeout: 20_000 });
  await expect(page.locator('canvas').first()).toBeVisible();
  await page.evaluate(() => { location.hash = '#/'; });
});

test('stock search says it needs the internet', async () => {
  await page.getByRole('link', { name: 'Open Agent poster' }).click();
  await expect(page).toHaveURL(/#\/d\//);
  await page.getByRole('button', { name: 'Photos' }).first().click();
  await page.getByTestId('photo-search').locator('input').or(page.getByTestId('photo-search')).first().fill('mountain');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Couldn't reach the library/).first()).toBeVisible({ timeout: 15_000 });
  await shot(page, 'offline-photos');
});

test('an open design follows an agent\'s edit', async () => {
  const c = await mcp();
  const list = await c.callTool({ name: 'list_designs', arguments: {} }) as { content: { text: string }[] };
  const id = /"id":\s*"([^"]+)"[^}]*Agent poster|Agent poster[^}]*"id":\s*"([^"]+)"/.exec(list.content[0]!.text)!;
  const design_id = id[1] ?? id[2]!;
  const canvas = page.getByTestId('canvas');
  await page.getByTestId('canvas').click({ position: { x: 5, y: 5 } });
  const before = await canvas.screenshot();
  await c.callTool({ name: 'add_elements', arguments: { design_id, elements: [{ type: 'shape', shape: 'rect', x: 0, y: 0, w: 1080, h: 1080, fill: '#ff0000' }] } });
  await c.close();
  // the file changed on disk, so the editor mounts again and the page turns red
  // (the canvas can detach mid-screenshot while it remounts: that only means not yet)
  await expect.poll(async () => Buffer.compare(before, await canvas.screenshot({ timeout: 3000 }).catch(() => before)) !== 0, { timeout: 15_000 }).toBe(true);
  await shot(page, 'live-edit');
});

test('an upload lands in assets/ and the MCP lists it', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await page.evaluate(() => { location.hash = '#/'; });
  await page.getByRole('link', { name: 'Open Agent poster' }).click();
  await page.getByRole('button', { name: 'Uploads' }).first().click();
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'dot.png', { type: 'image/png' }));
    document.querySelector('[data-testid="canvas"]')!.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 700, clientY: 400 }));
  }, png.toString('base64'));
  await expect.poll(() => { try { return readdirSync(join(folder, 'assets')).filter((f) => f !== 'index.json').length; } catch { return 0; } }, { timeout: 10_000 }).toBe(1);
  const c = await mcp();
  const r = await c.callTool({ name: 'list_assets', arguments: {} }) as { content: { text: string }[] };
  await c.close();
  expect(r.content[0]!.text).toContain('dot.png');
  await page.evaluate(() => { location.hash = '#/'; });
});

test('MCP video export runs on the window\'s encoder, no ffmpeg', async () => {
  test.setTimeout(90_000);
  const c = await mcp();
  const made = await c.callTool({ name: 'create_design', arguments: { title: 'Reel', width: 320, height: 240 } }) as { content: { text: string }[] };
  const design_id = /"id":\s*"([^"]+)"|"design_id":\s*"([^"]+)"/.exec(made.content[0]!.text)!.slice(1).find(Boolean)!;
  await c.callTool({ name: 'set_page', arguments: { design_id, page: 1, duration: 1, background: '#3366ff' } });
  const start = await c.callTool({ name: 'export_video', arguments: { design_id, fps: 10 } }, undefined, { timeout: 80_000 }) as { content: { text: string }[] };
  let text = start.content.map((x) => x.text).join('\n');
  const job = /"job_id":\s*"([^"]+)"/.exec(text)?.[1];
  for (let i = 0; job && i < 10 && !/\.mp4/.test(text); i++) {
    text = ((await c.callTool({ name: 'get_export', arguments: { job_id: job, wait_seconds: 5 } })) as { content: { text: string }[] }).content.map((x) => x.text).join('\n');
  }
  await c.close();
  expect(text).toContain('.mp4');
  const mp4 = readdirSync(join(folder, 'Exports')).find((f) => f.endsWith('.mp4'))!;
  const bytes = readFileSync(join(folder, 'Exports', mp4));
  expect(bytes.subarray(4, 8).toString()).toBe('ftyp');
  expect(bytes.length).toBeGreaterThan(500);
});

test('nothing went to our backend, and the app restarts into the same folder', async () => {
  const off = await blocked();
  console.log(`blocked requests: ${off.length}\n${[...new Set(off.map((u) => new URL(u).hostname))].join('\n')}`);
  expect(off.filter((u) => /firebase|googleapis|web\.app|cloudfunctions|firestore|icebase/.test(u))).toEqual([]);
  await app.close();
  app = await launch();
  // Playwright's firstWindow() never fires for a page a service worker already controls, so ask the window itself.
  const label = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.executeJavaScript(
    `[document.querySelector('[data-testid=store-label]')?.textContent?.trim(), !!document.querySelector('[data-testid=folder-setup]')].join('|')`).catch(() => '') ?? '');
  await expect.poll(label, { timeout: 20_000 }).toBe('My Designs|false');
  expect(JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')).folder).toBe(folder);
});
