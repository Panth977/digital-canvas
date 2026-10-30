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
});
