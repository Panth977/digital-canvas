import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { FakeDrive, FOLDER, fakeSignIn } from './fake-drive.ts';
import { CONTENT_HOSTS, doc, newDesign, pngBytes } from './helpers.ts';
import { routeMockups } from './mockup-fixtures.ts';

/**
 * r20 user plugins: the Plugins rail module and its creators (animation from
 * CSS, effect with an SkSL shader, font upload, mockup from a photo), using
 * them from the Animate / Effects / font / Mockups panels, .dcplugin export +
 * import, and sharing by link to the /plugin/<fileId> install screen.
 */

const SHOTS = process.env.SHOTS_DIR ?? '/tmp/orch27-rw';
const shoot = process.env.SHOTS === '1';

const addBox = (page: Page) => page.evaluate(() => {
  const ed = (window as any).__dc;
  ed.addShape('rect');
  ed.update({ x: 300, y: 300, w: 400, h: 400, rotation: 0, fill: { type: 'solid', color: '#ff0000' }, stroke: null });
  ed.seal();
  return ed.selection[0] as string;
});
const addText = (page: Page) => page.evaluate(() => {
  const ed = (window as any).__dc;
  ed.addText('body');
  ed.seal();
  return ed.selection[0] as string;
});
const el = (page: Page, id: string) => page.evaluate((id) => (window as any).__dc.doc.pages.flatMap((p: any) => p.elements).find((e: any) => e.id === id), id);
const library = (page: Page) => page.evaluate(() => (window as any).__plugins.lib.plugins as any[]);

async function openPlugins(page: Page): Promise<void> {
  await page.getByTestId('tab-plugins').click();
  await expect(page.getByTestId('plugins-panel')).toBeVisible();
}
async function create(page: Page, kind: string): Promise<void> {
  await page.getByTestId('plugin-create').click();
  await page.getByTestId(`plugin-new-${kind}`).click();
}

const CSS = `@keyframes wobble-in {
  0% { transform: translateX(-50%) rotate(-20deg); opacity: 0; }
  70% { transform: translateX(10%) rotate(5deg); opacity: 1; }
  100% { transform: none; }
}`;

/** An animation plugin made in the UI; returns its id. */
async function makeAnimation(page: Page, name = 'Wobble in'): Promise<string> {
  await openPlugins(page);
  await create(page, 'animation');
  await expect(page.getByTestId('animation-creator')).toBeVisible();
  await page.getByTestId('anim-plugin-name').fill(name);
  await page.getByTestId('anim-css').fill(CSS);
  await expect(page.getByTestId('anim-css-error')).toHaveCount(0);
  await page.getByTestId('anim-plugin-save').click();
  await expect(page.getByTestId('plugin-list')).toContainText(name);
  return (await library(page)).find((p) => p.name === name).id;
}

test('animation from CSS @keyframes: live preview, saved, applied from the Animate panel and played', async ({ page }) => {
  await newDesign(page);
  const box = await addBox(page);
  await openPlugins(page);
  await expect(page.getByTestId('plugins-empty')).toBeVisible();
  await create(page, 'animation');
  await page.getByTestId('anim-plugin-name').fill('Wobble in');
  await page.getByTestId('anim-css').fill('.nope { color: red }');
  await expect(page.getByTestId('anim-css-error')).toContainText('No @keyframes');
  await page.getByTestId('anim-css').fill(CSS);
  await expect(page.getByTestId('anim-css-error')).toHaveCount(0);
  // the preview keeps playing
  const pv = page.getByTestId('anim-plugin-preview');
  const f0 = Number(await pv.getAttribute('data-frame'));
  await expect.poll(async () => Number(await pv.getAttribute('data-frame'))).toBeGreaterThan(f0 + 3);
  // the table shows the same keyframes
  await page.getByTestId('anim-mode-table').click();
  await expect(page.getByTestId('anim-row-1')).toBeVisible();
  expect(await page.getByTestId('anim-row-1').locator('input').first().inputValue()).toBe('70');
  await page.getByTestId('anim-mode-css').click();
  await page.getByTestId('anim-plugin-duration').fill('1.5');
  if (shoot) await page.screenshot({ path: `${SHOTS}/r20-anim-creator.png` });
  await page.getByTestId('anim-plugin-save-apply').click();

  await expect(page.getByTestId('animate-panel')).toBeVisible();
  await expect.poll(async () => !!(await el(page, box)).animation).toBe(true);
  const lib = await library(page);
  expect(lib).toHaveLength(1);
  expect(lib[0]).toMatchObject({ kind: 'animation', name: 'Wobble in', recipe: { len: 1.5 } });
  expect(lib[0].css).toContain('@keyframes wobble-in');
  let a = (await el(page, box)).animation;
  expect(a).toMatchObject({ type: 'keyframes', plugin: lib[0].id, duration: 1.5 });
  expect(a.keyframes.f.map((f: any) => f.a)).toEqual([0, 0.7, 1]);

  // Animate panel: "My animations", pick None then the plugin again
  await expect(page.getByTestId('animate-panel')).toBeVisible();
  await expect(page.getByTestId(`anim-plugin-${lib[0].id}`)).toHaveClass(/on/);
  await page.getByTestId('anim-none').click();
  expect((await el(page, box)).animation).toBeUndefined();
  await page.getByTestId(`anim-plugin-${lib[0].id}`).click();
  a = (await el(page, box)).animation;
  expect(a).toMatchObject({ type: 'keyframes', plugin: lib[0].id });
  await expect(page.getByTestId('anim-options')).toBeVisible();
  // it moves: the panel's preview plays it (frames differ from the page at rest)
  await page.getByTestId('anim-play').click();
  const frames = new Set<string>();
  for (let i = 0; i < 8; i++) {
    frames.add(await page.getByTestId('anim-preview').evaluate((c: HTMLCanvasElement) => c.toDataURL().slice(-200)));
    await page.waitForTimeout(80);
  }
  expect(frames.size).toBeGreaterThan(1);
  if (shoot) await page.screenshot({ path: `${SHOTS}/r20-anim-mine.png` });
});

test('effect with an SkSL shader: compile errors, sliders, applied, and its sliders in the Effects panel', async ({ page }) => {
  await newDesign(page);
  const t = await addText(page);
  await openPlugins(page);
  await create(page, 'effect');
  await expect(page.getByTestId('effect-creator')).toBeVisible();
  await page.getByTestId('effect-plugin-name').fill('Warm');
  await expect(page.getByTestId('effect-compiled')).toBeVisible();
  await expect(page.getByTestId('effect-param-amount')).toBeVisible();
  const code = await page.getByTestId('effect-sksl').inputValue();
  await page.getByTestId('effect-sksl').fill(code.replace('return half4(mix', 'return hal4(mix'));
  await expect(page.getByTestId('effect-compile-error')).toBeVisible();
  await expect(page.getByTestId('effect-plugin-save')).toBeDisabled();
  await page.getByTestId('effect-sksl').fill(code.replace('uniform float amount;', 'uniform float amount;\nuniform float glow;'));
  await expect(page.getByTestId('effect-compiled')).toBeVisible();
  await expect(page.getByTestId('effect-param-glow')).toBeVisible();
  await page.getByTestId('effect-param-slider-amount').fill('0.8');
  // the preview draws the selected text through the shader
  await expect.poll(async () => Number(await page.getByTestId('effect-plugin-preview').getAttribute('data-frame'))).toBeGreaterThan(0);
  expect(await page.getByTestId('effect-plugin-preview').getAttribute('data-error')).toBe('');
  if (shoot) await page.screenshot({ path: `${SHOTS}/r20-effect-creator.png` });
  await page.getByTestId('effect-plugin-save-apply').click();

  const p = (await library(page)).find((x) => x.name === 'Warm');
  expect(p.shader.params.map((q: any) => q.name)).toEqual(['amount', 'glow']);
  await expect.poll(async () => !!(await el(page, t)).shader).toBe(true);
  const shader = (await el(page, t)).shader;
  expect(shader).toMatchObject({ plugin: p.id, name: 'Warm', params: { amount: 0.8, glow: 0.5 } });
  expect(shader.sksl).toContain('uniform float glow;');

  // Effects panel: My effects, the shader's sliders, Remove
  await page.getByTestId('effects-btn').click();
  await expect(page.getByTestId('my-effects')).toBeVisible();
  await expect(page.getByTestId(`my-effect-${p.id}`)).toHaveClass(/on/);
  await page.getByTestId('shader-param-amount').fill('0.2');
  expect((await el(page, t)).shader.params.amount).toBeCloseTo(0.2, 5);
  // the renderer draws it: a red page under a full-strength tint looks different
  const sum = () => page.evaluate(() => { const ed = (window as any).__dc; return Array.from(ed.pageRgba(ed.pageId, 120, 120).data as Uint8Array).reduce((s, v) => s + v, 0); });
  await page.evaluate((id) => { const ed = (window as any).__dc; ed.update({ x: 0, y: 0, w: ed.doc.width, h: ed.doc.height, style: { ...ed.doc.pages[0].elements.find((e: any) => e.id === id).style, fontSize: 300, color: '#2266ff' } }, null, [id]); }, t);
  await page.getByTestId('shader-param-amount').fill('1');
  const tinted = await sum();
  await page.getByTestId('shader-remove').click();
  expect((await el(page, t)).shader).toBeUndefined();
  expect(await sum()).not.toBe(tinted);
  await page.getByTestId(`my-effect-${p.id}`).click();
  expect((await el(page, t)).shader.params.amount).toBeCloseTo(0.8, 5);
});

test('font upload: family from the file, shows under My fonts, used and embedded in the design', async ({ page }) => {
  await newDesign(page);
  const t = await addText(page);
  await openPlugins(page);
  await create(page, 'font');
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('font-plugin-upload').click();
  await (await chooser).setFiles({ name: 'inter-sub.woff2', mimeType: 'font/woff2', buffer: readFileSync(new URL('../packages/render/test/fixtures/fonts/inter-sub.woff2', import.meta.url)) });
  await expect(page.getByTestId('font-plugin-family')).toHaveValue(/Inter/);
  await page.getByTestId('font-plugin-family').fill('Panth Sans');
  await page.getByTestId('font-plugin-name').fill('Panth Sans');
  await page.getByTestId('font-plugin-license').fill('SIL OFL 1.1');
  await page.getByTestId('font-plugin-save').click();
  const p = (await library(page)).find((x) => x.kind === 'font');
  expect(p).toMatchObject({ family: 'Panth Sans', license: 'SIL OFL 1.1', faces: [{ weight: 400, italic: false, mime: 'font/ttf' }] });

  await page.getByTestId('font-picker').click();
  await expect(page.getByTestId('my-fonts')).toBeVisible();
  await page.getByTestId(`my-font-${p.id}`).click();
  await expect.poll(async () => (await el(page, t)).style.fontFamily).toBe('Panth Sans');
  const d = await doc(page);
  const embedded = d.fonts.find((f: any) => f.family === 'Panth Sans');
  expect(embedded).toBeTruthy();
  expect(d.assets[embedded.asset].mime).toBe('font/ttf');
  expect(await page.evaluate(() => (window as any).__dc.engine.fonts.families.has('Panth Sans'))).toBe(true);
});

test('mockup from a photo: corners dragged, live preview, shows under My mockups and renders', async ({ page }) => {
  await routeMockups(page);
  await newDesign(page);
  await page.evaluate(() => { const d = (window as any).__dc; d.updatePage({ background: { type: 'solid', color: '#e01010' } }); d.select([]); d.seal(); });
  const photo = await pngBytes(page, 400, 300, '#dddddd');
  await openPlugins(page);
  await create(page, 'mockup');
  await expect(page.getByTestId('mockup-creator')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('mockup-photo-upload').click();
  await (await chooser).setFiles({ name: 'wall.png', mimeType: 'image/png', buffer: photo });
  await expect(page.getByTestId('mockup-stage')).toBeVisible();
  await expect(page.getByTestId('mockup-plugin-name')).toHaveValue('wall');
  // drag the top-left corner up and left
  const h = await page.getByTestId('mockup-corner-0').boundingBox();
  await page.mouse.move(h!.x + h!.width / 2, h!.y + h!.height / 2);
  await page.mouse.down();
  await page.mouse.move(h!.x - 40, h!.y - 30, { steps: 5 });
  await page.mouse.up();
  // nudge corner 3 with the keyboard
  await page.getByTestId('mockup-stage').focus();
  await page.keyboard.press('4');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(async () => Number(await page.getByTestId('mockup-plugin-preview').getAttribute('data-rendered'))).toBeGreaterThan(0);
  // the middle of the print area is the red page
  const px = await page.getByTestId('mockup-plugin-preview').evaluate((c: HTMLCanvasElement) => Array.from(c.getContext('2d')!.getImageData(Math.floor(c.width * 0.5), Math.floor(c.height * 0.5), 1, 1).data));
  expect(px[0]).toBeGreaterThan(150);
  expect(px[1]).toBeLessThan(80);
  if (shoot) await page.screenshot({ path: `${SHOTS}/r20-mockup-creator.png` });
  await page.getByTestId('mockup-plugin-save-show').click();

  const p = (await library(page)).find((x) => x.kind === 'mockup');
  expect(p).toMatchObject({ name: 'wall', width: 400, height: 300, category: 'My mockups' });
  expect(p.corners[0][0]).toBeLessThan(100);
  expect(p.corners[3][0]).toBeCloseTo(90, 0);
  await expect(page.getByTestId('mockups-panel')).toBeVisible();
  await expect(page.getByTestId('my-mockups')).toBeVisible();
  await expect.poll(async () => Number(await page.getByTestId(`mockup-canvas-${p.id}`).getAttribute('data-rendered')), { timeout: 10_000 }).toBeGreaterThan(0);
  await page.getByTestId(`mockup-${p.id}`).click();
  await expect(page.getByTestId('mockup-canvas-fx-poster').or(page.locator('[role=dialog]')).first()).toBeVisible();
  if (shoot) await page.screenshot({ path: `${SHOTS}/r20-my-mockups.png` });
});

test('.dcplugin export and import round trip (file picker and drop)', async ({ page }) => {
  await newDesign(page);
  const id = await makeAnimation(page, 'Round trip');
  await page.getByTestId(`plugin-more-${id}`).click();
  const dl = page.waitForEvent('download');
  await page.getByTestId('plugin-export').click();
  const file = await dl;
  expect(file.suggestedFilename()).toBe('Round trip.dcplugin');
  const bytes = readFileSync(await file.path());
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');

  await page.getByTestId(`plugin-more-${id}`).click();
  await page.getByTestId('plugin-delete').click();
  await page.getByRole('button', { name: 'Delete' }).last().click();
  await expect(page.getByTestId('plugins-empty')).toBeVisible();

  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('plugin-import').click();
  await (await chooser).setFiles({ name: 'Round trip.dcplugin', mimeType: 'application/zip', buffer: bytes });
  await expect(page.getByTestId(`plugin-${id}`)).toBeVisible();
  expect((await library(page)).map((p) => p.id)).toEqual([id]);

  // dropping the same file again updates it in place; Duplicate makes a copy
  await page.getByTestId('plugins-panel').evaluate((el, b64) => {
    const bin = atob(b64), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([u8], 'Round trip.dcplugin', { type: 'application/zip' }));
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, bytes.toString('base64'));
  await page.waitForTimeout(300);
  expect(await library(page)).toHaveLength(1);
  await page.getByTestId(`plugin-more-${id}`).click();
  await page.getByTestId('plugin-duplicate').click();
  await expect.poll(async () => (await library(page)).map((p) => p.name)).toEqual(['Round trip', 'Round trip copy']);

  // plugins persist: a reload reads them back from this browser
  await page.waitForFunction(() => !(window as any).__plugins.saving);
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__plugins);
  await page.evaluate(() => (window as any).__plugins.load(undefined, true));
  expect((await library(page)).map((p) => p.name)).toEqual(['Round trip', 'Round trip copy']);
});

async function freshPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(CONTENT_HOSTS, (r) => r.fulfill({ status: 503, body: 'offline in tests' }));
  return ctx.newPage();
}

test('share by link: .dcplugin in Drive made public, /plugin/<id> installs it without signing in', async ({ page, browser }) => {
  const d = new FakeDrive();
  const app = d.add({ id: 'appfolder', name: 'Digital Canvas', mimeType: FOLDER, appProperties: { digitalCanvasRoot: '1' } });
  d.add({ id: 'assetsfolder', name: 'assets', mimeType: FOLDER, parents: [app.id], appProperties: { dcAssets: '1', digitalCanvasRoot: 'assets' } });
  await page.context().route(CONTENT_HOSTS, (r) => r.fulfill({ status: 503, body: 'offline in tests' }));
  await d.install(page);
  await page.goto('/');
  await fakeSignIn(page);
  await page.getByTestId('preset-instagram-post').click();
  await page.waitForFunction(() => !!(window as any).__dc);
  const id = await makeAnimation(page, 'Shared wobble');
  // the library went to Drive
  expect([...d.files.values()].some((f) => f.appProperties?.dcPlugins === '1')).toBe(true);

  await page.getByTestId(`plugin-more-${id}`).click();
  await page.getByTestId('plugin-share').click();
  const link = await page.getByTestId('plugin-share-link').inputValue();
  const shared = [...d.files.values()].find((f) => f.appProperties?.dcPluginShare === id)!;
  expect(shared.name).toBe('Shared wobble.dcplugin');
  expect(shared.parents).toEqual([app.id]);
  expect(link).toBe(`https://digital-canvas-p977.web.app/plugin/${shared.id}`);
  expect(d.permCalls.some((c) => c.fileId === shared.id && c.body?.type === 'anyone' && c.body?.role === 'reader' && c.body?.allowFileDiscovery === false)).toBe(true);
  // sharing again updates the same file
  await page.getByTestId(`plugin-more-${id}`).click();
  await page.getByTestId('plugin-share').click();
  await expect(page.getByTestId('plugin-share-link')).toHaveValue(link);
  expect([...d.files.values()].filter((f) => f.appProperties?.dcPluginShare === id)).toHaveLength(1);

  d.keyReads = [];
  const anon = await freshPage(browser);
  await d.install(anon);
  await anon.goto(`/plugin/${shared.id}`);
  await expect(anon.getByTestId('plugin-install-name')).toHaveText('Shared wobble');
  expect(d.keyReads).toContain(shared.id);
  if (shoot) await anon.screenshot({ path: `${SHOTS}/r20-plugin-install.png` });
  await anon.getByTestId('plugin-install-add').click();
  await expect(anon.getByTestId('plugin-installed')).toBeVisible();
  expect((await library(anon)).map((p) => [p.id, p.name])).toEqual([[id, 'Shared wobble']]);
  await anon.getByTestId('plugin-install-open').click();
  await expect(anon.getByTestId('preset-instagram-post')).toBeVisible();

  await anon.goto('/plugin/nope-missing');
  await expect(anon.getByTestId('plugin-install-error')).toBeVisible();
  await anon.context().close();
});

test('phone layout: Plugins in the toolbar opens the panel in the sheet', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await newDesign(page);
  await page.getByTestId('m-plugins').click();
  await expect(page.getByTestId('plugins-panel')).toBeVisible();
  await ctx.close();
});
