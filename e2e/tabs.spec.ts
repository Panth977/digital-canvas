import { expect, test, type Page } from '@playwright/test';
import { CONTENT_HOSTS, fakeWco, newDesign } from './helpers.ts';

/** Design tabs (Canva's desktop app): several designs open in one window. */

const id = (page: Page) => page.evaluate(() => (window as any).__dc.doc.id as string);
const sel = (page: Page) => page.evaluate(() => (window as any).__dc.selection as string[]);
const tabIds = (page: Page) => page.locator('[data-tab]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tab')));
const live = (page: Page) => page.evaluate(() => (window as any).__tabs.liveCount as number);

/** Wait until the editor shows design `d`. */
async function showing(page: Page, d: string): Promise<void> {
  await expect.poll(() => page.evaluate(() => (window as any).__dc?.doc.id)).toBe(d);
  await expect(page.getByTestId('canvas')).toBeVisible();
}

/** A second (third…) design from Home: Home button, then a preset. */
async function another(page: Page, preset = 'instagram-story'): Promise<string> {
  const before = await page.evaluate(() => (window as any).__dc?.doc.id);
  await page.getByTestId('home').click();
  await page.getByTestId(`preset-${preset}`).click();
  await expect.poll(() => page.evaluate(() => (window as any).__dc?.doc.id)).not.toBe(before);
  await expect(page.getByTestId('canvas')).toBeVisible();
  return id(page);
}

test('tabs: two designs, each keeps its undo history, selection, zoom and side panel', async ({ page }) => {
  await newDesign(page);
  const a = await id(page);
  // one design in a browser tab: no strip (the browser has its own tabs)
  await expect(page.getByTestId('dtabs')).toHaveCount(0);
  await page.keyboard.press('r'); // a rectangle, selected
  const aSel = await sel(page);
  expect(aSel).toHaveLength(1);
  await page.getByTestId('tab-text').click();
  const fitZoom = await page.evaluate(() => (window as any).__dcView.get().zoom);
  await page.keyboard.press('Control+Equal');
  await expect.poll(() => page.evaluate(() => (window as any).__dcView.get().mode)).toBe(null);
  const aZoom = await page.evaluate(() => (window as any).__dcView.get().zoom);
  expect(aZoom).toBeGreaterThan(fitZoom);

  const b = await another(page);
  await expect(page.getByTestId('dtabs')).toBeVisible();
  expect(await tabIds(page)).toEqual([a, b]);
  await expect(page.getByTestId(`dtab-${b}`)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('t'); // a text box in B
  const bSel = await sel(page);
  expect(bSel).toHaveLength(1);
  expect(bSel).not.toEqual(aSel);
  await expect(page.getByTestId('tab-elements')).toHaveAttribute('aria-pressed', 'true');

  // back to A: same editor object, its selection, undo, zoom and panel
  await page.getByTestId(`dtab-${a}`).click();
  await showing(page, a);
  expect(await sel(page)).toEqual(aSel);
  await expect(page.getByTestId('undo')).toBeEnabled();
  await expect(page.getByTestId('tab-text')).toHaveAttribute('aria-pressed', 'true');
  // the view comes back on the canvas's first resize callback, a frame after the tab shows
  await expect.poll(() => page.evaluate(() => (window as any).__dcView.get().zoom)).toBeCloseTo(aZoom, 3);
  await expect(page.locator('svg.overlay polygon.sel')).toHaveCount(1);
  await page.getByTestId('undo').click();
  expect(await page.evaluate(() => (window as any).__dc.doc.pages[0].elements.length)).toBe(0);
  // redo is still there for A, and B still has its text box and its own history
  await expect(page.getByTestId('redo')).toBeEnabled();
  await page.getByTestId(`dtab-${b}`).click();
  await showing(page, b);
  expect(await sel(page)).toEqual(bSel);
  expect(await page.evaluate(() => (window as any).__dc.doc.pages[0].elements[0].type)).toBe('text');
  await expect(page.getByTestId('tab-elements')).toHaveAttribute('aria-pressed', 'true');
  expect(await live(page)).toBe(2);

  // the background tab saved itself (autosave keeps working after a switch)
  await page.getByTestId(`dtab-${a}`).click();
  await showing(page, a);
  await page.keyboard.press('c'); // a circle in A
  await page.getByTestId(`dtab-${b}`).click();
  await showing(page, b);
  await expect.poll(() => page.evaluate(async (a) => {
    const f = await (window as any).__library.store.open(a);
    return f.doc.pages[0].elements.length;
  }, a), { timeout: 10_000 }).toBe(1);
});

test('tabs: close, middle-click, reorder by dragging, titles follow renames', async ({ page }) => {
  await newDesign(page);
  const a = await id(page);
  await page.getByTestId('title').fill('Alpha poster');
  await page.getByTestId('title').press('Enter');
  const b = await another(page);
  const c = await another(page, 'presentation');
  expect(await tabIds(page)).toEqual([a, b, c]);
  await expect(page.getByTestId(`dtab-${a}`)).toContainText('Alpha poster');

  // drag C to the front
  const from = (await page.getByTestId(`dtab-${c}`).boundingBox())!;
  const to = (await page.getByTestId(`dtab-${a}`).boundingBox())!;
  await page.mouse.move(from.x + 30, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 40, to.y + to.height / 2, { steps: 8 });
  await page.mouse.move(to.x + 10, to.y + to.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => tabIds(page)).toEqual([c, a, b]);
  await showing(page, c);

  // middle click closes a background tab; the active one stays
  await page.getByTestId(`dtab-${b}`).click({ button: 'middle' });
  await expect.poll(() => tabIds(page)).toEqual([c, a]);
  await showing(page, c);

  // × on the active tab: the neighbour opens; one design left = no strip in a browser tab
  await page.getByTestId(`dtab-close-${c}`).click();
  await showing(page, a);
  await expect(page.getByTestId('dtabs')).toHaveCount(0);
  await expect.poll(() => live(page)).toBe(1);
});

test('tabs: reload brings the tabs back; keyboard shortcuts', async ({ page }) => {
  await newDesign(page);
  const a = await id(page);
  await page.keyboard.press('r');
  const b = await another(page);
  const c = await another(page, 'presentation');
  await page.waitForFunction(() => (window as any).__dc.saveState === 'saved');

  await page.reload();
  await showing(page, c);
  expect(await tabIds(page)).toEqual([a, b, c]);
  // tabs not shown yet are loaded from storage when opened
  expect(await live(page)).toBe(1);
  await page.getByTestId(`dtab-${a}`).click();
  await showing(page, a);
  expect(await page.evaluate(() => (window as any).__dc.doc.pages[0].elements.length)).toBe(1);

  // Ctrl+Tab / Ctrl+Shift+Tab walk Home → a → b → c (wrapping)
  await page.keyboard.press('Control+Tab');
  await showing(page, b);
  await page.keyboard.press('Control+Shift+Tab');
  await page.keyboard.press('Control+Shift+Tab');
  await expect(page.getByTestId('dtab-home')).toHaveClass(/on/);
  await expect(page.getByTestId('create-design')).toBeVisible();
  await page.keyboard.press('Control+Shift+Tab');
  await showing(page, c);
  // ⌘1..⌘9 (⌘9 = last)
  await page.keyboard.press('Control+Digit1');
  await showing(page, a);
  await page.keyboard.press('Control+Digit9');
  await showing(page, c);
  await page.keyboard.press('Control+Digit2');
  await showing(page, b);
  // ⌘W closes the active tab
  await page.keyboard.press('Control+KeyW');
  await showing(page, c);
  expect(await tabIds(page)).toEqual([a, c]);
  // ⌘T: Home with "Create a design" open; a new design gets a tab at the end
  await page.keyboard.press('Control+KeyT');
  await expect(page.getByTestId('create-popover')).toBeVisible();
  await page.getByTestId('create-popover').locator('[data-testid^=create-preset-]').first().click();
  await expect.poll(async () => (await tabIds(page)).length).toBe(3);
  expect((await tabIds(page)).slice(0, 2)).toEqual([a, c]);
  // "+" does the same
  await page.getByTestId('dtab-new').click();
  await expect(page.getByTestId('create-popover')).toBeVisible();
});

test('tabs: a deep link and the Projects panel open tabs; at most 8 editors stay in memory', async ({ page }) => {
  test.setTimeout(90_000);
  await newDesign(page);
  const ids = [await id(page)];
  for (let i = 0; i < 8; i++) ids.push(await another(page));
  expect(await tabIds(page)).toEqual(ids);
  expect(await live(page)).toBe(8);
  // the oldest was suspended; it comes back from storage
  await page.getByTestId(`dtab-${ids[0]}`).click();
  await showing(page, ids[0]!);
  expect(await live(page)).toBe(8);

  // deep link to a design already open: focuses its tab, no duplicate
  await page.goto(`/#/d/${ids[3]}`);
  await showing(page, ids[3]!);
  expect(await tabIds(page)).toEqual(ids);

  // the strip scrolls when it overflows; the active tab is kept in view
  await page.setViewportSize({ width: 900, height: 800 });
  const list = page.locator('[role=tablist]');
  expect(await list.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await page.getByTestId(`dtab-${ids[3]}`).click();
  await page.keyboard.press('Control+Digit9');
  await showing(page, ids[8]!);
  const box = (await page.getByTestId(`dtab-${ids[8]}`).boundingBox())!;
  const lb = (await list.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(lb.x + lb.width + 1);

  // Projects panel: opening another design focuses its tab
  await page.getByTestId('tab-projects').click();
  await page.getByTestId(`project-${ids[2]}`).click();
  await showing(page, ids[2]!);
  await expect(page.getByTestId(`dtab-${ids[2]}`)).toHaveAttribute('aria-selected', 'true');
});

test('tabs: none on phones', async ({ page }) => {
  await page.context().route(CONTENT_HOSTS, (r) => r.fulfill({ status: 503, body: 'offline in tests' }));
  await newDesign(page);
  await another(page);
  await expect(page.getByTestId('dtabs')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('dtabs')).toHaveCount(0);
});

test('tabs: installed app with Window Controls Overlay puts them in the title bar', async ({ page }) => {
  await newDesign(page);
  await fakeWco(page, true);
  // one design is enough: the strip is the title bar
  const strip = page.getByTestId('dtabs');
  await expect(strip).toHaveAttribute('data-mode', 'titlebar');
  const sb = (await strip.boundingBox())!;
  expect(sb.y).toBe(0);
  expect(sb.height).toBe(36);
  expect(sb.width).toBe(1440);
  // Home sits right of the traffic lights; the editor header starts below the bar
  const home = (await page.getByTestId('dtab-home').boundingBox())!;
  expect(home.x).toBeGreaterThanOrEqual(78);
  const header = (await page.locator('header.top').boundingBox())!;
  expect(header.y).toBe(36);
  // the bar drags the window; tabs and buttons don't
  const region = (sel: string) => page.locator(sel).first().evaluate((el) => (getComputedStyle(el) as any).webkitAppRegion ?? getComputedStyle(el).getPropertyValue('-webkit-app-region'));
  expect(await region('[data-testid=dtabs]')).toBe('drag');
  expect(await region('[data-testid=dtab-new]')).toBe('no-drag');
  expect(await region('[data-tab]')).toBe('no-drag');
  // the user hides the title bar (WCO off, still installed would be 'bar'); in a browser tab with one design: no strip
  await fakeWco(page, false);
  await expect(page.getByTestId('dtabs')).toHaveCount(0);
});
