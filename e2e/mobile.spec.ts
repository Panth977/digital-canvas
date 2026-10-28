import { test, expect, type Page, type CDPSession } from '@playwright/test';
import { newDesign, elements } from './helpers';

/**
 * The phone layout (iPhone 15 / Pixel 8 descriptors, touch). Fingers are real
 * touch events sent through CDP, so the canvas sees pointerType "touch".
 */

type P = { x: number; y: number };
const cdps = new WeakMap<Page, CDPSession>();
async function cdp(page: Page): Promise<CDPSession> {
  let c = cdps.get(page);
  if (!c) { c = await page.context().newCDPSession(page); cdps.set(page, c); }
  return c;
}
async function fingers(page: Page, type: 'touchStart' | 'touchMove' | 'touchEnd', pts: P[]): Promise<void> {
  await (await cdp(page)).send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : pts.map((p, id) => ({ x: p.x, y: p.y, id })) });
}
/** One finger from a to b. */
async function swipe(page: Page, a: P, b: P, steps = 8): Promise<void> {
  await fingers(page, 'touchStart', [a]);
  for (let i = 1; i <= steps; i++) await fingers(page, 'touchMove', [{ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }]);
  await fingers(page, 'touchEnd', []);
}
async function tapAt(page: Page, p: P): Promise<void> {
  await fingers(page, 'touchStart', [p]);
  await fingers(page, 'touchEnd', []);
}
const view = (page: Page) => page.evaluate(() => (window as any).__dcView.get() as { zoom: number; panX: number; panY: number });
const selection = (page: Page) => page.evaluate(() => [...(window as any).__dc.selection] as string[]);

/** A rectangle in the middle of the page, not selected. */
async function addRect(page: Page): Promise<string> {
  await page.evaluate(() => { const d = (window as any).__dc; d.addShape('rect'); d.select([]); });
  return (await elements(page))[0]!.id;
}
/** Screen centre of element `id` (page 1). */
async function centerOf(page: Page, id: string): Promise<P> {
  const stage = (await page.getByTestId('stage').boundingBox())!;
  const v = await view(page);
  const el = (await elements(page)).find((e) => e.id === id)!;
  return { x: stage.x + v.panX + (el.x + el.w / 2) * v.zoom, y: stage.y + v.panY + (el.y + el.h / 2) * v.zoom };
}

test('home on a phone: floating create button opens the sizes as a sheet', async ({ page }) => {
  await page.goto('/');
  const fab = page.getByTestId('m-create');
  await expect(fab).toBeVisible();
  await expect(page.getByTestId('create-design')).toBeHidden();
  await fab.tap();
  const pop = page.getByTestId('create-popover');
  await expect(pop).toBeVisible();
  const box = (await pop.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(Math.round(box.x)).toBe(0);
  expect(Math.round(box.width)).toBe(vp.width);
  expect(Math.round(box.y + box.height)).toBe(vp.height); // a bottom sheet
  await page.getByTestId('create-preset-instagram-post').tap();
  await expect(page.getByTestId('mobile-editor')).toBeVisible();
});

test('phone editor: top bar, full-screen canvas, bottom toolbar, no desktop rail', async ({ page }) => {
  await newDesign(page);
  await expect(page.getByTestId('mobile-editor')).toBeVisible();
  await expect(page.getByTestId('tab-elements')).toHaveCount(0);
  await expect(page.getByTestId('context-toolbar')).toHaveCount(0);
  const bar = page.getByTestId('mobile-toolbar');
  await expect(bar).toHaveAttribute('data-kind', 'page');
  for (const id of ['templates', 'elements', 'text', 'uploads', 'photos', 'draw']) await expect(page.getByTestId(`m-${id}`)).toBeAttached();
  // the page nearly fills the width
  const stage = (await page.getByTestId('stage').boundingBox())!;
  const v = await view(page);
  expect(1080 * v.zoom).toBeGreaterThan(stage.width - 40);
  // the toolbar scrolls sideways
  expect(await bar.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/orch27-rw/r5-mobile-web-${test.info().project.name}-editor.png` });
});

test('add an element from the sheet; the toolbar follows the selection', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('m-text').tap();
  const sheet = page.getByTestId('m-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute('data-size', 'half');
  await page.screenshot({ path: `/tmp/orch27-rw/r5-mobile-web-${test.info().project.name}-sheet.png` });
  await page.getByTestId('text-heading').tap();
  await expect.poll(async () => (await elements(page)).length).toBe(1);
  // adding selects it: the sheet closes and the text tools show
  await expect(sheet).toHaveCount(0);
  const bar = page.getByTestId('mobile-toolbar');
  await expect(bar).toHaveAttribute('data-kind', 'text');
  for (const id of ['edit', 'font', 'size', 'text-color', 'format', 'effects', 'animate', 'spacing', 'position', 'duplicate', 'delete']) await expect(page.getByTestId(`m-${id}`)).toBeAttached();
  await page.screenshot({ path: `/tmp/orch27-rw/r5-mobile-web-${test.info().project.name}-text.png` });

  // Size sheet
  await page.getByTestId('m-size').tap();
  await expect(page.getByTestId('m-size-sheet')).toBeVisible();
  const before = (await elements(page))[0]!.style.fontSize;
  await page.getByTestId('m-size-up').tap();
  await expect.poll(async () => (await elements(page))[0]!.style.fontSize).toBe(Math.round(before) + 1);
  // Font opens the font panel in the sheet
  await page.getByTestId('m-font').tap();
  await expect(page.getByTestId('tool-panel')).toHaveAttribute('data-panel', 'font');
  // a shape gets the shape tools
  await page.getByTestId('sheet-close').tap();
  await page.evaluate(() => (window as any).__dc.addShape('rect'));
  await expect(bar).toHaveAttribute('data-kind', 'shape');
  await expect(page.getByTestId('m-fill')).toBeAttached();
  await expect(page.getByTestId('m-font')).toHaveCount(0);
  await page.getByTestId('m-delete').tap();
  await expect.poll(async () => (await elements(page)).length).toBe(1);
});

test('bottom sheet: drag up to full, down to half, down to close', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('m-elements').tap();
  const sheet = page.getByTestId('m-sheet');
  await expect(sheet).toHaveAttribute('data-size', 'half');
  const h = (await page.getByTestId('sheet-handle').boundingBox())!;
  const at = { x: h.x + 40, y: h.y + h.height / 2 };
  await swipe(page, at, { x: at.x, y: at.y - 250 });
  await expect(sheet).toHaveAttribute('data-size', 'full');
  await page.waitForTimeout(300);
  const h2 = (await page.getByTestId('sheet-handle').boundingBox())!;
  await swipe(page, { x: h2.x + 40, y: h2.y + 10 }, { x: h2.x + 40, y: h2.y + 400 });
  await expect(sheet).toHaveAttribute('data-size', 'half');
  await page.waitForTimeout(300);
  const h3 = (await page.getByTestId('sheet-handle').boundingBox())!;
  await swipe(page, { x: h3.x + 40, y: h3.y + 10 }, { x: h3.x + 40, y: h3.y + 300 });
  await expect(sheet).toHaveCount(0);
});

test('touch: tap selects, drag moves the selection, tap on empty space deselects', async ({ page }) => {
  await newDesign(page);
  const id = await addRect(page);
  const start = (await elements(page))[0]!;
  const c = await centerOf(page, id);
  // a drag over an unselected element scrolls, it does not move it
  await swipe(page, c, { x: c.x + 60, y: c.y });
  expect((await elements(page))[0]!.x).toBe(start.x);
  await tapAt(page, await centerOf(page, id));
  await expect.poll(() => selection(page)).toEqual([id]);
  // handles are finger-sized
  expect(Number(await page.getByTestId('handle-se').getAttribute('r'))).toBeGreaterThanOrEqual(9);
  const c2 = await centerOf(page, id);
  await swipe(page, c2, { x: c2.x + 50, y: c2.y + 30 });
  const moved = (await elements(page))[0]!;
  const z = (await view(page)).zoom;
  // within the 6 px snap of the page's guides
  expect(Math.abs(moved.x - start.x - 50 / z)).toBeLessThan(8 / z);
  expect(moved.y).toBeGreaterThan(start.y);
  // a tap well away from the element (on the grey around the page) deselects
  const stage = (await page.getByTestId('stage').boundingBox())!;
  await tapAt(page, { x: stage.x + stage.width / 2, y: stage.y + stage.height - 20 });
  await expect.poll(() => selection(page)).toEqual([]);
});

test('touch: pinch zooms around the fingers, two fingers pan', async ({ page }) => {
  await newDesign(page);
  const stage = (await page.getByTestId('stage').boundingBox())!;
  const m = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };
  const z0 = (await view(page)).zoom;
  await fingers(page, 'touchStart', [{ x: m.x - 40, y: m.y }, { x: m.x + 40, y: m.y }]);
  for (let i = 1; i <= 10; i++) await fingers(page, 'touchMove', [{ x: m.x - 40 - i * 8, y: m.y }, { x: m.x + 40 + i * 8, y: m.y }]);
  await fingers(page, 'touchEnd', []);
  const z1 = (await view(page)).zoom;
  // fingers 80 px apart end 240 px apart: 3×
  expect(z1 / z0).toBeGreaterThan(2.8);
  expect(z1 / z0).toBeLessThan(3.2);
  // zoomed in, two fingers moving together pan the page
  const v1 = await view(page);
  await fingers(page, 'touchStart', [{ x: m.x - 30, y: m.y }, { x: m.x + 30, y: m.y }]);
  for (let i = 1; i <= 6; i++) await fingers(page, 'touchMove', [{ x: m.x - 30 - i * 10, y: m.y - i * 10 }, { x: m.x + 30 - i * 10, y: m.y - i * 10 }]);
  await fingers(page, 'touchEnd', []);
  const v2 = await view(page);
  expect(v2.zoom).toBeCloseTo(v1.zoom, 2);
  expect(v2.panX).toBeLessThan(v1.panX - 30);
  expect(v2.panY).toBeLessThan(v1.panY - 30);
});

test('touch: long press opens the element menu', async ({ page }) => {
  await newDesign(page);
  const id = await addRect(page);
  const c = await centerOf(page, id);
  await fingers(page, 'touchStart', [c]);
  await page.waitForTimeout(700);
  await fingers(page, 'touchEnd', []);
  await expect(page.getByTestId('canvas-menu')).toBeVisible();
  await expect.poll(() => selection(page)).toEqual([id]);
});

test('text: edit with the keyboard; the text stays above a shorter (keyboard) viewport', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('m-text').tap();
  await page.getByTestId('text-heading').tap();
  await expect(page.getByTestId('mobile-toolbar')).toHaveAttribute('data-kind', 'text');
  // move it to the bottom of the page first
  await page.evaluate(() => { const d = (window as any).__dc; d.update({ y: 900 }); d.seal(); });
  await page.getByTestId('m-edit').tap();
  const editor = page.getByTestId('text-editor');
  await expect(editor).toBeFocused();
  // the on-screen keyboard: the visual viewport shrinks
  const vp = page.viewportSize()!;
  await page.setViewportSize({ width: vp.width, height: Math.round(vp.height * 0.55) });
  await expect(page.getByTestId('mobile-toolbar')).toBeInViewport();
  await page.waitForTimeout(400);
  const stage = (await page.getByTestId('stage').boundingBox())!;
  const box = (await editor.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(stage.y);
  expect(box.y + box.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Hello phone');
  await expect.poll(async () => (await elements(page))[0]!.text).toBe('Hello phone');
  await page.screenshot({ path: `/tmp/orch27-rw/r5-mobile-web-${test.info().project.name}-keyboard.png` });
  // a tap on the selected text edits it too
  await tapAt(page, { x: stage.x + 10, y: stage.y + 10 });
  await expect(editor).toHaveCount(0);
  await page.setViewportSize(vp);
  await page.waitForTimeout(300);
  const id = (await elements(page))[0]!.id;
  await page.evaluate((id) => (window as any).__dc.select([id]), id);
  await tapAt(page, await centerOf(page, id));
  await expect(page.getByTestId('text-editor')).toBeVisible();
});

test('pages sheet: add a page, go to it', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('m-pages').tap();
  await expect(page.getByTestId('m-pages-sheet')).toBeVisible();
  await page.getByTestId('m-add-page').tap();
  await expect.poll(async () => (await page.evaluate(() => (window as any).__dc.doc.pages.length))).toBe(2);
  await expect(page.getByTestId('m-page-counter')).toHaveText('2 / 2');
  await page.getByTestId('m-page-0').tap();
  await expect(page.getByTestId('m-page-counter')).toHaveText('1 / 2');
  await page.screenshot({ path: `/tmp/orch27-rw/r5-mobile-web-${test.info().project.name}-pages.png` });
});

test('no browser zoom: the viewport is locked and the stage takes every gesture', async ({ page }) => {
  await newDesign(page);
  const meta = await page.locator('meta[name=viewport]').getAttribute('content');
  expect(meta).toContain('viewport-fit=cover');
  expect(await page.getByTestId('stage').evaluate((el) => getComputedStyle(el).touchAction)).toBe('none');
});

test('video on a phone: one scene on the stage, compact filmstrip, tap a scene to show it, play', async ({ page }) => {
  await newDesign(page, 'video-vertical');
  const ids = await page.evaluate(() => {
    const ed = (window as any).__dc;
    ed.updatePage({ duration: 2, background: { type: 'solid', color: '#ff5a5f' } });
    ed.addPage(); ed.updatePage({ duration: 4, background: { type: 'solid', color: '#2a5bd7' } });
    ed.addPage(); ed.updatePage({ duration: 2, background: { type: 'solid', color: '#ffe9a8' } });
    ed.addText('heading'); ed.update({ animation: { type: 'rise' } }); ed.select([]);
    ed.seal();
    ed.select([], ed.doc.pages[0].id);
    return ed.doc.pages.map((p: any) => p.id);
  });
  const v = await page.evaluate(() => (window as any).__dcView.get());
  expect(v.videoMode).toBe(true);
  await expect(page.getByTestId('timeline')).toBeVisible();
  const scenes = page.getByTestId('tl-scene');
  await expect(scenes).toHaveCount(3);
  const w = await scenes.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  expect(w[1]! / w[0]!).toBeCloseTo(2, 0);
  // the whole timeline fits under the stage, the stage keeps most of the screen
  const tl = (await page.getByTestId('timeline').boundingBox())!;
  const stage = (await page.getByTestId('stage').boundingBox())!;
  expect(tl.height).toBeLessThan(150);
  expect(stage.height).toBeGreaterThan(tl.height * 2);
  await scenes.nth(1).tap();
  await expect.poll(() => page.evaluate(() => (window as any).__dc.pageId)).toBe(ids[1]);
  await page.screenshot({ path: `/tmp/orch27-rw/r9-video-phone-${test.info().project.name}.png` });
  await page.getByTestId('play').tap();
  await expect.poll(() => page.evaluate(() => (window as any).__dc.player.time), { timeout: 5000 }).toBeGreaterThan(2.5);
  await page.getByTestId('play').tap();
});
