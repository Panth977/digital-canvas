import { expect, test, type Page } from '@playwright/test';
import { newDesign } from './helpers.ts';

/**
 * During a drag the canvas draws what lies below and above the moving
 * elements from cached layers (Canvas.svelte `drawLayered`). The picture must
 * be the same as a normal full redraw.
 */
async function diff(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(async ([a, b]) => {
    const px = async (b64: string) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d')!;
      g.drawImage(bmp, 0, 0);
      return g.getImageData(0, 0, bmp.width, bmp.height).data;
    };
    const [x, y] = await Promise.all([px(a), px(b)]);
    let bad = 0;
    for (let i = 0; i < x.length; i += 4) if (Math.abs(x[i]! - y[i]!) + Math.abs(x[i + 1]! - y[i + 1]!) + Math.abs(x[i + 2]! - y[i + 2]!) > 24) bad++;
    return bad / (x.length / 4);
  }, [a.toString('base64'), b.toString('base64')] as const);
}

test('a drag draws from cached layers, and looks the same as a full redraw', async ({ page }) => {
  await newDesign(page);
  const ids = await page.evaluate(() => {
    const ed = (window as any).__dc;
    for (let i = 0; i < 6; i++) ed.addShape(i % 2 ? 'rect' : 'ellipse');
    ed.addText('heading');
    for (let i = 0; i < 4; i++) ed.addShape('rect');
    const els = ed.page.elements;
    els.forEach((e: any, i: number) => { ed.select([e.id], ed.pageId); ed.update({ x: 40 + (i % 4) * 230, y: 40 + Math.floor(i / 4) * 300, w: 260, h: 260, fill: { type: 'solid', color: ['#e5484d', '#30a46c', '#0090ff', '#ffb224'][i % 4] } }); });
    ed.seal();
    return els.map((e: any) => e.id);
  });
  const mid = ids[6]; // the heading: shapes below and above it
  const stage = page.getByTestId('canvas');
  // a drag in progress: a coalesced change that is not sealed yet
  await page.evaluate((id) => { const ed = (window as any).__dc; ed.select([id], ed.pageId); ed.commit(ed.doc, null); ed.update({ x: 300, y: 320 }, 'drag:test'); }, mid);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  expect(await page.evaluate(() => (window as any).__dc.busy)).toBe(true);
  expect(await page.evaluate(() => (window as any).__dcView.get().layered)).toBe(true);
  const during = await stage.screenshot();
  await page.evaluate(() => { const ed = (window as any).__dc; ed.seal(); ed.frame++; });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const after = await stage.screenshot();
  expect(await page.evaluate(() => (window as any).__dcView.get().layered)).toBe(false);
  expect(await diff(page, during, after)).toBeLessThan(0.002);
});
