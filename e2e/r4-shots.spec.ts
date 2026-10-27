import { expect, test, type Page } from '@playwright/test';
import { newDesign, pngBytes } from './helpers.ts';

/** Screenshots of the Canva-parity UI (header menus, toolbar, colour, animate), dark and light. */
const SHOTS = '/tmp/orch27-rw';
test.use({ viewport: { width: 1571, height: 875 } });

async function design(page: Page): Promise<void> {
  await newDesign(page);
  await page.getByTestId('title').fill('Kesar Basundi menu');
  await page.getByTestId('title').press('Enter');
  await page.getByTestId('shape-rect').click();
  const png = await pngBytes(page, 80, 60, '#d98b2b');
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await (window as any).__dc.addImageFile(new File([bytes], 'photo.png', { type: 'image/png' }));
  }, png.toString('base64'));
  await page.getByTestId('tab-text').click();
  await page.getByTestId('text-heading').click();
}

for (const scheme of ['dark', 'light'] as const) {
  test(`r4 UI screenshots (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await design(page);
    const shot = (name: string) => page.screenshot({ path: `${SHOTS}/r4-ui-${name}-${scheme}.png` });

    // toolbar: size list open, tooltip
    await page.getByTestId('font-size').click();
    await shot('toolbar-size');
    await page.keyboard.press('Escape');
    await page.getByTestId('spacing-btn').click();
    await shot('toolbar-spacing');
    await page.getByTestId('spacing-btn').click();
    await page.getByTestId('bold').hover();
    await expect(page.getByTestId('tooltip')).toBeVisible();
    await shot('tooltip');

    // colour panel with our picker
    await page.getByTestId('text-color-btn').click();
    await page.getByTestId('color-add').click();
    await shot('color');
    // animate
    await page.getByTestId('animate-btn').click();
    await page.getByTestId('anim-rise').click();
    await shot('animate');

    // header menus
    await page.keyboard.press('Escape');
    await page.getByTestId('file-menu').click();
    await page.getByTestId('file-settings').hover();
    await shot('file-menu');
    await page.getByTestId('file-menu').click();
    await page.getByTestId('resize').click();
    await page.getByTestId('resize-preset-instagram-story').check();
    await shot('resize');
    await page.getByTestId('resize').click();
    await page.getByTestId('download').click();
    await page.getByTestId('dl-pages').click();
    await shot('download');
    await page.getByTestId('download').click();
    await page.keyboard.press('?');
    await shot('shortcuts');
    await page.keyboard.press('Escape');

    // narrow window: overflow into …
    await page.setViewportSize({ width: 1100, height: 760 });
    await page.evaluate(() => { const ed = (window as any).__dc; ed.select([ed.page.elements.find((e: any) => e.type === 'text').id]); });
    await expect(page.getByTestId('context-toolbar')).toHaveAttribute('data-kind', 'text');
    await page.getByTestId('more-btn').click();
    await page.screenshot({ path: `${SHOTS}/r4-ui-overflow-${scheme}.png` });
  });
}
