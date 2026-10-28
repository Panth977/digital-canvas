import { expect, test, type Page } from '@playwright/test';
import { GOOGLE_APP_ID, PICKER_API_KEY } from '../backend/google.ts';
import { FakeDrive, FOLDER, fakeSignIn } from './fake-drive.ts';
import { installFakePicker, pickerState, respond, cancel } from './fake-picker.ts';
import { doc, elements, pngBytes } from './helpers.ts';

const SHOTS = '/tmp/orch27-rw';
test.use({ viewport: { width: 1571, height: 875 }, colorScheme: 'dark' });

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('[data-testid=uploads-panel] img')].every((i) => !i.getAttribute('src') || (i.complete && i.naturalWidth > 0)));
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Every request the page makes, to prove no whole-Drive scope or tokeninfo call happens. */
function watch(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  return urls;
}

/** The user's Drive: files outside the app's folder (only readable once picked), plus the app's folder. */
async function seed(page: Page): Promise<{ d: FakeDrive; assets: string }> {
  const d = new FakeDrive();
  d.thumb = await pngBytes(page, 220, 220, '#00c4cc');
  d.add({ id: 'photos', name: 'Photos', mimeType: FOLDER, parents: ['root'] });
  d.add({ id: 'cat', name: 'cat.png', mimeType: 'image/png', parents: ['photos'], body: await pngBytes(page, 60, 40, '#e5484d') });
  d.add({ id: 'sky', name: 'sky.png', mimeType: 'image/png', parents: ['photos'], body: await pngBytes(page, 80, 50, '#3b82f6') });
  d.add({ id: 'logo', name: 'logo.png', mimeType: 'image/png', parents: ['photos'], body: await pngBytes(page, 40, 40, '#30a46c') });
  const app = d.add({ name: 'Digital Canvas', mimeType: FOLDER, appProperties: { digitalCanvasRoot: '1' } });
  const assets = d.add({ name: 'assets', mimeType: FOLDER, parents: [app.id], appProperties: { dcAssets: '1', digitalCanvasRoot: 'assets' } });
  return { d, assets: assets.id };
}

async function openDriveTab(page: Page): Promise<{ d: FakeDrive; assets: string }> {
  await installFakePicker(page);
  await page.goto('/');
  const s = await seed(page);
  await s.d.install(page);
  await fakeSignIn(page);
  await page.getByTestId('preset-instagram-post').click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.waitForFunction(() => !!(window as any).__dc);
  await page.getByTestId('tab-uploads').click();
  await page.getByTestId('uploads-tab-drive').click();
  return s;
}

const media = (d: FakeDrive) => d.log.filter((l) => /^GET \/drive\/v3\/files\/(cat|sky|logo)$/.test(l));

test('Drive tab: one "Choose from Google Drive" button, no whole-Drive browser', async ({ page }) => {
  const urls = watch(page);
  await openDriveTab(page);
  const panel = page.getByTestId('drive-pick-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('drive-pick')).toHaveText(/Choose from Google Drive/);
  await expect(panel).toContainText('only the files you pick');
  for (const gone of ['connect-drive', 'drive-search', 'drive-src-computers', 'drive-crumbs']) await expect(page.getByTestId(gone)).toHaveCount(0);
  await shot(page, 'r8-picker-empty');

  // closing the Picker changes nothing
  await page.getByTestId('drive-pick').click();
  await expect(page.getByTestId('fake-picker')).toBeVisible();
  await cancel(page);
  await expect(page.getByTestId('fake-picker')).toHaveCount(0);
  await expect(page.getByTestId('drive-picked')).toHaveCount(0);
  expect(urls.filter((u) => /drive\.readonly|tokeninfo|apis\.google\.com\/js\/api\.js/.test(u))).toEqual([]);
});

test('pick → download with progress → stored once in Digital Canvas/assets → listed → click and drag onto the page', async ({ page }) => {
  const urls = watch(page);
  const { d, assets } = await openDriveTab(page);

  // slow one download down so the progress tile shows
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route(/\/drive\/v3\/files\/sky\?alt=media/, async (r) => { await held; await r.fallback(); });

  await page.getByTestId('drive-pick').click();
  await expect(page.getByTestId('fake-picker')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/r8-picker-open.png` });
  const cfg = await pickerState(page);
  expect(cfg).toMatchObject({ appId: GOOGLE_APP_ID, key: PICKER_API_KEY, token: 'fake-token', origin: new URL(page.url()).origin });
  expect(cfg.features).toEqual(expect.arrayContaining(['multiselect', 'support-drives']));
  expect(cfg.views.map((v) => v.label)).toEqual(['My Drive', 'Shared with me', 'Starred', 'Recent', 'Shared drives', 'Images', 'Videos', 'Audio']);
  expect(cfg.views[0]).toMatchObject({ parent: 'root', folders: true });
  expect(cfg.views[1]).toMatchObject({ ownedByMe: false });
  expect(cfg.views[2]).toMatchObject({ starred: true });
  expect(cfg.views[4]).toMatchObject({ drives: true });
  expect(cfg.views[0]!.mimes).toContain('image/png');

  await respond(page, [
    { id: 'cat', name: 'cat.png', mimeType: 'image/png', sizeBytes: 300 },
    { id: 'photos', name: 'Photos', mimeType: FOLDER },
    { id: 'sky', name: 'sky.png', mimeType: 'image/png' },
  ]);
  await expect(page.getByTestId('fake-picker')).toHaveCount(0);
  // cat.png is in already; sky.png is still downloading
  await expect(page.getByTestId('drive-picked')).toHaveCount(1);
  await expect(page.getByTestId('drive-importing')).toHaveCount(1);
  await expect(page.getByTestId('drive-importing')).toHaveAttribute('title', 'sky.png');
  await expect(page.getByTestId('drive-progress')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/r8-picker-progress.png` });
  release();

  const picked = page.getByTestId('drive-picked');
  await expect(picked).toHaveCount(2);
  await expect(page.getByTestId('drive-importing')).toHaveCount(0);
  await expect(page.getByTestId('uploads-panel')).toContainText('From Google Drive');
  // two picks of more than one file: nothing placed yet
  expect((await elements(page)).length).toBe(0);
  // each copied once into Digital Canvas/assets, marked with the Drive file it came from
  const stored = [...d.files.values()].filter((f) => f.parents?.includes(assets));
  expect(stored.map((f) => [f.appProperties!.dcDrive, f.appProperties!.dcName]).sort()).toEqual([['cat', 'cat.png'], ['sky', 'sky.png']]);
  await shot(page, 'r8-picker-picked');

  // click: placed on the page
  await page.locator('[data-testid=drive-picked][title="cat.png"]').click();
  await expect.poll(async () => (await elements(page)).filter((e) => e.type === 'image').length).toBe(1);
  const img = (await elements(page)).find((e) => e.type === 'image') as any;
  expect((await doc(page)).assets[img.asset]).toMatchObject({ mime: 'image/png', width: 60, height: 40, name: 'cat.png' });
  expect(img.asset).toBe(stored.find((f) => f.appProperties!.dcDrive === 'cat')!.appProperties!.dcAsset);

  // drag: lands where it was dropped
  const stage = (await page.getByTestId('stage').boundingBox())!;
  await page.locator('[data-testid=drive-picked][title="sky.png"]').dragTo(page.getByTestId('stage'), { targetPosition: { x: stage.width / 2 + 60, y: stage.height / 2 + 40 } });
  await expect.poll(async () => (await elements(page)).filter((e) => e.type === 'image').length).toBe(2);
  const sky = (await elements(page)).filter((e) => e.type === 'image')[1]!;
  expect(sky.x + sky.w / 2).toBeGreaterThan(560);
  expect(sky.y + sky.h / 2).toBeGreaterThan(560);
  await shot(page, 'r8-picker-inserted');

  // never the whole Drive: no restricted scope, no tokeninfo, no listing outside our folders
  expect(urls.filter((u) => /drive\.readonly|tokeninfo/.test(u))).toEqual([]);
  expect(d.log.filter((l) => /'root' in parents|sharedWithMe|'photos' in parents/.test(l))).toEqual([]);
});

test('files picked before are listed without picking again; picking one again places it without a new download', async ({ page }) => {
  await installFakePicker(page);
  await page.goto('/');
  const { d, assets } = await seed(page);
  // picked on another device: already in Digital Canvas/assets with dcDrive
  const logo = await pngBytes(page, 40, 40, '#30a46c');
  d.add({ name: '00000000000000000009.png', mimeType: 'image/png', parents: [assets], body: logo, appProperties: { dcAsset: '00000000000000000009.png', dcName: 'logo.png', dcDrive: 'logo' } });
  d.add({ name: '00000000000000000008.png', mimeType: 'image/png', parents: [assets], body: logo, appProperties: { dcAsset: '00000000000000000008.png', dcName: 'upload.png' } });
  await d.install(page);
  await fakeSignIn(page);
  await page.getByTestId('preset-instagram-post').click();
  await page.waitForFunction(() => !!(window as any).__dc);
  await page.getByTestId('tab-uploads').click();
  await page.getByTestId('uploads-tab-drive').click();
  // only the Drive pick, not the ordinary upload
  await expect(page.getByTestId('drive-picked')).toHaveCount(1);
  await expect(page.getByTestId('drive-picked')).toHaveAttribute('title', 'logo.png');
  await page.getByTestId('drive-kind-video').click();
  await expect(page.getByTestId('drive-picked')).toHaveCount(0);
  await page.getByTestId('drive-kind-all').click();

  // one file picked: placed right away; already imported, so not downloaded from Drive again
  await page.getByTestId('drive-pick').click();
  await respond(page, [{ id: 'logo', name: 'logo.png', mimeType: 'image/png' }]);
  await expect.poll(async () => (await elements(page)).filter((e) => e.type === 'image').length).toBe(1);
  expect(d.log.filter((l) => l.startsWith('GET /drive/v3/files/logo'))).toEqual([]);
  expect(media(d)).toEqual([]);
  expect([...d.files.values()].filter((f) => f.parents?.includes(assets))).toHaveLength(2);
});

test('a picked file that cannot be read shows an error and nothing else changes', async ({ page }) => {
  await openDriveTab(page);
  await page.getByTestId('drive-pick').click();
  await respond(page, [{ id: 'gone', name: 'gone.png', mimeType: 'image/png' }]);
  await expect(page.getByTestId('drive-error')).toContainText('gone.png');
  await expect(page.getByTestId('drive-picked')).toHaveCount(0);
  await expect(page.getByTestId('drive-importing')).toHaveCount(0);
});
