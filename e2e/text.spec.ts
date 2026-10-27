import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { doc, elements, newDesign, selectionCenter } from './helpers.ts';

async function addAndEdit(page: import('@playwright/test').Page, value: string) {
  await newDesign(page);
  await page.getByTestId('tab-text').click();
  await page.getByTestId('text-body').click();
  const c = await selectionCenter(page);
  await page.mouse.dblclick(c.x, c.y);
  const editor = page.getByTestId('text-editor');
  await expect(editor).toBeVisible();
  await page.keyboard.type(value);
  return editor;
}

test('rich text: style only the selected word, keep it while typing', async ({ page }) => {
  await addAndEdit(page, 'Fresh coffee');
  // select "coffee"
  for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowLeft');
  await expect(page.getByText('Styling the selected text only.')).toBeVisible();
  await page.getByTestId('bold').click();
  let [t] = await elements(page);
  expect(t!.text).toBe('Fresh coffee');
  expect(t!.style.bold).toBe(false);
  expect((t as any).runs).toEqual([{ text: 'Fresh ' }, { text: 'coffee', style: { bold: true } }]);
  // still editing; typing at the end continues the bold run
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  [t] = await elements(page);
  expect(t!.text).toBe('Fresh coffee!');
  expect((t as any).runs).toEqual([{ text: 'Fresh ' }, { text: 'coffee!', style: { bold: true } }]);
  // ⌘B toggles back
  await page.keyboard.press('Shift+Home');
  await page.keyboard.press('ControlOrMeta+b');
  [t] = await elements(page);
  expect(t!.style.bold).toBe(true);
  expect((t as any).runs).toBeUndefined();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('text-editor')).toBeHidden();
});

test('effects, curve and lists change the text box', async ({ page }) => {
  await addAndEdit(page, 'Curve me please');
  await page.keyboard.press('Escape');
  const [t0] = await elements(page);
  // Effects open in the left panel from the contextual toolbar (Canva)
  await page.getByTestId('effects-btn').click();
  await expect(page.getByTestId('side-panel').getByTestId('tool-panel')).toHaveAttribute('data-panel', 'effects');
  await page.getByTestId('fx-pick-outline').click();
  let [t] = await elements(page);
  expect((t as any).effect).toMatchObject({ type: 'outline', thickness: 50 });
  await page.getByTestId('fx-thickness').fill('80');
  [t] = await elements(page);
  expect((t as any).effect.thickness).toBe(80);
  await page.getByTestId('curve').fill('70');
  [t] = await elements(page);
  expect((t as any).curve).toBe(70);
  expect(t!.h).toBeGreaterThan(t0!.h * 1.5); // the arc needs a taller box
  expect(t!.w).toBeLessThan(t0!.w);
  await page.getByTestId('curve').fill('0');
  [t] = await elements(page);
  expect((t as any).curve).toBeUndefined();
  await page.getByTestId('list').click();
  [t] = await elements(page);
  expect((t as any).list).toBe('bullet');
  await page.getByTestId('text-color-btn').click();
  await page.getByTestId('gradient-on').click();
  [t] = await elements(page);
  expect((t as any).gradient.type).toBe('linear');
  await page.getByTestId('effects-btn').click();
  await page.getByTestId('fx-pick-none').click();
  [t] = await elements(page);
  expect((t as any).effect).toBeUndefined();
});

test('pick a Google font: it is downloaded and embedded in the design', async ({ page }) => {
  await addAndEdit(page, 'Łódź menu');
  await page.keyboard.press('Escape');
  await page.getByTestId('font-picker').click();
  await page.getByTestId('font-search').fill('Lobster');
  await page.locator('[data-family="Lobster"]').click();
  await expect.poll(async () => (await elements(page))[0]!.style.fontFamily, { timeout: 20_000 }).toBe('Lobster');
  const d = await doc(page);
  const faces = d.fonts.filter((f: any) => f.family === 'Lobster');
  expect(faces.length).toBeGreaterThanOrEqual(2); // latin + latin-ext (for Ł, ź)
  expect(new Set(faces.map((f: any) => f.subset))).toEqual(new Set(['latin', 'latin-ext']));
  for (const f of faces) expect(d.assets[f.asset].mime).toBe('font/ttf');
});

test('upload a font file', async ({ page }) => {
  await addAndEdit(page, 'Uploaded');
  await page.keyboard.press('Escape');
  await page.getByTestId('font-picker').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('font-upload').click();
  await (await chooser).setFiles({ name: 'MyFont-Bold.ttf', mimeType: 'font/ttf', buffer: readFileSync(new URL('../apps/web/public/fonts/Inter-Bold.ttf', import.meta.url)) });
  await expect.poll(async () => (await doc(page)).fonts?.some((f: any) => f.source === 'upload')).toBe(true);
  const d = await doc(page);
  const f = d.fonts.find((x: any) => x.source === 'upload');
  expect(f.weight).toBe(700);
  expect((await elements(page))[0]!.style.fontFamily).toBe(f.family);
});
