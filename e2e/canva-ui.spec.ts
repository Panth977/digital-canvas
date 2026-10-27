import { expect, test } from '@playwright/test';
import { doc, elements, newDesign } from './helpers.ts';

/** Canva's editor layout: contextual toolbar, left panels, continuous pages, bottom bar, themes. */

test('contextual toolbar follows the selection: text, shape, page', async ({ page }) => {
  await newDesign(page);
  const bar = page.getByTestId('context-toolbar');
  await expect(bar).toHaveAttribute('data-kind', 'page');
  await expect(bar.getByTestId('page-bg-btn')).toBeVisible();

  await page.getByTestId('tab-text').click();
  await page.getByTestId('text-heading').click();
  await expect(bar).toHaveAttribute('data-kind', 'text');
  for (const id of ['font-picker', 'font-size', 'text-color-btn', 'bold', 'italic', 'underline', 'strike', 'uppercase', 'align', 'list', 'spacing-btn', 'effects-btn', 'position-btn', 'opacity-btn', 'more-btn'])
    await expect(bar.getByTestId(id)).toBeVisible();
  await expect(page.getByTestId('mini-toolbar')).toBeVisible();

  // size −/+ and the spacing popover
  const size = (await elements(page))[0]!.style.fontSize;
  await bar.getByRole('button', { name: 'Increase font size' }).click();
  expect((await elements(page))[0]!.style.fontSize).toBe(Math.round(size) + 1);
  await bar.getByTestId('spacing-btn').click();
  await page.getByTestId('line-height').fill('2');
  expect((await elements(page))[0]!.style.lineHeight).toBe(2);
  const before = (await elements(page))[0]!.style.align;
  await bar.getByTestId('align').click(); // cycles left → centre → right → justify
  expect((await elements(page))[0]!.style.align).not.toBe(before);

  await page.getByTestId('tab-elements').click();
  await page.getByTestId('shape-rect').click();
  await expect(bar).toHaveAttribute('data-kind', 'shape');
  await expect(bar.getByTestId('font-picker')).toHaveCount(0);
  await bar.getByTestId('fill-btn').click();
  await expect(page.getByTestId('tool-panel')).toHaveAttribute('data-panel', 'color');
  await page.getByRole('button', { name: 'Colour #ff3131' }).click();
  expect(((await elements(page))[1] as any).fill.color).toBe('#ff3131');

  await page.keyboard.press('Escape');
  await expect(bar).toHaveAttribute('data-kind', 'page');
  await expect(page.getByTestId('tool-panel')).toHaveCount(0); // the colour panel closed with the selection
});

test('effects and fonts open in the left panel; closing returns to the rail section', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('tab-text').click();
  await page.getByTestId('text-subheading').click();
  await page.getByTestId('effects-btn').click();
  const panel = page.getByTestId('side-panel').getByTestId('tool-panel');
  await expect(panel).toHaveAttribute('data-panel', 'effects');
  await expect(page.getByTestId('tab-text')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('fx-pick-shadow').click();
  expect(((await elements(page))[0] as any).effect.type).toBe('shadow');
  await expect(page.getByTestId('fx-blur')).toBeVisible();

  await page.getByTestId('font-picker').click();
  await expect(panel).toHaveAttribute('data-panel', 'font');
  await expect(page.getByTestId('font-search')).toBeVisible();

  await page.getByTestId('panel-close').click();
  await expect(page.getByTestId('tool-panel')).toHaveCount(0);
  await expect(page.getByTestId('tab-text')).toHaveAttribute('aria-pressed', 'true');

  // clicking the open rail item again collapses the panel (Canva)
  await page.getByTestId('tab-text').click();
  await expect(page.getByTestId('side-panel')).toHaveCount(0);
  await page.getByTestId('tab-text').click();
  await expect(page.getByTestId('text-heading')).toBeVisible();
  await page.getByTestId('collapse-panel').click();
  await expect(page.getByTestId('side-panel')).toHaveCount(0);
});

test('continuous scroll: every page has a header; scrolling changes the current page', async ({ page }) => {
  await newDesign(page);
  await page.evaluate(() => { const ed = (window as any).__dc; for (let i = 0; i < 3; i++) ed.addPage(); });
  expect((await doc(page)).pages).toHaveLength(4);
  await page.evaluate(() => { const ed = (window as any).__dc; ed.select([], ed.doc.pages[0].id); });
  // page titles and hiding (Canva: "Page 1 - Add page title", eye button)
  await page.getByTestId('page-title').first().fill('Menu');
  await page.getByTestId('page-title').first().press('Enter');
  expect((await doc(page)).pages[0].name).toBe('Menu');
  await page.getByTestId('page-hide').first().click();
  expect((await doc(page)).pages[0].hidden).toBe(true);
  // ⌘/Ctrl + wheel zooms out around the pointer (here: the top of page 1)
  const box = (await page.getByTestId('stage').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 70);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 400);
  await page.mouse.wheel(0, 400);
  await page.keyboard.up('Control');
  await expect(page.getByTestId('page-header')).toHaveCount(4);
  await expect(page.getByTestId('page-header').first()).toContainText('Page 1');
  await expect(page.getByTestId('page-header').last()).toContainText('Page 4');


  // zoom in and scroll down the column: the counter follows
  await page.locator('input[aria-label=Zoom]').fill('0.5');
  await page.evaluate(() => { const ed = (window as any).__dc; ed.select([], ed.doc.pages[0].id); });
  await expect(page.getByTestId('page-counter')).toHaveText('1 / 4');
  const stage = (await page.getByTestId('stage').boundingBox())!;
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 200);
  await expect(page.getByTestId('page-counter')).not.toHaveText('1 / 4');
});

test('bottom bar: page counter, pages strip and grid view', async ({ page }) => {
  await newDesign(page);
  const counter = page.getByTestId('page-counter');
  await expect(counter).toHaveText('1 / 1');
  await page.getByTestId('add-page').click();
  await expect(counter).toHaveText('2 / 2');
  await page.getByTestId('pages-btn').click();
  await expect(page.getByTestId('pages-strip').locator('img')).toHaveCount(2);
  await page.getByTestId('pages-strip').getByTitle('Page 1').click();
  await expect(counter).toHaveText('1 / 2');
  await page.getByTestId('grid-btn').click();
  await expect(page.getByTestId('grid-page')).toHaveCount(2);
  await page.getByTestId('grid-page').nth(1).click();
  await expect(page.getByTestId('grid-view')).toHaveCount(0);
  await expect(counter).toHaveText('2 / 2');
  // notes belong to the page
  await page.getByTestId('notes-btn').click();
  await page.getByTestId('notes').fill('Say hello');
  expect((await doc(page)).pages[1].notes).toBe('Say hello');
});

test('dark and light themes follow the system setting', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await newDesign(page);
  const bg = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await bg('[data-testid=side-panel]')).toBe('rgb(24, 25, 27)');
  expect(await bg('main.work')).toBe('rgb(15, 16, 21)');
  // the canvas behind the page is painted in the theme's workspace colour
  const stage = (await page.getByTestId('stage').boundingBox())!;
  await page.waitForTimeout(200);
  const { PNG } = await import('./png.ts');
  const px = PNG.firstPixel(await page.screenshot({ clip: { x: stage.x + 4, y: stage.y + stage.height - 6, width: 2, height: 2 } }));
  expect(px.slice(0, 3)).toEqual([15, 16, 21]);
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await bg('[data-testid=side-panel]')).toBe('rgb(255, 255, 255)');
  expect(await bg('main.work')).toBe('rgb(235, 236, 240)');
});
