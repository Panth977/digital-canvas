import { expect, test, type Locator, type Page } from '@playwright/test';
import { doc, drag, elements, newDesign, selectionCenter } from './helpers.ts';

/** A PNG made in the browser: left half `a`, right half `b` (or all `a`). */
async function png(page: Page, w: number, h: number, a: string, b = a): Promise<Buffer> {
  const b64 = await page.evaluate(async ([w, h, a, b]) => {
    const c = new OffscreenCanvas(w as number, h as number);
    const g = c.getContext('2d')!;
    g.fillStyle = a as string;
    g.fillRect(0, 0, (w as number) / 2, h as number);
    g.fillStyle = b as string;
    g.fillRect((w as number) / 2, 0, (w as number) / 2, h as number);
    const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let s = '';
    for (const x of buf) s += String.fromCharCode(x);
    return btoa(s);
  }, [w, h, a, b]);
  return Buffer.from(b64, 'base64');
}

async function upload(page: Page, buffer: Buffer): Promise<any> {
  await page.getByTestId('tab-uploads').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('upload').click();
  await (await chooser).setFiles({ name: 'photo.png', mimeType: 'image/png', buffer });
  await expect.poll(async () => (await elements(page)).filter((e) => e.type === 'image').length).toBe(1);
  return (await elements(page)).find((e) => e.type === 'image')!;
}

/** Set a range input like a user dragging it (input events, then change on release). */
async function slide(range: Locator, value: number): Promise<void> {
  await range.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

/** RGBA of a page pixel in the exported PNG (page px). */
function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return page.evaluate(async ([x, y]) => {
    const ed = (window as any).__dc;
    const bytes = ed.exportPage(ed.pageId, 'png', 1);
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d')!;
    g.drawImage(bmp, 0, 0);
    return Array.from(g.getImageData(Math.round(x!), Math.round(y!), 1, 1).data);
  }, [x, y]);
}

const el0 = async (page: Page) => (await elements(page))[0]! as any;

test('crop mode: resize the frame, slide and scale the image, Escape and Done exit', async ({ page }) => {
  await newDesign(page);
  const start = await upload(page, await png(page, 400, 200, '#ff0000', '#0000ff'));
  expect(start.crop).toBeUndefined();

  // double-click enters crop mode
  const c = await selectionCenter(page);
  await page.mouse.dblclick(c.x, c.y);
  await expect(page.getByTestId('crop-frame')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__dc.croppingId)).toBe(start.id);

  // drag the right edge of the frame in: the box narrows, the image stays put
  const e = (await page.getByTestId('crop-e').boundingBox())!;
  await drag(page, { x: e.x + e.width / 2, y: e.y + e.height / 2 }, { x: e.x + e.width / 2 - 150, y: e.y + e.height / 2 });
  let el = await el0(page);
  expect(el.w).toBeLessThan(start.w * 0.8);
  expect(el.x).toBeCloseTo(start.x, 0);
  expect(el.crop.x).toBeCloseTo(0, 3);
  expect(el.crop.w).toBeCloseTo(el.w / start.w, 2);

  // drag inside: the image slides behind the frame (to the left = later part shows)
  const c2 = await selectionCenter(page);
  await drag(page, c2, { x: c2.x - 80, y: c2.y });
  el = await el0(page);
  expect(el.crop.x).toBeGreaterThan(0.05);
  expect(el.x).toBeCloseTo(start.x, 0); // the frame did not move
  const panned = el.crop.x;

  // drag an image corner out: the image grows, so the frame shows less of it
  const se = (await page.getByTestId('crop-img-se').boundingBox())!;
  await drag(page, { x: se.x + se.width / 2, y: se.y + se.height / 2 }, { x: se.x + se.width / 2 + 120, y: se.y + se.height / 2 + 60 });
  el = await el0(page);
  expect(el.crop.h).toBeLessThan(0.95);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('crop-frame')).toBeHidden();
  expect((await el0(page)).crop).toEqual(el.crop); // kept

  // undo steps back through the crop drags
  await page.getByTestId('undo').click();
  expect((await el0(page)).crop.x).toBeCloseTo(panned, 5);

  // the Crop button enters too; Done leaves
  await page.getByTestId('crop').click();
  await expect(page.getByTestId('crop-frame')).toBeVisible();
  await page.getByTestId('crop-done').click();
  await expect(page.getByTestId('crop-frame')).toBeHidden();
});

test('adjust: saturation slider turns the photo grey; undo restores it', async ({ page }) => {
  await newDesign(page);
  const img = await upload(page, await png(page, 200, 200, '#ff2020'));
  const cx = img.x + img.w / 2, cy = img.y + img.h / 2;
  expect((await pixel(page, cx, cy))[0]).toBeGreaterThan(240);

  await page.getByTestId('imgtab-adjust').click();
  await slide(page.getByTestId('adj-saturation'), -100);
  expect((await el0(page)).adjust).toEqual({ saturation: -100 });
  const [r, g, b] = await pixel(page, cx, cy);
  expect(Math.abs(r! - g!)).toBeLessThan(4);
  expect(Math.abs(g! - b!)).toBeLessThan(4);

  await slide(page.getByTestId('adj-brightness'), 50);
  expect((await el0(page)).adjust).toEqual({ saturation: -100, brightness: 50 });
  await page.getByTestId('undo').click();
  expect((await el0(page)).adjust).toEqual({ saturation: -100 });
  await page.getByTestId('adj-reset').click();
  expect((await el0(page)).adjust).toBeUndefined();
  expect((await pixel(page, cx, cy))[0]).toBeGreaterThan(240);
});

test('filters: previews, Mono at full and zero intensity', async ({ page }) => {
  await newDesign(page);
  const img = await upload(page, await png(page, 200, 200, '#ff2020'));
  const cx = img.x + img.w / 2, cy = img.y + img.h / 2;
  await page.getByTestId('imgtab-filters').click();
  await expect(page.locator('[data-testid^="filter-"] img')).toHaveCount(13); // None + 12
  await page.getByTestId('filter-mono').click();
  expect((await el0(page)).filter).toEqual({ name: 'mono', intensity: 100 });
  const [r, , b] = await pixel(page, cx, cy);
  expect(Math.abs(r! - b!)).toBeLessThan(4);

  await slide(page.getByTestId('filter-intensity'), 0);
  expect((await el0(page)).filter.intensity).toBe(0);
  expect((await pixel(page, cx, cy))[0]).toBeGreaterThan(240);

  await page.getByTestId('filter-none').click();
  expect((await el0(page)).filter).toBeUndefined();
});

test('effects: drop shadow paints below-right of the image', async ({ page }) => {
  await newDesign(page);
  const img = await upload(page, await png(page, 200, 200, '#ff2020'));
  // a point just outside the image's bottom-right corner (shadow direction 45°)
  const px = img.x + img.w + 6, py = img.y + img.h + 6;
  expect(await pixel(page, px, py)).toEqual([255, 255, 255, 255]);

  await page.getByTestId('imgtab-effects').click();
  await page.getByTestId('img-effect').selectOption('shadow');
  expect((await el0(page)).effect.type).toBe('shadow');
  await slide(page.getByTestId('ifx-offset'), 100);
  await slide(page.getByTestId('ifx-blur'), 0);
  await slide(page.getByTestId('ifx-transparency'), 0);
  expect((await el0(page)).effect).toMatchObject({ blur: 0, transparency: 0 });
  const [r, g, b] = await pixel(page, px, py);
  expect(r! + g! + b!).toBeLessThan(60);

  await page.getByTestId('img-effect').selectOption('duotone');
  expect((await el0(page)).effect).toMatchObject({ type: 'duotone' });
  await page.getByTestId('img-effect').selectOption('');
  expect((await el0(page)).effect).toBeUndefined();
});

test('background remover (stub model): new PNG asset, original kept, restore and undo', async ({ page }) => {
  await newDesign(page);
  const img = await upload(page, await png(page, 200, 200, '#ff2020', '#2020ff'));
  // a stand-in for the model: clears the left half
  await page.evaluate(() => {
    (window as any).__dc.bgRemover = async (bytes: Uint8Array, mime: string, progress: (m: string) => void) => {
      progress('Removing the background…');
      const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d')!;
      g.drawImage(bmp, 0, 0);
      g.clearRect(0, 0, bmp.width / 2, bmp.height);
      return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
    };
  });
  await page.getByTestId('remove-bg').click();
  await expect.poll(async () => (await el0(page)).asset).not.toBe(img.asset);
  const el = await el0(page);
  expect(el.original).toBe(img.asset);
  const d = await doc(page);
  expect(d.assets[el.asset]).toMatchObject({ mime: 'image/png', width: 200, height: 200 });
  expect(d.assets[img.asset]).toBeTruthy();
  // the left half now shows the page through it
  expect(await pixel(page, img.x + img.w * 0.25, img.y + img.h / 2)).toEqual([255, 255, 255, 255]);
  expect((await pixel(page, img.x + img.w * 0.75, img.y + img.h / 2))[2]).toBeGreaterThan(200);

  await page.getByTestId('restore-original').click();
  expect((await el0(page)).asset).toBe(img.asset);
  expect((await el0(page)).original).toBeUndefined();
  await page.getByTestId('undo').click();
  expect((await el0(page)).asset).toBe(el.asset);
  await page.getByTestId('undo').click();
  expect((await el0(page)).asset).toBe(img.asset);
});

test('set an image as the page background', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('shape-rect').click();
  await upload(page, await png(page, 300, 100, '#20a020'));
  const before = await elements(page);
  expect(before.map((e) => e.type)).toEqual(['shape', 'image']);
  await page.getByTestId('set-bg').click();
  const d = await doc(page);
  const [bg] = await elements(page);
  expect(bg).toMatchObject({ type: 'image', x: 0, y: 0, w: d.width, h: d.height, locked: true });
  expect((await pixel(page, 2, 2))[1]).toBeGreaterThan(140); // the page corner is the photo now
});
