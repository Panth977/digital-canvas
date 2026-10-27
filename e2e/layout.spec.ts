import { expect, test, type Page } from '@playwright/test';
import { doc, drag, elements, newDesign, selectionCenter } from './helpers.ts';

/** Place elements of page 1 exactly (by index), as one undo step. */
async function place(page: Page, boxes: { x: number; y: number; w: number; h: number }[]): Promise<void> {
  await page.evaluate((boxes) => {
    const ed = (window as any).__dc;
    ed.page.elements.forEach((e: any, i: number) => boxes[i] && ed.update(boxes[i], null, [e.id]));
    ed.seal();
  }, boxes);
}

/** Screen point of a page-1 point, from the selection outline of an element whose page box is known. */
async function screenOf(page: Page, box: { x: number; y: number; w: number; h: number }, p: { x: number; y: number }) {
  const pts = (await page.locator('svg.overlay polygon.sel').first().getAttribute('points'))!.split(' ').map((s) => s.split(',').map(Number));
  const stage = (await page.getByTestId('stage').boundingBox())!;
  const [tl, , br] = pts as [number[], number[], number[]];
  return {
    x: stage.x + tl[0]! + ((p.x - box.x) / box.w) * (br[0]! - tl[0]!),
    y: stage.y + tl[1]! + ((p.y - box.y) / box.h) * (br[1]! - tl[1]!),
  };
}

test('moving snaps to the page centre with a guide; Cmd/Ctrl places freely', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('shape-rect').click();
  const [r] = await elements(page); // added centred
  const c = await selectionCenter(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 40, c.y + 60, { steps: 4 });
  await page.mouse.move(c.x + 3, c.y + 120, { steps: 4 });
  await expect(page.locator('svg.overlay line.snap')).not.toHaveCount(0); // (a vertical line has no width, so not 'visible')
  await page.mouse.up();
  await expect(page.locator('svg.overlay line.snap')).toHaveCount(0);
  const [m] = await elements(page);
  expect(m!.x).toBeCloseTo(r!.x, 5); // pulled back to the centre line
  expect(m!.y).toBeGreaterThan(r!.y + 100);

  const c2 = await selectionCenter(page);
  await page.keyboard.down('ControlOrMeta');
  await drag(page, c2, { x: c2.x + 4, y: c2.y }); // inside the snap distance (3 px is the drag threshold)
  await page.keyboard.up('ControlOrMeta');
  const [f] = await elements(page);
  expect(f!.x - m!.x).toBeGreaterThan(2);
});

test('group, move as one, select a child by double-click, ungroup', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('shape-rect').click();
  await page.getByTestId('shape-ellipse').click();
  await place(page, [{ x: 100, y: 100, w: 200, h: 200 }, { x: 600, y: 500, w: 200, h: 200 }]);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+g');
  let els = await elements(page);
  expect(els).toHaveLength(1);
  expect(els[0]!.type).toBe('group');
  const g = els[0] as any;
  expect(g.children).toHaveLength(2);
  expect([g.x, g.y, g.w, g.h]).toEqual([100, 100, 700, 600]);
  await page.getByTestId('position-btn').click();
  await page.getByTestId('postab-layers').click();
  await expect(page.getByTestId('layer-group')).toBeVisible();
  await expect(page.getByTestId('layer-shape')).toHaveCount(2);

  // drag by the rectangle (the middle of the group is empty)
  const from = await screenOf(page, g, { x: 200, y: 200 });
  const to = await screenOf(page, g, { x: 300, y: 250 });
  // Cmd/Ctrl: place freely (the group's centre would land within snapping distance of the page centre)
  await page.keyboard.down('ControlOrMeta');
  await drag(page, from, to);
  await page.keyboard.up('ControlOrMeta');
  els = await elements(page);
  const moved = els[0] as any;
  expect(moved.x).toBeCloseTo(200, 0);
  expect(moved.children[0].x).toBeCloseTo(200, 0);
  expect(moved.children[1].x).toBeCloseTo(700, 0);
  expect(moved.children[1].y).toBeCloseTo(550, 0);

  // double-click steps into the group and picks the ellipse
  const ell = await screenOf(page, moved, { x: 800, y: 650 });
  await page.mouse.dblclick(ell.x, ell.y);
  const sel = await page.evaluate(() => (window as any).__dc.selection);
  expect(sel).toEqual([moved.children[1].id]);
  await expect(page.getByTestId('context-toolbar')).toHaveAttribute('data-kind', 'shape');

  // nudging the child refits the group
  await page.keyboard.press('Shift+ArrowRight');
  expect(((await elements(page))[0] as any).w).toBeCloseTo(710, 0);

  // back to the whole group, then ungroup
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const ed = (window as any).__dc; ed.select([ed.page.elements[0].id]); });
  await page.keyboard.press('ControlOrMeta+Shift+g');
  els = await elements(page);
  expect(els.map((e) => e.type)).toEqual(['shape', 'shape']);
  expect(els[0]!.x).toBeCloseTo(200, 0);
  await page.keyboard.press('ControlOrMeta+z');
  expect((await elements(page))[0]!.type).toBe('group');
});

test('distribute and tidy up from the position panel', async ({ page }) => {
  await newDesign(page);
  for (let i = 0; i < 3; i++) await page.getByTestId('shape-rect').click();
  await place(page, [{ x: 0, y: 100, w: 100, h: 100 }, { x: 150, y: 100, w: 100, h: 100 }, { x: 800, y: 100, w: 100, h: 100 }]);
  await page.keyboard.press('ControlOrMeta+a');
  await page.getByTestId('position-btn').click();
  await page.getByTestId('distribute-x').click();
  expect((await elements(page))[1]!.x).toBeCloseTo(400, 0);
  await place(page, [{ x: 0, y: 0, w: 100, h: 100 }, { x: 160, y: 30, w: 100, h: 100 }, { x: 600, y: -20, w: 100, h: 100 }]);
  await page.getByTestId('tidy-up').click();
  const els = await elements(page);
  expect(new Set(els.map((e) => Math.round(e.y))).size).toBe(1);
  expect(els[2]!.x - els[1]!.x).toBeCloseTo(els[1]!.x - els[0]!.x, 0);
});

test('rulers: drag out a guide, elements snap to it, drag it off to delete', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('file-menu').click();
  await page.getByTestId('view-rulers').check();
  await page.getByTestId('file-menu').click(); // close the menu
  const top = (await page.getByTestId('ruler-top').boundingBox())!;
  await expect(page.getByTestId('ruler-left')).toBeVisible();
  const stage = (await page.getByTestId('stage').boundingBox())!;
  const x = stage.x + stage.width - 120, y = stage.y + stage.height / 2 + 40;
  await drag(page, { x, y: top.y + 10 }, { x, y });
  let d = await doc(page);
  expect(d.pages[0].guides).toHaveLength(1);
  expect(d.pages[0].guides[0].axis).toBe('y');
  const pos = d.pages[0].guides[0].pos;
  expect(pos).toBeGreaterThan(0);
  expect(pos).toBeLessThan(d.height);
  await expect(page.locator('svg.overlay line.guide')).toHaveCount(1);

  // a shape dragged near the guide sits on it
  await page.getByTestId('shape-rect').click();
  const c = await selectionCenter(page);
  const [r] = await elements(page);
  const zoom = await page.evaluate(() => Number(document.querySelector('[data-testid=zoom]')!.textContent!.replace('%', '')) / 100);
  const want = c.y + (pos - (r!.y + r!.h)) * zoom + 2; // bottom edge 2 px below the guide
  await drag(page, c, { x: c.x + 37, y: want });
  const [s] = await elements(page);
  expect(s!.y + s!.h).toBeCloseTo(pos, 3);

  // grab the guide (left of the shape) and drop it on the ruler
  await page.keyboard.press('Escape');
  const line = page.locator('svg.overlay line.guide');
  const gx = stage.x + Number(await line.getAttribute('x1')) + 20, gy = stage.y + Number(await line.getAttribute('y1'));
  await drag(page, { x: gx, y: gy }, { x, y: top.y + 5 });
  d = await doc(page);
  expect(d.pages[0].guides ?? []).toHaveLength(0);
});

test('print bleed and margins can be shown', async ({ page }) => {
  await newDesign(page, 'business-card');
  await page.getByTestId('file-menu').click();
  await page.getByTestId('view-bleed').check();
  await page.getByTestId('view-margins').check();
  await expect(page.getByTestId('trim-line')).toHaveCount(1);
  await expect(page.getByTestId('margin-line')).toHaveCount(1);
  await page.getByTestId('view-bleed').uncheck();
  await expect(page.getByTestId('trim-line')).toHaveCount(0);
});

test('position panel: lock aspect ratio for width and height', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('shape-rect').click();
  await place(page, [{ x: 10, y: 10, w: 200, h: 100 }]);
  await page.getByTestId('position-btn').click();
  await page.getByTestId('lock-ratio').click();
  await page.getByTestId('pos-w').fill('400');
  const [e] = await elements(page);
  expect([e!.w, e!.h]).toEqual([400, 200]);
});

test('resize a copy to another preset', async ({ page }) => {
  await newDesign(page);
  await page.getByTestId('tab-text').click();
  await page.getByTestId('text-heading').click();
  const original = await doc(page);
  const fs = original.pages[0].elements[0].style.fontSize;
  await page.getByTestId('resize').click();
  await page.getByTestId('resize-search').fill('facebook cover');
  await page.getByTestId('resize-preset-facebook-cover').check();
  await page.getByTestId('resize-go').click();
  await expect(page.getByTestId('resize-made')).toBeVisible();
  await page.getByTestId('resize-open').click();
  await page.waitForFunction((id) => (window as any).__dc && (window as any).__dc.doc.id !== id, original.id);
  const d = await doc(page);
  expect([Math.round(d.width), Math.round(d.height)]).toEqual([851, 315]);
  expect(d.title).toContain('Facebook cover');
  const t = d.pages[0].elements[0];
  expect(t.style.fontSize).toBeCloseTo(fs * (315 / 1080), 1);
  expect(t.x + t.w / 2).toBeCloseTo(851 / 2, 0); // still centred
  // the original is untouched and both are listed
  await page.getByTestId('home').click();
  await expect(page.getByTestId('project-card')).toHaveCount(2);
});

test('home: search and filter presets', async ({ page }) => {
  await page.goto('/');
  const search = page.getByTestId('preset-search');
  await search.fill('pinterest');
  await expect(page.getByTestId('preset-pinterest-pin')).toBeVisible();
  await expect(page.getByTestId('preset-a4')).toHaveCount(0);
  await search.fill('');
  await page.getByTestId('category-Print').click();
  await expect(page.getByTestId('preset-business-card')).toBeVisible();
  await expect(page.getByTestId('preset-instagram-post')).toHaveCount(0);
  await search.fill('poster a2');
  await page.getByTestId('preset-poster-a2').click();
  await page.waitForFunction(() => !!(window as any).__dc);
  const d = await doc(page);
  expect(d.width).toBeCloseTo((420 / 25.4) * 96, 0);
  expect(d.unit).toBe('mm');
});
