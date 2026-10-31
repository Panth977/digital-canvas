/**
 * The desktop app, for real: Electron launching the built bundle. The network
 * is blocked (DC_DESKTOP_BLOCK_NETWORK): everything leaving this machine is
 * refused and listed, and the test checks that list. Needs `npm run build:desktop`;
 * beforeAll builds it when missing.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const APP = resolve(__dirname, '../apps/desktop');
const SHOTS = process.env.DC_DESKTOP_SHOTS;
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `r16-desktop-${name}.png`) }); };

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName }, info) => info.project.name !== 'chromium' || (process.platform === 'linux' && !process.env.DISPLAY), 'Electron, once');

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
  if (!existsSync(join(APP, 'dist/main.cjs'))) execSync('npm run build:desktop', { cwd: resolve(__dirname, '..'), stdio: 'inherit' });
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
  await page.locator('[data-testid^="template-"]').first().click();
  await expect(page).toHaveURL(/#\/d\//, { timeout: 20_000 });
  await expect(page.locator('canvas').first()).toBeVisible();
  await page.evaluate(() => { location.hash = '#/'; });
});

test('stock search says it needs the internet', async () => {
  await page.getByText('Agent poster').first().click();
  await expect(page).toHaveURL(/#\/d\//);
  await page.getByRole('button', { name: 'Photos', exact: false }).first().click();
  await page.getByPlaceholder(/search/i).first().fill('mountain');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/internet|offline|couldn|no results|nothing/i).first()).toBeVisible({ timeout: 15_000 });
  await shot(page, 'offline-photos');
  await page.evaluate(() => { location.hash = '#/'; });
});

test('nothing went to our backend, and the app restarts into the same folder', async () => {
  const off = await blocked();
  console.log(`blocked requests: ${off.length}\n${[...new Set(off.map((u) => new URL(u).hostname))].join('\n')}`);
  expect(off.filter((u) => /firebase|googleapis|web\.app|cloudfunctions|firestore|icebase/.test(u))).toEqual([]);
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await expect(page.getByTestId('store-label')).toContainText('My Designs', { timeout: 20_000 });
  await expect(page.getByTestId('folder-setup')).toHaveCount(0);
  expect(JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')).folder).toBe(folder);
});
