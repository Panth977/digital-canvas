import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { doc, newDesign, selectionCenter } from './helpers.ts';

/** r16: animations to Canva's depth, transitions, Create an animation, find and replace, clip speed, presenter view. */

const SHOTS = process.env.SHOTS_DIR ?? '/tmp/orch27-rw';
const shoot = process.env.SHOTS === '1';
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

async function upload(page: Page, name: string, mimeType: string) {
  if (!(await page.getByTestId('upload').isVisible())) await page.getByTestId('tab-uploads').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('upload').click();
  await (await chooser).setFiles({ name, mimeType, buffer: fixture(name) });
}

const addText = (page: Page, text: string, more: Record<string, unknown> = {}) => page.evaluate(({ text, more }) => {
  const ed = (window as any).__dc;
  ed.addText?.('body');
  const id = ed.selection[0];
  ed.update({ text, runs: undefined, x: 100, y: 200, w: 800, ...more }, null, [id]);
  ed.seal();
  return id as string;
}, { text, more });

const addBox = (page: Page, more: Record<string, unknown> = {}) => page.evaluate((more) => {
  const ed = (window as any).__dc;
  ed.addShape('rect');
  ed.update({ x: 300, y: 300, w: 400, h: 400, rotation: 0, fill: { type: 'solid', color: '#ff0000' }, stroke: null, ...more });
  ed.seal();
  return ed.selection[0] as string;
}, more);

const animation = (page: Page, id: string) => page.evaluate((id) => (window as any).__dc.doc.pages.flatMap((p: any) => p.elements).find((e: any) => e.id === id)?.animation, id);

async function openAnimate(page: Page) {
  await page.getByTestId('animate-btn').click();
  await expect(page.getByTestId('animate-panel')).toBeVisible();
}

const tilePixels = (page: Page, id: string) => page.getByTestId(id).evaluate((c: HTMLCanvasElement) => Array.from(c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data).reduce((a, b, i) => (a * 31 + b * (i + 1)) % 1000003, 7));
const canvasSum = (page: Page, id: string) => page.getByTestId(id).evaluate((c: HTMLCanvasElement) => { const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 16) s = (s * 7 + d[i]! + d[i + 1]! * 3) % 1000003; return s; });

test.describe('Animate panel', () => {
  test('the sets follow the selection and options write the animation', async ({ page }) => {
    await newDesign(page);
    const id = await addText(page, 'Hello motion world');
    await openAnimate(page);
    for (const s of ['basic', 'exaggerate', 'text', 'writing', 'ambient']) await expect(page.getByTestId(`anim-set-${s}`)).toBeVisible();
    await expect(page.getByTestId('anim-set-photo')).toHaveCount(0);

    await page.getByTestId('anim-ascend').click();
    expect(await animation(page, id)).toMatchObject({ type: 'ascend', by: 'line' });
    await page.getByTestId('anim-by-letter').click();
    await page.getByTestId('anim-phase-both').click();
    await page.getByTestId('anim-order').selectOption('random');
    expect(await animation(page, id)).toMatchObject({ type: 'ascend', by: 'letter', phase: 'both', order: 'random' });

    await page.getByTestId('anim-intensity').fill('0.9');
    expect((await animation(page, id)).intensity).toBeCloseTo(0.9);

    // options that still apply stay when the animation changes
    await page.getByTestId('anim-pan').click();
    await expect(page.getByTestId('anim-dir-right')).toBeVisible();
    await page.getByTestId('anim-dir-right').click();
    expect(await animation(page, id)).toMatchObject({ type: 'pan', direction: 'right', phase: 'both', intensity: expect.any(Number) });

    // a keyframe family offers only its directions
    await page.getByTestId('anim-lightSpeed').click();
    await expect(page.getByTestId('anim-dir-up')).toHaveCount(0);
    await expect(page.getByTestId('anim-dir-left')).toBeVisible();

    // a loop has no In / Out; an exit recipe starts as Out
    await page.getByTestId('anim-pulse').click();
    await expect(page.getByTestId('anim-phase-in')).toHaveCount(0);
    await page.getByTestId('anim-hinge').click();
    expect(await animation(page, id)).toMatchObject({ type: 'hinge', phase: 'out' });

    await page.getByTestId('anim-none').click();
    expect(await animation(page, id)).toBeUndefined();
    await page.keyboard.press('ControlOrMeta+z');
    expect((await animation(page, id))?.type).toBe('hinge');
    if (shoot) await page.screenshot({ path: `${SHOTS}/r16-anim-panel.png` });
  });

  test('photos get Photo motion; a page animation can move the page as one', async ({ page }) => {
    await newDesign(page);
    await page.evaluate(async () => {
      const ed = (window as any).__dc;
      const c = new OffscreenCanvas(64, 64);
      const g = c.getContext('2d')!;
      g.fillStyle = '#3366ff'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#ffcc00'; g.fillRect(16, 16, 32, 32);
      const b = await c.convertToBlob({ type: 'image/png' });
      const f = new File([b], 'p.png', { type: 'image/png' });
      await ed.addImageFile?.(f);
    });
    await expect.poll(async () => (await doc(page)).pages[0].elements.length).toBeGreaterThanOrEqual(1);
    await openAnimate(page);
    await expect(page.getByTestId('anim-set-photo')).toBeVisible();
    await expect(page.getByTestId('anim-photoZoomIn')).toBeVisible();
    await expect(page.getByTestId('anim-set-text')).toHaveCount(0);

    await page.getByTestId('anim-tab-page').click();
    await page.getByTestId('anim-rise').click();
    await page.getByTestId('anim-page-whole').click();
    expect((await doc(page)).pages[0].animation).toMatchObject({ type: 'rise', by: 'page' });
    await page.getByTestId('anim-page-each').click();
    await page.getByTestId('anim-order').selectOption('together');
    expect((await doc(page)).pages[0].animation).toMatchObject({ type: 'rise', order: 'together' });
  });

  test('hovering a tile plays it: the tile and the big preview move, nothing is committed', async ({ page }) => {
    await newDesign(page);
    const id = await addBox(page);
    await openAnimate(page);
    const before = JSON.stringify((await doc(page)).pages[0]);
    const tile = page.getByTestId('anim-bounceIn');
    await tile.scrollIntoViewIfNeeded();
    await tile.hover();
    await expect(page.getByTestId('anim-preview')).toHaveAttribute('data-playing', 'true');
    await expect(page.getByTestId('tile-bounceIn')).toBeVisible();
    const seen = new Set<number>(), big = new Set<number>();
    for (let i = 0; i < 8; i++) {
      seen.add(await tilePixels(page, 'tile-bounceIn'));
      big.add(await canvasSum(page, 'anim-preview'));
      await page.waitForTimeout(90);
    }
    expect(seen.size).toBeGreaterThan(2);
    expect(big.size).toBeGreaterThan(2);
    if (shoot) await page.screenshot({ path: `${SHOTS}/r16-anim-hover.png` });
    await page.mouse.move(800, 40);
    await expect(page.getByTestId('tile-bounceIn')).toBeHidden();
    expect(JSON.stringify((await doc(page)).pages[0])).toBe(before);
    expect(await animation(page, id)).toBeUndefined();
  });

  test('Create an animation: drag draws a path, style and rotation change it, undo removes it', async ({ page }) => {
    await newDesign(page);
    const id = await addBox(page, { x: 100, y: 100, w: 200, h: 200 });
    await openAnimate(page);
    await page.getByTestId('anim-create').click();
    const layer = page.getByTestId('motion-draw');
    await expect(layer).toBeVisible();
    const b = (await layer.boundingBox())!;
    await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.2);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) { await page.mouse.move(b.x + b.width * (0.2 + i * 0.05), b.y + b.height * (0.2 + Math.sin(i / 2) * 0.1)); await page.waitForTimeout(15); }
    if (shoot) await page.screenshot({ path: `${SHOTS}/r16-anim-path.png` });
    await page.mouse.up();
    await expect(layer).toHaveCount(0);
    const a = await animation(page, id);
    expect(a.type).toBe('custom');
    expect(a.path.points.length).toBeGreaterThan(3);
    expect(a.path.points[0]).toEqual([0, 0, 0]);
    expect(a.path.points.at(-1)[2]).toBe(1);
    expect(a.duration).toBeGreaterThanOrEqual(0.5);

    await page.getByTestId('path-style-bounce').click();
    await page.getByTestId('path-rotation-follow').click();
    await page.getByTestId('path-fade').check();
    expect((await animation(page, id)).path).toMatchObject({ style: 'bounce', rotation: 'follow', fade: true });
    await page.getByTestId('anim-custom').waitFor();
    // a click is not a path, and Cancel leaves everything alone
    await page.getByTestId('anim-create').click();
    await page.getByTestId('motion-cancel').click();
    await expect(page.getByTestId('motion-draw')).toHaveCount(0);
    expect((await animation(page, id)).type).toBe('custom');
  });

  test('timing: from / to in the panel, and a bar per element on the timeline', async ({ page }) => {
    await newDesign(page, 'video');
    const a = await addBox(page);
    const b = await addBox(page, { x: 800 });
    await page.evaluate((a) => { const ed = (window as any).__dc; ed.updatePage({ duration: 6 }); ed.select([a]); }, a);
    await openAnimate(page);
    await page.getByTestId('anim-from').fill('1.5');
    await page.getByTestId('anim-from').press('Enter');
    await page.getByTestId('anim-to').fill('4');
    await page.getByTestId('anim-to').press('Enter');
    const timing = (id: string) => page.evaluate((id) => (window as any).__dc.doc.pages[0].elements.find((e: any) => e.id === id).timing, id);
    await expect.poll(() => timing(a)).toEqual({ start: 1.5, end: 4 });
    await page.getByTestId('tl-show-timing').click();
    await expect(page.getByTestId('tl-el-timing')).toHaveCount(2);
    const bar = page.locator(`[data-testid="tl-el-timing"][data-id="${a}"]`);
    await expect(bar).toHaveAttribute('data-start', '1.5');
    // drag the other element's right edge in
    const other = page.locator(`[data-testid="tl-el-timing"][data-id="${b}"] .h.r`);
    const r = (await other.boundingBox())!;
    await page.mouse.move(r.x + 2, r.y + 4);
    await page.mouse.down();
    await page.mouse.move(r.x - 100, r.y + 4, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await timing(b))?.end ?? 99).toBeLessThan(6);
    if (shoot) await page.screenshot({ path: `${SHOTS}/r16-anim-timing.png` });
  });

  test('transitions: pick, direction, duration, colour, all pages, one undo', async ({ page }) => {
    await newDesign(page, 'video');
    await page.evaluate(() => { const ed = (window as any).__dc; ed.updatePage({ duration: 2, background: { type: 'solid', color: '#ff0000' } }); ed.addPage(); ed.updatePage({ duration: 2, background: { type: 'solid', color: '#0000ff' } }); ed.addPage(); ed.updatePage({ duration: 2 }); });
    await page.getByTestId('animate-btn').click();
    await page.getByTestId('anim-tab-transition').click();
    for (const t of ['dissolve', 'slide', 'match', 'circle', 'line', 'stack', 'chop', 'flow', 'colorwipe']) await expect(page.getByTestId(`tr-${t}`)).toBeVisible();
    await page.getByTestId('tr-colorwipe').click();
    await page.getByTestId('tr-dir-left').click();
    await page.getByTestId('tr-duration').fill('1.3');
    const tr = (i: number) => page.evaluate((i) => (window as any).__dc.doc.pages[i].transition, i);
    expect(await tr(2)).toMatchObject({ type: 'colorwipe', direction: 'left', duration: 1.3, color: expect.any(String) });
    await page.getByTestId('tr-all').click();
    expect(await tr(1)).toMatchObject({ type: 'colorwipe', duration: 1.3 });
    expect(await tr(0)).toBeUndefined();
    await page.keyboard.press('ControlOrMeta+z');
    expect(await tr(1)).toBeUndefined();
    // hover plays it on the tile
    await page.getByTestId('tr-chop').hover();
    await expect(page.getByTestId('tile-tr-chop')).toBeVisible();
    await expect.poll(async () => { const a = await tilePixels(page, 'tile-tr-chop'); await page.waitForTimeout(120); return a !== await tilePixels(page, 'tile-tr-chop'); }).toBe(true);
    if (shoot) await page.screenshot({ path: `${SHOTS}/r16-anim-transitions.png` });
  });
});

/** The stage while scrubbing against the export's frame at the same time. */
async function compareWithExport(page: Page, t: number, exportAt = t): Promise<number> {
  await page.evaluate(async (t) => { const ed = (window as any).__dc; ed.player.scrub(true); await ed.player.seek(t); }, t);
  await page.waitForTimeout(120);
  const v = await page.evaluate(() => (window as any).__dcView.get());
  const stage = (await page.getByTestId('stage').boundingBox())!;
  const d = await doc(page);
  const W = Math.round(d.width * v.zoom), H = Math.round(d.height * v.zoom);
  const shot = await page.screenshot({ clip: { x: stage.x + v.panX, y: stage.y + v.panY, width: W, height: H } });
  return page.evaluate(async ({ png, exportAt, W, H }) => {
    const bin = atob(png);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = new OffscreenCanvas(W, H);
    const g = c.getContext('2d')!;
    g.drawImage(bmp, 0, 0, W, H);
    const live = g.getImageData(0, 0, W, H).data;
    const b64 = await (window as any).__dcExportFrame(exportAt, W, H);
    const eb = atob(b64);
    let sum = 0;
    for (let i = 0; i < live.length; i += 4) sum += (Math.abs(live[i]! - eb.charCodeAt(i)) + Math.abs(live[i + 1]! - eb.charCodeAt(i + 1)) + Math.abs(live[i + 2]! - eb.charCodeAt(i + 2))) / 3;
    return sum / (live.length / 4);
  }, { png: shot.toString('base64'), exportAt, W, H });
}

test.describe('editor = export', () => {
  test.use({ viewport: { width: 1571, height: 875 } });

  test('per-letter text, keyframes, a loop, an exit, a path and new transitions draw the same frames', async ({ page }) => {
    test.setTimeout(120_000);
    await newDesign(page, 'video');
    await page.evaluate(() => {
      const ed = (window as any).__dc;
      const put = (kind: 'text' | 'box', patch: any) => {
        if (kind === 'text') ed.addText?.('body'); else ed.addShape('rect');
        ed.update(kind === 'text' ? { rotation: 0, ...patch } : { rotation: 0, fill: { type: 'solid', color: '#ff0000' }, stroke: null, ...patch });
      };
      ed.updatePage({ duration: 3, background: { type: 'solid', color: '#fff4d6' } });
      put('text', { text: 'Burst of letters', x: 100, y: 60, w: 1600, animation: { type: 'burst', by: 'letter', duration: 1.5 } });
      put('box', { x: 100, y: 400, w: 300, h: 300, animation: { type: 'bounceIn', duration: 1.5 } });
      put('box', { x: 500, y: 400, w: 300, h: 300, animation: { type: 'wiggle' } });
      put('box', { x: 900, y: 400, w: 300, h: 300, animation: { type: 'fade', phase: 'out', duration: 1.5 } });
      put('box', { x: 1300, y: 400, w: 200, h: 200, animation: { type: 'custom', duration: 2, path: { points: [[0, 0, 0], [200, 100, 0.5], [300, 0, 1]], style: 'smooth', rotation: 'follow' } } });
      ed.addPage();
      ed.updatePage({ duration: 2, background: { type: 'solid', color: '#0044cc' }, transition: { type: 'chop', duration: 1 } });
      ed.addPage();
      ed.updatePage({ duration: 2, background: { type: 'solid', color: '#116644' }, transition: { type: 'colorwipe', duration: 1, color: '#ffcc00' } });
      ed.addPage();
      ed.updatePage({ duration: 2, background: { type: 'solid', color: '#ffffff' }, transition: { type: 'circle', duration: 1 } });
    });
    const means: number[] = [];
    for (const t of [0.4, 0.8, 1.2, 2.2, 2.7, 3.5, 5.5, 7.5]) {
      const mean = await compareWithExport(page, t);
      means.push(mean);
      expect(mean, `at ${t}s`).toBeLessThan(1.5);
    }
    console.log('editor vs export, mean colour difference per frame:', means.map((m) => m.toFixed(2)).join(' '));
    // the comparison can fail: an export frame 0.15 s off is well above that
    const off = await compareWithExport(page, 0.8, 0.95);
    console.log('same, export 0.15 s off:', off.toFixed(2));
    expect(off).toBeGreaterThan(2);
    if (shoot) await page.screenshot({ path: `${SHOTS}/r16-anim-export-match.png` });
  });
});

test.describe('find and replace', () => {
  test('Ctrl+F, match case, whole word, replace all with one undo, across pages', async ({ page }) => {
    await newDesign(page);
    await addText(page, 'Art starts here');
    await page.evaluate(() => (window as any).__dc.addPage());
    await addText(page, 'ART and art');
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+f');
    await expect(page.getByTestId('find-panel')).toBeVisible();
    await expect(page.getByTestId('find-query')).toBeFocused();
    await page.getByTestId('find-query').fill('art');
    await expect(page.getByTestId('find-count')).toHaveText('1 of 4 matches');
    await expect(page.getByTestId('find-item')).toHaveCount(4);
    await page.getByTestId('find-word').check();
    await expect(page.getByTestId('find-count')).toHaveText('1 of 3 matches');
    await page.getByTestId('find-case').check();
    await expect(page.getByTestId('find-count')).toHaveText('1 of 1 match');
    await page.getByTestId('find-case').uncheck();
    if (shoot) await page.screenshot({ path: `${SHOTS}/r16-anim-find.png` });

    // next goes to the match on page 2 and selects it
    await page.getByTestId('find-next').click();
    await expect.poll(() => page.evaluate(() => (window as any).__dc.pageIndex)).toBe(1);
    await expect.poll(() => page.evaluate(() => (window as any).__dc.selection.length)).toBe(1);

    const texts = () => page.evaluate(() => (window as any).__dc.doc.pages.flatMap((p: any) => p.elements.filter((e: any) => e.type === 'text').map((e: any) => e.text)));
    const before = await texts();
    await page.getByTestId('find-replace').fill('Craft');
    await page.getByTestId('find-replace-all').click();
    await expect(page.getByTestId('find-done')).toHaveText('Replaced 3');
    expect((await texts()).filter((t: string) => t.includes('Craft'))).toEqual(['Craft starts here', 'Craft and Craft']);
    await page.getByTestId('find-query').blur();
    await page.keyboard.press('ControlOrMeta+z');
    expect(await texts()).toEqual(before);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    expect((await texts()).filter((t: string) => t.includes('Craft'))).toHaveLength(2);
  });

  test('replace one, from the File menu', async ({ page }) => {
    await newDesign(page);
    await addText(page, 'one one one');
    await page.getByTestId('file-menu').click();
    await page.getByTestId('file-find').click();
    await page.getByTestId('find-query').fill('one');
    await page.getByTestId('find-replace').fill('two');
    await page.getByTestId('find-next').click();
    await page.getByTestId('find-replace-one').click();
    await expect.poll(() => page.evaluate(() => (window as any).__dc.doc.pages[0].elements.find((e: any) => e.type === 'text').text)).toBe('one two one');
    await expect(page.getByTestId('find-count')).toHaveText(/of 2 matches/);
  });
});

test.describe('clip speed', () => {
  test.use({ viewport: { width: 1571, height: 875 } });

  test('2× in the toolbar: the page follows, playback rate, frames and sound match the export', async ({ page }) => {
    test.setTimeout(120_000);
    await newDesign(page, 'video');
    await upload(page, 'clip.webm', 'video/webm');
    await expect.poll(async () => (await doc(page)).pages[0].elements.length).toBe(1);
    await page.evaluate(() => { const ed = (window as any).__dc; ed.select([ed.doc.pages[0].elements[0].id]); ed.updatePage({ duration: 2 }); });
    await page.getByTestId('speed-btn').click();
    await page.getByTestId('clip-speed').fill('2');
    await expect.poll(async () => (await doc(page)).pages[0].elements[0].speed).toBe(2);
    await expect.poll(async () => (await doc(page)).pages[0].duration).toBeCloseTo(1, 0);
    if (shoot) await page.screenshot({ path: `${SHOTS}/r16-anim-speed.png` });
    await page.getByTestId('clip-speed').fill('0.25');
    await expect.poll(async () => (await doc(page)).pages[0].elements[0].speed).toBe(0.25);
    await page.getByTestId('clip-speed').fill('2');
    await expect.poll(async () => (await doc(page)).pages[0].elements[0].speed).toBe(2);

    // the same frame in the editor and the export, part-way through
    await page.keyboard.press('Escape');
    expect(await compareWithExport(page, 0.5)).toBeLessThan(6);
    await page.evaluate(() => (window as any).__dc.player.scrub(false));

    // playback reads the file at that rate
    const rate = await page.evaluate(async () => {
      const ed = (window as any).__dc;
      await ed.player.seek(0);
      ed.player.play();
      await new Promise((r) => setTimeout(r, 300));
      const v = [...(ed.player as any).videos.values()][0] as HTMLVideoElement;
      const out = { rate: v.playbackRate, pitch: v.preservesPitch };
      ed.player.pause();
      return out;
    });
    expect(rate).toEqual({ rate: 2, pitch: true });

    // the export's sound: half as long, same pitch
    const sound = await page.evaluate(async () => {
      const { mixAudio } = await import('/src/lib/mp4.ts');
      const ed = (window as any).__dc;
      const measure = async (speed: number) => {
        const page0 = ed.doc.pages[0];
        const el = { ...page0.elements[0], speed, muted: false, volume: 1 };
        const fileDur = ed.doc.assets[el.asset].duration;
        const doc = { ...ed.doc, pages: [{ ...page0, duration: fileDur / speed, elements: [el] }], audio: [] };
        const mix = await mixAudio(doc, ed.assets, fileDur / speed);
        if (!mix) return null;
        const d = mix.getChannelData(0);
        // sound's length, and its main frequency by zero crossings
        let last = 0, n = 0;
        for (let i = 1; i < d.length; i++) { if (Math.abs(d[i]!) > 0.002) last = i; if (d[i - 1]! < 0 && d[i]! >= 0) n++; }
        return { sounding: last / mix.sampleRate, hz: n / (last / mix.sampleRate) };
      };
      return { one: await measure(1), two: await measure(2) };
    });
    expect(sound.one).not.toBeNull();
    expect(sound.two!.sounding).toBeCloseTo(sound.one!.sounding / 2, 0);
    expect(sound.two!.hz / sound.one!.hz).toBeGreaterThan(0.85);
    expect(sound.two!.hz / sound.one!.hz).toBeLessThan(1.15);
  });
});

test.describe('presenting', () => {
  async function deck(page: Page) {
    await newDesign(page, 'presentation');
    await page.evaluate(() => {
      const ed = (window as any).__dc;
      ed.updatePage({ background: { type: 'solid', color: '#ffe9a8' }, notes: 'Open with the story.' });
      ed.addPage();
      ed.updatePage({ background: { type: 'solid', color: '#0044cc' }, notes: 'Second page notes.' });
      ed.addPage();
      ed.updatePage({ background: { type: 'solid', color: '#116644' } });
      ed.select([], ed.doc.pages[0].id);
    });
  }

  test('presenter view: notes, next page, timers in a second window, both windows in step', async ({ page, context }) => {
    await deck(page);
    await page.getByTestId('share').click();
    const popup = context.waitForEvent('page');
    await page.getByTestId('share-presenter').click();
    const win = await popup;
    await expect(page.getByTestId('present')).toBeVisible();
    await expect(win.getByTestId('presenter')).toBeVisible();
    await expect(win.getByTestId('presenter-notes')).toHaveText('Open with the story.');
    await expect(win.getByTestId('presenter-count')).toHaveText('Page 1 of 3');
    await expect(win.getByTestId('presenter-next')).toBeVisible();
    await expect(win.getByTestId('presenter-current')).toHaveAttribute('src', /^blob:/);

    // the timer runs, and pauses
    await expect.poll(() => win.getByTestId('presenter-timer').textContent(), { timeout: 4000 }).not.toBe('0:00');
    await win.getByTestId('presenter-timer-toggle').click();
    const held = await win.getByTestId('presenter-timer').textContent();
    await page.waitForTimeout(1200);
    expect(await win.getByTestId('presenter-timer').textContent()).toBe(held);
    await win.getByTestId('presenter-timer-toggle').click();

    await win.getByTestId('presenter-go-next').click();
    await expect(page.getByTestId('present-count')).toHaveText('2 / 3');
    await expect(win.getByTestId('presenter-notes')).toHaveText('Second page notes.');

    // keys in the speaker's window work, last page has no next
    await win.keyboard.press('ArrowRight');
    await expect(page.getByTestId('present-count')).toHaveText('3 / 3');
    await expect(win.getByTestId('presenter-next-end')).toBeVisible();
    await expect(win.getByTestId('presenter-notes')).toHaveText('No notes on this page.');
    if (shoot) await win.screenshot({ path: `${SHOTS}/r16-anim-presenter.png` });

    await win.getByTestId('presenter-end').click();
    await expect(page.getByTestId('present')).toHaveCount(0);
    await expect.poll(() => win.isClosed()).toBe(true);
  });

  test('autoplay moves on by itself and stops at the end, or loops', async ({ page }) => {
    await deck(page);
    await page.getByTestId('share').click();
    await page.getByTestId('share-autoplay').click();
    await expect(page.getByTestId('present')).toHaveAttribute('data-auto', 'true');
    await page.getByTestId('present-seconds').selectOption('3');
    await expect(page.getByTestId('present-count')).toHaveText('2 / 3', { timeout: 6000 });
    await expect(page.getByTestId('present-count')).toHaveText('3 / 3', { timeout: 6000 });
    await page.getByTestId('present-loop').check();
    await expect(page.getByTestId('present-count')).toHaveText('1 / 3', { timeout: 6000 });
    await page.getByTestId('present-close').click();
  });

  test('a page shows its animation; a video page plays instead of a still', async ({ page }) => {
    test.setTimeout(60_000);
    await newDesign(page, 'video');
    await upload(page, 'clip.webm', 'video/webm');
    await expect.poll(async () => (await doc(page)).pages[0].elements.length).toBe(1);
    await page.getByTestId('share').click();
    await page.getByTestId('share-present').click();
    await expect(page.getByTestId('present-page')).toBeVisible();
    const seen = new Set<number>();
    for (let i = 0; i < 14; i++) {
      seen.add(await canvasSum(page, 'present-page'));
      await page.waitForTimeout(100);
    }
    expect(seen.size).toBeGreaterThan(3);
    if (shoot) await page.screenshot({ path: `${SHOTS}/r16-anim-present-video.png` });
    await page.getByTestId('present-close').click();
    await expect(page.getByTestId('present')).toHaveCount(0);
    // the stage is back on the editable design
    await expect.poll(() => page.evaluate(() => (window as any).__dc.player.quiet)).toBe(false);
  });
});
