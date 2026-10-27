import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { drag, elements, newDesign, pngBytes, selectionCenter } from './helpers.ts';

/** Screen point of a page point on page 1. */
async function screenOf(page: Page, p: { x: number; y: number }): Promise<{ x: number; y: number }> {
  return page.evaluate(([x, y]) => {
    const stage = document.querySelector('[data-testid="stage"]')!.getBoundingClientRect();
    // the page bar sits 34px above the page's top-left corner and is as wide as the page
    const bar = document.querySelector('.pagebar') as HTMLElement;
    const zoom = parseFloat(bar.style.width) / (window as any).__dc.doc.width;
    const left = parseFloat(bar.style.left), top = parseFloat(bar.style.top) + 34;
    return { x: stage.left + left + (x as number) * zoom, y: stage.top + top + (y as number) * zoom };
  }, [p.x, p.y]);
}

test('lines: add an arrow, drag its end onto a shape, the connector follows the shape', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('shape-rect').click();
  const [rect] = await elements(page);
  await page.getByTestId('line-arrow').click();
  let [, ln] = await elements(page);
  expect(ln!.type).toBe('line');
  expect((ln as any).end.marker).toBe('arrow');
  // drag the end handle onto the rectangle's left side anchor
  const endHandle = page.getByTestId('handle-end');
  const hb = (await endHandle.boundingBox())!;
  const target = await screenOf(page, { x: rect!.x, y: rect!.y + rect!.h / 2 });
  await drag(page, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, target);
  [, ln] = await elements(page);
  expect((ln as any).end.attach).toEqual({ elementId: rect!.id, point: { x: 0, y: 0.5 } });
  // move the rectangle: the line's end goes with it
  await page.evaluate((id) => { const c = (window as any).__dc; c.select([id]); c.nudge(0, 40); c.seal(); }, rect!.id);
  const [r2, l2] = await elements(page);
  expect(r2!.y).toBeCloseTo(rect!.y + 40, 0);
  expect((l2 as any).y + (l2 as any).end.y).toBeCloseTo(r2!.y + r2!.h / 2, 0);
  // properties: markers and route
  await page.evaluate((id) => (window as any).__dc.select([id]), ln!.id);
  await page.getByTestId('line-start').selectOption('circle');
  await page.getByTestId('line-route').selectOption('elbow');
  const [, l3] = await elements(page);
  expect((l3 as any).start.marker).toBe('circle');
  expect((l3 as any).route).toBe('elbow');
});

test('draw: a freehand stroke becomes a path element', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('tab-draw').click();
  await page.getByTestId('brush-marker').click();
  const a = await screenOf(page, { x: 200, y: 300 }), b = await screenOf(page, { x: 700, y: 500 });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 12, a.y + Math.sin(i / 2) * 40 + ((b.y - a.y) * i) / 12);
  await page.mouse.up();
  const els = await elements(page);
  expect(els).toHaveLength(1);
  const p = els[0] as any;
  expect(p.type).toBe('path');
  expect(p.paths[0].stroke.width).toBe(16);
  expect(p.paths[0].d).toMatch(/^M[\d.]+ [\d.]+C/);
  expect(p.w).toBeGreaterThan(400);
  // Esc stops drawing; a click then selects instead of drawing
  await page.keyboard.press('Escape');
  await page.mouse.click(a.x + 5, a.y + 5);
  expect(await elements(page)).toHaveLength(1);
});

test('frames: a photo goes into a circle frame and can be repositioned', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('frame-circle').click();
  const [f] = await elements(page);
  expect((f as any).mask).toBe('ellipse');
  expect((f as any).asset).toBe('');
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('frame-upload').click();
  await (await chooser).setFiles({ name: 'wide.png', mimeType: 'image/png', buffer: await pngBytes(page, 400, 100, '#ff0000') });
  await expect.poll(async () => ((await elements(page))[0] as any).asset).not.toBe('');
  const filled = (await elements(page))[0] as any;
  expect(filled.crop.w).toBeLessThan(0.5); // a wide photo is cropped to the round frame
  // double-click: move the photo inside the frame
  const c = await selectionCenter(page);
  await page.mouse.dblclick(c.x, c.y);
  await drag(page, c, { x: c.x + 80, y: c.y });
  const moved = (await elements(page))[0] as any;
  expect(moved.x).toBeCloseTo(filled.x, 1); // the frame stays
  expect(moved.crop.x).toBeLessThan(filled.crop.x); // the photo slid right
  await page.getByTestId('edit-frame').click();
  await page.getByTestId('frame-zoom').fill('200');
  expect(((await elements(page))[0] as any).crop.w).toBeCloseTo(filled.crop.w / 2, 2);
});

test('grids: a layout adds a frame per cell', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('grid-4g').click();
  const els = await elements(page);
  expect(els).toHaveLength(4);
  expect(els.every((e: any) => e.type === 'image' && e.mask === 'rect')).toBe(true);
});

test('tables: add, type in a cell, add a row and colour a cell', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('table-rows').fill('2');
  await page.getByTestId('table-cols').fill('3');
  await page.getByTestId('add-table').click();
  const [t] = await elements(page);
  expect(t!.type).toBe('table');
  // double-click the first cell of row 2
  const tl = await screenOf(page, { x: t!.x + 10, y: t!.y + t!.h * 0.75 });
  await page.mouse.dblclick(tl.x, tl.y);
  const editor = page.getByTestId('cell-editor');
  await expect(editor).toBeVisible();
  await editor.fill('Espresso\nDouble shot');
  await page.keyboard.press('Tab');
  await page.keyboard.type('€3.50');
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  const [t2] = (await elements(page)) as any[];
  expect(t2.cells[1][0].text).toBe('Espresso\nDouble shot');
  expect(t2.cells[1][1].text).toBe('€3.50');
  expect(t2.h).toBeGreaterThan(t!.h); // the row grew for two lines
  await page.getByTestId('edit-table').click();
  await page.getByTestId('row-add').click();
  const [t3] = (await elements(page)) as any[];
  expect(t3.rows).toHaveLength(3);
  expect(t3.cells).toHaveLength(3);
  await page.getByTestId('cell-fill').fill('#ffcc00');
  const [t4] = (await elements(page)) as any[];
  expect(t4.cells.flat().some((c: any) => c.fill === '#ffcc00')).toBe(true);
});

test('charts: add a column chart, edit data, switch to donut', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('chart-column').click();
  const [c] = (await elements(page)) as any[];
  expect(c.type).toBe('chart');
  await page.getByTestId('edit-chart').click();
  await page.getByTestId('chart-value-0-0').fill('42');
  await page.getByTestId('chart-add-row').click();
  const [c2] = (await elements(page)) as any[];
  expect(c2.series[0].values[0]).toBe(42);
  expect(c2.labels).toHaveLength(6);
  await page.getByTestId('chart-kind').selectOption('donut');
  expect(((await elements(page))[0] as any).chart).toBe('donut');
});

test('QR code: generate, then change its text', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('qr-text').fill('https://digital-canvas-p977.web.app');
  await page.getByTestId('add-qr').click();
  const [q] = (await elements(page)) as any[];
  expect(q.type).toBe('path');
  expect(q.qr).toBe('https://digital-canvas-p977.web.app');
  expect(q.paths.at(-1).d.length).toBeGreaterThan(200);
  await page.getByTestId('edit-qr').click();
  await page.getByTestId('qr-edit').fill('hello');
  await page.getByRole('button', { name: 'Update QR code' }).click();
  const [q2] = (await elements(page)) as any[];
  expect(q2.qr).toBe('hello');
  expect(q2.paths.at(-1).d).not.toBe(q.paths.at(-1).d);
});

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="currentColor" d="M10 20v-6h4v6h5v-8h3L12 3L2 12h3v8z"/></svg>';

test('icons: search Iconify (mocked) and insert a recolourable vector icon', async ({ page }) => {
  await page.route('https://api.iconify.design/search?*', (r) => r.fulfill({ json: { icons: ['mdi:home', 'mdi:home-outline'] } }));
  await page.route('https://api.iconify.design/mdi/*.svg', (r) => r.fulfill({ body: ICON_SVG, contentType: 'image/svg+xml' }));
  await newDesign(page);
  await page.getByTestId('icon-search').fill('home');
  await page.getByTestId('icon-search').press('Enter');
  await expect(page.getByTestId('icon-results').locator('button')).toHaveCount(2);
  await page.getByRole('button', { name: 'Add icon mdi:home', exact: true }).click();
  await expect.poll(async () => (await elements(page)).length).toBe(1);
  const [ic] = (await elements(page)) as any[];
  expect(ic.type).toBe('path');
  expect(ic.name).toBe('mdi:home');
  expect(ic.viewBox).toEqual({ x: 0, y: 0, w: 24, h: 24 });
  expect(ic.paths[0].fill).toEqual({ type: 'solid', color: '#1f2328' });
  await page.getByTestId('graphic-swatch-0').click();
  await page.getByTestId('graphic-color-0').fill('#ff0000');
  expect(((await elements(page))[0] as any).paths[0].fill.color).toBe('#ff0000');
});

test('photos: search Openverse (mocked) and add a photo with its credit', async ({ page }) => {
  await newDesign(page);
  const png = await pngBytes(page, 60, 40, '#00aa00');
  await page.route('https://api.openverse.org/v1/images/?*', (r) => r.fulfill({
    json: { results: [{ id: 'abc', title: 'Green field', creator: 'Ana', license: 'by', license_version: '4.0', url: 'https://photos.example/green.png', thumbnail: 'https://api.openverse.org/v1/images/abc/thumb/', foreign_landing_url: 'https://photos.example/green' }] },
  }));
  await page.route('https://photos.example/green.png', (r) => r.fulfill({ body: png, contentType: 'image/png' }));
  await page.route('https://api.openverse.org/v1/images/abc/thumb/', (r) => r.fulfill({ body: png, contentType: 'image/png' }));
  await page.getByTestId('tab-photos').click();
  await page.getByTestId('photo-search').fill('field');
  await page.getByTestId('photo-search').press('Enter');
  await page.getByTestId('photo-results').locator('button').first().click();
  await expect.poll(async () => (await elements(page)).length).toBe(1);
  const [img] = (await elements(page)) as any[];
  const meta = await page.evaluate((id) => (window as any).__dc.doc.assets[id], img.asset);
  expect(meta.name).toBe('"Green field" by Ana (CC BY 4.0) https://photos.example/green');
  expect(meta.width).toBe(60);
});

test('download: SVG and vector PDF', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('tab-text').click();
  await page.getByTestId('text-heading').click();
  await page.getByTestId('tab-elements').click();
  await page.getByTestId('chart-column').click();
  await page.getByTestId('download').click();
  await page.getByTestId('dl-format').selectOption('svg');
  let dl = page.waitForEvent('download');
  await page.getByTestId('do-download').click();
  const svg = readFileSync((await (await dl).path())!, 'utf8');
  expect(svg).toContain('<svg');
  expect(svg).toContain('>Add</text>');
  expect(svg).toContain('@font-face');
  await page.getByTestId('download').click();
  await page.getByTestId('dl-format').selectOption('pdfv');
  dl = page.waitForEvent('download');
  await page.getByTestId('do-download').click();
  const d = await dl;
  expect(d.suggestedFilename()).toMatch(/\.pdf$/);
  const pdf = readFileSync((await d.path())!);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.length).toBeGreaterThan(20_000); // the embedded font
});
