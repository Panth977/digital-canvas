import { mkdirSync, readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { newDesign } from './helpers';
import { routeMockups } from './mockup-fixtures';

/** Mockups on a phone (projects iphone-15 and pixel-8): the grid in the bottom sheet, the preview full screen. */
test('phone: Mockups from the toolbar, grid in the sheet, full-screen preview', async ({ page }, info) => {
  await routeMockups(page);
  await newDesign(page);
  await page.evaluate(() => {
    const d = (window as any).__dc;
    d.updatePage({ background: { type: 'solid', color: '#e01010' } });
    d.addShape('ellipse');
    d.select([]);
    d.seal();
  });
  await page.getByTestId('m-mockups').click();
  const panel = page.getByTestId('mockups-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Mockups' })).toBeVisible();
  // two columns fit in the sheet
  const a = (await page.getByTestId('mockup-fx-poster').boundingBox())!, b = (await page.getByTestId('mockup-fx-mug').boundingBox())!;
  expect(Math.abs(a.y - b.y)).toBeLessThan(2);
  expect(b.x).toBeGreaterThan(a.x + a.width - 1);
  await expect.poll(() => page.getByTestId('mockup-canvas-fx-poster').getAttribute('data-rendered').then(Number), { timeout: 15_000 }).toBeGreaterThan(0);
  const px = await page.getByTestId('mockup-canvas-fx-poster').evaluate((c: HTMLCanvasElement) => Array.from(c.getContext('2d')!.getImageData(Math.floor(c.width * 0.3), Math.floor(c.height * 0.3), 1, 1).data));
  expect(px[0]).toBeGreaterThan(150); expect(px[1]).toBeLessThan(60);
  const shots = info.project.name === 'iphone-15';
  if (shots) {
    mkdirSync('/tmp/orch27-rw', { recursive: true });
    await page.waitForTimeout(300);
    await page.screenshot({ path: '/tmp/orch27-rw/r13-ui-phone.png' });
  }

  await page.getByTestId('mockup-fx-mug').click();
  const dlg = page.getByTestId('mockup-preview');
  await expect(dlg).toBeVisible();
  const vp = page.viewportSize()!;
  const box = (await dlg.boundingBox())!;
  expect(Math.round(box.width)).toBe(vp.width);
  expect(box.height).toBeGreaterThan(vp.height - 2);
  const full = page.getByTestId('mockup-full');
  await expect.poll(() => full.getAttribute('data-renders').then(Number), { timeout: 15_000 }).toBeGreaterThan(0);
  // everything reachable without scrolling: picture, colours, actions
  for (const id of ['mockup-full', 'mockup-color-1f3a93', 'mockup-download-png', 'mockup-add-page', 'mockup-next']) {
    const r = (await page.getByTestId(id).boundingBox())!;
    expect(r.y + r.height, id).toBeLessThanOrEqual(vp.height + 1);
    expect(r.x + r.width, id).toBeLessThanOrEqual(vp.width + 1);
  }
  const n = Number(await full.getAttribute('data-renders'));
  await page.getByTestId('mockup-color-1f3a93').click();
  await expect.poll(() => full.getAttribute('data-renders').then(Number)).toBeGreaterThan(n);
  if (shots) {
    await page.waitForTimeout(300);
    await page.screenshot({ path: '/tmp/orch27-rw/r13-ui-phone-preview.png' });
  }
  const [png] = await Promise.all([page.waitForEvent('download'), page.getByTestId('mockup-download-png').click()]);
  const bytes = readFileSync((await png.path())!);
  expect(bytes.readUInt32BE(16)).toBe(1000);
  await page.getByTestId('mockup-close').click();
  await expect(dlg).toHaveCount(0);
  await expect(panel).toBeVisible();
});
