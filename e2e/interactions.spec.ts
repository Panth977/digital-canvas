import { expect, test, type Page } from '@playwright/test';
import { drag, elements, handle, newDesign, selectionCenter } from './helpers.ts';

/** Make a multi-size, multi-line text box (like Panth's "PURE / GHEE & KAJU / SWEETS") and select it. */
async function richBox(page: Page, opts: { lineHeight?: number; align?: string; list?: string } = {}): Promise<string> {
  return page.evaluate((o) => {
    const ed = (window as any).__dc;
    ed.addText('heading');
    const id = ed.selection[0];
    const el = ed.selected[0];
    ed.update({ w: 520, style: { ...el.style, bold: false, fontSize: 40, lineHeight: o.lineHeight ?? 0.9, align: o.align ?? 'center', letterSpacing: 1.5 }, ...(o.list ? { list: o.list } : {}) }, null, [id]);
    const text = 'pure\nGHEE & KAJU\n\nsweets made fresh every single morning in our kitchen';
    ed.setRich(id, text, [
      { text: 'pure\n', style: { fontSize: 18, uppercase: true, italic: true } },
      { text: 'GHEE & KAJU\n\n', style: { fontSize: 64, bold: true } },
      { text: 'sweets made fresh every single morning in our kitchen', style: { fontSize: 26, letterSpacing: 4 } },
    ]);
    ed.seal();
    ed.select([id]);
    return id;
  }, opts);
}

/** Every character's box in the in-place editor and on the canvas, in screen px. */
async function compareLayouts(page: Page, id: string) {
  return page.evaluate((id) => {
    const ed = (window as any).__dc;
    const root = document.querySelector('[data-testid="text-editor"]') as HTMLElement;
    const stage = document.querySelector('[data-testid="stage"]')!.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    const el = ed.selected.find((e: any) => e.id === id) ?? ed.doc.pages[0].elements.find((e: any) => e.id === id);
    const zoom = box.width / el.w;
    const sk: any[] = ed.renderer.textCharRects(el);
    const dom: (DOMRect | null)[] = [];
    [...root.children].forEach((line, k) => {
      if (k > 0) dom.push(null); // the line break
      for (const span of line.querySelectorAll('span')) {
        const t = span.firstChild as Text;
        for (let i = 0; i < t.length; i++) {
          const r = document.createRange();
          r.setStart(t, i); r.setEnd(t, i + 1);
          const rs = [...r.getClientRects()].filter((x) => x.width > 0 || x.height > 0);
          dom.push(rs[rs.length - 1] ?? null);
        }
      }
    });
    let maxX = 0, maxY = 0, n = 0;
    const bad: string[] = [];
    sk.forEach((s, i) => {
      const d = dom[i];
      if (!s || !d || s.w < 0.01 || el.text[i] === ' ') return;
      n++;
      const sx = box.left + s.x * zoom, sy = box.top + (s.y + s.h / 2) * zoom;
      const dx = Math.abs(sx - d.left), dy = Math.abs(sy - (d.top + d.height / 2));
      if (dx > 2 || dy > 2) bad.push(`${i}:${el.text[i]} dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`);
      maxX = Math.max(maxX, dx); maxY = Math.max(maxY, dy);
    });
    return { n, maxX, maxY, bad: bad.slice(0, 12), domLen: dom.length, len: el.text.length, stageTop: stage.top };
  }, id);
}

test('text: the in-place editor lays a multi-size box out exactly like the canvas', async ({ page }) => {
  await newDesign(page);
  for (const opts of [{}, { lineHeight: 1.6, align: 'left' }, { lineHeight: 0.75, align: 'right' }, { list: 'bullet', align: 'left' }]) {
    const id = await richBox(page, opts);
    const c = await selectionCenter(page);
    await page.mouse.dblclick(c.x, c.y);
    await expect(page.getByTestId('text-editor')).toBeVisible();
    const r = await compareLayouts(page, id);
    expect(r.domLen).toBe(r.len);
    expect(r.n).toBeGreaterThan(40);
    expect(r.bad).toEqual([]);
    if (!opts.list && opts.lineHeight === undefined) await page.screenshot({ path: '/tmp/orch27-rw/r3-interact-text-edit.png' });
    if (!opts.list && opts.lineHeight === undefined) {
      // typing a new line (the browser's own DOM) still lines up once rebuilt
      await page.evaluate(() => document.getSelection()!.collapseToEnd());
      await page.keyboard.press('Enter');
      await page.keyboard.type('more');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await page.keyboard.type('end');
      const after = await compareLayouts(page, id);
      expect(after.len).toBe(r.len + 10); // \nmore\n\nend
      expect(after.domLen).toBe(after.len);
      expect(after.bad).toEqual([]);
    }
    await page.keyboard.press('Escape');
    await page.evaluate(() => (window as any).__dc.deleteSelection());
  }
});

/** Screen point of a point on page 1 (from the page header, which sits 34 px above the page and is as wide). */
async function at(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const bar = (await page.getByTestId('page-header').first().boundingBox())!;
  const W = await page.evaluate(() => (window as any).__dc.doc.width);
  const z = bar.width / W;
  return { x: bar.x + x * z, y: bar.y + 34 + y * z };
}

/** Three shapes at known places (page 1080 × 1080): a page-size backdrop, and two squares on it. */
async function scene(page: Page): Promise<string[]> {
  await newDesign(page);
  return page.evaluate(() => {
    const ed = (window as any).__dc;
    const ids: string[] = [];
    for (const box of [{ x: 0, y: 0, w: 1080, h: 1080 }, { x: 200, y: 200, w: 200, h: 200 }, { x: 600, y: 600, w: 200, h: 200 }]) {
      ed.addShape('rect');
      const id = ed.selection[0];
      ed.update(box, null, [id]);
      ids.push(id);
    }
    ed.seal();
    ed.select([]);
    return ids;
  });
}

async function modClick(page: Page, p: { x: number; y: number }, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.up(key);
}

const sel = (page: Page) => page.evaluate(() => (window as any).__dc.selection as string[]);

test('open a design from Home in the same tab', async ({ page, context }) => {
  await newDesign(page);
  const id = await page.evaluate(() => (window as any).__dc.doc.id);
  await page.getByTestId('home').click();
  const open = page.getByTestId('project-open').first();
  await expect(open).toHaveAttribute('href', `#/d/${id}`);
  expect(await open.getAttribute('target')).toBeNull();
  await open.click();
  await expect(page).toHaveURL(new RegExp(`#/d/${id}$`));
  await expect(page.getByTestId('canvas')).toBeVisible();
  expect(context.pages()).toHaveLength(1);
});

test('drag on an unselected element draws a selection box; only the selection moves', async ({ page }) => {
  const [bg, a, b] = await scene(page);
  const before = await elements(page);
  // press on the backdrop (not selected) and drag across both squares: a selection box, nothing moves
  const p0 = await at(page, 150, 150), p1 = await at(page, 650, 650);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  await page.mouse.move(p1.x, p1.y, { steps: 6 });
  await expect(page.locator('svg.overlay rect.marquee')).toHaveCount(1);
  await page.mouse.up();
  expect(await elements(page)).toEqual(before);
  expect((await sel(page)).sort()).toEqual([a, b].sort()); // the backdrop holds the whole box: not picked
  await page.screenshot({ path: '/tmp/orch27-rw/r3-interact-marquee.png' });

  // drag on an unselected square: it does not move (selection box instead)
  await page.keyboard.press('Escape');
  const c = await at(page, 300, 300);
  await drag(page, c, { x: c.x + 80, y: c.y + 80 });
  expect((await elements(page))[1]).toEqual(before[1]);
  // click selects it (topmost), then a drag moves it
  await page.mouse.click(c.x, c.y);
  expect(await sel(page)).toEqual([a]);
  await drag(page, c, { x: c.x + 80, y: c.y + 40 });
  const moved = (await elements(page))[1]!;
  expect(moved.x).toBeGreaterThan(before[1]!.x + 50);
  expect((await elements(page))[0]).toEqual(before[0]); // the backdrop stayed

  // a locked element is never dragged and never picked by the selection box
  await page.evaluate((id) => { const ed = (window as any).__dc; ed.update({ locked: true }, null, [id]); ed.seal(); }, b);
  const q0 = await at(page, 560, 560), q1 = await at(page, 900, 900);
  await drag(page, q0, q1);
  expect(await sel(page)).toEqual([]);
  const lc = await at(page, 700, 700);
  await page.mouse.click(lc.x, lc.y);
  expect(await sel(page)).toEqual([b]);
  await drag(page, lc, { x: lc.x + 60, y: lc.y });
  expect((await elements(page))[2]!.x).toBe(600);
  void bg;
});

test('shift-click toggles, Cmd/Ctrl-click picks the element behind, empty workspace deselects, page click outlines the page', async ({ page }) => {
  const [bg, a, b] = await scene(page);
  const pa = await at(page, 300, 300), pb = await at(page, 700, 700);
  await page.mouse.click(pa.x, pa.y);
  await modClick(page, pb, 'Shift');
  expect(await sel(page)).toEqual([a, b]);
  await modClick(page, pa, 'Shift');
  expect(await sel(page)).toEqual([b]);
  // Cmd/Ctrl-click: the square, then the backdrop behind it, then round again
  await page.keyboard.press('Escape');
  await modClick(page, pa, 'ControlOrMeta');
  expect(await sel(page)).toEqual([a]);
  await modClick(page, pa, 'ControlOrMeta');
  expect(await sel(page)).toEqual([bg]);
  await modClick(page, pa, 'ControlOrMeta');
  expect(await sel(page)).toEqual([a]);
  // the workspace (outside the page) clears the selection
  const stage = (await page.getByTestId('stage').boundingBox())!;
  const left = await at(page, 0, 500);
  await page.mouse.click((stage.x + left.x) / 2, left.y);
  expect(await sel(page)).toEqual([]);
  await expect(page.getByTestId('current-page')).toHaveCount(0);
  // the page's own background: page selected (purple outline) once nothing covers it
  await page.evaluate((id) => (window as any).__dc.update({ hidden: true }, null, [id]), bg);
  await page.mouse.click((await at(page, 900, 100)).x, (await at(page, 900, 100)).y);
  await expect(page.getByTestId('current-page')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('current-page')).toHaveCount(0);
});

test('alt-drag moves a copy; hover outline; resize and rotate readouts', async ({ page }) => {
  const [, a] = await scene(page);
  const pa = await at(page, 300, 300);
  await page.mouse.move(pa.x, pa.y);
  await expect(page.locator('svg.overlay polygon.hover')).toHaveCount(1);
  await page.mouse.click(pa.x, pa.y);
  await expect(page.locator('svg.overlay polygon.hover')).toHaveCount(0); // selected: outline, not hover
  await page.keyboard.down('Alt');
  await drag(page, pa, { x: pa.x + 120, y: pa.y });
  await page.keyboard.up('Alt');
  const els = await elements(page);
  expect(els).toHaveLength(4);
  expect(els[1]!.x).toBe(200); // the original stays
  expect(els[3]!.x).toBeGreaterThan(260);
  expect((await sel(page))[0]).not.toBe(a);

  // resize: a "w × h" readout follows the pointer
  const se = await handle(page, 2);
  await page.mouse.move(se.x, se.y);
  await page.mouse.down();
  await page.mouse.move(se.x + 40, se.y + 40, { steps: 4 });
  await expect(page.getByTestId('drag-tip')).toHaveText(/^w \d+ × h \d+$/);
  await page.screenshot({ path: '/tmp/orch27-rw/r3-interact-resize.png' });
  await page.mouse.up();
  await expect(page.getByTestId('drag-tip')).toHaveCount(0);
  // rotate: degrees
  const rot = (await page.locator('svg.overlay g.rot').boundingBox())!;
  const c = await selectionCenter(page);
  await page.mouse.move(rot.x + rot.width / 2, rot.y + rot.height / 2);
  await page.mouse.down();
  await page.mouse.move(c.x + 200, c.y, { steps: 4 });
  await expect(page.getByTestId('drag-tip')).toHaveText(/^\d+°$/);
  await page.mouse.up();
});

test('keyboard: nudge, duplicate, copy/paste, delete, select all, tab, add elements and pages', async ({ page }) => {
  const [, a] = await scene(page);
  const pa = await at(page, 300, 300);
  await page.mouse.click(pa.x, pa.y);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  let el = (await elements(page))[1]!;
  expect([el.x, el.y]).toEqual([201, 210]);
  await page.keyboard.press('ControlOrMeta+d');
  expect(await elements(page)).toHaveLength(4);
  await page.keyboard.press('ControlOrMeta+c');
  await page.keyboard.press('ControlOrMeta+v');
  expect(await elements(page)).toHaveLength(5);
  await page.keyboard.press('Delete');
  expect(await elements(page)).toHaveLength(4);
  await page.keyboard.press('Shift+Tab'); // the last element
  await page.keyboard.press('Backspace');
  expect(await elements(page)).toHaveLength(3);
  await page.keyboard.press('ControlOrMeta+a');
  expect(await sel(page)).toHaveLength(3);
  await page.keyboard.press('Escape');
  expect(await sel(page)).toEqual([]);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  expect(await sel(page)).toEqual([a]);
  for (const [k, type] of [['t', 'text'], ['r', 'shape'], ['c', 'shape'], ['l', 'line']] as const) {
    const n = (await elements(page)).length;
    await page.keyboard.press('Escape');
    await page.keyboard.press(k);
    const els = await elements(page);
    expect(els).toHaveLength(n + 1);
    expect(els[n]!.type).toBe(type);
  }
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+Enter');
  expect((await page.evaluate(() => (window as any).__dc.doc.pages.length))).toBe(2);
  // ⌘⌫ on the new, empty page deletes it
  await page.keyboard.press('ControlOrMeta+Backspace');
  expect((await page.evaluate(() => (window as any).__dc.doc.pages.length))).toBe(1);
  el = (await elements(page))[0]!;
  expect(el).toBeTruthy();
});

test('text: a click on a selected text box puts the caret there; double-click selects all; Cmd+Shift+K uppercases', async ({ page }) => {
  await newDesign(page);
  await page.evaluate(() => (window as any).__dc.addText('heading'));
  await page.keyboard.press('Escape');
  const c = await at(page, 540, 540);
  const box = await page.evaluate(() => { const e = (window as any).__dc.page.elements[0]; return { x: e.x, y: e.y, w: e.w, h: e.h }; });
  // near the end of the line (the side handle sits on the edge itself)
  const end = await at(page, box.x + box.w - 40, box.y + box.h / 2);
  await page.mouse.click(c.x, c.y); // select
  await expect(page.getByTestId('text-editor')).toHaveCount(0);
  await page.mouse.click(end.x, end.y); // click again: edit, caret at the end
  await expect(page.getByTestId('text-editor')).toBeVisible();
  const r = await page.evaluate(() => (window as any).__dc.textSel);
  const len = await page.evaluate(() => (window as any).__dc.page.elements[0].text.length);
  expect(r.start).toBe(r.end);
  expect(r.start).toBeGreaterThan(len - 5); // by the last letters, not the start (a double-click would select all)
  await page.keyboard.type('!');
  const typed = 'Add a heading'.slice(0, r.start) + '!' + 'Add a heading'.slice(r.start);
  expect(await page.evaluate(() => (window as any).__dc.page.elements[0].text)).toBe(typed);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.mouse.dblclick(c.x, c.y);
  await expect(page.getByTestId('text-editor')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__dc.textSel)).toEqual({ start: 0, end: typed.length });
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+Shift+K');
  expect(await page.evaluate(() => (window as any).__dc.page.elements[0].style.uppercase)).toBe(true);
});

test('view: pinch / Cmd+wheel zooms, Cmd +/- and Cmd+0, space-drag pans', async ({ page }) => {
  await newDesign(page);
  const zoomText = () => page.getByTestId('stage').evaluate(() => document.body.innerText.match(/(\d+)%/)?.[1]);
  const z0 = Number(await zoomText());
  const stage = (await page.getByTestId('stage').boundingBox())!;
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.keyboard.down('Control'); // a trackpad pinch arrives as Ctrl+wheel
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await expect.poll(async () => Number(await zoomText())).toBeGreaterThan(z0);
  await page.keyboard.press('ControlOrMeta+0');
  await expect.poll(async () => Number(await zoomText())).toBe(z0);
  await page.keyboard.press('ControlOrMeta+=');
  await expect.poll(async () => Number(await zoomText())).toBeGreaterThan(z0);
  await page.keyboard.press('ControlOrMeta+0');
  // space + drag pans the view (the page header moves with it)
  const before = (await page.getByTestId('page-header').first().boundingBox())!;
  await page.keyboard.down('Space');
  await drag(page, { x: stage.x + 100, y: stage.y + 300 }, { x: stage.x + 160, y: stage.y + 340 });
  await page.keyboard.up('Space');
  const after = (await page.getByTestId('page-header').first().boundingBox())!;
  expect(after.x - before.x).toBeCloseTo(60, 0);
  expect(await page.evaluate(() => (window as any).__dc.page.elements.length)).toBe(0);
});
