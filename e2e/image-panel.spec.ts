import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import { doc, elements, newDesign } from './helpers.ts';

/** The Edit image panel, its tools and the mask brush. Models and AI keys are stubbed; the last tests run the real ones when DC_REAL_MODELS is set. */

async function png(page: Page, w: number, h: number, a: string, b = a): Promise<Buffer> {
  const b64 = await page.evaluate(async ([w, h, a, b]) => {
    const c = new OffscreenCanvas(w as number, h as number), g = c.getContext('2d')!;
    g.fillStyle = a as string; g.fillRect(0, 0, (w as number) / 2, h as number);
    g.fillStyle = b as string; g.fillRect((w as number) / 2, 0, (w as number) / 2, h as number);
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

const slide = (page: Page, id: string, value: number) => page.getByTestId(id).evaluate((el, v) => {
  const i = el as HTMLInputElement;
  i.value = String(v);
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.dispatchEvent(new Event('change', { bubbles: true }));
}, value);

const pixel = (page: Page, x: number, y: number): Promise<number[]> => page.evaluate(async ([x, y]) => {
  const ed = (window as any).__dc;
  const bmp = await createImageBitmap(new Blob([ed.exportPage(ed.pageId, 'png', 1)], { type: 'image/png' }));
  const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d')!;
  g.drawImage(bmp, 0, 0);
  return Array.from(g.getImageData(Math.round(x!), Math.round(y!), 1, 1).data);
}, [x, y]);

const el0 = async (page: Page) => (await elements(page)).find((e) => e.type === 'image') as any;

/** Stand-ins for the models: the remover keeps the right half; the inpainter paints the masked area green and records the mask. */
async function stubs(page: Page): Promise<void> {
  await page.evaluate(() => {
    const ed = (window as any).__dc, w = window as any;
    ed.bgRemover = async (bytes: Uint8Array, mime: string) => {
      const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
      const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d')!;
      g.drawImage(bmp, 0, 0);
      g.clearRect(0, 0, bmp.width / 2, bmp.height);
      return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
    };
    ed.inpainter = async (bytes: Uint8Array, mime: string, mask: Uint8Array) => {
      const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
      const m = await createImageBitmap(new Blob([mask as BlobPart], { type: 'image/png' }));
      const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d')!;
      g.drawImage(bmp, 0, 0);
      const t = new OffscreenCanvas(bmp.width, bmp.height), tg = t.getContext('2d')!;
      tg.drawImage(m, 0, 0, bmp.width, bmp.height);
      tg.globalCompositeOperation = 'source-in';
      tg.fillStyle = '#00ff00';
      tg.fillRect(0, 0, bmp.width, bmp.height);
      g.drawImage(t, 0, 0);
      w.__inpainted = (w.__inpainted ?? 0) + 1;
      return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
    };
    ed.ocr = async () => [{ text: 'SALE', x: 0.1, y: 0.1, w: 0.4, h: 0.1, color: '#112233' }];
  });
}

/** Paint across the middle of the brush canvas. */
async function paint(page: Page, from = 0.3, to = 0.7): Promise<void> {
  const b = (await page.getByTestId('brush-canvas').boundingBox())!;
  const y = b.y + b.height / 2;
  await page.mouse.move(b.x + b.width * from, y);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * to, y, { steps: 8 });
  await page.mouse.up();
}

test('the panel has Canva\'s sections, every slider and the filter families', async ({ page }) => {
  await newDesign(page);
  await upload(page, await png(page, 200, 200, '#808080'));
  await page.getByTestId('edit-image').click();
  for (const t of ['tools', 'filters', 'adjust', 'shadows', 'duotone', 'effects']) await expect(page.getByTestId(`imgtab-${t}`)).toBeVisible();
  for (const t of ['remove-bg', 'tool-erase', 'tool-grab', 'tool-text', 'tool-edit', 'tool-expand', 'tool-crop', 'tool-blur', 'tool-focus', 'tool-pop', 'retouch']) await expect(page.getByTestId(t)).toBeVisible();
  await page.getByTestId('imgtab-adjust').click();
  for (const g of ['White balance', 'Light', 'Colour', 'Texture', 'Colour edit']) await expect(page.locator('summary', { hasText: new RegExp(`^${g}$`) })).toBeVisible();
  for (const k of ['temperature', 'tint', 'brightness', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'vibrance', 'saturation', 'texture', 'clarity', 'sharpen', 'fade', 'grain', 'vignette', 'blur']) await expect(page.getByTestId(`adj-${k}`)).toHaveCount(1);
  await expect(page.locator('[data-testid^="band-"][aria-label]')).toHaveCount(8);
  await page.getByTestId('imgtab-shadows').click();
  await expect(page.locator('[data-testid^="shadow-"]')).toHaveCount(8);
  await page.getByTestId('imgtab-duotone').click();
  await expect(page.locator('[data-testid^="duo-"]')).toHaveCount(13);
});

test('whites, vibrance and colour edit change the export; invert and auto-adjust too', async ({ page }) => {
  await newDesign(page);
  const img = await upload(page, await png(page, 200, 200, '#a06050'));
  const cx = img.x + img.w / 2, cy = img.y + img.h / 2;
  const base = await pixel(page, cx, cy);
  await page.getByTestId('edit-image').click();
  await page.getByTestId('imgtab-adjust').click();
  await slide(page, 'adj-vibrance', 100);
  expect((await el0(page)).adjust.vibrance).toBe(100);
  const vib = await pixel(page, cx, cy);
  expect(vib[0]! - vib[2]!).toBeGreaterThan(base[0]! - base[2]!);
  await slide(page, 'adj-vibrance', 0);
  await page.getByTestId('band-red').click();
  await slide(page, 'band-hue', 100);
  expect((await el0(page)).colorEdit.red.hue).toBe(100);
  expect((await pixel(page, cx, cy))[1]).toBeGreaterThan(base[1]! + 8);
  await page.getByTestId('adj-reset').click();
  await page.getByTestId('invert').check();
  expect(await pixel(page, cx, cy)).toEqual([255 - base[0]!, 255 - base[1]!, 255 - base[2]!, 255].map((v, i) => (i < 3 ? expect.closeTo(v, -1) : v)) as any);
  await page.getByTestId('invert').uncheck();
  await page.getByTestId('auto-adjust').click();
  await expect.poll(async () => !!(await el0(page)).auto).toBe(true);
  await slide(page, 'auto-intensity', 40);
  expect((await el0(page)).auto.intensity).toBe(40);
});

test('foreground and background edits, Colour Pop and Auto Focus use one subject mask', async ({ page }) => {
  await newDesign(page);
  const img = await upload(page, await png(page, 200, 200, '#cc4040'));
  await stubs(page);
  const left = img.x + img.w * 0.2, right = img.x + img.w * 0.8, y = img.y + img.h / 2;
  await page.getByTestId('edit-image').click();
  await page.getByTestId('imgtab-adjust').click();
  await page.getByTestId('scope-foreground').click();
  await expect.poll(async () => !!(await el0(page)).matte).toBe(true);
  const matte = (await el0(page)).matte;
  await expect(page.getByTestId('scope-foreground')).toHaveClass(/on/);
  await slide(page, 'adj-brightness', 100);
  expect((await el0(page)).selective.foreground.brightness).toBe(100);
  expect((await pixel(page, right, y))[1]).toBeGreaterThan((await pixel(page, left, y))[1]! + 20); // the stub's subject is the right half
  await page.getByTestId('adj-reset').click();
  await page.getByTestId('imgtab-tools').click();
  await page.getByTestId('tool-pop').click();
  await expect.poll(async () => (await el0(page)).selective?.background?.saturation).toBe(-100);
  const l = await pixel(page, left, y);
  expect(Math.abs(l[0]! - l[2]!)).toBeLessThan(10);
  const r = await pixel(page, right, y);
  expect(r[0]! - r[2]!).toBeGreaterThan(60);
  await page.getByTestId('tool-focus').click();
  await expect.poll(async () => (await el0(page)).autoFocus).toBe(40);
  await slide(page, 'auto-focus', 80);
  expect((await el0(page)).autoFocus).toBe(80);
  expect((await el0(page)).matte).toBe(matte); // found once
  expect((await doc(page)).assets[matte]).toBeTruthy();
});

test('background remover: Erase and Restore brushes fix the mask, the original stays', async ({ page }) => {
  await newDesign(page);
  const img = await upload(page, await png(page, 200, 200, '#ff2020', '#2020ff'));
  await stubs(page);
  await page.getByTestId('edit-image').click();
  await page.getByTestId('remove-bg').click();
  await expect.poll(async () => !!(await el0(page)).original).toBe(true);
  expect(await pixel(page, img.x + img.w * 0.25, img.y + img.h / 2)).toEqual([255, 255, 255, 255]);

  // restore a stroke on the left, erase one on the right
  await page.getByTestId('bg-brush').click();
  await page.getByTestId('brush-add').click();
  await paint(page, 0.1, 0.4);
  await page.getByTestId('brush-remove').click();
  await paint(page, 0.6, 0.9);
  await page.getByTestId('brush-done').click();
  await expect(page.getByTestId('brush-canvas')).toBeHidden();
  await expect.poll(async () => (await pixel(page, img.x + img.w * 0.25, img.y + img.h / 2))[0]).toBeGreaterThan(200);
  const p = await pixel(page, img.x + img.w * 0.25, img.y + img.h / 2);
  expect(p[1]).toBeLessThan(80); // the red came back
  expect(await pixel(page, img.x + img.w * 0.75, img.y + img.h / 2)).toEqual([255, 255, 255, 255]); // the blue went
  expect(await pixel(page, img.x + img.w * 0.75, img.y + img.h * 0.1)).not.toEqual([255, 255, 255, 255]); // untouched
  expect((await el0(page)).original).toBe(img.asset);
  await page.getByTestId('restore-original').click();
  expect((await el0(page)).asset).toBe(img.asset);
});

test('blur brush: only the painted part blurs, its strength stays editable, Esc cancels', async ({ page }) => {
  await newDesign(page);
  const img = await upload(page, await png(page, 400, 400, '#000000', '#ffffff'));
  await page.getByTestId('edit-image').click();
  await page.getByTestId('tool-blur').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('brush-canvas')).toBeHidden();
  expect((await el0(page)).blurBrush).toBeUndefined();
  await page.getByTestId('tool-blur').click();
  await paint(page, 0.4, 0.6);
  await page.getByTestId('brush-done').click();
  await expect.poll(async () => !!(await el0(page)).blurBrush).toBe(true);
  const c = await pixel(page, img.x + img.w * 0.48, img.y + img.h / 2);
  expect(c[0]).toBeGreaterThan(20); // white bled into black
  const far = await pixel(page, img.x + img.w * 0.48, img.y + 6);
  expect(far[0]).toBeLessThan(6);
  await slide(page, 'blur-intensity', 10);
  expect((await el0(page)).blurBrush.intensity).toBe(10);
  await page.getByTestId('blur-remove').click();
  expect((await el0(page)).blurBrush).toBeUndefined();
});

test('a stroke started while the brush loads never drags the picture', async ({ page }) => {
  await newDesign(page);
  const img = await upload(page, await png(page, 800, 800, '#ff2020'));
  await page.getByTestId('edit-image').click();
  await page.getByTestId('tool-erase').click(); // no wait for the picture to decode
  const b = (await page.getByTestId('brush-canvas').boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.8, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
  const el = await el0(page);
  expect([el.x, el.y]).toEqual([img.x, img.y]);
});

test('Magic Eraser fills what was brushed; undo brings it back', async ({ page }) => {
  await newDesign(page);
  const img = await upload(page, await png(page, 200, 200, '#ff2020'));
  await stubs(page);
  await page.getByTestId('edit-image').click();
  await page.getByTestId('tool-erase').click();
  await expect(page.getByTestId('brush-done')).toBeDisabled();
  await paint(page);
  await page.getByTestId('brush-done').click();
  await expect.poll(async () => (await el0(page)).asset).not.toBe(img.asset);
  expect((await el0(page)).original).toBe(img.asset);
  expect((await pixel(page, img.x + img.w / 2, img.y + img.h / 2))[1]).toBeGreaterThan(200);
  expect((await pixel(page, img.x + img.w / 2, img.y + 6))[0]).toBeGreaterThan(200);
  await page.getByTestId('undo').click();
  expect((await el0(page)).asset).toBe(img.asset);
});

test('Magic Grab: subject on top, background filled; Grab Text; Magic Crop', async ({ page }) => {
  await newDesign(page);
  const img = await upload(page, await png(page, 200, 200, '#ff2020', '#2020ff'));
  await stubs(page);
  // Magic Crop: a subject in the top-right quarter
  const realRemover = await page.evaluateHandle(() => (window as any).__dc.bgRemover);
  await page.evaluate(() => {
    const ed = (window as any).__dc, keep = ed.bgRemover;
    ed.bgRemover = async (b: Uint8Array, m: string) => {
      const bmp = await createImageBitmap(new Blob([(await keep(b, m)) as BlobPart], { type: 'image/png' }));
      const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d')!;
      g.drawImage(bmp, 0, 0);
      g.clearRect(0, bmp.height / 2, bmp.width, bmp.height / 2);
      return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
    };
  });
  await page.getByTestId('edit-image').click();
  await page.getByTestId('tool-crop').click();
  await expect.poll(async () => (await el0(page)).crop?.w).toBeLessThan(0.8);
  expect((await el0(page)).crop.x).toBeGreaterThan(0.3);
  await page.getByTestId('undo').click();
  await page.getByTestId('undo').click(); // and the mask it made
  await page.evaluate((f) => { (window as any).__dc.bgRemover = f; }, realRemover);
  await page.getByTestId('tool-grab').click();
  await expect.poll(async () => (await elements(page)).filter((e) => e.type === 'image').length).toBe(2);
  const [base, top] = (await elements(page)) as any[];
  expect(top.name).toBe('Subject');
  expect(base.asset).not.toBe(top.asset);
  expect(base.original).toBe(img.asset);
  expect(await page.evaluate(() => (window as any).__dc.selection)).toEqual([top.id]);
  await page.evaluate((id) => (window as any).__dc.select([id]), base.id);
  await page.getByTestId('tool-text').click();
  await expect.poll(async () => (await elements(page)).some((e) => e.type === 'text')).toBe(true);
  const t = (await elements(page)).find((e) => e.type === 'text')!;
  expect(t.text).toBe('SALE');
  expect(t.style.color).toBe('#112233');
});

test('Magic Edit and Magic Expand say they need a key; with one, only the new part changes', async ({ page }) => {
  await newDesign(page);
  const img = await upload(page, await png(page, 200, 200, '#ff2020'));
  await stubs(page);
  await page.getByTestId('edit-image').click();
  await expect(page.getByTestId('key-note')).toContainText('own image AI key');
  await expect(page.getByTestId('tool-edit')).toBeDisabled();
  await expect(page.getByTestId('tool-expand')).toBeDisabled();

  // stand-in for the provider: returns a blue picture of the same size
  await page.evaluate(() => {
    (window as any).__dc.imageEditor = async (image: { bytes: Uint8Array; mime: string }) => {
      const b = await createImageBitmap(new Blob([image.bytes as BlobPart], { type: image.mime }));
      const c = new OffscreenCanvas(b.width, b.height), g = c.getContext('2d')!;
      g.fillStyle = '#0000ff';
      g.fillRect(0, 0, b.width, b.height);
      return { bytes: new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()), mime: 'image/png' };
    };
  });
  await page.getByTestId('imgtab-adjust').click();
  await page.getByTestId('imgtab-tools').click();
  await expect(page.getByTestId('tool-edit')).toBeEnabled();
  await page.getByTestId('tool-edit').click();
  await paint(page);
  await expect(page.getByTestId('brush-done')).toBeDisabled();
  await page.getByTestId('brush-prompt').fill('a blue square');
  await page.getByTestId('brush-done').click();
  await expect.poll(async () => (await pixel(page, img.x + img.w / 2, img.y + img.h / 2))[2]).toBeGreaterThan(200);
  expect((await pixel(page, img.x + img.w / 2, img.y + 8))[0]).toBeGreaterThan(200); // outside the brush: untouched

  await page.getByTestId('tool-expand').click();
  await page.getByTestId('expand-16:9').click();
  await expect.poll(async () => (await el0(page)).w).toBeGreaterThan(img.w * 1.5);
  expect((await el0(page)).h).toBeCloseTo(img.h, 0);
});

test('crop bar: ratio, straighten, tilt, shape, rotate, reset', async ({ page }) => {
  await newDesign(page);
  await upload(page, await png(page, 400, 300, '#ff2020', '#2020ff'));
  await page.getByTestId('crop').click();
  await page.getByTestId('ratio-1:1').click();
  let el = await el0(page);
  expect(el.w / el.h).toBeCloseTo(1, 2);
  await page.getByTestId('ratio-16:9').click();
  el = await el0(page);
  expect(el.w / el.h).toBeCloseTo(16 / 9, 2);
  await slide(page, 'crop-straighten', 12);
  expect((await el0(page)).straighten).toBe(12);
  await page.getByTestId('crop-more').click();
  await slide(page, 'crop-tiltx', 30);
  expect((await el0(page)).tiltX).toBe(30);
  await page.getByTestId('crop-shape').selectOption({ index: 1 });
  expect((await el0(page)).mask).toBeTruthy();
  await page.getByTestId('crop-rotate').click();
  expect((await el0(page)).rotation).toBe(90);
  await page.getByTestId('crop-reset').click();
  el = await el0(page);
  expect(el.straighten).toBeUndefined();
  expect(el.crop).toBeUndefined();
  await page.getByTestId('crop-done').click();
  await expect(page.getByTestId('crop-bar')).toBeHidden();
});

test('toolbar: border, blend, replace, detach, download selection', async ({ page }) => {
  await newDesign(page);
  const img = await upload(page, await png(page, 200, 200, '#808080'));
  await page.getByTestId('border-btn').click();
  await page.getByTestId('border-solid').click();
  expect((await el0(page)).border).toMatchObject({ width: 8, color: '#000000' });
  expect((await pixel(page, img.x + img.w / 2, img.y + 2))[0]).toBeLessThan(10);
  await page.getByTestId('border-dashed').click();
  expect((await el0(page)).border.dash).toBe('dashed');
  await page.getByTestId('border-none').click();
  expect((await el0(page)).border).toBeUndefined();

  await page.getByTestId('opacity-btn').click();
  await page.getByTestId('blend').selectOption('multiply');
  expect((await el0(page)).blend).toBe('multiply');
  await page.getByTestId('opacity-btn').click();

  await page.getByTestId('more-btn').click();
  const dl = page.waitForEvent('download');
  await page.getByTestId('download-selection').click();
  expect((await dl).suggestedFilename()).toMatch(/\.png$/);

  await page.getByTestId('more-btn').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('replace-image').click();
  await (await chooser).setFiles({ name: 'other.png', mimeType: 'image/png', buffer: await png(page, 100, 300, '#00ff00') });
  await expect.poll(async () => (await el0(page)).asset).not.toBe(img.asset);
  expect((await el0(page)).w).toBe(img.w); // same box

  await page.getByTestId('more-btn').click();
  await page.getByTestId('set-bg').click();
  expect((await el0(page)).locked).toBe(true);
  await page.getByTestId('more-btn').click();
  await page.getByTestId('detach-bg').click();
  const el = await el0(page);
  expect(el.locked).toBe(false);
  expect(el.w).toBeLessThan((await doc(page)).width);
});

test('export matches the editor with shadow, duotone, stylize and adjustments on', async ({ page }) => {
  await newDesign(page);
  const img = await upload(page, await png(page, 400, 400, '#d08040', '#4080d0'));
  await page.evaluate(() => (window as any).__dc.updateLook({
    adjust: { clarity: 40, vibrance: 30, grain: 10, whites: 15 }, colorEdit: { blue: { hue: 30 } }, duotone: { dark: '#14532d', light: '#fef08a', intensity: 60 },
    shadow: { style: 'drop', size: 50, blur: 20, angle: 45, distance: 40, transparency: 30, color: '#000000' }, stylize: { type: 'posterize', amount: 50 },
  }));
  await page.evaluate(() => (window as any).__dc.select([]));
  await page.waitForTimeout(400);
  // read the visible stage canvas at the zoom it shows, and the export at the same size
  const stage = (await page.getByTestId('stage').boundingBox())!;
  const view = await page.evaluate(() => (window as any).__dcView.get());
  const at = (px: number, py: number) => ({ x: stage.x + view.panX + px * view.zoom, y: stage.y + view.panY + py * view.zoom });
  const shot = await page.screenshot();
  const pts = [[0.3, 0.5], [0.7, 0.5], [0.25, 0.2], [0.75, 0.8]].map(([u, v]) => ({ x: img.x + u! * img.w, y: img.y + v! * img.h }));
  const seen = await page.evaluate(async ([b64, ps]) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d')!;
    g.drawImage(bmp, 0, 0);
    return (ps as { x: number; y: number }[]).map((p) => {
      const d = g.getImageData(Math.round(p.x) - 5, Math.round(p.y) - 5, 11, 11).data;
      const m = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) m[k]! += d[i + k]! / 121;
      return m;
    });
  }, [shot.toString('base64'), pts.map((p) => at(p.x, p.y))] as const);
  for (let i = 0; i < pts.length; i++) {
    const e = await pixel(page, pts[i]!.x, pts[i]!.y);
    for (let k = 0; k < 3; k++) expect(Math.abs(seen[i]![k]! - e[k]!)).toBeLessThan(14);
  }
});

/** Downloads the real models from Hugging Face, so only on request. */
test.describe('real models', () => {
  test.skip(!process.env.DC_REAL_MODELS, 'set DC_REAL_MODELS=1 to download and run the real models');
  test.setTimeout(240_000);

  test('BiRefNet cuts out a real mug photo, in the worker, with progress', async ({ page }) => {
    await newDesign(page);
    await page.getByTestId('tab-uploads').click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('upload').click();
    await (await chooser).setFiles({ name: 'mug.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync('apps/web/public/mockups/mug-green/base.jpg') });
    await expect.poll(async () => (await elements(page)).length).toBe(1);
    await page.getByTestId('edit-image').click();
    const t0 = Date.now();
    await page.getByTestId('remove-bg').click();
    await expect(page.getByTestId('bg-progress')).toBeVisible();
    await expect.poll(async () => {
      if (process.env.DC_MODEL_LOG) console.log(await page.getByTestId('bg-progress').textContent().catch(() => '-'), await page.getByTestId('tool-error').textContent({ timeout: 100 }).catch(() => ''));
      return !!(await el0(page)).original || (await page.getByTestId('tool-error').count()) > 0;
    }, { timeout: 200_000, intervals: [3000] }).toBe(true);
    console.log(`cut-out in ${Date.now() - t0} ms`);
    const img = await el0(page);
    expect((await pixel(page, img.x + 8, img.y + 8))).toEqual([255, 255, 255, 255]); // backdrop gone
    const mug = await pixel(page, img.x + img.w * 0.5, img.y + img.h * 0.6);
    expect(mug[0]! + mug[1]! + mug[2]!).toBeGreaterThan(450);
    await page.getByTestId('canvas').screenshot({ path: '/tmp/orch27-rw/r15-bg-mug-in-editor.png' });
  });

  test('Tesseract reads real text', async ({ page }) => {
    await newDesign(page);
    const lines = await page.evaluate(async () => {
      const c = new OffscreenCanvas(640, 200), g = c.getContext('2d')!;
      g.fillStyle = '#fff'; g.fillRect(0, 0, 640, 200);
      g.fillStyle = '#123456'; g.font = 'bold 64px sans-serif'; g.fillText('SUMMER SALE', 40, 120);
      const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
      return (window as any).__dc.ocr(bytes, 'image/png', () => {});
    });
    expect(lines[0].text).toContain('SALE');
    expect(lines[0].w).toBeGreaterThan(0.5);
    expect(lines[0].color).toMatch(/^#[0-3]/);
  });

  test('LaMa erases in the worker and keeps pixels outside the mask', async ({ page }) => {
    await newDesign(page);
    await page.getByTestId('tab-uploads').click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('upload').click();
    await (await chooser).setFiles({ name: 'mug.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync('apps/web/public/mockups/mug-green/base.jpg') });
    await expect.poll(async () => (await elements(page)).length).toBe(1);
    const before = await el0(page);
    await page.getByTestId('edit-image').click();
    await page.getByTestId('tool-erase').click();
    await paint(page, 0.35, 0.65);
    await page.getByTestId('brush-done').click();
    await expect.poll(async () => (await el0(page)).asset !== before.asset, { timeout: 200_000 }).toBe(true);
    const p = await pixel(page, before.x + 4, before.y + 4);
    expect(p[3]).toBe(255);
    await page.getByTestId('canvas').screenshot({ path: '/tmp/orch27-rw/r15-eraser-real.png' });
  });
});
