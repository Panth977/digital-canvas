import { expect, test, type Page } from '@playwright/test';
import { doc, elements, newDesign, pngBytes } from './helpers.ts';

/** Openverse answers with one photo; the other sources stay offline (newDesign). */
async function stubPhotos(page: Page): Promise<void> {
  const png = await pngBytes(page, 60, 40, '#22aa66');
  await page.route('https://api.openverse.org/v1/images/?*', (r) => r.fulfill({ json: { page_count: 1, results: [
    { id: 'p1', title: 'Green field', creator: 'Ana', license: 'by', license_version: '4.0', url: 'https://photos.example/p1.png', thumbnail: 'https://api.openverse.org/v1/images/p1/thumb/', foreign_landing_url: 'https://photos.example/p1', width: 60, height: 40 },
  ] } }));
  await page.route('https://api.openverse.org/v1/images/*/thumb/', (r) => r.fulfill({ body: png, contentType: 'image/png' }));
  await page.route('https://photos.example/**', (r) => r.fulfill({ body: png, contentType: 'image/png' }));
}

test('a tile shows "…" on hover: add, set as background, credit', async ({ page }) => {
  await newDesign(page);
  await stubPhotos(page);
  await page.getByTestId('tab-photos').click();
  const tile = page.getByTestId('photo-results').locator('.wrap').first();
  await expect(tile.getByTestId('tile-more')).toBeHidden();
  await tile.hover();
  await expect(tile.getByTestId('tile-more')).toBeVisible();
  await tile.getByTestId('tile-more').click();
  const menu = page.getByTestId('tile-menu');
  await expect(menu).toContainText('Green field');
  await expect(menu).toContainText('by Ana');
  await expect(menu.getByRole('menuitem', { name: 'View on Openverse' })).toHaveAttribute('href', 'https://photos.example/p1');
  await page.getByTestId('tile-bg').click();
  await expect.poll(async () => (await elements(page)).length).toBe(1);
  const d = await doc(page);
  expect((await elements(page))[0]).toMatchObject({ type: 'image', x: 0, y: 0, w: d.width, h: d.height, locked: true });
});

test('a clicked element lands in the middle of the part of the page you can see', async ({ page }) => {
  await newDesign(page, 'a4');
  // zoom in and go to the top of the page: its lower half is off screen
  await page.evaluate(() => (window as any).__dc.select([]));
  for (let i = 0; i < 4; i++) await page.keyboard.press('Meta+=');
  const stage = (await page.getByTestId('stage').boundingBox())!;
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  // scroll up just until the top of the page shows
  for (let i = 0; i < 40 && !(await page.getByTestId('page-header').count()); i++) {
    await page.mouse.wheel(0, -60);
    await page.waitForTimeout(30);
  }
  await expect(page.getByTestId('page-header')).toBeVisible();
  await page.getByTestId('shape-rect').click(); // the Elements panel is open
  const [r] = await elements(page);
  const d = await doc(page);
  // not the page centre (off screen) but the middle of what is visible
  expect(r!.y + r!.h / 2).toBeLessThan(d.height / 2 - 50);
  const sel = (await page.locator('svg.overlay polygon.sel').first().boundingBox())!;
  const cy = sel.y + sel.height / 2, cx = sel.x + sel.width / 2;
  expect(cy).toBeGreaterThan(stage.y);
  expect(cy).toBeLessThan(stage.y + stage.height);
  expect(Math.abs(cx - (stage.x + stage.width / 2))).toBeLessThan(40);
});

test('keyboard: arrows move along the rail, Enter opens a section, Esc closes it', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('tab-elements').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('tab-text')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('tab-templates')).toBeFocused();
  await page.getByTestId('tab-text').focus();
  // Text is a rail section: close it first, then open it from the keyboard
  await page.getByTestId('tab-text').click();
  await expect(page.getByTestId('side-panel')).toHaveCount(1);
  await page.getByTestId('tab-text').click();
  await expect(page.getByTestId('side-panel')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('side-panel')).toBeVisible();
  await expect(page.getByTestId('side-panel').locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('side-panel')).toHaveCount(0);
  await expect(page.getByTestId('tab-text')).toBeFocused();
});

test('recently used is shared between the Photos and Elements panels', async ({ page }) => {
  await newDesign(page);
  await stubPhotos(page);
  await page.getByTestId('tab-photos').click();
  await page.getByTestId('photo-results').locator('.tile').first().click();
  await expect.poll(async () => (await elements(page)).length).toBe(1);
  // the photo added from Photos is in Elements' recently used
  await page.getByTestId('tab-elements').click();
  await expect(page.getByTestId('row-recent').locator('.tile').first()).toHaveAttribute('data-key', 'openverse:p1');
  await page.getByTestId('tab-photos').click();
  await expect(page.getByTestId('photo-recent').locator('.tile').first()).toHaveAttribute('data-key', 'openverse:p1');
});
