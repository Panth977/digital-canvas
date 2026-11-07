import { expect, test, type Page } from '@playwright/test';
import { FakeDrive, fakeSignIn } from './fake-drive.ts';
import { CONTENT_HOSTS, newDesign } from './helpers.ts';

/**
 * The canvas stays smooth while Google Drive is slow (ORCH-44 rework): drag an
 * element around a busy page, pausing so autosaves start mid-drag, with every
 * Drive call answered 1.2 s late. The main thread must never stall: no task
 * over LONG_MS while dragging, and the pointer → picture delay stays small.
 */
const LONG_MS = Number(process.env.DC_PERF_LONG_MS ?? 250);
test.describe.configure({ mode: 'serial' });
// The real GPU (as in people's browsers): headless Chromium's software WebGL takes ~0.4 s per frame of
// shadowed pictures on its own, which would hide what this test is about. Skipped where there is none (CI).
test.use({ launchOptions: { args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] } });
test.skip(process.platform !== 'darwin', 'needs the GPU (macOS Metal)');

/** Like Panth's wall board: big photos with drop shadows (each costs real time to draw on the CPU), texts and shapes. */
async function busyPage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const ed = (window as any).__dc;
    for (let i = 0; i < 16; i++) {
      const c = new OffscreenCanvas(2400, 1800);
      const g = c.getContext('2d')!;
      const grad = g.createLinearGradient(0, 0, 2400, 1800);
      grad.addColorStop(0, `hsl(${i * 23} 70% 50%)`);
      grad.addColorStop(1, `hsl(${i * 23 + 90} 70% 30%)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, 2400, 1800);
      for (let k = 0; k < 400; k++) { g.fillStyle = `hsl(${(k * 37) % 360} 80% 60% / .5)`; g.fillRect((k * 97) % 2400, (k * 53) % 1800, 60, 60); }
      await ed.addImageFile(new File([await c.convertToBlob({ type: 'image/png' })], `p${i}.png`, { type: 'image/png' }));
    }
    const shadow = { style: 'drop', size: 50, blur: 45, angle: 90, distance: 30, transparency: 55, color: '#1e0a00' };
    const imgs = ed.page.elements.filter((e: any) => e.type === 'image');
    imgs.forEach((e: any, i: number) => { ed.select([e.id], ed.pageId); ed.update({ shadow, x: (i % 4) * 260, y: Math.floor(i / 4) * 260, w: 240, h: 180 }); });
    for (let i = 0; i < 40; i++) ed.addText(i % 3 ? 'body' : 'heading');
    for (let i = 0; i < 20; i++) ed.addShape(i % 2 ? 'rect' : 'ellipse');
    ed.seal();
  });
}

/** Drag the selection in small steps for ~4 s with two 1.2 s holds; returns stalls seen by the page. */
async function dragAndMeasure(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__long = [];
    w.__frames = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: false });
    let last = performance.now();
    const tick = (t: number) => { w.__frames.push(t - last); last = t; if (!w.__stopFrames) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await page.evaluate(() => { const ed = (window as any).__dc; ed.select([ed.page.elements.at(-1).id], ed.pageId); });
  const box = (await page.locator('svg.overlay polygon.sel').first().boundingBox())!;
  let x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let leg = 0; leg < 3; leg++) {
    for (let i = 0; i < 40; i++) { x += leg % 2 ? -3 : 3; y += 1; await page.mouse.move(x, y); await page.waitForTimeout(16); }
    if (leg < 2) await page.waitForTimeout(1200); // an autosave starts here, mid-drag
  }
  await page.mouse.up();
  await page.waitForTimeout(1500); // the save after the drop
  return page.evaluate(() => {
    const w = window as any;
    w.__stopFrames = true;
    const f = (w.__frames as number[]).slice(2);
    return { long: w.__long as number[], worstFrame: Math.round(Math.max(...f)), saveState: w.__dc.saveState };
  });
}

test.describe('canvas stays smooth while Drive is slow', () => {
  test('drag on a busy page with 1.2 s Drive latency', async ({ page }) => {
    test.setTimeout(120_000);
    const d = new FakeDrive();
    await page.context().route(CONTENT_HOSTS, (r) => r.fulfill({ status: 503, body: 'offline in tests' }));
    await d.install(page);
    await page.goto('/');
    await fakeSignIn(page);
    await page.getByTestId('preset-instagram-post').click();
    await page.waitForFunction(() => !!(window as any).__dc);
    await busyPage(page);
    await expect(page.getByTestId('save-state')).toContainText('Saved', { timeout: 60_000 });
    await page.waitForTimeout(3000); // the first (cold) thumbnail and strip are done
    d.latencyMs = 1200;
    const r = await dragAndMeasure(page);
    console.log('drive', JSON.stringify(r));
    expect(r.long.filter((t) => t > LONG_MS), `long tasks ${r.long}`).toEqual([]);
  });

  test('same drag, this browser (baseline)', async ({ page }) => {
    test.setTimeout(120_000);
    await newDesign(page);
    await busyPage(page);
    const r = await dragAndMeasure(page);
    console.log('browser', JSON.stringify(r));
    expect(r.long.filter((t) => t > LONG_MS), `long tasks ${r.long}`).toEqual([]);
  });
});

test.describe('a real heavy design (opt-in: DC_PERF_DESIGN=<file.dcanvas>)', () => {
  const file = process.env.DC_PERF_DESIGN;
  test.skip(!file, 'set DC_PERF_DESIGN');
  test('drag + where the save time goes', async ({ page }) => {
    test.setTimeout(240_000);
    const { readFileSync } = await import('node:fs');
    const d = new FakeDrive();
    await page.context().route(CONTENT_HOSTS, (r) => r.fulfill({ status: 503, body: 'offline in tests' }));
    await d.install(page);
    await page.goto('/');
    await fakeSignIn(page);
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('open-file').click();
    await (await chooser).setFiles({ name: 'heavy.dcanvas', mimeType: 'application/zip', buffer: readFileSync(file!) });
    await page.waitForFunction(() => !!(window as any).__dc, null, { timeout: 120_000 });
    await expect(page.getByTestId('save-state')).toContainText('Saved', { timeout: 120_000 });
    await page.waitForTimeout(2000);
    const parts = await page.evaluate(async () => {
      const ed = (window as any).__dc;
      const t = (fn: () => unknown) => { const a = performance.now(); fn(); return Math.round(performance.now() - a); };
      const m = await import('/@fs' + '/Users/panth977/Dev/PROJECTS/DigitalCanvas/packages/storage/src/index.ts').catch(() => null);
      const s = await import('/@fs' + '/Users/panth977/Dev/PROJECTS/DigitalCanvas/packages/scene/src/index.ts').catch(() => null);
      return {
        thumbnail: t(() => ed.thumbnail()),
        thumbnailAgain: t(() => { ed.commit({ ...ed.doc, pages: [{ ...ed.doc.pages[0] }, ...ed.doc.pages.slice(1)] }); ed.thumbnail(); }),
        workerThumbMainThread: await (async () => { ed.commit({ ...ed.doc, pages: [{ ...ed.doc.pages[0] }, ...ed.doc.pages.slice(1)] }); const a = performance.now(); const pr = ed.thumbnailInBackground(); const sync = performance.now() - a; const b = await pr; return `${Math.round(sync)}ms sync, ${Math.round(performance.now() - a)}ms total, ${b.length}B`; })(),
        stripPage: t(() => ed.renderer.exportPage(ed.doc, ed.doc.pages[1] ?? ed.doc.pages[0], { format: 'png', scale: 0.05, preview: true })),
        prune: s ? t(() => s.pruneAssets(s.pruneFonts(ed.doc))) : -1,
        pack: m ? t(() => m.pack({ doc: ed.doc, assets: new Map(), thumbnail: undefined })) : -1,
        stringify: t(() => JSON.stringify(ed.doc)),
        exportDcanvas: t(() => ed.exportDcanvas()),
      };
    });
    console.log('parts', JSON.stringify(parts));
    d.latencyMs = 1200;
    const r = await dragAndMeasure(page);
    console.log('heavy', JSON.stringify(r));
  });
});
