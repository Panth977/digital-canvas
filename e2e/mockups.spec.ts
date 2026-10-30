import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { newDesign, doc } from './helpers';
import { routeMockups } from './mockup-fixtures';

/**
 * The Mockups tab on the synthetic fixture library (e2e/fixtures/mockups,
 * tools/mockups/fixtures.ts): fx-poster (Print, 800×1000), fx-mug (Home,
 * 1000×800, tint), fx-billboard (Outdoor, 1200×800).
 */
const SHOTS = '/tmp/orch27-rw';

/** A red page with a white circle (easy to find in a composite). */
async function redPage(page: Page): Promise<void> {
  await page.evaluate(() => {
    const d = (window as any).__dc;
    d.updatePage({ background: { type: 'solid', color: '#e01010' } });
    d.addShape('ellipse');
    d.select([]);
    d.seal();
  });
}

/** RGBA of a canvas at fractions (fx, fy) of its size. */
function pixel(page: Page, testid: string, fx: number, fy: number): Promise<number[]> {
  return page.getByTestId(testid).evaluate((c: HTMLCanvasElement, [fx, fy]) => {
    const x = Math.floor(c.width * fx), y = Math.floor(c.height * fy);
    return Array.from(c.getContext('2d')!.getImageData(x, y, 1, 1).data);
  }, [fx, fy] as const);
}

const rendered = (page: Page, id: string) => page.getByTestId(`mockup-canvas-${id}`).getAttribute('data-rendered').then(Number);

async function openTab(page: Page): Promise<void> {
  await page.getByTestId('tab-mockups').click();
  await expect(page.getByTestId('mockups-panel')).toBeVisible();
}

test('no library yet: a calm empty state', async ({ page }) => {
  await page.route('**/mockups/index.json', (r) => r.fulfill({ status: 404, body: '' }));
  await newDesign(page);
  await openTab(page);
  await expect(page.getByTestId('mockups-empty')).toContainText('No mockups yet');
});

test('grid renders the page live on every mockup, filters by category, re-renders after an edit', async ({ page }) => {
  await routeMockups(page);
  await newDesign(page);
  await redPage(page);
  await openTab(page);
  // the rail keeps its sections: Mockups sits after Elements, Tools still has its device mockups
  await expect(page.getByTestId('tab-elements')).toBeVisible();
  await expect(page.getByTestId('tab-draw')).toBeVisible();

  await expect(page.getByTestId('mockup-grid').locator('button')).toHaveCount(3);
  for (const id of ['fx-poster', 'fx-mug', 'fx-billboard']) await expect.poll(() => rendered(page, id), { timeout: 15_000 }).toBeGreaterThan(0);
  // print areas show the design (red), outside the base photo stays
  const [r, g, b] = await pixel(page, 'mockup-canvas-fx-poster', 0.3, 0.3);
  expect(r).toBeGreaterThan(150); expect(g).toBeLessThan(60); expect(b).toBeLessThan(60);
  const wall = await pixel(page, 'mockup-canvas-fx-poster', 0.05, 0.05);
  expect(Math.abs(wall[0]! - wall[1]!)).toBeLessThan(25);
  const bill = await pixel(page, 'mockup-canvas-fx-billboard', 0.3, 0.45);
  expect(bill[0]).toBeGreaterThan(150); expect(bill[2]).toBeLessThan(60);

  // categories present in the library only
  await expect(page.getByTestId('mockup-cat-All')).toBeVisible();
  await expect(page.getByTestId('mockup-cat-Apparel')).toHaveCount(0);
  await page.getByTestId('mockup-cat-Outdoor').click();
  await expect(page.getByTestId('mockup-grid').locator('button')).toHaveCount(1);
  await expect(page.getByTestId('mockup-fx-billboard')).toBeVisible();
  await page.getByTestId('mockup-cat-Home').click();
  await expect(page.getByTestId('mockup-grid').locator('button')).toHaveCount(1);
  await expect(page.getByTestId('mockup-fx-mug')).toBeVisible();
  await page.getByTestId('mockup-cat-All').click();
  await expect(page.getByTestId('mockup-grid').locator('button')).toHaveCount(3);

  // an edit re-renders the tiles (debounced)
  for (const id of ['fx-poster', 'fx-mug', 'fx-billboard']) await expect.poll(() => rendered(page, id), { timeout: 15_000 }).toBeGreaterThan(0);
  const before = await rendered(page, 'fx-poster');
  await page.evaluate(() => { const d = (window as any).__dc; d.updatePage({ background: { type: 'solid', color: '#1040e0' } }); d.seal(); });
  await expect.poll(() => rendered(page, 'fx-poster'), { timeout: 15_000 }).toBeGreaterThan(before);
  const blue = await pixel(page, 'mockup-canvas-fx-poster', 0.3, 0.3);
  expect(blue[2]).toBeGreaterThan(150); expect(blue[0]).toBeLessThan(60);
});

test('page picker shows another page', async ({ page }) => {
  await routeMockups(page);
  await newDesign(page);
  await redPage(page);
  await page.evaluate(() => { const d = (window as any).__dc; d.addPage(); d.updatePage({ background: { type: 'solid', color: '#10c040' } }); d.seal(); });
  await openTab(page);
  // current page = page 2 (green)
  await expect.poll(() => rendered(page, 'fx-poster'), { timeout: 15_000 }).toBeGreaterThan(0);
  expect((await pixel(page, 'mockup-canvas-fx-poster', 0.3, 0.3))[1]).toBeGreaterThan(150);
  const firstPage = await page.evaluate(() => (window as any).__dc.doc.pages[0].id);
  const v = await rendered(page, 'fx-poster');
  await page.getByTestId('mockup-page').selectOption(firstPage);
  await expect.poll(() => rendered(page, 'fx-poster'), { timeout: 15_000 }).toBeGreaterThan(v);
  expect((await pixel(page, 'mockup-canvas-fx-poster', 0.3, 0.3))[0]).toBeGreaterThan(150);
});

test('preview dialog: full size, colours, prev/next, download PNG/JPG, add as a new page', async ({ page }) => {
  await routeMockups(page);
  await newDesign(page);
  await redPage(page);
  await openTab(page);
  await page.getByTestId('mockup-fx-mug').click();
  const dlg = page.getByTestId('mockup-preview');
  await expect(dlg).toBeVisible();
  const full = page.getByTestId('mockup-full');
  await expect(full).toHaveAttribute('data-mockup', 'fx-mug');
  await expect.poll(() => full.getAttribute('data-renders').then(Number), { timeout: 15_000 }).toBeGreaterThan(0);
  expect(await full.evaluate((c: HTMLCanvasElement) => [c.width, c.height])).toEqual([1000, 800]);
  await expect(page.getByTestId('mockup-credit')).toHaveText('Synthetic test mockup (CC0)');
  // colours: the list + a custom one; the first is the default
  await expect(dlg.locator('[role=radio]')).toHaveCount(4);
  await expect(full).toHaveAttribute('data-color', '#ffffff');
  const body = async () => full.evaluate((c: HTMLCanvasElement) => Array.from(c.getContext('2d')!.getImageData(470, 615, 1, 1).data));
  const white = await body();
  const firstMs = await full.getAttribute('data-ms');
  const n = Number(await full.getAttribute('data-renders'));
  await page.getByTestId('mockup-color-1f3a93').click();
  await expect(full).toHaveAttribute('data-color', '#1f3a93');
  await expect.poll(() => full.getAttribute('data-renders').then(Number)).toBeGreaterThan(n);
  const blue = await body();
  expect(white[0]! - blue[0]!).toBeGreaterThan(60);
  console.log(`mockup preview 1000×800: first render ${firstMs} ms (fetch + decode + prepare + composite), colour change ${await full.getAttribute('data-ms')} ms`);
  expect(blue[2]!).toBeGreaterThan(blue[0]! + 40);
  // custom colour
  await page.getByTestId('mockup-color-custom').evaluate((i: HTMLInputElement) => { i.value = '#00aa00'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(full).toHaveAttribute('data-color', '#00aa00');

  // download PNG: magic number and size
  const [png] = await Promise.all([page.waitForEvent('download'), page.getByTestId('mockup-download-png').click()]);
  expect(png.suggestedFilename()).toMatch(/ - Mug\.png$/);
  const pb = readFileSync((await png.path())!);
  expect([...pb.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect([pb.readUInt32BE(16), pb.readUInt32BE(20)]).toEqual([1000, 800]);
  const [jpg] = await Promise.all([page.waitForEvent('download'), page.getByTestId('mockup-download-jpg').click()]);
  const jb = readFileSync((await jpg.path())!);
  expect([jb[0], jb[1], jb[2]]).toEqual([0xff, 0xd8, 0xff]);

  // prev / next (and the keyboard)
  await page.getByTestId('mockup-next').click();
  await expect(full).toHaveAttribute('data-mockup', 'fx-billboard');
  await expect(dlg.locator('[role=radio]')).toHaveCount(0);
  await page.keyboard.press('ArrowLeft');
  await expect(full).toHaveAttribute('data-mockup', 'fx-mug');
  await expect(full).toHaveAttribute('data-color', '#00aa00'); // remembered per mockup
  await page.getByTestId('mockup-prev').click();
  await expect(full).toHaveAttribute('data-mockup', 'fx-poster');
  await expect.poll(async () => (await full.evaluate((c: HTMLCanvasElement) => [c.width, c.height])).join('x'), { timeout: 15_000 }).toBe('800x1000');

  // add to the design as a new page
  await page.getByTestId('mockup-add-page').click();
  await expect(dlg).toHaveCount(0);
  const d = await doc(page);
  expect(d.pages).toHaveLength(2);
  const els = d.pages[1].elements;
  expect(els).toHaveLength(1);
  expect(els[0].type).toBe('image');
  expect(d.assets[els[0].asset]).toMatchObject({ mime: 'image/png', width: 800, height: 1000 });
  // fitted inside the 1080×1080 page, centred
  expect(Math.round(els[0].h)).toBe(1080);
  expect(Math.round(els[0].x + els[0].w / 2)).toBe(540);
  expect(await page.evaluate(() => (window as any).__dc.pageIndex)).toBe(1);
});

test('Esc closes the preview; copy puts a PNG on the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await routeMockups(page);
  await newDesign(page);
  await redPage(page);
  await openTab(page);
  await page.getByTestId('mockup-fx-poster').click();
  const full = page.getByTestId('mockup-full');
  await expect.poll(() => full.getAttribute('data-renders').then(Number), { timeout: 15_000 }).toBeGreaterThan(0);
  await page.getByTestId('mockup-copy').click();
  await expect(page.getByText('Mockup copied')).toBeVisible();
  const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((i) => i.types));
  expect(types).toContain('image/png');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('mockup-preview')).toHaveCount(0);
  await expect(page.getByTestId('mockups-panel')).toBeVisible();
});

test('screenshots: grid light and dark, preview with a colour', async ({ page }) => {
  test.setTimeout(60_000);
  mkdirSync(SHOTS, { recursive: true });
  await routeMockups(page);
  await newDesign(page);
  await redPage(page);
  await page.evaluate(() => { const d = (window as any).__dc; d.addText('heading'); d.select([]); d.seal(); });
  await openTab(page);
  for (const id of ['fx-poster', 'fx-mug', 'fx-billboard']) await expect.poll(() => rendered(page, id), { timeout: 15_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, 'r13-ui-grid-light.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS, 'r13-ui-grid-dark.png') });
  await page.getByTestId('mockup-fx-mug').click();
  const full = page.getByTestId('mockup-full');
  await expect.poll(() => full.getAttribute('data-renders').then(Number), { timeout: 15_000 }).toBeGreaterThan(0);
  const n = Number(await full.getAttribute('data-renders'));
  await page.getByTestId('mockup-color-c0392b').click();
  await expect.poll(() => full.getAttribute('data-renders').then(Number)).toBeGreaterThan(n);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS, 'r13-ui-preview-color-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS, 'r13-ui-preview-color.png') });
});
