import { expect, test, type Page } from '@playwright/test';
import { CONTENT_HOSTS } from './helpers';

/** Home with network stubbed: content hosts and font downloads answer 503. */
async function home(page: Page): Promise<void> {
  await page.context().route(CONTENT_HOSTS, (r) => r.fulfill({ status: 503, body: 'offline in tests' }));
  await page.context().route(/fontsource|fonts\.(googleapis|gstatic)\.com|jsdelivr/, (r) => r.fulfill({ status: 503, body: 'offline in tests' }));
  await page.goto('/');
  await expect(page.getByTestId('home-search')).toBeVisible();
}

/** Make a design from a preset, name it, and return to Home. */
async function makeDesign(page: Page, preset: string, title: string): Promise<void> {
  await page.getByTestId(`preset-${preset}`).click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.waitForFunction(() => !!(window as any).__dc);
  await page.evaluate((t) => { const ed = (window as any).__dc; ed.rename(t); ed.addShape('ellipse'); ed.addText('heading'); }, title);
  await page.evaluate(() => (window as any).__dc.save());
  await page.getByTestId('home').click();
  await expect(page.getByTestId('project-card').filter({ hasText: title })).toBeVisible();
}

test('home: the top search finds your designs, sizes and templates', async ({ page }) => {
  await home(page);
  await makeDesign(page, 'instagram-post', 'Cafe menu');
  await makeDesign(page, 'a4', 'Summer flyer');
  await expect(page.getByTestId('project-card')).toHaveCount(2);

  await page.getByTestId('home-search').fill('menu');
  await expect(page.getByTestId('project-card')).toHaveCount(1);
  await expect(page.getByTestId('project-card')).toContainText('Cafe menu');
  await expect(page.getByTestId('search-sizes')).toContainText('Menu (A4)');
  await expect(page.getByTestId('home-templates').locator('button').first()).toBeVisible();

  await page.getByTestId('home-search').fill('zzqx');
  await expect(page.getByText('None of your designs match')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page.getByTestId('project-card')).toHaveCount(2);
});

test('home: Create a design popover lists popular sizes, searches, and makes a custom size', async ({ page }) => {
  await home(page);
  await page.getByTestId('create-design').click();
  const pop = page.getByTestId('create-popover');
  await expect(pop).toBeVisible();
  await expect(pop.getByTestId('create-preset-instagram-post')).toBeVisible();
  await page.getByTestId('create-search').fill('youtube thumb');
  await expect(pop.getByTestId('create-preset-youtube-thumbnail')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();

  await page.getByTestId('create-design').click();
  await page.getByTestId('custom-w').fill('800');
  await page.getByTestId('custom-h').fill('600');
  await page.getByTestId('custom-create').click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.waitForFunction(() => !!(window as any).__dc);
  expect(await page.evaluate(() => [(window as any).__dc.doc.width, (window as any).__dc.doc.height])).toEqual([800, 600]);
});

test('home: design-type shortcuts create or filter sizes', async ({ page }) => {
  await home(page);
  await page.getByTestId('shortcut-video').click();
  await expect(page.getByTestId('category-Video')).toHaveClass(/on/);
  await page.getByTestId('shortcut-presentation').click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.waitForFunction(() => !!(window as any).__dc);
  expect(await page.evaluate(() => (window as any).__dc.doc.width)).toBe(1920);
});

test('home: a template becomes a new design and opens in this tab', async ({ page }) => {
  await home(page);
  const pages = page.context().pages().length;
  await page.getByTestId('home-template-community-cards').click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.waitForFunction(() => !!(window as any).__dc);
  const d = await page.evaluate(() => ({ title: (window as any).__dc.doc.title, n: (window as any).__dc.doc.pages[0].elements.length, id: (window as any).__dc.doc.id }));
  expect(d.title).toBe('Community cards');
  expect(d.n).toBeGreaterThan(2);
  expect(d.id).not.toBe('tpl_community-cards');
  expect(page.context().pages().length).toBe(pages);
});

test('home: card menu renames, copies, downloads and trashes; grid/list is remembered', async ({ page }) => {
  await home(page);
  await makeDesign(page, 'instagram-post', 'Poster one');
  const card = () => page.getByTestId('project-card').filter({ hasText: 'Poster one' });

  // rename inline
  await card().hover();
  await card().getByTestId('card-menu').click();
  await page.getByTestId('card-rename').click();
  await page.getByTestId('card-rename-input').fill('Poster two');
  await page.getByTestId('card-rename-input').press('Enter');
  await expect(page.getByTestId('project-card').filter({ hasText: 'Poster two' })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('project-card').filter({ hasText: 'Poster two' })).toBeVisible();
  const two = page.getByTestId('project-card').filter({ has: page.locator('b', { hasText: /^Poster two$/ }) });

  // make a copy
  await two.hover();
  await two.getByTestId('card-menu').click();
  await page.getByTestId('card-copy').click();
  await expect(page.getByTestId('toast')).toContainText('Copy of Poster two');
  await expect(page.getByTestId('project-card')).toHaveCount(2);

  // download the .dcanvas file
  await two.hover();
  await two.getByTestId('card-menu').click();
  const dl = page.waitForEvent('download');
  await page.getByTestId('card-download').click();
  expect((await dl).suggestedFilename()).toBe('Poster two.dcanvas');

  // list view, remembered after reload
  await page.getByTestId('view-list').click();
  await expect(page.getByTestId('designs')).toHaveAttribute('data-view', 'list');
  await page.reload();
  await expect(page.getByTestId('designs')).toHaveAttribute('data-view', 'list');

  // trash: this browser deletes for good, so it asks first; Cancel keeps it
  const copy = page.getByTestId('project-card').filter({ hasText: 'Copy of Poster two' });
  await copy.getByTestId('card-menu').click();
  await page.getByTestId('card-trash').click();
  await expect(page.getByTestId('confirm')).toBeVisible();
  await page.getByTestId('confirm-cancel').click();
  await expect(page.getByTestId('project-card')).toHaveCount(2);
  await copy.getByTestId('card-menu').click();
  await page.getByTestId('card-trash').click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('project-card')).toHaveCount(1);
  await expect(page.getByTestId('toast').last()).toContainText('deleted');
});

test('home screenshots (dark and light)', async ({ page }) => {
  await page.setViewportSize({ width: 1571, height: 875 });
  await home(page);
  await makeDesign(page, 'instagram-post', 'Cafe menu');
  await makeDesign(page, 'presentation', 'Quarterly pitch');
  await makeDesign(page, 'a4', 'Summer flyer');
  for (const scheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `/tmp/orch27-rw/r4-ui-home-${scheme}.png` });
  }
  await page.getByTestId('create-design').click();
  await page.screenshot({ path: '/tmp/orch27-rw/r4-ui-home-create-light.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: '/tmp/orch27-rw/r4-ui-home-create-dark.png' });
});
