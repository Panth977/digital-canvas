import { expect, test } from '@playwright/test';

test('Drive "Open with" asks to sign in, keeps the request, cleans the URL', async ({ page }) => {
  await page.goto(`/?state=${encodeURIComponent(JSON.stringify({ ids: ['FILE123'], action: 'open', userId: '1' }))}`);
  await expect(page.getByTestId('drive-signin')).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
  expect(await page.evaluate(() => sessionStorage.getItem('dc.driveState'))).toContain('FILE123');
  // still pending after a reload (e.g. the sign-in redirect)
  await page.reload();
  await expect(page.getByTestId('drive-signin')).toBeVisible();
});
