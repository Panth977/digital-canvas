import { expect, test, type Page } from '@playwright/test';
import { FakeDrive, FOLDER, READONLY, fakeSignIn } from './fake-drive.ts';
import { doc, elements, pngBytes } from './helpers.ts';

const SHOTS = '/tmp/orch27-rw';

/** Screenshot once every thumbnail in the panel has loaded. */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('[data-testid=uploads-panel] img')].every((i) => !i.getAttribute('src') || (i.complete && i.naturalWidth > 0)));
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
test.use({ viewport: { width: 1571, height: 875 }, colorScheme: 'dark' });

/** A Drive with a tree, a computer backup, something shared and a big folder. */
async function seed(page: Page): Promise<FakeDrive> {
  const d = new FakeDrive();
  const red = await pngBytes(page, 60, 40, '#e5484d');
  const blue = await pngBytes(page, 50, 50, '#3b82f6');
  d.thumb = await pngBytes(page, 220, 220, '#00c4cc');
  const thumb = (n: string) => `https://lh3.googleusercontent.com/fake-${n}=s220`;
  d.add({ id: 'photos', name: 'Photos', mimeType: FOLDER, parents: ['root'] });
  d.add({ id: 'big', name: 'Big folder', mimeType: FOLDER, parents: ['root'] });
  d.add({ id: 'notes', name: 'notes.txt', mimeType: 'text/plain', parents: ['root'] });
  d.add({ id: 'cat', name: 'cat.png', mimeType: 'image/png', parents: ['photos'], body: red, thumbnailLink: thumb('cat'), imageMediaMetadata: { width: 60, height: 40 } });
  d.add({ id: 'trip', name: 'Trip 2026', mimeType: FOLDER, parents: ['photos'] });
  for (let i = 0; i < 130; i++) d.add({ id: `b${i}`, name: `IMG_${String(i).padStart(4, '0')}.png`, mimeType: 'image/png', parents: ['big'], body: blue, thumbnailLink: thumb(`b${i}`) });
  // Drive for desktop: the computer is an owned folder with no parent
  d.add({ id: 'mac', name: 'MacBook Pro', mimeType: FOLDER });
  d.add({ id: 'desk', name: 'Desktop', mimeType: FOLDER, parents: ['mac'] });
  d.add({ id: 'shot', name: 'Screenshot.png', mimeType: 'image/png', parents: ['desk'], body: blue, thumbnailLink: thumb('shot') });
  d.add({ id: 'theirs', name: 'From a friend', mimeType: FOLDER, owned: false });
  return d;
}

async function openDrive(page: Page, scopes: string[]): Promise<FakeDrive> {
  await page.goto('/');
  const d = await seed(page);
  await d.install(page);
  await fakeSignIn(page, scopes);
  await page.getByTestId('preset-instagram-post').click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.waitForFunction(() => !!(window as any).__dc);
  await page.getByTestId('tab-uploads').click();
  return d;
}

test('Drive tab asks to connect the whole Drive when only drive.file is granted', async ({ page }) => {
  await openDrive(page, ['openid', 'https://www.googleapis.com/auth/drive.file']);
  await page.getByTestId('uploads-tab-drive').click();
  await expect(page.getByTestId('connect-drive')).toBeVisible();
  await expect(page.getByTestId('drive-connect')).toContainText('Advanced → Continue');
  await shot(page, 'r3-drive-connect');
});

test('browse My Drive folders, page a big folder, insert an image stored once as an asset', async ({ page }) => {
  const d = await openDrive(page, [READONLY]);
  await page.getByTestId('uploads-tab-drive').click();
  const folders = page.getByTestId('drive-folder');
  await expect(folders).toHaveText([/^\s*Photos\s*$/, /^\s*Big\ folder\s*$/, /^\s*Digital Canvas\s*$/]);
  await expect(page.getByTestId('drive-file')).toHaveCount(0); // notes.txt is not media

  await folders.filter({ hasText: 'Photos' }).click();
  await expect(page.getByTestId('drive-crumbs')).toContainText(/My Drive\s*›\s*Photos/);
  await expect(page.getByTestId('drive-folder')).toHaveText([/^\s*Trip\ 2026\s*$/]);
  await expect(page.getByTestId('drive-file')).toHaveCount(1);
  await shot(page, 'r3-drive-folder');

  await page.getByTestId('drive-file').first().click();
  await expect.poll(async () => (await elements(page)).filter((e) => e.type === 'image').length).toBe(1);
  const img = (await elements(page)).find((e) => e.type === 'image') as any;
  const meta = (await doc(page)).assets[img.asset];
  expect(meta).toMatchObject({ mime: 'image/png', width: 60, height: 40, name: 'cat.png' });
  // saved once into Digital Canvas/assets under its content hash
  await expect.poll(() => [...d.files.values()].filter((f) => f.appProperties?.dcAsset === img.asset).length, { timeout: 15_000 }).toBe(1);
  const stored = [...d.files.values()].find((f) => f.appProperties?.dcAsset === img.asset)!;
  expect(stored.appProperties!.dcName).toBe('cat.png');
  expect(d.files.get(stored.parents![0]!)!.name).toBe('assets');

  // back via breadcrumbs (cached: no new request), then a big folder pages in on scroll
  const before = d.log.length;
  await page.getByTestId('drive-crumbs').getByRole('button', { name: 'My Drive' }).click();
  await expect(page.getByTestId('drive-folder')).toHaveText([/^\s*Photos\s*$/, /^\s*Big\ folder\s*$/, /^\s*Digital Canvas\s*$/]);
  expect(d.log.slice(before).filter((l) => l.includes("'root' in parents"))).toHaveLength(0);
  await page.getByTestId('drive-folder').filter({ hasText: 'Big folder' }).click();
  await expect(page.getByTestId('drive-file')).toHaveCount(100);
  await page.getByTestId('drive-file').nth(99).scrollIntoViewIfNeeded();
  await expect(page.getByTestId('drive-file')).toHaveCount(130);
  expect(d.log.some((l) => l.includes("'big' in parents") && l.includes('page=100'))).toBe(true);

  // search the whole Drive
  await page.getByTestId('drive-search').fill('screenshot');
  await page.getByTestId('drive-search').press('Enter');
  await expect(page.getByTestId('drive-file')).toHaveCount(1);
  await expect(page.getByTestId('drive-file')).toHaveAttribute('title', 'Screenshot.png');
});

test('Computers lists backed-up machines; drag a backup file onto the page', async ({ page }) => {
  await openDrive(page, [READONLY]);
  await page.getByTestId('uploads-tab-drive').click();
  await page.getByTestId('drive-src-computers').click();
  await expect(page.getByTestId('drive-folder')).toHaveText([/^\s*MacBook\ Pro\s*$/]); // not "From a friend" (not yours) or My Drive folders
  await shot(page, 'r3-drive-computers');
  await page.getByTestId('drive-folder').click();
  await page.getByTestId('drive-folder').filter({ hasText: 'Desktop' }).click();
  await expect(page.getByTestId('drive-crumbs')).toContainText(/Computers\s*›\s*MacBook Pro\s*›\s*Desktop/);
  const file = page.getByTestId('drive-file');
  await expect(file).toHaveCount(1);
  await shot(page, 'r3-drive-backup');

  const stage = (await page.getByTestId('stage').boundingBox())!;
  const target = { x: stage.x + stage.width / 2 + 60, y: stage.y + stage.height / 2 + 40 };
  await file.dragTo(page.getByTestId('stage'), { targetPosition: { x: target.x - stage.x, y: target.y - stage.y } });
  await expect.poll(async () => (await elements(page)).filter((e) => e.type === 'image').length).toBe(1);
  const [img] = (await elements(page)).filter((e) => e.type === 'image');
  const a = (await doc(page)).assets[(img as any).asset];
  expect(a).toMatchObject({ width: 50, height: 50, name: 'Screenshot.png' });
  // landed where it was dropped (right of and below the page centre), not in the middle
  expect(img!.x + img!.w / 2).toBeGreaterThan(560);
  expect(img!.y + img!.h / 2).toBeGreaterThan(560);
});

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
  await fakeSignIn(page, ['https://www.googleapis.com/auth/drive.file']);
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
