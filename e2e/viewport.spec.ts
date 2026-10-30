import { expect, test, type Page } from '@playwright/test';
import { doc, newDesign } from './helpers';

/** The canvas viewport: pan (screen position of page 1's top-left), zoom, size and the allowed pan range. */
type V = { panX: number; panY: number; zoom: number; vw: number; vh: number; mode: string | null; range: { x: { lo: number; hi: number }; y: { lo: number; hi: number } } };
const view = (page: Page): Promise<V> => page.evaluate(() => (window as any).__dcView.get());

async function stageCentre(page: Page): Promise<{ x: number; y: number; box: { x: number; y: number; width: number; height: number } }> {
  const box = (await page.getByTestId('stage').boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

async function zoomMenu(page: Page, item: string): Promise<void> {
  await page.getByTestId('zoom-btn').click();
  await page.getByTestId('zoom-menu').getByRole('menuitemradio', { name: item, exact: true }).click();
}

/** Page width on screen fits → x centred and locked; scrolling sideways does nothing. */
async function expectCentredX(page: Page): Promise<void> {
  const v = await view(page);
  const w = (await doc(page)).width * v.zoom;
  expect(v.range.x.lo).toBeCloseTo(v.range.x.hi, 3);
  expect(v.panX).toBeCloseTo((v.vw - w) / 2, 0);
}

test('fit: page centred, no sideways scroll; zoomed wider than the workspace: scroll-x within the page edges + margin', async ({ page }) => {
  await newDesign(page);
  const c = await stageCentre(page);
  await page.mouse.move(c.x, c.y);
  await expect.poll(async () => (await view(page)).mode).toBe('fit');
  await expectCentredX(page);
  const before = await view(page);
  // trackpad sideways, shift + wheel, plain wheel: nothing moves while everything fits
  await page.mouse.wheel(300, 0);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 300);
  await page.keyboard.up('Shift');
  await page.mouse.wheel(0, 300);
  const after = await view(page);
  expect(after.panX).toBe(before.panX);
  expect(after.panY).toBe(before.panY);
  await expect(page.getByTestId('hscroll')).toHaveCount(0);
  await expect(page.getByTestId('vscroll')).toHaveCount(0);
  // space + drag can't move it either
  await page.keyboard.down('Space');
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 120, c.y + 80, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  expect((await view(page)).panX).toBe(before.panX);

  // 100%: 1080 px wide in a ~1000 px workspace → scroll-x allowed, clamped to the page edges + 40 px
  await zoomMenu(page, '100%');
  let v = await view(page);
  expect(v.zoom).toBe(1);
  expect(v.range.x.hi).toBe(40);
  expect(v.range.x.lo).toBeCloseTo(v.vw - 40 - 1080, 3);
  await expect(page.getByTestId('hscroll')).toHaveCount(1);
  for (let i = 0; i < 10; i++) await page.mouse.wheel(-400, 0);
  v = await view(page);
  expect(v.panX).toBe(40); // left page edge 40 px in from the workspace edge
  for (let i = 0; i < 10; i++) await page.mouse.wheel(400, 0);
  v = await view(page);
  expect(v.panX + 1080).toBeCloseTo(v.vw - 40, 3); // right edge 40 px in
  // shift + wheel scrolls sideways now
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Shift');
  expect((await view(page)).panX).toBeCloseTo(v.panX + 100, 3);
  // vertical: first page header at the top … "Add page" + margin at the bottom
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -400);
  v = await view(page);
  expect(v.panY).toBe(56);
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 400);
  v = await view(page);
  expect(v.panY + 1080 + 88).toBeCloseTo(v.vh, 3);
  const add = (await page.getByTestId('add-page').boundingBox())!;
  expect(add.y + add.height).toBeLessThan(c.box.y + c.box.height);

  // zoom back to fit: centred again
  await zoomMenu(page, 'Fit');
  await expectCentredX(page);
  await page.screenshot({ path: '/tmp/orch27-rw/r4-view-e2e-fit.png' });
});

test('zoom around the pointer; zoom slider, % menu presets, Fill, ⌘+/⌘− steps, ⌘0 / ⌥⌘0', async ({ page }) => {
  await newDesign(page);
  await zoomMenu(page, '200%');
  const v0 = await view(page);
  expect(v0.zoom).toBe(2);
  // a point on the page under the pointer stays put while zooming (when not clamped)
  const c = await stageCentre(page);
  const sx = c.x + 100, sy = c.y + 50;
  const local = { x: sx - c.box.x, y: sy - c.box.y };
  const world = { x: (local.x - v0.panX) / v0.zoom, y: (local.y - v0.panY) / v0.zoom };
  await page.mouse.move(sx, sy);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  const v1 = await view(page);
  expect(v1.zoom).toBeGreaterThan(2);
  expect(v1.mode).toBeNull();
  expect(v1.panX + world.x * v1.zoom).toBeCloseTo(local.x, 0);
  expect(v1.panY + world.y * v1.zoom).toBeCloseTo(local.y, 0);
  // zooming out past fit centres x again
  await page.keyboard.down('Control');
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 300);
  await page.keyboard.up('Control');
  await expectCentredX(page);
  // range 10%–500%
  expect((await view(page)).zoom).toBeGreaterThanOrEqual(0.1);
  await page.locator('input[aria-label=Zoom]').fill('5');
  expect((await view(page)).zoom).toBe(5);
  await page.locator('input[aria-label=Zoom]').blur();
  await expect(page.getByTestId('zoom')).toHaveText('500%');
  await page.keyboard.press('ControlOrMeta+=');
  expect((await view(page)).zoom).toBe(5);
  // ⌘− steps down Canva's levels: 500 → 400 → 300
  await page.keyboard.press('ControlOrMeta+-');
  await expect(page.getByTestId('zoom')).toHaveText('400%');
  await page.keyboard.press('ControlOrMeta+-');
  await expect(page.getByTestId('zoom')).toHaveText('300%');
  // ⌘0 = actual size, ⌥⌘0 = fit, ⇧⌘0 = fill
  await page.keyboard.press('ControlOrMeta+0');
  await expect(page.getByTestId('zoom')).toHaveText('100%');
  await page.keyboard.press('ControlOrMeta+Alt+0');
  await expect.poll(async () => (await view(page)).mode).toBe('fit');
  const fitZoom = (await view(page)).zoom;
  await page.keyboard.press('ControlOrMeta+=');
  await expect.poll(async () => (await view(page)).zoom).toBeGreaterThan(fitZoom);
  await page.keyboard.press('ControlOrMeta+Shift+0');
  const fill = await view(page);
  expect(fill.mode).toBe('fill');
  expect(1080 * fill.zoom).toBeCloseTo(fill.vw - 80, 0); // page width fills the workspace (less the margins)
  // the menu shows Canva's presets
  await page.getByTestId('zoom-btn').click();
  for (const z of ['300%', '200%', '125%', '100%', '75%', '50%', '25%', '10%', 'Fit', 'Fill'])
    await expect(page.getByTestId('zoom-menu').getByRole('menuitemradio', { name: z, exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('Fit re-fits on resize and panel toggles; a zoomed view stays put when the panel closes', async ({ page }) => {
  await newDesign(page);
  const a0 = await view(page);
  await page.getByTestId('collapse-panel').click();
  await expect.poll(async () => (await view(page)).vw).toBeGreaterThan(a0.vw);
  await expectCentredX(page);
  const a = await view(page);
  expect(a.mode).toBe('fit');
  await page.setViewportSize({ width: 1100, height: 760 });
  await expect.poll(async () => (await view(page)).vw).toBeLessThan(a.vw);
  await expectCentredX(page);
  const small = await view(page);
  expect(small.zoom).toBeLessThan(a.zoom); // re-fitted to the smaller window

  // zoomed by the user: the spot in the middle of the view stays in the middle
  await page.setViewportSize({ width: 1440, height: 900 });
  await zoomMenu(page, '200%');
  const c = await stageCentre(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.wheel(150, 200);
  const z = await view(page);
  const mid = { x: (z.vw / 2 - z.panX) / z.zoom, y: (z.vh / 2 - z.panY) / z.zoom };
  await page.getByTestId('tab-elements').click(); // panel opens: the workspace narrows
  await expect.poll(async () => (await view(page)).vw).toBeLessThan(z.vw);
  const z2 = await view(page);
  expect(z2.zoom).toBe(2);
  expect((z2.vw / 2 - z2.panX) / z2.zoom).toBeCloseTo(mid.x, 0);
  expect((z2.vh / 2 - z2.panY) / z2.zoom).toBeCloseTo(mid.y, 0);
});

test('very small and very large pages fit', async ({ page }) => {
  await newDesign(page);
  for (const [w, h] of [[300, 300], [4000, 2250]]) {
    await page.evaluate(([w, h]) => { const ed = (window as any).__dc; ed.commit({ ...ed.doc, width: w, height: h }); ed.seal(); }, [w, h]);
    await expect.poll(async () => (await view(page)).zoom * w).toBeLessThanOrEqual((await view(page)).vw - 80 + 0.5);
    const v = await view(page);
    expect(Math.min((v.vw - 80) / w, (v.vh - 144) / h)).toBeCloseTo(v.zoom, 3);
    await expectCentredX(page);
    expect(v.panY).toBeGreaterThanOrEqual(56);
    expect(v.panY + h * v.zoom).toBeLessThanOrEqual(v.vh - 88 + 0.5);
    await page.screenshot({ path: `/tmp/orch27-rw/r4-view-e2e-${w}x${h}.png` });
  }
});

test('pages: scrolling moves the counter, Page Down jumps, add / duplicate scroll to the new page, delete keeps the clamp', async ({ page }) => {
  await newDesign(page);
  await page.evaluate(() => { const ed = (window as any).__dc; ed.addPage(); ed.addPage(); ed.addPage(); });
  const counter = page.getByTestId('page-counter');
  await expect(counter).toHaveText('4 / 4');
  // the new page was scrolled into view
  await expect.poll(async () => (await view(page)).panY).toBeLessThan(-1000);
  await page.keyboard.press('Escape');
  await page.mouse.click(10, 10); // focus off any input
  await page.keyboard.press('PageUp');
  await expect(counter).toHaveText('3 / 4');
  await page.keyboard.press('Home'); // nothing
  await page.keyboard.press('PageUp');
  await page.keyboard.press('PageUp');
  await expect(counter).toHaveText('1 / 4');
  await expect.poll(async () => (await view(page)).panY).toBe(56);
  // scroll down: the counter follows the page in the middle of the view
  const c = await stageCentre(page);
  await page.mouse.move(c.x, c.y);
  await page.evaluate(() => (window as any).__dc.select([]));
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 300);
  await expect(counter).not.toHaveText('1 / 4');
  // vertical clamp at the bottom
  for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 500);
  const v = await view(page);
  expect(v.panY).toBe(v.range.y.lo);
  await expect(counter).toHaveText('4 / 4');
  // delete the last page: still within the (shorter) column
  await page.evaluate(() => { const ed = (window as any).__dc; ed.removePage(ed.doc.pages[3].id); });
  await expect.poll(async () => { const w = await view(page); return w.panY >= w.range.y.lo && w.panY <= w.range.y.hi; }).toBe(true);
  // duplicate page 1: the copy lands after it and is scrolled to
  await page.keyboard.press('PageUp');
  await page.keyboard.press('PageUp');
  await expect(counter).toHaveText('1 / 3');
  await expect.poll(async () => (await view(page)).panY).toBe(56);
  await page.getByTestId('page-header').first().getByRole('button', { name: 'Duplicate page' }).click();
  await expect(counter).toHaveText('2 / 4');
});

test('right-click menu: Copy, Paste, Duplicate, Delete, Layer, Align to page, Lock, page actions', async ({ page }) => {
  await newDesign(page);
  await page.evaluate(() => { const ed = (window as any).__dc; ed.addShape('rect'); ed.update({ x: 100, y: 100, w: 300, h: 300 }); ed.seal(); ed.addShape('ellipse'); ed.update({ x: 600, y: 600, w: 300, h: 300 }); ed.seal(); ed.select([]); });
  const els = await page.evaluate(() => (window as any).__dc.page.elements.map((e: any) => ({ id: e.id, x: e.x, y: e.y, w: e.w, h: e.h })));
  expect(els).toHaveLength(2);
  const v = await view(page);
  const st = (await page.getByTestId('stage').boundingBox())!;
  // pick a spot only the rectangle covers
  const r = els[0];
  const at = { x: st.x + v.panX + (r.x + 4) * v.zoom, y: st.y + v.panY + (r.y + 4) * v.zoom };
  await page.mouse.click(at.x, at.y, { button: 'right' });
  const menu = page.getByTestId('canvas-menu');
  await expect(menu).toBeVisible();
  expect(await page.evaluate(() => (window as any).__dc.selection)).toEqual([r.id]); // right-click selects
  for (const name of ['Copy', 'Paste', 'Duplicate', 'Delete', 'Layer', 'Align to page', 'Lock']) await expect(menu.getByRole('menuitem', { name: new RegExp(`^${name}`) }).first()).toBeVisible();
  await menu.getByRole('menuitem', { name: /^Layer/ }).hover();
  await page.getByTestId('canvas-menu-layer').getByRole('menuitem', { name: /Bring to front/ }).click();
  await expect(menu).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__dc.page.elements.at(-1).id)).toBe(r.id);
  // align to page: left
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await menu.getByRole('menuitem', { name: /^Align to page/ }).hover();
  await page.getByTestId('canvas-menu-align').getByRole('menuitem', { name: 'Left' }).click();
  expect(await page.evaluate((id) => (window as any).__dc.page.elements.find((e: any) => e.id === id).x, r.id)).toBe(0);
  // duplicate, then lock, then delete via the menu
  const sel = (await page.evaluate(() => (window as any).__dc.selected[0]))!;
  const at2 = { x: st.x + v.panX + (sel.x + 4) * v.zoom, y: st.y + v.panY + (sel.y + 4) * v.zoom };
  await page.mouse.click(at2.x, at2.y, { button: 'right' });
  await menu.getByRole('menuitem', { name: /^Duplicate/ }).click();
  expect((await doc(page)).pages[0].elements).toHaveLength(3);
  await page.mouse.click(at2.x, at2.y, { button: 'right' });
  await menu.getByRole('menuitem', { name: /^Lock/ }).click();
  expect(await page.evaluate(() => (window as any).__dc.selected[0].locked)).toBe(true);
  await page.mouse.click(at2.x, at2.y, { button: 'right' });
  await expect(menu.getByRole('menuitem', { name: /^Unlock/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  // on an empty part of the page: page actions
  const blank = { x: st.x + v.panX + 1050 * v.zoom, y: st.y + v.panY + 1050 * v.zoom };
  await page.mouse.click(blank.x, blank.y, { button: 'right' });
  await expect(menu.getByRole('menuitem', { name: 'Duplicate page' })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Add page' }).click();
  expect((await doc(page)).pages).toHaveLength(2);
  await page.screenshot({ path: '/tmp/orch27-rw/r4-view-e2e-menu.png' });
});

test('drag to reorder pages in the Pages strip and the grid view', async ({ page }) => {
  await newDesign(page);
  await page.evaluate(() => { const ed = (window as any).__dc; ed.addPage(); ed.addPage(); });
  const ids = (await doc(page)).pages.map((p: any) => p.id);
  await page.getByTestId('pages-btn').click();
  const strip = page.getByTestId('strip-page');
  await expect(strip).toHaveCount(3);
  // page 1 dropped after page 3
  const last = (await strip.nth(2).boundingBox())!;
  await strip.nth(0).dragTo(strip.nth(2), { targetPosition: { x: last.width - 4, y: last.height / 2 } });
  await expect.poll(async () => (await doc(page)).pages.map((p: any) => p.id)).toEqual([ids[1], ids[2], ids[0]]);
  // grid view: the (now) last page dropped before the first
  await page.getByTestId('grid-btn').click();
  const grid = page.getByTestId('grid-page');
  await expect(grid).toHaveCount(3);
  await grid.nth(2).dragTo(grid.nth(0), { targetPosition: { x: 4, y: 20 } });
  await expect.poll(async () => (await doc(page)).pages.map((p: any) => p.id)).toEqual([ids[0], ids[1], ids[2]]);
});

test('dragging an element to the workspace edge scrolls the view', async ({ page }) => {
  await newDesign(page);
  await page.evaluate(() => { const ed = (window as any).__dc; ed.addShape('rect'); });
  await zoomMenu(page, '200%');
  const before = await view(page);
  const sel = await page.evaluate(() => (window as any).__dc.selected[0]);
  const st = (await page.getByTestId('stage').boundingBox())!;
  const from = { x: st.x + before.panX + (sel.x + sel.w / 2) * 2, y: st.y + before.panY + (sel.y + sel.h / 2) * 2 };
  expect(from.y).toBeGreaterThan(st.y);
  expect(from.y).toBeLessThan(st.y + st.height);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, st.y + st.height - 6, { steps: 8 });
  await page.waitForTimeout(500);
  await page.mouse.up();
  const after = await view(page);
  expect(after.panY).toBeLessThan(before.panY - 50);
  const moved = await page.evaluate(() => (window as any).__dc.selected[0]);
  expect(moved.y - sel.y).toBeGreaterThan((st.y + st.height - 6 - from.y) / 2 + 20); // moved further than the pointer did
});

test('rulers follow scroll and zoom; selection handles keep their size', async ({ page }) => {
  await newDesign(page);
  await page.evaluate(() => { const ed = (window as any).__dc; ed.addShape('rect'); });
  await page.keyboard.press('Shift+R');
  await expect(page.getByTestId('ruler-top')).toBeVisible();
  const r0 = await page.locator('[data-testid=ruler-top] .page').evaluate((el) => (el as HTMLElement).style.left);
  const v0 = await view(page);
  expect(parseFloat(r0)).toBeCloseTo(v0.panX, 1);
  await zoomMenu(page, '200%');
  const c = await stageCentre(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.wheel(120, 80);
  const v1 = await view(page);
  const r1 = await page.locator('[data-testid=ruler-top] .page').evaluate((el) => ({ left: parseFloat((el as HTMLElement).style.left), width: parseFloat((el as HTMLElement).style.width) }));
  expect(r1.left).toBeCloseTo(v1.panX, 1);
  expect(r1.width).toBeCloseTo(1080 * 2, 1);
  const r = await page.locator('svg.overlay circle.handle').first().getAttribute('r');
  expect(r).toBe('5.5');
  await page.keyboard.press('Shift+R');
});
