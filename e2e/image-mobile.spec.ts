import { expect, test, type Page, type CDPSession } from '@playwright/test';
import { elements, newDesign } from './helpers.ts';

/** The Edit image panel on phones (touch, real CDP fingers). */

type P = { x: number; y: number };
async function swipe(c: CDPSession, a: P, b: P): Promise<void> {
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...a, id: 0 }] });
  for (let i = 1; i <= 6; i++) await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + ((b.x - a.x) * i) / 6, y: a.y + ((b.y - a.y) * i) / 6, id: 0 }] });
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function addPhoto(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const c = new OffscreenCanvas(300, 300), g = c.getContext('2d')!;
    g.fillStyle = '#ff2020'; g.fillRect(0, 0, 300, 300);
    const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
    const ed = (window as any).__dc;
    await ed.addImage(bytes, 'image/png', 'photo.png');
  });
  await expect.poll(async () => (await elements(page)).length).toBe(1);
}

test('tabs and sliders fit a phone; the panel edits the picture', async ({ page }) => {
  await newDesign(page);
  await addPhoto(page);
  await page.getByTestId('m-edit-image').click();
  const panel = page.getByTestId('image-tools');
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  await page.getByTestId('imgtab-adjust').click();
  await page.getByTestId('adj-clarity').evaluate((el) => { const i = el as HTMLInputElement; i.value = '40'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(((await elements(page))[0] as any).adjust.clarity).toBe(40);
  await page.getByTestId('imgtab-shadows').click();
  await page.getByTestId('shadow-drop').click();
  expect(((await elements(page))[0] as any).shadow.style).toBe('drop');
  await page.getByTestId('imgtab-effects').scrollIntoViewIfNeeded();
  await page.getByTestId('imgtab-effects').click();
  await page.getByTestId('stylize-halftone').click();
  expect(((await elements(page))[0] as any).stylize.type).toBe('halftone');
});

test('the brush takes a finger, with the sheet out of the way', async ({ page }) => {
  await newDesign(page);
  await addPhoto(page);
  const asset = ((await elements(page))[0] as any).asset;
  await page.evaluate(() => {
    (window as any).__dc.inpainter = async (bytes: Uint8Array) => bytes;
  });
  await page.getByTestId('m-edit-image').click();
  await page.getByTestId('tool-erase').click();
  await expect(page.getByTestId('image-tools')).toBeHidden();
  const canvas = page.getByTestId('brush-canvas');
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId('brush-bar')).toBeVisible();
  const bar = (await page.getByTestId('brush-bar').boundingBox())!;
  expect(bar.x).toBeGreaterThanOrEqual(0);
  expect(bar.x + bar.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  const b = (await canvas.boundingBox())!;
  const c = await page.context().newCDPSession(page);
  await swipe(c, { x: b.x + b.width * 0.3, y: b.y + b.height / 2 }, { x: b.x + b.width * 0.7, y: b.y + b.height / 2 });
  await expect(page.getByTestId('brush-done')).toBeEnabled();
  await page.getByTestId('brush-done').click();
  await expect(canvas).toBeHidden();
  await expect.poll(async () => ((await elements(page))[0] as any).original).toBe(asset);
});

test('the crop bar fits a phone', async ({ page }) => {
  await newDesign(page);
  await addPhoto(page);
  await page.getByTestId('m-crop').click();
  const bar = page.getByTestId('crop-bar');
  await expect(bar).toBeVisible();
  const b = (await bar.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  await page.getByTestId('ratio-1:1').click();
  await page.getByTestId('crop-done').click();
  await expect(bar).toBeHidden();
});
