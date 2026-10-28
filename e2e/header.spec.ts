import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { FakeDrive, fakeSignIn } from './fake-drive.ts';
import { doc, newDesign, waitSaved, CONTENT_HOSTS } from './helpers.ts';

test('title: click to rename; Enter keeps, Esc and an empty title put it back; long titles end in …', async ({ page }) => {
  await newDesign(page);
  const title = page.getByTestId('title');
  await title.click();
  // the whole name is selected, so typing replaces it
  expect(await title.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 'Instagram post (square)'.length]);
  await page.keyboard.type('Spring sale');
  await page.keyboard.press('Escape');
  await expect(title).toHaveValue('Instagram post (square)');
  await expect(title).not.toBeFocused();
  expect((await doc(page)).title).toBe('Instagram post (square)');

  await title.click();
  await page.keyboard.type('Spring sale');
  await page.keyboard.press('Enter');
  await expect(title).not.toBeFocused();
  expect((await doc(page)).title).toBe('Spring sale');

  await title.fill('   ');
  await page.getByTestId('canvas').click({ position: { x: 5, y: 5 } }); // blur
  await expect(title).toHaveValue('Spring sale');

  await title.fill('A very long design name that will not fit in the header of the editor at all');
  await title.press('Enter');
  expect(await title.evaluate((el) => getComputedStyle(el).textOverflow)).toBe('ellipsis');
  expect(await title.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
});

test('undo and redo are disabled with nothing to undo or redo; the save cloud explains itself', async ({ page }) => {
  await newDesign(page);
  await expect(page.getByTestId('undo')).toBeDisabled();
  await expect(page.getByTestId('redo')).toBeDisabled();
  await page.getByTestId('shape-rect').click();
  await expect(page.getByTestId('undo')).toBeEnabled();
  await expect(page.getByTestId('redo')).toBeDisabled();
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('undo')).toBeDisabled();
  await expect(page.getByTestId('redo')).toBeEnabled();
  await waitSaved(page);
  // Canva-style tooltip on hover
  await page.getByTestId('save-state').hover();
  await expect(page.getByTestId('tooltip')).toHaveText('All changes saved');
  await page.getByTestId('undo').hover();
  await expect(page.getByTestId('tooltip')).toContainText('Undo');
  await expect(page.getByTestId('tooltip').locator('kbd')).toHaveText('⌘Z');
});

test('save shows a spinner while saving', async ({ page }) => {
  await newDesign(page);
  // hold the save so the spinner can be seen
  await page.evaluate(() => {
    const ed = (window as any).__dc;
    const save = ed.store.save.bind(ed.store);
    ed.store.save = (f: unknown) => new Promise((r) => setTimeout(() => r(save(f)), 1500));
  });
  await page.getByTestId('shape-rect').click();
  await expect(page.getByTestId('save-state')).toHaveAttribute('data-state', 'saving', { timeout: 5000 });
  await expect(page.getByTestId('save-state').locator('.ring')).toBeVisible();
  await waitSaved(page);
});

test('File menu: Canva items, Settings submenu, Make a copy, Create new design, shortcuts', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('file-menu').click();
  const menu = page.getByTestId('file-dropdown');
  for (const t of ['Create new design', 'Upload files', 'Settings', 'Save', 'Make a copy', 'Download', 'Version history', 'Move to trash', 'Help']) {
    await expect(menu.getByRole('menuitem', { name: t, exact: false }).first()).toBeVisible();
  }
  // no Drive: no version history
  await expect(page.getByTestId('file-versions')).toBeDisabled();
  await page.getByTestId('file-settings').hover();
  await expect(page.getByTestId('file-settings-menu')).toBeVisible();
  await expect(page.getByTestId('view-snap')).toBeChecked();

  await page.getByTestId('file-copy').click();
  await expect(page.getByTestId('toast')).toContainText('Made “Copy of Instagram post (square)”');
  await page.getByTestId('toast-action').click();
  await expect(page.getByTestId('title')).toHaveValue('Copy of Instagram post (square)');

  await page.getByTestId('file-menu').click();
  await page.getByTestId('file-new').hover();
  await page.getByTestId('file-new-presentation').click();
  await expect(page.getByTestId('title')).toHaveValue('Presentation (16:9)');
  expect((await doc(page)).width).toBe(1920);

  await page.keyboard.press('?');
  await expect(page.getByTestId('shortcuts')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('shortcuts')).toHaveCount(0);
  await expect(page.getByTestId('context-toolbar')).toHaveAttribute('data-kind', 'page');
});

test('Move to trash asks first (no bin in this browser), goes home and says so', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('title').fill('Doomed');
  await page.getByTestId('title').press('Enter');
  await waitSaved(page);
  await page.getByTestId('file-menu').click();
  await page.getByTestId('file-trash').click();
  await expect(page.getByTestId('confirm')).toContainText('deleted for good');
  await page.getByTestId('confirm-cancel').click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByTestId('file-menu').click();
  await page.getByTestId('file-trash').click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('toast')).toContainText('Design deleted');
  await expect(page.getByTestId('project-card').filter({ hasText: 'Doomed' })).toHaveCount(0);
});

test('Drive: version history lists earlier saves and restores one (undoable); trash has Undo', async ({ page }) => {
  await page.context().route(CONTENT_HOSTS, (r) => r.fulfill({ status: 503, body: 'offline' }));
  await page.goto('/');
  const d = new FakeDrive();
  await d.install(page);
  await fakeSignIn(page);
  await expect(page.getByTestId('store-label')).toContainText('Google Drive');
  await page.getByTestId('preset-instagram-post').click();
  await page.waitForFunction(() => !!(window as any).__dc);
  await waitSaved(page);
  await page.getByTestId('shape-rect').click();
  await waitSaved(page);
  await page.getByTestId('shape-ellipse').click();
  await waitSaved(page);
  expect((await doc(page)).pages[0].elements).toHaveLength(2);

  await page.getByTestId('file-menu').click();
  await page.getByTestId('file-versions').click();
  await expect(page.getByTestId('version-history')).toBeVisible();
  const items = page.getByTestId('version-item');
  await expect(items).toHaveCount(2); // the current save is not listed
  await expect(page.getByTestId('version-preview')).toBeVisible();
  await items.nth(0).click(); // newest earlier save: one rectangle
  await page.getByTestId('version-restore').click();
  await expect(page.getByTestId('version-history')).toHaveCount(0);
  expect((await doc(page)).pages[0].elements).toHaveLength(1);
  await page.getByTestId('toast-action').click(); // Undo
  expect((await doc(page)).pages[0].elements).toHaveLength(2);

  // trash on Drive: no question, Undo brings it back
  await waitSaved(page);
  const id = (await doc(page)).id;
  await page.getByTestId('file-menu').click();
  await page.getByTestId('file-trash').click();
  await expect(page.getByTestId('confirm')).toContainText('30 days');
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('toast')).toContainText('moved to trash');
  expect([...d.files.values()].find((f) => f.appProperties?.dcDocId === id)?.trashed).toBe(true);
  await page.getByTestId('toast-action').click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  expect([...d.files.values()].find((f) => f.appProperties?.dcDocId === id)?.trashed).toBe(false);
});

test('Resize: "Resize" changes this design (undoable), "Copy & resize" makes copies', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('shape-rect').click();
  await page.getByTestId('resize').click();
  await page.getByTestId('resize-search').fill('facebook cover');
  await page.getByTestId('resize-preset-facebook-cover').check();
  await page.getByTestId('resize-here').click();
  const d = await doc(page);
  expect([d.width, d.height]).toEqual([851, 315]);
  expect(d.title).toBe('Instagram post (square)');
  await expect(page.getByTestId('toast')).toContainText('Resized to 851 × 315');
  await page.getByTestId('toast-action').click();
  expect((await doc(page)).width).toBe(1080);
  // two sizes: only copies
  await page.getByTestId('resize').click();
  await page.getByTestId('resize-preset-facebook-cover').check();
  await page.getByTestId('resize-search').fill('story');
  await page.getByTestId('resize-preset-instagram-story').check();
  await expect(page.getByTestId('resize-here')).toBeDisabled();
  await expect(page.getByTestId('resize-go')).toHaveText(/Copy & resize \(2\)/);
});

test('Download: Canva file types, pages picker, zip for several pages, JPG quality, GIF', async ({ page }) => {
  await newDesign(page, 'logo');
  await page.getByTestId('shape-rect').click();
  await page.getByTestId('add-page').click();
  await page.getByTestId('shape-ellipse').click();
  await page.getByTestId('download').click();
  const fmt = page.getByTestId('dl-format');
  await expect(fmt.locator('option')).toHaveText(['PNG · Suggested', 'JPG', 'PDF Standard', 'PDF Print', 'SVG', 'GIF']);
  await expect(page.getByTestId('dl-hint')).toHaveText('Best for complex images, illustrations');
  await expect(page.getByTestId('dl-pages')).toHaveText(/All pages \(2\)/);

  // both pages: one zip with two PNGs
  let dl = page.waitForEvent('download');
  await page.getByTestId('do-download').click();
  let file = await dl;
  expect(file.suggestedFilename()).toBe('Logo.zip');
  const zip = unzipSync(readFileSync((await file.path())!));
  expect(Object.keys(zip).sort()).toEqual(['Logo - page 1.png', 'Logo - page 2.png']);

  // only page 2, as JPG at low quality
  await page.getByTestId('download').click();
  await fmt.selectOption('jpeg');
  await page.getByTestId('dl-quality').fill('20');
  await page.getByTestId('dl-pages').click();
  await page.getByTestId('dl-page-1').uncheck();
  await page.getByTestId('dl-pages-done').click();
  await expect(page.getByTestId('dl-pages')).toHaveText(/Page 2/);
  dl = page.waitForEvent('download');
  await page.getByTestId('do-download').click();
  file = await dl;
  expect(file.suggestedFilename()).toBe('Logo - page 2.jpg');

  // GIF: pages one after another
  await page.getByTestId('download').click();
  await fmt.selectOption('gif');
  await page.getByTestId('dl-pages').click();
  await page.getByTestId('dl-pages-all').check();
  await page.getByTestId('dl-pages-done').click();
  dl = page.waitForEvent('download');
  await page.getByTestId('do-download').click();
  file = await dl;
  expect(file.suggestedFilename()).toBe('Logo.gif');
  const gif = readFileSync((await file.path())!);
  expect(gif.subarray(0, 6).toString()).toBe('GIF89a');
  // at least two image descriptors (0x2c) = two frames
  let frames = 0;
  for (let i = 0; i < gif.length - 1; i++) if (gif[i] === 0x21 && gif[i + 1] === 0xf9) frames++;
  expect(frames).toBeGreaterThanOrEqual(2);
});

test('deleting a page shows a toast with Undo', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('add-page').click();
  expect((await doc(page)).pages).toHaveLength(2);
  await page.evaluate(() => (window as any).__dc.removePage());
  await expect(page.getByTestId('toast')).toContainText('Page 2 deleted');
  await page.getByTestId('toast-action').click();
  expect((await doc(page)).pages).toHaveLength(2);
});
