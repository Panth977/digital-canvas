import { expect, test, type Page } from '@playwright/test';
import { CONTENT_HOSTS, fakeWco } from './helpers.ts';

/** Screenshots of the design tabs: browser bar, installed-app title bar (WCO), dark and light. */
const SHOTS = '/tmp/orch27-rw';
test.use({ viewport: { width: 1571, height: 875 } });
// opens nine designs; slower than the default 30 s on a busy machine
test.setTimeout(120_000);
// screenshot-only file (no product assertions): a template click on a busy machine sometimes lands before Home settles
test.describe.configure({ retries: 2 });

/** Three designs from Home templates, each its own tab. */
async function threeDesigns(page: Page): Promise<void> {
  await page.context().route(CONTENT_HOSTS, (r) => r.fulfill({ status: 503, body: 'offline in tests' }));
  await page.goto('/');
  for (const t of ['menu-cafe', 'deck-pitch', 'yt-thumb-tech']) {
    const card = page.getByTestId(`home-template-${t}`);
    const id = (await card.count()) ? card : page.locator('[data-testid^=home-template-]').nth(['menu-cafe', 'deck-pitch', 'yt-thumb-tech'].indexOf(t));
    const before = await page.evaluate(() => (window as any).__dc?.doc.id);
    await id.click();
    await expect.poll(() => page.evaluate(() => (window as any).__dc?.doc.id)).not.toBe(before);
    await expect(page.getByTestId('canvas')).toBeVisible();
    if (t !== 'yt-thumb-tech') await page.getByTestId('home').click();
  }
}

/** Draw macOS traffic lights where the window would (the overlay is the browser's, not ours). */
async function trafficLights(page: Page): Promise<void> {
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.id = 'fake-lights';
    d.style.cssText = 'position:fixed;top:12px;left:14px;display:flex;gap:8px;z-index:99999';
    for (const c of ['#ff5f57', '#febc2e', '#28c840']) {
      const s = document.createElement('span');
      s.style.cssText = `width:12px;height:12px;border-radius:50%;background:${c};box-shadow:inset 0 0 0 .5px rgba(0,0,0,.25)`;
      d.append(s);
    }
    document.body.append(d);
  });
}

for (const scheme of ['dark', 'light'] as const) {
  test(`r7 tabs screenshots (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await threeDesigns(page);
    await page.waitForTimeout(600);
    const shot = (name: string) => page.screenshot({ path: `${SHOTS}/r7-tabs-${name}-${scheme}.png` });

    // browser tab: a thin bar above the header once two or more designs are open
    await expect(page.getByTestId('dtabs')).toHaveAttribute('data-mode', 'bar');
    await shot('browser');

    // installed app, Window Controls Overlay: tabs in the title bar next to the traffic lights
    await fakeWco(page, true);
    await trafficLights(page);
    await expect(page.getByTestId('dtabs')).toHaveAttribute('data-mode', 'titlebar');
    await page.waitForTimeout(300);
    await shot('wco');
    await page.getByTestId('dtab-home').click();
    await expect(page.getByTestId('create-design')).toBeVisible();
    await shot('wco-home');
    await page.getByTestId('dtab-new').click();
    await expect(page.getByTestId('create-popover')).toBeVisible();
    await shot('wco-new');
    await page.keyboard.press('Escape');

    // mid-drag: the dragged tab lifts, the others make room
    const ids = await page.locator('[data-tab]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tab')!));
    const last = (await page.getByTestId(`dtab-${ids[2]}`).boundingBox())!;
    const first = (await page.getByTestId(`dtab-${ids[0]}`).boundingBox())!;
    await page.mouse.move(last.x + 40, last.y + last.height / 2);
    await page.mouse.down();
    await page.mouse.move(first.x + 60, first.y + last.height / 2, { steps: 8 });
    await page.waitForTimeout(250);
    await shot('wco-drag');
    await page.mouse.up();

    // many designs: the strip scrolls
    if (scheme === 'dark') {
      for (let i = 0; i < 6; i++) {
        await page.getByTestId('dtab-home').click();
        const before = await page.evaluate(() => (window as any).__dc?.doc.id);
        await page.locator('[data-testid^=home-template-]').nth(4 + i).click();
        await expect.poll(() => page.evaluate(() => (window as any).__dc?.doc.id)).not.toBe(before);
        await expect(page.getByTestId('canvas')).toBeVisible();
      }
      await page.waitForTimeout(400);
      await shot('wco-many');
    }
  });
}
