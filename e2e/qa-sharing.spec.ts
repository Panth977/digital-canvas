import { expect, test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { FakeDrive, FOLDER, OWNER, RECIPIENT, fakeSignIn, type FakeFile, type FakeUser } from './fake-drive.ts';
import { installFakePicker, pickerState, respond } from './fake-picker.ts';
import { CONTENT_HOSTS, waitSaved } from './helpers.ts';

/**
 * QA cases for sharing and import (apps/web/public/qa/sharing.html). Every test
 * title starts with its case id. Two people, two browser contexts, one fake
 * Drive that enforces access per user: Panth (OWNER) and Harshil (RECIPIENT)
 * have separate tokens; a file is visible to a user only when drive.file
 * granted it (created by the app for them, picked in the Picker, or opened
 * from Drive) and they have a permission on it; anything else is a 404.
 */
const SHOTS = '/tmp/orch27-rw';
mkdirSync(SHOTS, { recursive: true });
const ORIGIN = 'https://digital-canvas-p977.web.app';
const MIME = 'application/vnd.digital-canvas+zip';

function world(): FakeDrive {
  const d = new FakeDrive();
  d.addUser(OWNER);
  d.addUser(RECIPIENT);
  return d;
}

/** A fresh browser context for one person (signed in unless `signedIn: false`). */
async function as(browser: Browser, d: FakeDrive, who: FakeUser, path = '/', o: { signedIn?: boolean; ctx?: BrowserContextOptions } = {}): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...o.ctx });
  const page = await ctx.newPage();
  await ctx.route(CONTENT_HOSTS, (r) => r.fulfill({ status: 503, body: 'offline in tests' }));
  await installFakePicker(page);
  await d.install(page);
  await page.goto(path);
  if (o.signedIn !== false) await fakeSignIn(page, who);
  return page;
}

async function redPng(page: Page, color = '#e5484d'): Promise<void> {
  await page.evaluate(async (color) => {
    const c = new OffscreenCanvas(120, 80);
    const g = c.getContext('2d')!;
    g.fillStyle = color;
    g.fillRect(0, 0, 120, 80);
    const blob = await c.convertToBlob({ type: 'image/png' });
    await (window as any).__dc.addImageFile(new File([blob], `${color}.png`, { type: 'image/png' }));
  }, color);
}

/** Panth makes a 2-page "Launch poster" with one picture. */
async function ownerDesign(browser: Browser, d: FakeDrive): Promise<{ page: Page; file: FakeFile; asset: FakeFile; docId: string }> {
  const page = await as(browser, d, OWNER);
  await page.getByTestId('preset-instagram-post').click();
  await page.waitForFunction(() => !!(window as any).__dc);
  await redPng(page);
  await page.evaluate(() => { const ed = (window as any).__dc; ed.rename('Launch poster'); ed.addPage(); });
  await waitSaved(page);
  const docId = await page.evaluate(() => (window as any).__dc.doc.id);
  const file = [...d.files.values()].find((f) => f.appProperties?.dcDocId === docId)!;
  const asset = [...d.files.values()].find((f) => f.appProperties?.dcAsset)!;
  expect(file.owner).toBe(OWNER.email);
  expect(asset.owner).toBe(OWNER.email);
  return { page, file, asset, docId };
}

/** Panth adds a person in the Share popover. */
async function shareWith(page: Page, email: string, role: 'writer' | 'commenter' | 'reader', note = ''): Promise<void> {
  await page.getByTestId('share').click();
  await expect(page.getByTestId('share-menu')).toBeVisible();
  await page.getByTestId('share-email').fill(email);
  await page.getByTestId('share-role').selectOption(role);
  if (note) await page.getByTestId('share-message').fill(note);
  await page.getByTestId('share-send').click();
  await expect(page.getByTestId('share-sent')).toBeVisible();
}

/** The person picks the file in the (fake) Picker: drive.file grants it to the app for them. */
async function pick(page: Page, d: FakeDrive, who: FakeUser, f: FakeFile): Promise<void> {
  await expect(page.getByTestId('fake-picker')).toBeVisible();
  d.grant(who.email, f.id);
  await respond(page, [{ id: f.id, name: f.name, mimeType: f.mimeType }]);
}

/** Owner design shared with Harshil (role), Harshil opens it from the email link. */
async function recipientOpens(browser: Browser, d: FakeDrive, role: 'writer' | 'commenter' | 'reader') {
  const o = await ownerDesign(browser, d);
  await shareWith(o.page, RECIPIENT.email, role);
  await expect.poll(() => d.isPublic(o.asset)).toBe(true);
  const r = await as(browser, d, RECIPIENT, `/d/${o.file.id}`);
  await expect(r.getByTestId('shared-open')).toHaveAttribute('data-phase', 'grant');
  await r.getByTestId('shared-grant').click();
  await pick(r, d, RECIPIENT, o.file);
  await expect(r.getByTestId('canvas')).toBeVisible();
  await expect(r.getByTestId('shared-by')).toHaveText('Shared by Panth');
  return { ...o, r };
}

const fileOf = (d: FakeDrive, docId: string) => [...d.files.values()].find((f) => f.appProperties?.dcDocId === docId);

test.describe('Owner shares', () => {
  for (const [id, role, label] of [['QA-01', 'writer', 'Can edit'], ['QA-02', 'commenter', 'Can comment'], ['QA-03', 'reader', 'Can view']] as const) {
    test(`${id} owner shares by email (${label}): Drive permission, the email carries the app link, assets readable by link`, async ({ browser }) => {
      const d = world();
      const { page, file, asset } = await ownerDesign(browser, d);
      await page.getByTestId('share').click();
      await page.getByTestId('share-email').fill(RECIPIENT.email);
      await page.getByTestId('share-role').selectOption(role);
      await page.getByTestId('share-message').fill('Have a look at the poster');
      const link = `${ORIGIN}/d/${file.id}`;
      await expect(page.getByTestId('share-email-preview')).toContainText(`Open in Digital Canvas: ${link}`);
      if (id === 'QA-01') await page.getByTestId('share-menu').screenshot({ path: `${SHOTS}/r12-share-email-preview.png` });
      await page.getByTestId('share-send').click();
      await expect(page.getByTestId('share-sent')).toContainText(`Shared with ${RECIPIENT.email}`);
      await expect(page.getByTestId('share-sent-copy')).toBeVisible();
      await expect(page.getByTestId('share-sent-send')).toBeVisible();
      const add = d.permCalls.find((c) => c.method === 'POST' && c.body.type === 'user')!;
      expect(add.body).toEqual({ type: 'user', role, emailAddress: RECIPIENT.email });
      expect(add.query.sendNotificationEmail).toBe('true');
      expect(add.query.emailMessage).toBe(`Open in Digital Canvas: ${link}\n\nHave a look at the poster`);
      expect(d.roleOf(file, RECIPIENT.email)).toBe(role);
      await expect.poll(() => d.isPublic(asset)).toBe(true);
      // Harshil's app may not see the file until he opens it with the app (drive.file)
      expect(d.visible(file, RECIPIENT.email)).toBe(false);
      await page.context().close();
    });
  }

  test('QA-04 link access: anyone with the link can view; a stranger opens it view-only after the Picker', async ({ browser }) => {
    const d = world();
    const { page, file, asset } = await ownerDesign(browser, d);
    await page.getByTestId('share').click();
    await page.getByTestId('share-link-access').selectOption('anyone');
    await expect.poll(() => d.permsOf(file).find((p) => p.type === 'anyone')?.role).toBe('reader');
    expect(d.permsOf(file).find((p) => p.type === 'anyone')!.allowFileDiscovery).toBe(false);
    await expect.poll(() => d.isPublic(asset)).toBe(true);
    const r = await as(browser, d, RECIPIENT, `/d/${file.id}`);
    await r.getByTestId('shared-grant').click();
    await pick(r, d, RECIPIENT, file);
    await expect(r.getByTestId('view-only')).toBeVisible();
    expect(await r.evaluate(() => (window as any).__dc.assets.size)).toBe(1);
    await page.context().close();
    await r.context().close();
  });
});

test.describe('Recipient opens', () => {
  test('QA-05 recipient via the email link (/d/<id>, signed in): Drive says 404 until the Picker grants it, then it opens', async ({ browser }) => {
    const d = world();
    const o = await ownerDesign(browser, d);
    await shareWith(o.page, RECIPIENT.email, 'writer');
    const r = await as(browser, d, RECIPIENT, `/d/${o.file.id}`);
    await expect(r.getByTestId('shared-open')).toHaveAttribute('data-phase', 'grant');
    expect(d.denied.some((x) => x.startsWith(`${RECIPIENT.email} GET ${o.file.id} 404`))).toBe(true);
    await r.getByTestId('shared-grant').click();
    expect((await pickerState(r)).views.map((v) => v.fileIds)).toEqual([o.file.id]);
    await pick(r, d, RECIPIENT, o.file);
    await expect(r.getByTestId('canvas')).toBeVisible();
    await expect(r.getByTestId('view-only')).toHaveCount(0);
    expect(new URL(r.url()).hash).toBe(`#/d/${o.docId}`);
    expect(await r.evaluate(() => (window as any).__dc.assets.size)).toBe(1); // Panth's picture, by link
    await o.page.context().close();
    await r.context().close();
  });

  test('QA-06 recipient via Home "Shared with you": the opened design is listed and reopens; "Open a shared design" uses the Picker', async ({ browser }) => {
    const d = world();
    const o = await recipientOpens(browser, d, 'writer');
    const r = o.r;
    await r.goto('/');
    await fakeSignIn(r, RECIPIENT);
    const item = r.getByTestId('shared-item');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('Launch poster');
    await expect(item).toContainText('from Panth · Can edit');
    await r.getByTestId('shared-section').screenshot({ path: `${SHOTS}/r12-home-shared-with-you.png` });
    await r.screenshot({ path: `${SHOTS}/r12-home-shared-with-you-full.png` });
    await item.getByTestId('shared-open-item').click();
    await expect(r.getByTestId('canvas')).toBeVisible();
    await expect(r.getByTestId('shared-by')).toHaveText('Shared by Panth');

    // a second design, never opened: "Open a shared design" (Picker, Shared with me, designs only)
    const two = d.add({ id: 'second', name: 'Menu card.dcanvas', mimeType: MIME, owner: OWNER.email, grants: [OWNER.email], body: o.file.body, perms: [
      { id: 'p-owner', type: 'user', role: 'owner', emailAddress: OWNER.email, displayName: 'Panth' },
      { id: 'p-h', type: 'user', role: 'reader', emailAddress: RECIPIENT.email, displayName: 'Harshil' }] });
    const fresh = await as(browser, d, RECIPIENT);
    await expect(fresh.getByTestId('shared-empty')).toBeVisible();
    await fresh.getByTestId('open-shared').click();
    const st = await pickerState(fresh);
    expect(st.views[0]).toMatchObject({ label: 'Shared with me', ownedByMe: false });
    expect(st.views[0]!.mimes).toContain(MIME);
    await pick(fresh, d, RECIPIENT, two);
    await expect(fresh.getByTestId('canvas')).toBeVisible();
    await expect(fresh.getByTestId('view-only')).toBeVisible();
    await o.page.context().close();
    await r.context().close();
    await fresh.context().close();
  });

  test('QA-07 recipient via Drive "Open with" (?state=…): opens the shared file; another account is told to switch', async ({ browser }) => {
    const d = world();
    const o = await ownerDesign(browser, d);
    await shareWith(o.page, RECIPIENT.email, 'writer');
    d.grant(RECIPIENT.email, o.file.id); // Drive "Open with" grants the file to the app
    const state = (userId: string) => `/?state=${encodeURIComponent(JSON.stringify({ ids: [o.file.id], action: 'open', userId }))}`;
    const r = await as(browser, d, RECIPIENT, state('200'));
    await expect(r.getByTestId('canvas')).toBeVisible();
    await expect(r.getByTestId('shared-by')).toHaveText('Shared by Panth');
    expect(new URL(r.url()).search).toBe('');

    const wrong = await as(browser, d, RECIPIENT, state('999'));
    await expect(wrong.getByTestId('drive-other-account')).toContainText('another Google account');
    await o.page.context().close();
    await r.context().close();
    await wrong.context().close();
  });

  test('QA-08 Drive "New → Digital Canvas" (?state= create) makes a design in the user\'s Drive', async ({ browser }) => {
    const d = world();
    const r = await as(browser, d, RECIPIENT, `/?state=${encodeURIComponent(JSON.stringify({ action: 'create', folderId: 'root', userId: '200' }))}`);
    await expect(r.getByTestId('canvas')).toBeVisible();
    await waitSaved(r).catch(() => {});
    await expect.poll(() => d.ownedBy(RECIPIENT.email).filter((f) => f.appProperties?.dcDocId).length).toBe(1);
    await r.context().close();
  });

  test('QA-09 recipient not signed in: the link page asks to sign in, then goes straight on to the Picker and opens', async ({ browser }) => {
    const d = world();
    const o = await ownerDesign(browser, d);
    await shareWith(o.page, RECIPIENT.email, 'writer');
    const r = await as(browser, d, RECIPIENT, `/d/${o.file.id}`, { signedIn: false });
    await expect(r.getByTestId('shared-open')).toHaveAttribute('data-phase', 'signin');
    await expect(r.getByTestId('shared-signin')).toBeVisible();
    await r.screenshot({ path: `${SHOTS}/r12-landing-signed-out.png` });
    // Google sign-in stands in: the popup succeeds as Harshil
    await r.evaluate((u) => {
      const a = (window as any).__account;
      a.signIn = async () => { a.token = { value: u.token, expires: Date.now() + 3600_000 }; a.scope = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.install'; a.user = { uid: u.uid, email: u.email, name: u.name }; return true; };
    }, RECIPIENT);
    await r.getByTestId('shared-signin').click();
    await pick(r, d, RECIPIENT, o.file); // no extra click: the Picker opened by itself
    await expect(r.getByTestId('canvas')).toBeVisible();
    await expect(r.getByTestId('shared-by')).toHaveText('Shared by Panth');
    await o.page.context().close();
    await r.context().close();
  });
});

test.describe('What the recipient may do', () => {
  test('QA-10 viewer: read-only, edits are no-ops, nothing is saved, Make a copy gives an editable copy', async ({ browser }) => {
    const d = world();
    const o = await recipientOpens(browser, d, 'reader');
    const r = o.r;
    await expect(r.getByTestId('view-only')).toBeVisible();
    await expect(r.getByTestId('tab-uploads')).toHaveCount(0);
    const revs = o.file.revisions!.length;
    const n = await r.evaluate(() => (window as any).__dc.doc.pages[0].elements.length);
    await r.evaluate(() => (window as any).__dc.addShape('rect'));
    expect(await r.evaluate(() => (window as any).__dc.doc.pages[0].elements.length)).toBe(n);
    await r.waitForTimeout(1200);
    expect(o.file.revisions!.length).toBe(revs);
    await r.getByTestId('make-copy').click();
    await expect(r.getByTestId('view-only')).toHaveCount(0);
    await waitSaved(r);
    const mine = d.ownedBy(RECIPIENT.email);
    expect(mine.filter((f) => f.appProperties?.dcDocId)).toHaveLength(1);
    expect(mine.filter((f) => f.appProperties?.dcAsset)).toHaveLength(1);
    await o.page.context().close();
    await r.context().close();
  });

  test('QA-11 commenter: opens view-only (comments are not in the app yet)', async ({ browser }) => {
    const d = world();
    const o = await recipientOpens(browser, d, 'commenter');
    await expect(o.r.getByTestId('view-only')).toBeVisible();
    await o.page.context().close();
    await o.r.context().close();
  });

  test('QA-12 editor saves back to the owner\'s file; never touches the owner\'s assets folder; the owner sees the new picture', async ({ browser }) => {
    const d = world();
    const o = await recipientOpens(browser, d, 'writer');
    const r = o.r;
    const revs = o.file.revisions!.length;
    await redPng(r, '#30a46c');
    await r.evaluate(() => (window as any).__dc.addShape('rect'));
    await waitSaved(r);
    expect(o.file.revisions!.length).toBeGreaterThan(revs);
    // no write of Harshil's was refused, and his app never listed or wrote Panth's assets folder
    expect(d.denied.filter((x) => x.startsWith(RECIPIENT.email) && /(PUT|PATCH|POST)/.test(x))).toEqual([]);
    const ownerFolders = d.ownedBy(OWNER.email).filter((f) => f.mimeType === FOLDER).map((f) => f.id);
    expect(d.calls.filter((l) => l.startsWith(RECIPIENT.email) && ownerFolders.some((id) => l.includes(id)))).toEqual([]);
    const hisAssets = d.ownedBy(RECIPIENT.email).filter((f) => f.appProperties?.dcAsset);
    expect(hisAssets).toHaveLength(1); // only the new picture, in his own assets/
    expect(d.isPublic(hisAssets[0]!)).toBe(true); // readable by Panth's app (design is shared)
    expect(d.ownedBy(RECIPIENT.email).filter((f) => f.appProperties?.dcDocId)).toHaveLength(0); // no copy of the design

    // Panth reopens his design: both pictures
    const p = o.page;
    await p.goto('/');
    await fakeSignIn(p, OWNER);
    await p.goto(`/#/d/${o.docId}`);
    await expect(p.getByTestId('canvas')).toBeVisible();
    await expect.poll(() => p.evaluate(() => (window as any).__dc?.assets.size)).toBe(2);
    await p.context().close();
    await r.context().close();
  });

  test('QA-13 remove access: the recipient can no longer open it, with a clear message', async ({ browser }) => {
    const d = world();
    const o = await recipientOpens(browser, d, 'writer');
    await o.page.reload();
    await fakeSignIn(o.page, OWNER);
    await o.page.goto(`/#/d/${o.docId}`);
    await o.page.getByTestId('share').click();
    const row = o.page.locator(`[data-testid=share-person][data-email="${RECIPIENT.email}"]`);
    await row.getByTestId('share-person-role').selectOption('remove');
    await expect(o.page.getByTestId('share-person')).toHaveCount(1);
    expect(d.roleOf(o.file, RECIPIENT.email)).toBeNull();

    const r = o.r;
    await r.goto(`/d/${o.file.id}`);
    await fakeSignIn(r, RECIPIENT);
    await expect(r.getByTestId('shared-open')).toHaveAttribute('data-phase', 'grant');
    await r.getByTestId('shared-grant').click();
    await pick(r, d, RECIPIENT, o.file);
    await expect(r.getByTestId('shared-grant-error')).toContainText('ask the owner to share it');
    await o.page.context().close();
    await r.context().close();
  });
});

test.describe('Import a .dcanvas', () => {
  async function chooseFile(page: Page, file: { name: string; mimeType: string; buffer: Buffer }): Promise<string | null> {
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('open-file').click();
    const c = await chooser;
    const accept = await c.element().getAttribute('accept');
    await c.setFiles(file);
    return accept;
  }

  test('QA-14 import an app-downloaded (self-contained) file: opens, saved with its picture into your Drive', async ({ browser }) => {
    const d = world();
    const o = await ownerDesign(browser, d);
    // Panth's Download (.dcanvas) has the picture inside
    const dl = o.page.waitForEvent('download');
    await o.page.evaluate(async (id) => { const m = await import('/src/lib/designs.ts'); await m.downloadDesignFile((window as any).__library.store, id); }, o.docId);
    const buffer = Buffer.from(await (await (await dl).createReadStream()).toArray().then((c) => Buffer.concat(c)));
    const r = await as(browser, d, RECIPIENT);
    const accept = await chooseFile(r, { name: 'Launch poster.dcanvas', mimeType: MIME, buffer });
    expect(accept).toContain('.dcanvas');
    expect(accept).toContain('application/zip');
    await expect(r.getByTestId('canvas')).toBeVisible();
    await expect(r.getByTestId('title')).toHaveValue('Launch poster');
    expect(await r.evaluate(() => (window as any).__dc.assets.size)).toBe(1);
    await expect.poll(() => d.ownedBy(RECIPIENT.email).filter((f) => f.appProperties?.dcAsset).length).toBe(1);
    await o.page.context().close();
    await r.context().close();
  });

  test('QA-15 import a Drive-downloaded file (links only): pictures fetched by Drive id with progress, self-contained copy with a new id', async ({ browser }) => {
    const d = world();
    const o = await ownerDesign(browser, d);
    await shareWith(o.page, RECIPIENT.email, 'reader');
    await expect.poll(() => d.isPublic(o.asset)).toBe(true);
    const buffer = o.file.body!; // what Drive's own Download gives: document + links.json, no assets
    const { unpack } = await import('../packages/storage/src/index.ts');
    const raw = unpack(new Uint8Array(buffer));
    expect(raw.assets.size).toBe(0);
    expect(Object.keys(raw.links ?? {})).toHaveLength(1);
    const before = o.file.revisions!.length;

    const r = await as(browser, d, RECIPIENT);
    d.mediaDelay = 1500;
    await chooseFile(r, { name: 'Launch poster.dcanvas', mimeType: 'application/octet-stream', buffer });
    await expect(r.getByTestId('import-progress')).toBeVisible();
    await r.screenshot({ path: `${SHOTS}/r12-import-progress.png` });
    d.mediaDelay = 0;
    await expect(r.getByTestId('canvas')).toBeVisible({ timeout: 15_000 });
    expect(await r.evaluate(() => (window as any).__dc.assets.size)).toBe(1);
    const newId = await r.evaluate(() => (window as any).__dc.doc.id);
    expect(newId).not.toBe(o.docId);
    await expect(r.getByTestId('toast').first()).toContainText('Imported “Launch poster” with 1 picture');
    await waitSaved(r).catch(() => {});
    await expect.poll(() => d.ownedBy(RECIPIENT.email).filter((f) => f.appProperties?.dcAsset).length).toBe(1);
    const copy = fileOf(d, newId)!;
    expect(copy.owner).toBe(RECIPIENT.email);
    expect(o.file.revisions!.length).toBe(before); // Panth's file untouched
    await o.page.context().close();
    await r.context().close();
  });

  test('QA-16 import a links-only file whose pictures are not shared: opens with a clear warning', async ({ browser }) => {
    const d = world();
    const o = await ownerDesign(browser, d); // never shared: assets stay private
    const r = await as(browser, d, RECIPIENT);
    await chooseFile(r, { name: 'Launch poster.dcanvas', mimeType: MIME, buffer: o.file.body! });
    await expect(r.getByTestId('canvas')).toBeVisible();
    await expect(r.getByTestId('toast').first()).toContainText('could not be loaded');
    await o.page.context().close();
    await r.context().close();
  });

  test('QA-17 import name clash: importing your own design again makes a second design, the first is untouched', async ({ browser }) => {
    const d = world();
    const o = await ownerDesign(browser, d);
    const p = o.page;
    const before = o.file.revisions!.length;
    await p.goto('/');
    await fakeSignIn(p, OWNER);
    await chooseFile(p, { name: 'Launch poster.dcanvas', mimeType: MIME, buffer: o.file.body! });
    await expect(p.getByTestId('canvas')).toBeVisible();
    const id = await p.evaluate(() => (window as any).__dc.doc.id);
    expect(id).not.toBe(o.docId);
    expect(await p.evaluate(() => (window as any).__dc.assets.size)).toBe(1); // from his own assets/
    await waitSaved(p).catch(() => {});
    await expect.poll(() => d.ownedBy(OWNER.email).filter((f) => f.appProperties?.dcDocId).length).toBe(2);
    expect(o.file.revisions!.length).toBe(before);
    expect(d.ownedBy(OWNER.email).filter((f) => f.appProperties?.dcAsset)).toHaveLength(1); // stored once
    await p.context().close();
  });

  test('QA-18 import on a phone: no file-type filter (Android/iOS would grey the file out), a .zip name works, a photo is refused clearly', async ({ browser }) => {
    const d = world();
    const o = await ownerDesign(browser, d);
    await shareWith(o.page, RECIPIENT.email, 'reader');
    const r = await as(browser, d, RECIPIENT, '/', { ctx: { viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true } });
    const accept = await chooseFile(r, { name: 'IMG_2041.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) });
    expect(accept ?? '').toBe('');
    await expect(r.getByTestId('toast').first()).toContainText('is not a Digital Canvas design');
    await chooseFile(r, { name: 'Launch poster.zip', mimeType: 'application/zip', buffer: o.file.body! });
    await expect(r.getByTestId('canvas')).toBeVisible();
    expect(await r.evaluate(() => (window as any).__dc.assets.size)).toBe(1);
    await o.page.context().close();
    await r.context().close();
  });

  test('QA-19 a file that is not a design shows an error toast (not a silent failure)', async ({ browser }) => {
    const d = world();
    const r = await as(browser, d, RECIPIENT);
    const { zipSync, strToU8 } = await import('fflate');
    await chooseFile(r, { name: 'holiday.dcanvas', mimeType: MIME, buffer: Buffer.from(zipSync({ 'readme.txt': strToU8('hi') })) });
    await expect(r.getByTestId('toast').first()).toContainText('not a Digital Canvas design');
    await chooseFile(r, { name: 'page.dcanvas', mimeType: MIME, buffer: Buffer.from('<!DOCTYPE html><html><body>Google Drive - Virus scan warning</body></html>') });
    await expect(r.getByTestId('toast').last()).toContainText('web page, not a design');
    await expect(r.getByTestId('canvas')).toHaveCount(0);
    await r.context().close();
  });

  test('QA-20 Open a .dcanvas file › From Drive: the Picker grants the file, it is imported as your own copy', async ({ browser }) => {
    const d = world();
    const o = await ownerDesign(browser, d);
    await shareWith(o.page, RECIPIENT.email, 'reader');
    const r = await as(browser, d, RECIPIENT);
    await r.getByTestId('open-drive-file').click();
    const st = await pickerState(r);
    expect(st.views[0]).toMatchObject({ label: 'My Drive' });
    expect(st.views[0]!.mimes).toContain('application/octet-stream');
    await pick(r, d, RECIPIENT, o.file);
    await expect(r.getByTestId('canvas')).toBeVisible();
    await expect(r.getByTestId('view-only')).toHaveCount(0); // his own copy, editable
    expect(await r.evaluate(() => (window as any).__dc.assets.size)).toBe(1);
    await expect.poll(() => d.ownedBy(RECIPIENT.email).filter((f) => f.appProperties?.dcDocId).length).toBe(1);
    await o.page.context().close();
    await r.context().close();
  });
});

test.describe('Drive "Open with" for existing users', () => {
  test('QA-21 an account without drive.install is asked once to show the app in Drive\'s Open with; "Not now" sticks', async ({ browser }) => {
    const d = world();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await ctx.route(CONTENT_HOSTS, (r) => r.fulfill({ status: 503, body: 'offline in tests' }));
    await d.install(page);
    await page.goto('/');
    await fakeSignIn(page, OWNER, 'openid email profile https://www.googleapis.com/auth/drive.file');
    await expect(page.getByTestId('drive-install')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/r12-drive-install-banner.png` });
    await page.getByTestId('drive-install-no').click();
    await expect(page.getByTestId('drive-install')).toHaveCount(0);
    await page.reload();
    await fakeSignIn(page, OWNER, 'openid email profile https://www.googleapis.com/auth/drive.file');
    await page.waitForTimeout(300);
    await expect(page.getByTestId('drive-install')).toHaveCount(0);
    // a fresh sign-in has the scope: no banner
    const p2 = await as(browser, d, RECIPIENT);
    await page.waitForTimeout(300);
    await expect(p2.getByTestId('drive-install')).toHaveCount(0);
    await ctx.close();
    await p2.context().close();
  });
});
