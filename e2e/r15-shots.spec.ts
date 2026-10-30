import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { newDesign, elements } from './helpers.ts';

/** Before/after screenshots for the image audit (only when SHOTS=<prefix> is set). */
const prefix = process.env.SHOTS;
test.skip(!prefix, 'screenshots only');
const photo = fs.readFileSync('apps/web/public/mockups/mug-green/base.jpg');

test('image panel screenshots', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('tab-uploads').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('upload').click();
  await (await chooser).setFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: photo });
  await expect.poll(async () => (await elements(page)).length).toBe(1);
  await page.getByTestId('edit-image').click();
  await page.waitForTimeout(500);
  for (const t of ['tools', 'filters', 'adjust', 'shadows', 'duotone', 'effects']) {
    await page.getByTestId(`imgtab-${t}`).click();
    await page.waitForTimeout(t === 'filters' ? 1200 : 300);
    await page.screenshot({ path: `/tmp/orch27-rw/r15-${prefix}-${t}.png` });
  }
  await page.getByTestId('imgtab-shadows').click();
  await page.getByTestId('shadow-angle').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `/tmp/orch27-rw/r15-${prefix}-shadow-on.png` });
  await page.getByTestId('shadow-none').click();
  await page.getByTestId('imgtab-tools').click();
  await page.getByTestId('tool-erase').click();
  await page.locator('[data-testid="brush-canvas"][data-ready]').waitFor();
  const b = (await page.getByTestId('brush-canvas').boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.6, { steps: 6 });
  await page.mouse.up();
  await page.screenshot({ path: `/tmp/orch27-rw/r15-${prefix}-brush.png` });
  await page.getByTestId('brush-cancel').click();
  await page.getByTestId('crop').click();
  await page.getByTestId('crop-more').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `/tmp/orch27-rw/r15-${prefix}-crop.png` });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });
  test('phone panel', async ({ page }) => {
    await newDesign(page);
    await page.evaluate(async (b) => {
      const bytes = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
      await (window as any).__dc.addImageFile(new File([bytes], 'mug.jpg', { type: 'image/jpeg' }));
    }, photo.toString('base64'));
    await expect.poll(async () => (await elements(page)).length).toBe(1);
    await page.getByTestId('m-edit-image').click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `/tmp/orch27-rw/r15-${prefix}-phone-tools.png` });
    await page.getByTestId('tool-erase').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `/tmp/orch27-rw/r15-${prefix}-phone-brush.png` });
  });
});
