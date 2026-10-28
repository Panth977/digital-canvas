import { expect, test, type Page } from '@playwright/test';
import { FakeDrive, FOLDER, fakeSignIn } from './fake-drive.ts';
import { installFakePicker, pickerState, respond } from './fake-picker.ts';
import { elements, pngBytes } from './helpers.ts';

/** Google Picker on the phone layout (runs in the iphone-15 and pixel-8 projects only). */

async function openDriveSheet(page: Page): Promise<FakeDrive> {
  await installFakePicker(page);
  await page.goto('/');
  const d = new FakeDrive();
  d.add({ id: 'cat', name: 'cat.png', mimeType: 'image/png', parents: ['root'], body: await pngBytes(page, 60, 40, '#e5484d') });
  const app = d.add({ name: 'Digital Canvas', mimeType: FOLDER, appProperties: { digitalCanvasRoot: '1' } });
  d.add({ name: 'assets', mimeType: FOLDER, parents: [app.id], appProperties: { dcAssets: '1', digitalCanvasRoot: 'assets' } });
  await d.install(page);
  await fakeSignIn(page);
  await page.getByTestId('m-create').tap();
  await page.getByTestId('create-preset-instagram-post').tap();
  await expect(page.getByTestId('mobile-editor')).toBeVisible();
  await page.waitForFunction(() => !!(window as any).__dc);
  await page.getByTestId('m-uploads').tap();
  await page.getByTestId('uploads-tab-drive').tap();
  return d;
}

test('phone: Choose from Google Drive opens the Picker full screen, a pick lands on the page', async ({ page }) => {
  const shot = `/tmp/orch27-rw/r8-picker-phone-${test.info().project.name}`;
  await openDriveSheet(page);
  const button = page.getByTestId('drive-pick');
  await expect(button).toBeVisible();
  const vp = page.viewportSize()!;
  const box = (await button.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  expect(box.height).toBeGreaterThanOrEqual(44); // a comfortable tap target
  await page.screenshot({ path: `${shot}.png` });

  await button.tap();
  await expect(page.getByTestId('fake-picker')).toBeVisible();
  expect((await pickerState(page)).size).toEqual([vp.width, vp.height]);
  await page.screenshot({ path: `${shot}-open.png` });
  await respond(page, [{ id: 'cat', name: 'cat.png', mimeType: 'image/png' }]);
  await expect.poll(async () => (await elements(page)).filter((e) => e.type === 'image').length).toBe(1);
});

test('installed app (WebView): no Picker, the phone\'s own file picker instead', async ({ page }) => {
  await installFakePicker(page);
  await page.goto('/');
  const d = new FakeDrive();
  d.add({ name: 'Digital Canvas', mimeType: FOLDER, appProperties: { digitalCanvasRoot: '1' } });
  await d.install(page);
  await fakeSignIn(page);
  await page.getByTestId('m-create').tap();
  await page.getByTestId('create-preset-instagram-post').tap();
  await expect(page.getByTestId('mobile-editor')).toBeVisible();
  // as if inside the Capacitor shell (the panel reads this when it opens)
  await page.evaluate(() => ((window as any).Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' }));
  await page.getByTestId('m-uploads').tap();
  await page.getByTestId('uploads-tab-drive').tap();
  await expect(page.getByTestId('drive-native')).toBeVisible();
  await expect(page.getByTestId('drive-native')).toContainText('Google Drive');
  await expect(page.getByTestId('drive-pick')).toHaveCount(0);
  await page.screenshot({ path: `/tmp/orch27-rw/r8-picker-app-${test.info().project.name}.png` });
});
