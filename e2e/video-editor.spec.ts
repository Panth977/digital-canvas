import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { doc, newDesign } from './helpers.ts';

/**
 * Canva's video editor: a video design shows one scene on the stage and a
 * filmstrip timeline; playing / scrubbing draws exactly what the MP4 export holds.
 */

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

async function upload(page: Page, name: string, mimeType: string) {
  if (!(await page.getByTestId('upload').isVisible())) await page.getByTestId('tab-uploads').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('upload').click();
  await (await chooser).setFiles({ name, mimeType, buffer: fixture(name) });
}

/**
 * A 3-scene reel: scene 1 (3 s) a clip and a red box that Rises in over 2 s,
 * scene 2 (2 s) a caption shown 0.5–1.5 s, scene 3 (4 s) blue; plus a sound.
 */
export async function makeReel(page: Page): Promise<{ box: string; caption: string; pages: string[] }> {
  await newDesign(page, 'video');
  await upload(page, 'clip.webm', 'video/webm');
  await expect.poll(async () => (await doc(page)).pages[0].elements.length).toBe(1);
  await upload(page, 'tone.mp3', 'audio/mpeg');
  await expect.poll(async () => (await doc(page)).audio?.length ?? 0).toBe(1);
  return page.evaluate(() => {
    const ed = (window as any).__dc;
    const p1 = ed.doc.pages[0].id;
    ed.select([], p1);
    ed.updatePage({ duration: 3 });
    // the clip in the left half, the red box in the right half
    ed.update({ x: 40, y: 40, w: 800, h: 450 }, null, [ed.doc.pages[0].elements[0].id]);
    ed.addShape('rect');
    const box = ed.selection[0];
    ed.update({ x: 1100, y: 300, w: 600, h: 500, rotation: 0, fill: { type: 'solid', color: '#ff0000' }, stroke: null, animation: { type: 'rise', duration: 2 } });
    ed.addPage();
    ed.updatePage({ duration: 2, background: { type: 'solid', color: '#ffe9a8' } });
    ed.addText('heading');
    const caption = ed.selection[0];
    ed.update({ timing: { start: 0.5, end: 1.5 } });
    ed.addPage();
    ed.updatePage({ duration: 4, background: { type: 'solid', color: '#2a5bd7' } });
    ed.seal();
    ed.select([], p1);
    return { box, caption, pages: ed.doc.pages.map((p: any) => p.id) };
  });
}

const view = (page: Page) => page.evaluate(() => (window as any).__dcView.get());
const time = (page: Page) => page.evaluate(() => (window as any).__dc.player.time as number);

/** Mean and per-probe colour difference between the stage's page area (screenshot) and the export frame at t. */
async function compareWithExport(page: Page, t: number, probes: { x: number; y: number }[]) {
  const v = await view(page);
  const stage = (await page.getByTestId('stage').boundingBox())!;
  const d = await doc(page);
  const W = Math.round(d.width * v.zoom), H = Math.round(d.height * v.zoom);
  const shot = await page.screenshot({ clip: { x: stage.x + v.panX, y: stage.y + v.panY, width: W, height: H } });
  return page.evaluate(async ({ png, t, W, H, probes, docW }) => {
    const bin = atob(png);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = new OffscreenCanvas(W, H);
    const g = c.getContext('2d')!;
    g.drawImage(bmp, 0, 0, W, H);
    const live = g.getImageData(0, 0, W, H).data;
    const b64 = await (window as any).__dcExportFrame(t, W, H);
    const eb = atob(b64);
    const exp = new Uint8Array(eb.length);
    for (let i = 0; i < eb.length; i++) exp[i] = eb.charCodeAt(i);
    let sum = 0;
    for (let i = 0; i < live.length; i += 4) sum += (Math.abs(live[i]! - exp[i]!) + Math.abs(live[i + 1]! - exp[i + 1]!) + Math.abs(live[i + 2]! - exp[i + 2]!)) / 3;
    const k = W / docW;
    const at = (px: ArrayLike<number>, p: { x: number; y: number }) => { const i = (Math.round(p.y * k) * W + Math.round(p.x * k)) * 4; return [px[i]!, px[i + 1]!, px[i + 2]!]; };
    return { mean: sum / (live.length / 4), probes: probes.map((p) => ({ live: at(live, p), exp: at(exp, p) })) };
  }, { png: shot.toString('base64'), t, W, H, probes, docW: d.width });
}

test.describe('video editor (Canva video mode)', () => {
  test.use({ viewport: { width: 1571, height: 875 }, colorScheme: 'dark' });

  test('one scene on the stage, filmstrip ∝ durations, scrub = export, play, scene edits, element timing', async ({ page }) => {
    test.setTimeout(120_000);
    const reel = await makeReel(page);

    // ---- stage: one scene, no page headers, no "Add page" ----
    let v = await view(page);
    expect(v.videoMode).toBe(true);
    await expect(page.getByTestId('page-header')).toHaveCount(0);
    await expect(page.getByTestId('add-page')).toHaveCount(0);
    expect(v.range.y.lo).toBeCloseTo(v.range.y.hi); // one scene fits: nothing to scroll
    const stage = (await page.getByTestId('stage').boundingBox())!;
    expect(1080 * v.zoom).toBeLessThanOrEqual(stage.height);

    // ---- filmstrip: 3 scenes, widths ∝ durations, labels ----
    const scenes = page.getByTestId('tl-scene');
    await expect(scenes).toHaveCount(3);
    const widths = await scenes.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
    expect(widths[1]! / widths[0]!).toBeCloseTo(2 / 3, 1);
    expect(widths[2]! / widths[0]!).toBeCloseTo(4 / 3, 1);
    await expect(page.getByTestId('tl-scene-dur')).toHaveText(['3.0s', '2.0s', '4.0s']);
    await expect(page.getByTestId('time')).toContainText('/ 0:09.0');
    await expect(page.getByTestId('tl-audio')).toHaveCount(1);
    await expect.poll(() => page.locator('[data-testid=tl-audio] svg.wave path').getAttribute('d'), { timeout: 10_000 }).toMatch(/^M/); // waveform bars
    // thumbnails arrive
    await expect.poll(() => scenes.nth(2).evaluate((e) => getComputedStyle(e).backgroundImage), { timeout: 10_000 }).toContain('blob:');
    await page.screenshot({ path: '/tmp/orch27-rw/r9-video-editor.png' });

    // ---- static design while paused: the box fully there ----
    const boxProbe = { x: 1400, y: 760 }; // inside the box, also inside it while rising
    let cmp = await compareWithExport(page, 2.5, [boxProbe]);
    expect(cmp.probes[0]!.live[0]).toBeGreaterThan(230);
    expect(cmp.probes[0]!.live[1]).toBeLessThan(25);

    // ---- scrub: drag the playhead knob to 0.5 s and hold: the live frame equals the export ----
    const knob = page.getByTestId('tl-playhead-knob');
    const kb = (await knob.boundingBox())!;
    const s0 = (await scenes.nth(0).boundingBox())!;
    await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2);
    await page.mouse.down();
    await page.mouse.move(s0.x + s0.width * (0.5 / 3), kb.y + kb.height / 2, { steps: 5 });
    await expect.poll(async () => (await view(page)).lastDraw?.live).toBe(true);
    const tScrub = await time(page);
    expect(tScrub).toBeGreaterThan(0.3);
    expect(tScrub).toBeLessThan(0.7);
    await page.waitForTimeout(300); // clip frame seeked and drawn
    cmp = await compareWithExport(page, tScrub, [boxProbe]);
    // mid-Rise: the box is half transparent (pink on white), exactly as exported
    expect(cmp.probes[0]!.live[1]).toBeGreaterThan(40);
    expect(cmp.probes[0]!.live[1]).toBeLessThan(220);
    for (let c = 0; c < 3; c++) expect(Math.abs(cmp.probes[0]!.live[c]! - cmp.probes[0]!.exp[c]!)).toBeLessThan(12);
    expect(cmp.mean).toBeLessThan(6);
    await page.screenshot({ path: '/tmp/orch27-rw/r9-video-scrub.png' });

    // into scene 2 while holding: the caption's window (0.5–1.5 s) decides whether it shows
    const s1 = (await scenes.nth(1).boundingBox())!;
    await page.mouse.move(s1.x + s1.width * 0.5, kb.y + kb.height / 2, { steps: 4 }); // 1 s into scene 2: caption on
    await expect.poll(async () => (await view(page)).lastDraw?.pageId).toBe(reel.pages[1]);
    const tCap = await time(page);
    cmp = await compareWithExport(page, tCap, []);
    expect(cmp.mean).toBeLessThan(6);
    await page.mouse.up();
    await expect.poll(async () => (await view(page)).lastDraw?.live).toBe(false);
    for (const t of [3.2, 8]) {
      // more times: page transition-free frames match too
      await page.evaluate((t) => (window as any).__dc.player.seek(t), t);
      await page.evaluate(() => (window as any).__dc.player.scrub(true));
      await page.waitForTimeout(150);
      cmp = await compareWithExport(page, t, []);
      expect(cmp.mean).toBeLessThan(6);
      await page.evaluate(() => (window as any).__dc.player.scrub(false));
    }

    // ---- play advances the playhead, the stage follows the scene ----
    await page.evaluate(() => (window as any).__dc.player.seek(0));
    await page.getByTestId('play').click();
    await expect.poll(() => time(page), { timeout: 5000 }).toBeGreaterThan(0.6);
    expect((await view(page)).live).toBe(true);
    const x1 = Number(await page.getByTestId('tl-playhead').getAttribute('data-time'));
    expect(x1).toBeGreaterThan(0);
    await page.keyboard.press('Space'); // pause
    await expect.poll(() => page.evaluate(() => (window as any).__dc.player.playing)).toBe(false);
    expect((await view(page)).live).toBe(false);

    // ---- click a scene: it shows on the stage, the playhead moves into it ----
    await scenes.nth(2).click({ position: { x: 10, y: 10 } });
    await expect.poll(() => page.evaluate(() => (window as any).__dc.pageId)).toBe(reel.pages[2]);
    expect(await time(page)).toBeGreaterThanOrEqual(5);

    // ---- resize: drag scene 3's right edge (+1 s) ----
    const edge = scenes.nth(2).getByTestId('tl-scene-edge');
    const eb = (await edge.boundingBox())!;
    const pps = widths[0]! / 3;
    await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2);
    await page.mouse.down();
    await page.mouse.move(eb.x + eb.width / 2 + pps * 0.5, eb.y + 10, { steps: 3 });
    await page.mouse.move(eb.x + eb.width / 2 + pps, eb.y + 10, { steps: 3 });
    await page.mouse.up();
    await expect.poll(async () => (await doc(page)).pages[2].duration).toBeCloseTo(5, 0);

    // ---- split at the playhead (S) ----
    await page.evaluate(() => (window as any).__dc.player.seek(6));
    await page.keyboard.press('s');
    await expect(scenes).toHaveCount(4);
    let d = await doc(page);
    expect(d.pages.map((p: any) => p.duration)).toEqual([3, 2, 1, 4]);

    // ---- duplicate (menu) ----
    await scenes.nth(1).click({ button: 'right' });
    await expect(page.getByTestId('tl-menu')).toBeVisible();
    await page.getByTestId('tl-dup').click();
    await expect(scenes).toHaveCount(5);
    d = await doc(page);
    expect(d.pages.map((p: any) => p.duration)).toEqual([3, 2, 2, 1, 4]);

    // ---- reorder: drag scene 1 past scene 2 ----
    const first = (await scenes.nth(0).boundingBox())!;
    const second = (await scenes.nth(1).boundingBox())!;
    await page.mouse.move(first.x + 20, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(first.x + 60, first.y + first.height / 2, { steps: 3 });
    await page.mouse.move(second.x + second.width * 0.8, first.y + first.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await doc(page)).pages[1].id).toBe(reel.pages[0]);
    expect((await doc(page)).pages[0].id).toBe(reel.pages[1]);

    // ---- delete + hide via menu ----
    await scenes.nth(2).click({ button: 'right' });
    await page.getByTestId('tl-del').click();
    await expect(scenes).toHaveCount(4);
    await scenes.nth(3).click({ button: 'right' });
    await page.getByTestId('tl-hide').click();
    await expect.poll(async () => (await doc(page)).pages[3].hidden).toBe(true);
    await page.keyboard.press('Meta+z');
    await expect.poll(async () => (await doc(page)).pages[3].hidden).toBeFalsy();

    // ---- element timing: select the caption, drag its bar's start edge +0.5 s ----
    await page.evaluate((id) => (window as any).__dc.select([id]), reel.caption);
    const bar = page.getByTestId('tl-timing');
    await expect(bar).toBeVisible();
    expect(Number(await bar.getAttribute('data-start'))).toBeCloseTo(0.5);
    const sc = (await scenes.nth(0).boundingBox())!; // the caption's scene is first now
    const ppsNow = sc.width / 2;
    const hb = (await page.getByTestId('tl-timing-start').boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 + ppsNow * 0.25, hb.y + 5, { steps: 2 });
    await page.mouse.move(hb.x + hb.width / 2 + ppsNow * 0.5, hb.y + 5, { steps: 2 });
    await page.mouse.up();
    await expect.poll(async () => (await doc(page)).pages[0].elements.find((e: any) => e.id === reel.caption)?.timing).toEqual({ start: 1, end: 1.5 });
    await page.screenshot({ path: '/tmp/orch27-rw/r9-video-timing.png' });

    // ---- sound: drag it 1 s right ----
    const snd = (await page.getByTestId('tl-audio').boundingBox())!;
    await page.mouse.move(snd.x + snd.width / 2, snd.y + snd.height / 2);
    await page.mouse.down();
    await page.mouse.move(snd.x + snd.width / 2 + ppsNow * 0.5, snd.y + 5, { steps: 2 });
    await page.mouse.move(snd.x + snd.width / 2 + ppsNow, snd.y + 5, { steps: 2 });
    await page.mouse.up();
    await expect.poll(async () => (await doc(page)).audio[0].start).toBeCloseTo(1, 0);

    // ---- add scene, zoom, collapse ----
    await page.getByTestId('tl-add-scene').click();
    await expect(scenes).toHaveCount(5);
    expect((await doc(page)).pages[4].duration).toBe(5);
    const wBefore = (await scenes.nth(0).boundingBox())!.width;
    await page.getByTestId('tl-zoom').fill('3');
    await expect.poll(async () => (await scenes.nth(0).boundingBox())!.width).toBeGreaterThan(wBefore * 2.5);
    await page.getByTestId('tl-zoom').fill('1');
    await page.getByTestId('tl-collapse').click();
    await expect(scenes).toHaveCount(0);
    await expect(page.getByTestId('play')).toBeVisible();
    await page.getByTestId('tl-collapse').click();
    await expect(scenes).toHaveCount(5);
  });

  test('a page transition plays live like the export', async ({ page }) => {
    test.setTimeout(90_000);
    const reel = await makeReel(page);
    await page.evaluate((id) => { const ed = (window as any).__dc; ed.updatePage({ transition: { type: 'slide', direction: 'right', duration: 1 } }, null, id); ed.seal(); }, reel.pages[2]);
    await expect(page.getByTestId('tl-transition').nth(1)).toHaveClass(/set/);
    await page.evaluate(() => { const p = (window as any).__dc.player; p.scrub(true); return p.seek(5.5); });
    await page.waitForTimeout(200);
    const cmp = await compareWithExport(page, 5.5, [{ x: 200, y: 540 }, { x: 1700, y: 540 }]);
    expect(cmp.mean).toBeLessThan(6);
    // half way through the slide: the old (yellow) scene on the left, the new (blue) one on the right
    expect(cmp.probes[0]!.live[0]).toBeGreaterThan(200);
    expect(cmp.probes[1]!.live[2]).toBeGreaterThan(150);
    expect(cmp.probes[1]!.live[0]).toBeLessThan(100);
    await page.screenshot({ path: '/tmp/orch27-rw/r9-video-transition.png' });
    await page.evaluate(() => (window as any).__dc.player.scrub(false));
  });

  test('a non-video design keeps the page column', async ({ page }) => {
    await newDesign(page, 'instagram-post');
    await page.evaluate(() => (window as any).__dc.addPage());
    const v = await view(page);
    expect(v.videoMode).toBe(false);
    await expect(page.getByTestId('timeline')).toHaveCount(0);
    await expect(page.getByTestId('page-header')).not.toHaveCount(0);
    await expect(page.getByTestId('pages-btn')).toBeVisible();
  });
});
