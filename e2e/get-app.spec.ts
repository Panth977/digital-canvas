import { expect, test } from '@playwright/test';

test('Home has "Get the app"; /download offers every platform and the first-launch steps', async ({ page }) => {
  await page.route('https://api.github.com/**', (r) => r.fulfill({ json: { tag_name: 'v0.1.0' } }));
  await page.goto('/');
  await page.getByTestId('download-app').click();
  await expect(page).toHaveURL(/\/download$/);
  await expect(page.getByTestId('download-page')).toContainText('Version 0.1.0');
  for (const id of ['mac-arm64', 'mac-x64', 'windows', 'linux-appimage', 'linux-deb']) await expect(page.getByTestId(`download-${id}`)).toHaveAttribute('href', /releases\/latest\/download\/Digital-Canvas-/);
  await expect(page.getByTestId('download-primary').first()).toBeVisible();
  await expect(page.getByText('Open Anyway')).toBeVisible();
  await expect(page.getByText('Run anyway')).toBeVisible();
  if (process.env.DC_DESKTOP_SHOTS) await page.screenshot({ path: `${process.env.DC_DESKTOP_SHOTS}/r16-desktop-download.png`, fullPage: true });
});

test('a direct link to /download works', async ({ page }) => {
  await page.goto('/download');
  await expect(page.getByTestId('download-page')).toBeVisible();
});
