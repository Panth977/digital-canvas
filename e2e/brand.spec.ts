import { expect, test } from '@playwright/test';
import { doc, elements, newDesign, pngBytes } from './helpers.ts';
import { stubFonts } from './module-stubs.ts';

test('brand kit: palettes from the design, used in the colour panel, kept after reload', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('shape-rect').click();
  await page.evaluate(() => (window as any).__dc.update({ fill: { type: 'solid', color: '#1d3c78' } }));
  await page.getByTestId('tab-brand').click();
  await expect(page.getByTestId('brand-panel')).toBeVisible();
  await page.getByTestId('brand-from-design').click();
  await expect(page.getByTestId('brand-palette')).toHaveCount(1);
  await expect(page.getByTestId('brand-swatch')).toHaveCount(2); // white page + navy rect

  // add a colour with the colour input
  await page.getByTestId('brand-add-color').click();
  await page.getByTestId('brand-color-input').evaluate((el: HTMLInputElement) => { el.value = '#e0a526'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect(page.getByTestId('brand-swatch')).toHaveCount(3);

  // the colour panel shows the brand row; picking a brand colour fills the shape
  const rect = (await elements(page))[0]!;
  await page.evaluate((id) => (window as any).__dc.select([id]), rect.id);
  await page.getByTestId('fill-btn').click();
  const row = page.getByTestId('brand-colors');
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Brand colour #e0a526' }).click();
  expect(((await elements(page))[0] as any).fill.color).toBe('#e0a526');

  // stored in this browser: a reload (new session) still has it
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__dc);
  await page.getByTestId('tab-brand').click();
  await expect(page.getByTestId('brand-swatch')).toHaveCount(3);
});

test('brand kit: logos upload and go on the page', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('tab-brand').click();
  const png = await pngBytes(page, 80, 40, '#ff3366');
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('brand-logo-upload').click();
  await (await chooser).setFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByTestId('brand-logo')).toHaveCount(1);
  await page.getByTestId('brand-logo').click();
  await expect.poll(async () => (await elements(page)).length).toBe(1);
  const [img] = (await elements(page)) as any[];
  expect(img.type).toBe('image');
  const d = await doc(page);
  expect(d.assets[img.asset]).toMatchObject({ mime: 'image/png', width: 80, height: 40, name: 'logo.png' });
});

test('brand kit: brand fonts become text styles in the Text panel', async ({ page }) => {
  await stubFonts(page, ['Anton', 'Lato']);
  await newDesign(page);
  await page.getByTestId('tab-brand').click();
  await page.getByTestId('brand-font-pick-heading').click();
  await page.getByTestId('brand-font-search').fill('anton');
  await page.getByTestId('brand-font-anton').click();
  await expect(page.getByTestId('brand-font-heading')).toContainText('Anton');

  await page.getByTestId('tab-text').click();
  await expect(page.getByTestId('brand-text-styles')).toBeVisible();
  await page.getByTestId('brand-text-heading').click();
  await expect.poll(async () => (await elements(page)).length).toBe(1);
  const [t] = await elements(page);
  expect(t!.style.fontFamily).toBe('Anton');
  expect(t!.style.bold).toBe(true);
  expect((await doc(page)).fonts.some((f: any) => f.family === 'Anton')).toBe(true);
});
