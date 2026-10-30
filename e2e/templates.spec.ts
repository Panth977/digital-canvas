import { expect, test } from '@playwright/test';
import { doc, elements, newDesign } from './helpers.ts';
import { stubFonts } from './module-stubs.ts';

test.beforeEach(async ({ page }) => {
  await stubFonts(page, ['Source Sans 3', 'Playfair Display', 'Abhaya Libre', 'Ms Madi']);
});

test('templates: a blank page takes the template, fonts are embedded', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('tab-templates').click();
  await expect(page.getByTestId('templates-panel')).toBeVisible();
  // same-shape templates first: a square page gets the SWOT board
  await expect(page.getByTestId('tpl-fit-wb-swot')).toBeVisible();
  await page.getByTestId('tpl-fit-wb-swot').click();
  await expect(page.getByTestId('insert-dialog')).toHaveCount(0); // blank page: no question
  await expect.poll(async () => (await elements(page)).length).toBeGreaterThan(5);
  const d = await doc(page);
  expect(d.pages).toHaveLength(1);
  expect(d.pages[0].elements.some((e: any) => e.type === 'text' && e.text === 'strengths' && e.style.fontFamily === 'Source Sans 3')).toBe(true);
  expect(d.pages[0].elements.some((e: any) => e.type === 'shape')).toBe(true);
  expect(new Set(d.fonts.map((f: any) => f.family))).toEqual(new Set(['Source Sans 3']));
  // one undo step takes it all back
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await elements(page)).length).toBe(0);
});

test('templates: a page with content asks Replace or Add as new page', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('shape-rect').click();
  await page.getByTestId('tab-templates').click();
  await page.getByTestId('tpl-cat-Resume').click();
  await expect(page.getByTestId('template-results').locator('button')).toHaveCount(6);
  await expect(page.getByTestId('tpl-by-resume-just-another-1')).toHaveText('Maximo Gomez · CC BY 4.0');
  await page.getByTestId('tpl-resume-just-another-1').click();
  await expect(page.getByTestId('insert-dialog')).toBeVisible();
  await page.getByTestId('insert-add').click();
  await expect.poll(async () => (await doc(page)).pages.length).toBe(2);
  let d = await doc(page);
  expect(d.pages[0].elements).toHaveLength(1); // the rect stayed
  // tall resume fitted into the square page: everything inside it
  for (const e of d.pages[1].elements) {
    expect(e.x).toBeGreaterThanOrEqual(-1);
    expect(e.x + e.w).toBeLessThanOrEqual(1081);
  }
  await page.getByTestId('tpl-resume-just-another-2').click();
  await page.getByTestId('insert-replace').click();
  await expect.poll(async () => (await doc(page)).pages[1].background.color).toBe('#222222');
  d = await doc(page);
  expect(d.pages).toHaveLength(2);
  expect(d.pages[1].elements.some((e: any) => e.text?.startsWith('Learn more in my LinkedI'))).toBe(true);
  // cancel leaves the design alone
  await page.getByTestId('tpl-cv-enieber-1').click();
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
  await page.getByTestId('template-search').fill('Community cards');
  await expect(page.getByTestId('template-results').locator('button')).toHaveCount(1);
  await page.getByTestId('tpl-community-cards').click();
  // its pictures came along and draw
  await expect.poll(async () => { const d = await doc(page); return d.pages[0].elements.filter((e: any) => e.type === 'image' && d.assets[e.asset]).length; }).toBeGreaterThan(4);
  // the designer is searchable
  await page.getByTestId('template-search').fill('Marina Lopez');
  await expect(page.getByTestId('template-results').locator('button')).toHaveCount(1);
  await expect(page.getByTestId('tpl-bingo-reading')).toBeVisible();
  await page.getByTestId('template-search').fill('zzzz nothing');
  await expect(page.getByText('No templates match')).toBeVisible();
  await page.getByTestId('template-search').fill('');

  await page.getByTestId(`your-design-${oldId}`).click();
  await page.getByTestId('insert-add').click();
  await expect.poll(async () => (await doc(page)).pages.length).toBe(2);
  const d = await doc(page);
  const added = d.pages[1]; // after the current (first) page
  expect(added.elements).toHaveLength(1);
  expect(added.elements[0].shape).toBe('ellipse');
});

test('templates: the credit page lists every template and catalogue', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('tab-templates').click();
  const href = await page.getByTestId('tpl-credits').getAttribute('href');
  await page.goto(href!);
  await expect(page.getByRole('heading', { name: 'Credits and licences' })).toBeVisible();
  await expect(page.getByTestId('credits-templates').locator('tbody tr')).toHaveCount((await import('../apps/web/src/templates/index.json', { with: { type: 'json' } })).default.length);
  for (const name of ['OpenMoji', 'Open Doodles', 'Hero Patterns', 'Fonttrio', 'Open Color', 'uiGradients']) await expect(page.getByRole('link', { name }).first()).toBeVisible();
});
