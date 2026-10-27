import { expect, test } from '@playwright/test';
import { doc, doc as doc_, drag, elements, handle, newDesign, pngBytes, selectionCenter, waitSaved } from './helpers.ts';

test('home lists presets and creates a design', async ({ page }) => {
  await newDesign(page, 'business-card');
  await expect(page.getByTestId('title')).toHaveValue('Business card');
  const d = await doc(page);
  expect(Math.round(d.width)).toBe(321); // 85 mm at 96 dpi
  expect(d.bleed).toBeGreaterThan(11);
});

test('add, move, resize, rotate, undo and redo a shape', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('shape-rect').click();
  let [r] = await elements(page);
  expect(r!.type).toBe('shape');

  const c = await selectionCenter(page);
  await drag(page, c, { x: c.x + 100, y: c.y + 50 });
  const [moved] = await elements(page);
  expect(moved!.x).toBeGreaterThan(r!.x + 50);
  expect(moved!.y).toBeGreaterThan(r!.y + 20);

  const se = await handle(page, 2);
  await drag(page, se, { x: se.x + 60, y: se.y + 30 });
  const [resized] = await elements(page);
  expect(resized!.w).toBeGreaterThan(moved!.w);
  expect(resized!.x).toBeCloseTo(moved!.x, 0); // nw corner stays

  const rot = page.locator('svg.overlay g.rot');
  const box = (await rot.boundingBox())!;
  const sc = await selectionCenter(page);
  await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: sc.x + 200, y: sc.y });
  const [rotated] = await elements(page);
  expect(rotated!.rotation).toBeGreaterThan(200); // dragged to the right of centre from below
  expect(rotated!.rotation).toBeLessThan(300);

  await page.getByTestId('undo').click();
  expect((await elements(page))[0]!.rotation).toBe(0);
  await page.getByTestId('undo').click();
  expect((await elements(page))[0]!.w).toBeCloseTo(moved!.w, 0);
  await page.getByTestId('redo').click();
  expect((await elements(page))[0]!.w).toBeCloseTo(resized!.w, 0);
});

test('keyboard: delete, duplicate, nudge, select all', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('shape-ellipse').click();
  const [e] = await elements(page);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  const [n] = await elements(page);
  expect(n!.x).toBeCloseTo(e!.x + 1);
  expect(n!.y).toBeCloseTo(e!.y + 10);
  await page.keyboard.press('ControlOrMeta+d');
  expect(await elements(page)).toHaveLength(2);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  expect(await elements(page)).toHaveLength(0);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await elements(page)).toHaveLength(2);
});

test('text: add, edit in place, style, auto height', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('tab-text').click();
  await page.getByTestId('text-body').click();
  const [t0] = await elements(page);
  await page.mouse.dblclick((await selectionCenter(page)).x, (await selectionCenter(page)).y);
  const editor = page.getByTestId('text-editor');
  await expect(editor).toBeVisible();
  await editor.fill('Fresh coffee\nDaily specials\nOpen 7–11');
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  const [t1] = await elements(page);
  expect(t1!.text).toBe('Fresh coffee\nDaily specials\nOpen 7–11');
  expect(t1!.h).toBeGreaterThan(t0!.h * 2.5);
  await page.getByTestId('bold').click();
  expect((await elements(page))[0]!.style.bold).toBe(true);
  await page.getByTestId('font-size').fill('80');
  const [t2] = await elements(page);
  expect(t2!.style.fontSize).toBe(80);
  expect(t2!.h).toBeGreaterThan(t1!.h);
  expect(t2!.w / t1!.w).toBeCloseTo(80 / t1!.style.fontSize, 2); // box scales with the font
});

test('empty text is removed when editing ends', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('tab-text').click();
  await page.getByTestId('text-heading').click();
  await page.keyboard.press('Enter');
  await page.getByTestId('text-editor').fill('');
  await page.keyboard.press('Escape');
  expect(await elements(page)).toHaveLength(0);
});

test('upload an image and it becomes an element', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('tab-uploads').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('upload').click();
  await (await chooser).setFiles({ name: 'red.png', mimeType: 'image/png', buffer: await pngBytes(page, 400, 200, '#ff0000') });
  await expect.poll(async () => (await elements(page)).length).toBe(1);
  const [img] = await elements(page);
  expect(img!.type).toBe('image');
  expect(img!.w / img!.h).toBeCloseTo(2, 1);
  const d = await doc(page);
  expect(Object.values(d.assets)[0]).toMatchObject({ mime: 'image/png', width: 400, height: 200, name: 'red.png' });
});

test('pages: add, duplicate, delete', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('shape-star').click();
  await page.getByTestId('add-page').click();
  expect((await doc(page)).pages).toHaveLength(2);
  // the new page was scrolled into view; go back to page 1
  await page.evaluate(() => { const ed = (window as any).__dc; ed.select([], ed.doc.pages[0].id); });
  // the view scrolls (smoothly) back to page 1
  await expect.poll(() => page.evaluate(() => (window as any).__dcView.get().panY)).toBe(56);
  await page.getByRole('button', { name: 'Duplicate page' }).first().click();
  const d = await doc(page);
  expect(d.pages).toHaveLength(3);
  expect(d.pages[1].elements).toHaveLength(1);
  await page.getByRole('button', { name: 'Delete page' }).first().click();
  expect((await doc(page)).pages).toHaveLength(2);
});

test('autosaves and reopens after reload; home shows a thumbnail', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('shape-hexagon').click();
  await page.getByTestId('title').fill('Cafe menu');
  await page.getByTestId('title').press('Enter');
  await waitSaved(page);
  const id = (await doc(page)).id;
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__dc);
  expect((await doc(page)).id).toBe(id);
  expect(await elements(page)).toHaveLength(1);
  await page.getByTestId('home').click();
  const card = page.getByTestId('project-card').filter({ hasText: 'Cafe menu' });
  await expect(card).toBeVisible();
  await expect(card.locator('img')).toBeVisible();
});

test('download PNG at 2x', async ({ page }) => {
  await newDesign(page, 'logo');
  await page.getByTestId('shape-rect').click();
  await page.getByTestId('download').click();
  await page.locator('.dl input[type=range]').fill('2');
  const dl = page.waitForEvent('download');
  await page.getByTestId('do-download').click();
  const file = await dl;
  expect(file.suggestedFilename()).toBe('Logo.png');
  const path = await file.path();
  const buf = (await import('node:fs')).readFileSync(path!);
  expect(buf.subarray(1, 4).toString()).toBe('PNG');
  expect(buf.readUInt32BE(16)).toBe(1000); // width
  expect(buf.readUInt32BE(20)).toBe(1000);
});

test('download JPG', async ({ page }) => {
  await newDesign(page, 'logo');
  await page.getByTestId('shape-ellipse').click();
  await page.getByTestId('download').click();
  await page.locator('.dl select').first().selectOption('jpeg');
  const dl = page.waitForEvent('download');
  await page.getByTestId('do-download').click();
  const file = await dl;
  expect(file.suggestedFilename()).toBe('Logo.jpg');
  const buf = (await import('node:fs')).readFileSync((await file.path())!);
  expect([buf[0], buf[1], buf[2]]).toEqual([0xff, 0xd8, 0xff]);
});

test('download PDF of all pages', async ({ page }) => {
  await newDesign(page, 'a4');
  await page.getByTestId('shape-star').click();
  await page.getByTestId('add-page').click();
  await page.getByTestId('download').click();
  await page.getByTestId('dl-format').selectOption('pdf');
  await page.locator('.dl select').nth(1).selectOption('150');
  const dl = page.waitForEvent('download');
  await page.getByTestId('do-download').click();
  const file = await dl;
  expect(file.suggestedFilename()).toBe('A4 document.pdf');
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.load((await import('node:fs')).readFileSync((await file.path())!));
  expect(pdf.getPageCount()).toBe(2);
  expect(pdf.getPage(0).getSize().width).toBeCloseTo(595.3, 0);
});

test('open a .dcanvas file from the computer', async ({ page }) => {
  await page.goto('/');
  const { createDoc, addElements, shape } = await import('../packages/scene/src/index.ts');
  const { pack } = await import('../packages/storage/src/index.ts');
  let doc = createDoc({ width: 500, height: 500, title: 'From disk' });
  doc = addElements(doc, doc.pages[0]!.id, [shape('star', { x: 10, y: 10, w: 100, h: 100 })]);
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('open-file').click();
  await (await chooser).setFiles({ name: 'From disk.dcanvas', mimeType: 'application/vnd.digital-canvas+zip', buffer: Buffer.from(pack({ doc, assets: new Map() })) });
  await page.waitForFunction(() => !!(window as any).__dc);
  await expect(page.getByTestId('title')).toHaveValue('From disk');
  expect((await doc_(page)).pages[0].elements).toHaveLength(1);
});

test('canvas actually paints the design (WebGL)', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('shape-rect').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const c = await page.evaluate(() => {
    const ed = (window as any).__dc;
    return ed.doc.pages[0].elements[0];
  });
  const stage = (await page.getByTestId('stage').boundingBox())!;
  // sample the screenshot at the middle of the stage area where the square sits
  const shot = await page.screenshot({ clip: { x: stage.x + stage.width / 2 - 2, y: stage.y + stage.height / 2 - 2, width: 4, height: 4 } });
  const { PNG } = await import('./png.ts');
  const px = PNG.firstPixel(shot);
  expect(c.fill.color).toBe('#8b5cf6');
  expect(px[0]).toBeCloseTo(0x8b, -1);
  expect(px[1]).toBeCloseTo(0x5c, -1);
  expect(px[2]).toBeCloseTo(0xf6, -1);
});
