import { expect, test } from '@playwright/test';
import { doc, elements, newDesign } from './helpers.ts';
import { stubFonts } from './module-stubs.ts';

test.beforeEach(async ({ page }) => {
  await stubFonts(page, ['Anton', 'Montserrat', 'Poppins', 'DM Serif Display', 'Bebas Neue', 'Lato', 'Kalam', 'Bungee', 'Lilita One']);
});

test('templates: a blank page takes the template, fonts are embedded', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('tab-templates').click();
  await expect(page.getByTestId('templates-panel')).toBeVisible();
  // same-shape templates first
  await expect(page.getByTestId('tpl-fit-ig-sale-bold')).toBeVisible();
  await page.getByTestId('tpl-fit-ig-sale-bold').click();
  await expect(page.getByTestId('insert-dialog')).toHaveCount(0); // blank page: no question
  await expect.poll(async () => (await elements(page)).length).toBeGreaterThan(5);
  const d = await doc(page);
  expect(d.pages).toHaveLength(1);
  expect(d.pages[0].background).toEqual({ type: 'solid', color: '#ffe14d' });
  expect(d.pages[0].elements.some((e: any) => e.type === 'text' && e.text === 'MEGA' && e.style.fontFamily === 'Anton')).toBe(true);
  expect(d.pages[0].elements.some((e: any) => e.type === 'path' && e.name === 'fluent-emoji-flat:shopping-bags')).toBe(true);
  expect(new Set(d.fonts.map((f: any) => f.family))).toEqual(new Set(['Anton', 'Montserrat']));
  // one undo step takes it all back
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await elements(page)).length).toBe(0);
});

test('templates: a page with content asks Replace or Add as new page', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('shape-rect').click();
  await page.getByTestId('tab-templates').click();
  await page.getByTestId('tpl-cat-Menu').click();
  await expect(page.getByTestId('template-results').locator('button')).toHaveCount(3);
  await page.getByTestId('tpl-menu-cafe').click();
  await expect(page.getByTestId('insert-dialog')).toBeVisible();
  await page.getByTestId('insert-add').click();
  await expect.poll(async () => (await doc(page)).pages.length).toBe(2);
  let d = await doc(page);
  expect(d.pages[0].elements).toHaveLength(1); // the rect stayed
  // A4 menu fitted into the square page: everything inside it
  for (const e of d.pages[1].elements) {
    expect(e.x).toBeGreaterThanOrEqual(-1);
    expect(e.x + e.w).toBeLessThanOrEqual(1081);
  }
  await page.getByTestId('tpl-menu-pizza').click();
  await page.getByTestId('insert-replace').click();
  await expect.poll(async () => (await doc(page)).pages[1].background.color).toBe('#1b1b1b');
  d = await doc(page);
  expect(d.pages).toHaveLength(2);
  expect(d.pages[1].elements.some((e: any) => e.text === 'Forno Rosso')).toBe(true);
  // cancel leaves the design alone
  await page.getByTestId('tpl-menu-indian').click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect((await doc(page)).pages).toHaveLength(2);
});

test('templates: search, multi-page decks and your own designs', async ({ page }) => {
  // an earlier design to reuse
  await newDesign(page);
  await page.getByTestId('shape-ellipse').click();
  await page.evaluate(() => (window as any).__dc.rename('Old flyer'));
  await page.evaluate(() => (window as any).__dc.save());
  const oldId = (await doc(page)).id;

  await newDesign(page, 'presentation');
  await page.getByTestId('tab-templates').click();
  await page.getByTestId('template-search').fill('pitch');
  await expect(page.getByTestId('template-results').locator('button')).toHaveCount(1);
  await page.getByTestId('tpl-deck-pitch').click();
  await expect.poll(async () => (await doc(page)).pages.length).toBe(4);
  await page.getByTestId('template-search').fill('zzzz nothing');
  await expect(page.getByText('No templates match')).toBeVisible();
  await page.getByTestId('template-search').fill('');

  await page.getByTestId(`your-design-${oldId}`).click();
  await page.getByTestId('insert-add').click();
  await expect.poll(async () => (await doc(page)).pages.length).toBe(5);
  const d = await doc(page);
  const added = d.pages[1]; // after the current (first) page
  expect(added.elements).toHaveLength(1);
  expect(added.elements[0].shape).toBe('ellipse');
});
