import { expect, test, type Page } from '@playwright/test';
import { FakeDrive, FOLDER, fakeSignIn } from './fake-drive.ts';
import { elements, pngBytes } from './helpers.ts';

const SHOTS = '/tmp/orch27-rw';

/** Screenshot once every thumbnail in the panel has loaded. */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('[data-testid=uploads-panel] img')].every((i) => !i.getAttribute('src') || (i.complete && i.naturalWidth > 0)));
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
test.use({ viewport: { width: 1571, height: 875 }, colorScheme: 'dark' });

/** A Drive with a folder and a photo outside the app's folder (each test adds the app's own). */
async function seed(page: Page): Promise<FakeDrive> {
  const d = new FakeDrive();
  d.thumb = await pngBytes(page, 220, 220, '#00c4cc');
  d.add({ id: 'photos', name: 'Photos', mimeType: FOLDER, parents: ['root'] });
  d.add({ id: 'cat', name: 'cat.png', mimeType: 'image/png', parents: ['photos'], body: await pngBytes(page, 60, 40, '#e5484d') });
  return d;
}

test('Uploads tab shows your Drive uploads with a type filter and removes one', async ({ page }) => {
  await page.goto('/');
  const d = await seed(page);
  const png = await pngBytes(page, 30, 30, '#30a46c');
  const app = d.add({ name: 'Digital Canvas', mimeType: FOLDER, appProperties: { digitalCanvasRoot: '1' } });
  const assets = d.add({ name: 'assets', mimeType: FOLDER, parents: [app.id], appProperties: { dcAssets: '1', digitalCanvasRoot: 'assets' } });
  d.add({ name: '00000000000000000001.png', mimeType: 'image/png', parents: [assets.id], body: png, appProperties: { dcAsset: '00000000000000000001.png', dcName: 'logo.png' } });
  d.add({ name: '00000000000000000003.png', mimeType: 'image/png', parents: [assets.id], body: png, appProperties: { dcAsset: '00000000000000000003.png', dcName: 'badge.png' } });
  d.add({ name: '00000000000000000002.mp3', mimeType: 'audio/mpeg', parents: [assets.id], body: Buffer.from('x'), appProperties: { dcAsset: '00000000000000000002.mp3', dcName: 'jingle.mp3' } });
  await d.install(page);
  await fakeSignIn(page);
  await page.getByTestId('preset-instagram-post').click();
  await page.waitForFunction(() => !!(window as any).__dc);
  await page.getByTestId('tab-uploads').click();
  await page.getByTestId('uploads-tab-uploads').click();
  await expect(page.getByTestId('upload-item')).toHaveCount(2);
  await expect(page.getByTestId('uploads-panel')).toContainText('jingle.mp3');
  await shot(page, 'r3-drive-uploads');

  await page.getByTestId('kind-audio').click();
  await expect(page.getByTestId('upload-item')).toHaveCount(0);
  await page.getByTestId('kind-image').click();
  await expect(page.getByTestId('upload-item')).toHaveCount(2);

  // click: downloaded from the assets folder and placed
  await page.locator('[data-testid=upload-item][title="badge.png"]').click();
  await expect.poll(async () => (await elements(page)).filter((e) => e.type === 'image').length).toBe(1);

  // remove: hidden from Uploads, the file stays for designs that use it
  page.once('dialog', (dlg) => dlg.accept());
  const logo = page.locator('.tile', { has: page.locator('[title="logo.png"]') });
  await logo.hover();
  await logo.getByTestId('upload-remove').click();
  await expect(page.locator('[data-testid=upload-item][title="logo.png"]')).toHaveCount(0);
  await expect.poll(() => [...d.files.values()].find((f) => f.appProperties?.dcAsset === '00000000000000000001.png')?.appProperties?.dcHidden).toBe('1');
});
