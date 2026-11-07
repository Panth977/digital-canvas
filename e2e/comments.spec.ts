import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { FakeDrive, OWNER, RECIPIENT, fakeSignIn, type FakeFile, type FakeUser } from './fake-drive.ts';
import { installFakePicker, respond } from './fake-picker.ts';
import { CONTENT_HOSTS, newDesign, waitSaved } from './helpers.ts';

/**
 * Review comments (ORCH-44): pins on elements, points and video moments; the
 * thread card (text box, reply, resolve, delete); the comments panel; and the
 * manager → editor flow over Drive's own comments with two people.
 */
const SHOTS = '/tmp/orch44';
mkdirSync(SHOTS, { recursive: true });

const comments = (page: Page) => page.evaluate(() => (window as any).__dcComments.list.map((c: any) => ({ text: c.text, resolved: c.resolved, replies: c.replies.map((r: any) => r.action ?? r.text), anchor: c.anchor, author: c.author.name, me: !!c.author.me })));

test.describe('Comments (this browser)', () => {
  test('element comment from the mini toolbar: pin follows the element; reply, edit, resolve, delete', async ({ page }) => {
    await newDesign(page);
    await page.evaluate(() => (window as any).__dc.addShape('rect'));
    await page.getByTestId('mini-comment').click();
    await expect(page.getByTestId('comments-panel')).toBeVisible();
    await page.getByTestId('comment-box').fill('Make this box red\nand bigger');
    await page.getByTestId('comment-submit').click();
    await expect(page.getByTestId('comment-pin')).toHaveCount(1);
    await expect(page.getByTestId('comments-count')).toHaveText('1');
    const [c] = await comments(page);
    expect(c).toMatchObject({ text: 'Make this box red\nand bigger', resolved: false, anchor: { fx: 1, fy: 0 } });

    // the pin moves with its element
    const before = (await page.getByTestId('comment-pin').boundingBox())!;
    await page.evaluate(() => { const ed = (window as any).__dc; ed.update({ x: ed.selected[0].x + 100 }); ed.seal(); });
    await expect.poll(async () => Math.round((await page.getByTestId('comment-pin').boundingBox())!.x - before.x)).toBeGreaterThan(20);

    // thread card: reply (Enter sends), edit
    await page.getByTestId('comment-reply-box').fill('Done: red, 120 px');
    await page.getByTestId('comment-reply-box').press('Enter');
    await expect(page.locator('.card [data-testid=comment-reply]')).toHaveText(/Done: red, 120 px/);
    await page.locator('.card [data-testid=comment-edit]').first().click();
    await page.getByTestId('comment-edit-box').fill('Make this box red');
    await page.getByTestId('comment-edit-save').click();
    await expect(page.locator('.card [data-testid=comment-body]')).toContainText('Make this box red');
    await page.screenshot({ path: `${SHOTS}/thread.png` });

    // resolve: gone from Open, listed under Resolved; reopen
    await page.locator('.card [data-testid=comment-resolve]').click();
    await expect(page.getByTestId('comment-pin')).toHaveCount(0);
    await expect(page.getByTestId('comments-count')).toHaveCount(0);
    await page.getByTestId('comments-filter-resolved').click();
    await expect(page.getByTestId('comments-item')).toHaveCount(1);
    expect((await comments(page))[0]).toMatchObject({ resolved: true, replies: ['Done: red, 120 px', 'resolve'] });
    await page.getByTestId('comments-item').locator('[data-testid=comment-resolve]').click();
    await expect.poll(async () => (await comments(page))[0].resolved).toBe(false);

    // delete (asks first)
    await page.getByTestId('comments-filter-all').click();
    await page.getByTestId('comments-item').locator('[data-testid=comment-delete]').click();
    await page.getByRole('button', { name: 'Delete', exact: true }).last().click();
    await expect(page.getByTestId('comments-item')).toHaveCount(0);
    expect(await comments(page)).toEqual([]);
  });

  test('comment mode (⇧C, Add comment) drops a pin where you click; Esc leaves; comments are not in the design', async ({ page }) => {
    await newDesign(page);
    await page.getByTestId('comments').click();
    await page.getByTestId('comment-add').click();
    const stage = (await page.getByTestId('stage').boundingBox())!;
    await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);
    await expect(page.getByTestId('comment-draft')).toBeVisible();
    await page.getByTestId('comment-box').fill('Headline here');
    await page.getByTestId('comment-box').press('Enter');
    await expect(page.getByTestId('comment-pin')).toHaveCount(1);
    const [c] = await comments(page);
    expect(c.anchor.el).toBeUndefined();
    expect(c.anchor.x).toBeGreaterThan(100);
    // ⇧C with nothing selected enters comment mode; Esc leaves it
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+C');
    expect(await page.evaluate(() => (window as any).__dcComments.placing)).toBe(true);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => (window as any).__dcComments.placing)).toBe(false);
    // the design itself carries no comments (they are kept beside it)
    await waitSaved(page);
    expect(JSON.stringify(await page.evaluate(() => (window as any).__dc.doc))).not.toContain('Headline here');
    // clicking the panel item opens its card
    await page.getByTestId('comments-item').click();
    await expect(page.locator('.card [data-testid=comment-thread]')).toBeVisible();
  });

  test('video: a comment is pinned to the playhead moment and shows on the timeline', async ({ page }) => {
    await newDesign(page, 'instagram-reel');
    await page.evaluate(async () => {
      const ed = (window as any).__dc;
      ed.setPageDuration?.(ed.pageId, 4);
      ed.addPage();
      await ed.player.seek(ed.player.duration - 1.5);
    });
    await page.getByTestId('comments').click();
    await page.getByTestId('comment-add').click();
    const stage = (await page.getByTestId('stage').boundingBox())!;
    await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);
    await expect(page.getByTestId('comment-timed')).toBeChecked();
    await page.getByTestId('comment-box').fill('Cut here');
    await page.getByTestId('comment-submit').click();
    await expect(page.getByTestId('tl-comment')).toHaveCount(1);
    const [c] = await comments(page);
    expect(c.anchor.t).toBeGreaterThan(0);
    expect(c.anchor.page).toBe(await page.evaluate(() => (window as any).__dc.doc.pages.at(-1).id));
    await expect(page.getByTestId('comments-item')).toContainText(/Scene 2 · 0:/);
    // the marker takes you there
    await page.evaluate(() => (window as any).__dc.player.seek(0));
    await page.getByTestId('tl-comment').click();
    await expect.poll(() => page.evaluate(() => (window as any).__dc.pageIndex)).toBe(1);
    await page.screenshot({ path: `${SHOTS}/video.png` });
  });
});

// ---- two people over Drive comments ----

function world(): FakeDrive {
  const d = new FakeDrive();
  d.addUser(OWNER);
  d.addUser(RECIPIENT);
  return d;
}

async function as(browser: Browser, d: FakeDrive, who: FakeUser, path = '/'): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await ctx.route(CONTENT_HOSTS, (r) => r.fulfill({ status: 503, body: 'offline in tests' }));
  await installFakePicker(page);
  await d.install(page);
  await page.goto(path);
  await fakeSignIn(page, who);
  return page;
}

async function shared(browser: Browser, d: FakeDrive, role: 'writer' | 'commenter'): Promise<{ owner: Page; ed: Page; file: FakeFile }> {
  const owner = await as(browser, d, OWNER);
  await owner.getByTestId('preset-instagram-post').click();
  await owner.waitForFunction(() => !!(window as any).__dc);
  await owner.evaluate(() => { const ed = (window as any).__dc; ed.rename('Launch poster'); ed.addText('heading'); });
  await waitSaved(owner);
  const docId = await owner.evaluate(() => (window as any).__dc.doc.id);
  const file = [...d.files.values()].find((f) => f.appProperties?.dcDocId === docId)!;
  await owner.getByTestId('share').click();
  await owner.getByTestId('share-email').fill(RECIPIENT.email);
  await owner.getByTestId('share-role').selectOption(role);
  await owner.getByTestId('share-send').click();
  await expect(owner.getByTestId('share-sent')).toBeVisible();
  await owner.keyboard.press('Escape');
  await owner.mouse.click(5, 300);
  const ed = await as(browser, d, RECIPIENT, `/d/${file.id}`);
  await ed.getByTestId('shared-grant').click();
  await expect(ed.getByTestId('fake-picker')).toBeVisible();
  d.grant(RECIPIENT.email, file.id);
  await respond(ed, [{ id: file.id, name: file.name, mimeType: file.mimeType }]);
  await expect(ed.getByTestId('canvas')).toBeVisible();
  return { owner, ed, file };
}

test.describe('Comments (two people, Drive)', () => {
  test('manager comments, editor makes the change, replies and resolves; manager deletes', async ({ browser }) => {
    const d = world();
    const { owner, ed, file } = await shared(browser, d, 'writer');
    // manager: comment on the heading
    await owner.evaluate(() => { const ed = (window as any).__dc; ed.select([ed.page.elements[0].id], ed.pageId); });
    await owner.getByTestId('mini-comment').click();
    await owner.getByTestId('comment-box').fill('Say "Launch day" instead');
    await owner.getByTestId('comment-submit').click();
    await expect(owner.getByTestId('comment-pin')).toHaveCount(1);
    expect(file.comments).toHaveLength(1);
    expect(file.comments![0]).toMatchObject({ authorEmail: OWNER.email, content: 'Say "Launch day" instead' });
    expect(JSON.parse(file.comments![0].anchor!)).toMatchObject({ dc: 1 });

    // editor: sees it (focus refresh), changes the text, replies, resolves
    await ed.evaluate(() => (window as any).__dcComments.refresh());
    await expect(ed.getByTestId('comments-count')).toHaveText('1');
    await ed.getByTestId('comments').click();
    await ed.getByTestId('comments-item').click();
    const card = ed.locator('.card [data-testid=comment-thread]');
    await expect(card).toContainText('Panth');
    await expect(card.getByTestId('comment-delete')).toHaveCount(0); // only the author deletes
    await ed.evaluate(() => { const e = (window as any).__dc; e.select([e.page.elements[0].id], e.pageId); e.update({ text: 'Launch day' }); e.seal(); });
    await card.getByTestId('comment-reply-box').fill('Changed it');
    await card.getByTestId('comment-reply-send').click();
    await expect(card.getByTestId('comment-reply')).toHaveText(/Changed it/);
    await card.getByTestId('comment-resolve').click();
    await expect(ed.getByTestId('comment-pin')).toHaveCount(0);
    expect(file.comments![0]).toMatchObject({ resolved: true });
    await ed.screenshot({ path: `${SHOTS}/editor-resolved.png` });

    // the editor may not delete the manager's comment (Drive refuses too)
    const refused = await ed.evaluate(async () => { try { await (window as any).__dcComments.store.remove((window as any).__dc.doc.id, (window as any).__dcComments.list[0].id); return 'deleted'; } catch (e: any) { return e.message; } });
    expect(refused).toMatch(/author/);

    // manager: sees it resolved with the reply; deletes it, adds a new one
    await owner.evaluate(() => (window as any).__dcComments.refresh());
    await owner.getByTestId('comments-filter-all').click();
    await expect(owner.getByTestId('comments-item')).toContainText('Changed it');
    await expect(owner.getByTestId('comments-item')).toContainText('Harshil resolved this');
    await owner.getByTestId('comments-item').locator('[data-testid=comment-delete]').click();
    await owner.getByRole('button', { name: 'Delete', exact: true }).last().click();
    await expect(owner.getByTestId('comments-item')).toHaveCount(0);
    expect(file.comments!.filter((c) => !c.deleted)).toHaveLength(0);
    await owner.context().close();
    await ed.context().close();
  });

  test('a commenter (view only) can comment but not edit', async ({ browser }) => {
    const d = world();
    const { owner, ed, file } = await shared(browser, d, 'commenter');
    await expect(ed.getByTestId('view-only')).toBeVisible();
    await ed.getByTestId('comments').click();
    await ed.getByTestId('comment-add').click();
    const stage = (await ed.getByTestId('stage').boundingBox())!;
    await ed.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);
    await ed.getByTestId('comment-box').fill('Logo is too small');
    await ed.getByTestId('comment-submit').click();
    await expect(ed.getByTestId('comment-pin')).toHaveCount(1);
    expect(file.comments![0]).toMatchObject({ authorEmail: RECIPIENT.email });
    await owner.evaluate(() => (window as any).__dcComments.refresh());
    await expect(owner.getByTestId('comment-pin')).toHaveCount(1);
    await owner.context().close();
    await ed.context().close();
  });
});

test('slow Drive: a comment, reply and resolve show at once and are sent in the background', async ({ browser }) => {
  const d = world();
  const page = await as(browser, d, OWNER);
  await page.getByTestId('preset-instagram-post').click();
  await page.waitForFunction(() => !!(window as any).__dc);
  await page.evaluate(() => (window as any).__dc.addShape('rect'));
  await waitSaved(page);
  d.latencyMs = 1500;
  await page.getByTestId('mini-comment').click();
  await page.getByTestId('comment-box').fill('Fast please');
  const t0 = Date.now();
  await page.getByTestId('comment-submit').click();
  await expect(page.getByTestId('comment-pin')).toHaveCount(1, { timeout: 400 });
  expect(Date.now() - t0).toBeLessThan(1000);
  await expect(page.getByTestId('comment-sending').first()).toBeVisible();
  // reply and resolve before the comment even reached Drive: they queue behind it
  await page.getByTestId('comment-reply-box').fill('on it');
  await page.getByTestId('comment-reply-box').press('Enter');
  await expect(page.locator('.card [data-testid=comment-reply]')).toHaveText(/on it/, { timeout: 400 });
  await page.locator('.card [data-testid=comment-resolve]').click();
  await expect(page.getByTestId('comment-pin')).toHaveCount(0, { timeout: 400 });
  await expect.poll(() => page.evaluate(() => (window as any).__dcComments.pending), { timeout: 15_000 }).toBe(0);
  const file = [...d.files.values()].find((f) => f.comments?.length)!;
  expect(file.comments![0]).toMatchObject({ content: 'Fast please', resolved: true });
  expect(file.comments![0].replies.map((r) => r.action ?? r.content)).toEqual(['on it', 'resolve']);
  await page.context().close();
});
