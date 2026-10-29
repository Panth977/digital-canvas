import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { FakeDrive, FOLDER, fakeSignIn, type FakeFile } from './fake-drive.ts';
import { installFakePicker, pickerState, respond } from './fake-picker.ts';
import { CONTENT_HOSTS, waitSaved } from './helpers.ts';

/**
 * Share (r11): the Share popover on Drive permissions, view-only designs shared
 * with you, the public /view page, /template copies. Google is faked: an
 * in-memory Drive (fake-drive.ts, with permissions and API-key reads) and the
 * Picker stand-in (fake-picker.ts).
 */
const SHOTS = '/tmp/orch27-rw';
mkdirSync(SHOTS, { recursive: true });

async function seedDrive(): Promise<FakeDrive> {
  const d = new FakeDrive();
  const app = d.add({ id: 'appfolder', name: 'Digital Canvas', mimeType: FOLDER, appProperties: { digitalCanvasRoot: '1' } });
  d.add({ id: 'assetsfolder', name: 'assets', mimeType: FOLDER, parents: [app.id], appProperties: { dcAssets: '1', digitalCanvasRoot: 'assets' } });
  return d;
}

async function signedInPage(page: Page, d: FakeDrive, path = '/'): Promise<void> {
  await page.context().route(CONTENT_HOSTS, (r) => r.fulfill({ status: 503, body: 'offline in tests' }));
  await installFakePicker(page);
  await d.install(page);
  await page.goto(path);
  await fakeSignIn(page);
}

/** Tester makes a 2-page design with one picture and waits for the save. Returns its Drive file. */
async function ownerDesign(page: Page, d: FakeDrive): Promise<{ file: FakeFile; asset: FakeFile; docId: string }> {
  await signedInPage(page, d);
  await page.getByTestId('preset-instagram-post').click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.waitForFunction(() => !!(window as any).__dc);
  await page.evaluate(async () => {
    const c = new OffscreenCanvas(120, 80);
    const g = c.getContext('2d')!;
    g.fillStyle = '#e5484d';
    g.fillRect(0, 0, 120, 80);
    g.fillStyle = '#ffd60a';
    g.fillRect(30, 20, 60, 40);
    const blob = await c.convertToBlob({ type: 'image/png' });
    const ed = (window as any).__dc;
    await ed.addImageFile(new File([blob], 'red.png', { type: 'image/png' }));
    ed.rename('Launch poster');
    ed.addPage();
  });
  await waitSaved(page);
  const docId = await page.evaluate(() => (window as any).__dc.doc.id);
  const file = [...d.files.values()].find((f) => f.appProperties?.dcDocId === docId)!;
  const asset = [...d.files.values()].find((f) => f.appProperties?.dcAsset)!;
  expect(file && asset).toBeTruthy();
  return { file, asset, docId };
}

/** Hand Tester's design to "Ann": it lives in her Drive now and Tester's app was never granted it. */
function makeAnnsDesign(d: FakeDrive, file: FakeFile, asset: FakeFile, myRole: 'reader' | 'writer' | 'commenter', link?: 'reader' | 'writer'): void {
  for (const f of d.files.values()) {
    if (f.mimeType === FOLDER) f.appProperties = {}; // Tester's app folders: now Ann's (Tester's app makes its own)
  }
  const ann = { id: 'p-owner', type: 'user' as const, role: 'owner', emailAddress: 'ann@example.com', displayName: 'Ann Lee' };
  const anyone = link ? [{ id: 'anyoneWithLink', type: 'anyone' as const, role: link }] : [];
  Object.assign(file, { owned: false, noAccess: true, myRole, ownerName: 'Ann Lee', ownerEmail: 'ann@example.com', perms: [ann, { id: 'p-me', type: 'user', role: myRole, emailAddress: 'tester@example.com', displayName: 'Tester' }, ...anyone] });
  // the asset was published when Ann shared the design
  Object.assign(asset, { owned: false, noAccess: true, appProperties: { ...asset.appProperties, dcPublic: '1' }, perms: [ann, { id: 'anyoneWithLink', type: 'anyone', role: 'reader' }] });
}

async function freshPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  return ctx.newPage();
}

test.describe('Share popover', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('people, roles, link access, assets published, links, QR, email', async ({ page }) => {
    const d = await seedDrive();
    const { file, asset } = await ownerDesign(page, d);

    await page.getByTestId('share').click();
    const menu = page.getByTestId('share-menu');
    await expect(menu).toBeVisible();
    await expect(page.getByTestId('share-owner')).toContainText('Owner: Tester (you)');
    await expect(page.getByTestId('share-person')).toHaveCount(1);
    await expect(page.getByTestId('share-link-access')).toHaveValue('restricted');
    expect(asset.perms ?? []).toHaveLength(0); // not shared: assets stay private

    // add a person: Can comment, with a message
    await page.getByTestId('share-email').fill('bob@example.com');
    await page.getByTestId('share-role').selectOption('commenter');
    await page.getByTestId('share-message').fill('Have a look at the poster');
    await page.screenshot({ path: `${SHOTS}/r11-share-add.png` });
    await page.getByTestId('share-send').click();
    await expect(page.getByTestId('share-person')).toHaveCount(2);
    const add = d.permCalls.find((c) => c.method === 'POST' && c.body.type === 'user')!;
    expect(add.fileId).toBe(file.id);
    expect(add.body).toEqual({ type: 'user', role: 'commenter', emailAddress: 'bob@example.com' });
    expect(add.query.sendNotificationEmail).toBe('true');
    expect(add.query.emailMessage).toBe(`Open in Digital Canvas: https://digital-canvas-p977.web.app/d/${file.id}\n\nHave a look at the poster`);
    await expect(page.getByTestId('share-sent')).toContainText('Shared with bob@example.com');
    // shared: the design's picture is now link-readable for Bob's app
    await expect.poll(() => d.isPublic(asset)).toBe(true);
    expect(asset.appProperties?.dcPublic).toBe('1');
    expect(asset.perms!.find((p) => p.type === 'anyone')).toMatchObject({ role: 'reader', allowFileDiscovery: false });

    // change Bob's role
    const bob = page.locator('[data-testid=share-person][data-email="bob@example.com"]');
    await bob.getByTestId('share-person-role').selectOption('reader');
    await expect.poll(() => d.permsOf(file).find((p) => p.emailAddress === 'bob@example.com')?.role).toBe('reader');

    // bad email: Drive is not called
    await page.getByTestId('share-email').fill('not-an-email');
    await page.getByTestId('share-send').click();
    await expect(page.getByTestId('share-error')).toContainText('is not an email address');
    await page.getByTestId('share-email').fill('');

    // link access: anyone with the link can view, then can edit
    await page.getByTestId('share-link-access').selectOption('anyone');
    await expect.poll(() => d.permsOf(file).find((p) => p.type === 'anyone')?.role).toBe('reader');
    expect(d.permsOf(file).find((p) => p.type === 'anyone')!.allowFileDiscovery).toBe(false);
    await expect(page.getByTestId('share-link-role')).toHaveValue('reader');
    await page.getByTestId('share-link-role').selectOption('writer');
    await expect.poll(() => d.permsOf(file).find((p) => p.type === 'anyone')?.role).toBe('writer');

    // links
    const link = `https://digital-canvas-p977.web.app/d/${file.id}`;
    await expect(page.getByTestId('share-copy')).toHaveAttribute('data-link', link);
    await page.getByTestId('share-copy').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    await expect(page.getByTestId('share-public')).toHaveAttribute('data-link', `https://digital-canvas-p977.web.app/view/${file.id}`);
    await expect(page.getByTestId('share-template')).toHaveAttribute('data-link', `https://digital-canvas-p977.web.app/template/${file.id}`);
    const mail = await page.getByTestId('share-email-link').getAttribute('href');
    expect(mail).toMatch(/^mailto:\?subject=/);
    expect(decodeURIComponent(mail!)).toContain(`/view/${file.id}`);
    await page.screenshot({ path: `${SHOTS}/r11-share-popover.png` });

    // QR code of the link
    await page.getByTestId('share-qr-open').click();
    await expect(page.getByTestId('share-qr')).toHaveAttribute('data-text', `https://digital-canvas-p977.web.app/view/${file.id}`);
    await page.screenshot({ path: `${SHOTS}/r11-share-qr.png` });
    await menu.getByRole('button', { name: 'Back' }).click();

    // remove Bob, then only people added
    await bob.getByTestId('share-person-role').selectOption('remove');
    await expect(page.getByTestId('share-person')).toHaveCount(1);
    expect(d.permCalls.some((c) => c.method === 'DELETE')).toBe(true);
    await page.getByTestId('share-link-access').selectOption('restricted');
    await expect.poll(() => d.isPublic(file)).toBe(false);
  });

  test('while shared, a new picture is made link-readable on save; Download and Present', async ({ page }) => {
    const d = await seedDrive();
    const { file } = await ownerDesign(page, d);
    await page.getByTestId('share').click();
    await page.getByTestId('share-link-access').selectOption('anyone');
    await expect.poll(() => d.isPublic(file)).toBe(true);
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 300);
    await page.evaluate(async () => {
      const c = new OffscreenCanvas(40, 40);
      const g = c.getContext('2d')!;
      g.fillStyle = '#30a46c';
      g.fillRect(0, 0, 40, 40);
      await (window as any).__dc.addImageFile(new File([await c.convertToBlob({ type: 'image/png' })], 'green.png', { type: 'image/png' }));
    });
    await waitSaved(page);
    const assets = [...d.files.values()].filter((f) => f.appProperties?.dcAsset);
    expect(assets).toHaveLength(2);
    expect(assets.every((a) => d.isPublic(a))).toBe(true);

    // Quick actions: Download opens the download panel
    await page.getByTestId('share').click();
    await page.getByTestId('share-download').click();
    await expect(page.getByTestId('download-menu')).toBeVisible();
    // Present: full-screen pages, arrows, Esc
    await page.mouse.click(5, 300);
    await page.getByTestId('share').click();
    await page.getByTestId('share-present').click();
    await expect(page.getByTestId('present')).toBeVisible();
    await expect(page.getByTestId('present-count')).toHaveText(/\d \/ 2/);
    await page.keyboard.press('Home');
    await expect(page.getByTestId('present-count')).toHaveText('1 / 2');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('present-count')).toHaveText('2 / 2');
    await page.screenshot({ path: `${SHOTS}/r11-share-present.png` });
    await page.getByTestId('present-close').click();
    await expect(page.getByTestId('present')).toHaveCount(0);
  });

  test('signed out: Share asks to sign in', async ({ page }) => {
    await page.context().route(CONTENT_HOSTS, (r) => r.fulfill({ status: 503, body: 'offline in tests' }));
    await page.goto('/');
    await page.getByTestId('preset-instagram-post').click();
    await page.waitForFunction(() => !!(window as any).__dc);
    await page.getByTestId('share').click();
    await expect(page.getByTestId('share-signin')).toBeVisible();
    await expect(page.getByTestId('share-present')).toBeEnabled();
  });
});

test.describe('Shared with you', () => {
  test('view only: Picker grants the file, assets read with the API key, nothing saved, Make a copy', async ({ page, browser }) => {
    const d = await seedDrive();
    const { file, asset, docId } = await ownerDesign(page, d);
    makeAnnsDesign(d, file, asset, 'reader');
    const before = file.body;

    const bob = await freshPage(browser);
    await signedInPage(bob, d, `/d/${file.id}`);
    await expect(bob.getByTestId('shared-open')).toHaveAttribute('data-phase', 'grant');
    await bob.screenshot({ path: `${SHOTS}/r11-share-shared-with-you.png` });
    await bob.getByTestId('shared-grant').click();
    await expect(bob.getByTestId('fake-picker')).toBeVisible();
    const st = await pickerState(bob);
    expect(st.views.map((v) => v.fileIds)).toEqual([file.id]);
    file.noAccess = false; // picking it grants the file to the app (drive.file)
    await respond(bob, [{ id: file.id, name: file.name, mimeType: file.mimeType }]);

    await expect(bob.getByTestId('view-only')).toBeVisible();
    await expect(bob.getByTestId('shared-by')).toHaveText('Shared by Ann Lee');
    await expect(bob.getByTestId('tab-uploads')).toHaveCount(0); // no side panel
    expect(new URL(bob.url()).hash).toBe(`#/d/${docId}`);
    expect(d.keyReads).toContain(asset.id); // Ann's picture, through the API key
    expect(await bob.evaluate(() => (window as any).__dc.assets.size)).toBe(1);
    await bob.waitForTimeout(300);
    await bob.screenshot({ path: `${SHOTS}/r11-share-view-only.png` });

    // typing shortcuts change nothing; nothing is saved
    const n = await bob.evaluate(() => (window as any).__dc.doc.pages[0].elements.length);
    await bob.getByTestId('stage').click({ position: { x: 20, y: 20 } });
    await bob.keyboard.press('t');
    await bob.keyboard.press('r');
    await bob.evaluate(() => (window as any).__dc.addShape('rect'));
    expect(await bob.evaluate(() => (window as any).__dc.doc.pages[0].elements.length)).toBe(n);
    await bob.waitForTimeout(1200);
    expect(file.body).toBe(before);

    // Share popover for a viewer: owner shown, no adding people
    await bob.getByTestId('share').click();
    await expect(bob.getByTestId('share-owner')).toContainText('Shared by Ann Lee');
    await expect(bob.getByTestId('share-email')).toHaveCount(0);
    await bob.mouse.click(5, 400);

    // Make a copy: your own, editable, with its own copy of the picture
    await bob.getByTestId('make-copy').click();
    await expect(bob.getByTestId('view-only')).toHaveCount(0);
    await expect(bob.getByTestId('title')).toHaveValue('Copy of Launch poster');
    await waitSaved(bob);
    const mine = [...d.files.values()].filter((f) => f.owned && f.appProperties?.dcDocId && f.id !== file.id);
    expect(mine).toHaveLength(1);
    expect([...d.files.values()].filter((f) => f.owned && f.appProperties?.dcAsset)).toHaveLength(1);
    await bob.context().close();
  });

  test('can edit: saves back to the owner’s file without copying the assets', async ({ page, browser }) => {
    const d = await seedDrive();
    const { file, asset } = await ownerDesign(page, d);
    makeAnnsDesign(d, file, asset, 'writer');
    const bob = await freshPage(browser);
    await signedInPage(bob, d, `/d/${file.id}`);
    await bob.getByTestId('shared-grant').click();
    file.noAccess = false;
    await respond(bob, [{ id: file.id, name: file.name, mimeType: file.mimeType }]);
    await expect(bob.getByTestId('canvas')).toBeVisible();
    await expect(bob.getByTestId('view-only')).toHaveCount(0);
    await expect(bob.getByTestId('shared-by')).toHaveText('Shared by Ann Lee');
    const revs = file.revisions!.length;
    await bob.evaluate(() => (window as any).__dc.addShape('rect'));
    await waitSaved(bob);
    expect(file.revisions!.length).toBe(revs + 1);
    expect([...d.files.values()].filter((f) => f.owned && f.appProperties?.dcAsset)).toHaveLength(0);
    await bob.context().close();
  });

  test('public view: no sign-in, pages read with the API key, Make a copy asks to sign in', async ({ page, browser }) => {
    const d = await seedDrive();
    const { file, asset } = await ownerDesign(page, d);
    makeAnnsDesign(d, file, asset, 'reader', 'reader');
    d.keyReads = [];
    const anon = await freshPage(browser);
    const authed: string[] = [];
    anon.on('request', (r) => { if (r.url().startsWith('https://www.googleapis.com/drive') && r.headers().authorization) authed.push(r.url()); });
    await d.install(anon);
    await anon.goto(`/view/${file.id}`);
    await expect(anon.getByTestId('public-view')).toBeVisible();
    await expect(anon.getByTestId('view-title')).toHaveText('Launch poster');
    await expect(anon.getByTestId('shared-by')).toHaveText('by Ann Lee');
    await expect(anon.getByTestId('view-only')).toBeVisible();
    await expect(anon.getByTestId('canvas')).toBeVisible();
    await expect(anon.getByTestId('view-missing')).toHaveCount(0);
    expect(d.keyReads).toEqual(expect.arrayContaining([file.id, asset.id]));
    expect(authed).toEqual([]);
    expect(await anon.evaluate(() => (window as any).__dc.readOnly)).toBe(true);
    expect(await anon.evaluate(() => (window as any).__dc.doc.pages.length)).toBe(2);
    await anon.waitForTimeout(300);
    await anon.screenshot({ path: `${SHOTS}/r11-share-public-view.png` });
    await anon.getByTestId('download').click();
    await expect(anon.getByTestId('download-menu')).toBeVisible();
    await anon.context().close();

    // link back to "only people added": the view page says so
    file.perms = file.perms!.filter((p) => p.type !== 'anyone');
    const anon2 = await freshPage(browser);
    await d.install(anon2);
    await anon2.goto(`/view/${file.id}`);
    await expect(anon2.getByTestId('view-error')).toContainText('not shared publicly');
    await anon2.screenshot({ path: `${SHOTS}/r11-share-view-private.png` });
    await anon2.context().close();
  });

  test('template link: copies the design into your Drive and opens it', async ({ page, browser }) => {
    const d = await seedDrive();
    const { file, asset } = await ownerDesign(page, d);
    makeAnnsDesign(d, file, asset, 'reader', 'reader');
    const bob = await freshPage(browser);
    await signedInPage(bob, d, `/template/${file.id}`);
    await expect(bob.getByTestId('canvas')).toBeVisible();
    await expect(bob.getByTestId('view-only')).toHaveCount(0);
    await expect(bob.getByTestId('title')).toHaveValue('Launch poster');
    const copies = [...d.files.values()].filter((f) => f.owned && f.appProperties?.dcDocId);
    expect(copies).toHaveLength(1);
    expect(copies[0]!.id).not.toBe(file.id);
    expect(new URL(bob.url()).pathname).toBe('/');
    await bob.context().close();
  });
});
