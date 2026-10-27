import { expect, test, type Page } from '@playwright/test';
import { doc, elements, newDesign } from './helpers.ts';
import { screenOf } from './module-stubs.ts';

async function stroke(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const a = await screenOf(page, from), b = await screenOf(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 10, a.y + ((b.y - a.y) * i) / 10);
  await page.mouse.up();
}

test('tools: draw with the pen, the eraser removes only drawings', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('shape-rect').click(); // not a drawing: the eraser leaves it
  await page.getByTestId('tab-draw').click();
  await expect(page.getByTestId('tools-panel')).toBeVisible();
  await page.getByTestId('brush-pen').click();
  await stroke(page, { x: 100, y: 150 }, { x: 900, y: 150 });
  await stroke(page, { x: 100, y: 950 }, { x: 900, y: 950 });
  await expect.poll(async () => (await elements(page)).length).toBe(3);
  await page.getByTestId('brush-eraser').click();
  await expect(page.getByTestId('draw-color')).toHaveCount(0); // the eraser has no colour
  await stroke(page, { x: 500, y: 60 }, { x: 500, y: 240 }); // across the first line only
  await expect.poll(async () => (await elements(page)).map((e) => e.type)).toEqual(['shape', 'path']);
  expect(((await elements(page))[1] as any).y).toBeGreaterThan(800);
  // undo brings the erased stroke back
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await elements(page)).length).toBe(3);
});

test('tools: sticky notes, whiteboard shapes, tables, charts and QR codes', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('tab-draw').click();
  await page.getByTestId('tool-sticky').click();
  expect(await page.evaluate(() => (window as any).__dc.tool)).toBeNull(); // tools turn the pen off
  await page.getByTestId('sticky-pink').click();
  let els = await elements(page) as any[];
  expect(els[0].type).toBe('group');
  expect(els[0].children.map((c: any) => c.type)).toEqual(['shape', 'path', 'text']);
  expect(els[0].children[0].fill.color).toBe('#f8bbd0');

  await page.getByTestId('tools-back').click();
  await page.getByTestId('tool-flow').click();
  await page.getByTestId('flow-decision').click();
  await page.getByTestId('flow-data').click();
  els = await elements(page) as any[];
  expect(els[1].children[0].shape).toBe('diamond');
  expect(els[1].children[1].text).toBe('Decision');
  expect(els[2].children[0].type).toBe('path');
  await page.getByTestId('flow-line-elbow').click();
  expect(((await elements(page))[3] as any).route).toBe('elbow');

  await page.getByTestId('tools-back').click();
  await page.getByTestId('tool-table').click();
  await page.getByTestId('tools-table-rows').fill('4');
  await page.getByTestId('tools-table-cols').fill('2');
  await page.getByTestId('tools-add-table').click();
  const t = (await elements(page)).at(-1) as any;
  expect([t.type, t.cells.length, t.cells[0].length]).toEqual(['table', 4, 2]);

  await page.getByTestId('tools-back').click();
  await page.getByTestId('tool-chart').click();
  await page.getByTestId('tools-chart-donut').click();
  expect(((await elements(page)).at(-1) as any).chart).toBe('donut');

  await page.getByTestId('tools-back').click();
  await page.getByTestId('tool-qr').click();
  await page.getByTestId('tools-qr-text').fill('https://digitalcanvas.app');
  await page.getByTestId('tools-add-qr').click();
  expect(((await elements(page)).at(-1) as any).qr).toBe('https://digitalcanvas.app');
});

test('tools: mockups put a picture of a page into a device', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('shape-star').click();
  await page.evaluate(() => (window as any).__dc.addPage());
  await page.getByTestId('tab-draw').click();
  await page.getByTestId('tool-mockups').click();
  const first = (await doc(page)).pages[0].id;
  await page.getByTestId('mockup-source').selectOption(first);
  await page.getByTestId('mockup-phone').click();
  await expect.poll(async () => (await elements(page, 1)).length).toBe(1);
  const [g] = (await elements(page, 1)) as any[];
  expect(g.type).toBe('group');
  expect(g.name).toBe('Phone mockup');
  const screen = g.children.find((c: any) => c.type === 'image');
  const d = await doc(page);
  expect(d.assets[screen.asset].mime).toBe('image/png');
  expect(d.assets[screen.asset].name).toBe(`Page 1 of ${d.title}`);
  expect(screen.h).toBeGreaterThan(screen.w * 1.8); // a tall phone screen

  await page.getByTestId('mockup-laptop').click();
  await expect.poll(async () => (await elements(page, 1)).length).toBe(2);
  expect(((await elements(page, 1))[1] as any).name).toBe('Laptop mockup');
});

test('tools: the background remover needs a photo', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('tab-draw').click();
  await page.getByTestId('tool-bg').click();
  await expect(page.getByText('Select a photo on the page')).toBeVisible();
  await expect(page.getByTestId('tools-bg-remove')).toHaveCount(0);
});
