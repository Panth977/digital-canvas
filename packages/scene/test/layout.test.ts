import { describe, expect, it } from 'vitest';
import {
  PRESETS, PRESET_CATEGORIES, addElements, addGuide, aabb, arrange, createDoc, distribute, duplicateElements, duplicatePage, findElement, groupElements,
  hitTest, hitTestAll, hitTestPath, marqueePick, moveGuide, parseDoc, pruneAssets, removeElements, removeGuide, resizeDoc, safeMargin, searchPresets, shape, snapMove, snapResize,
  snapTargets, text, tidyUp, toPx, ungroupElements, updateElements, image, MIN_SIDE, MAX_SIDE,
  type Doc, type Element, type GroupElement,
} from '../src/index.ts';

const page = (d: Doc) => d.pages[0]!;
const els = (d: Doc) => page(d).elements;
const get = (d: Doc, id: string) => findElement(d, id)!.element;

function docWith(...e: Element[]): Doc {
  const d = createDoc({ width: 1000, height: 800 });
  return addElements(d, d.pages[0]!.id, e);
}

describe('snapping', () => {
  const t = snapTargets(1000, 800, [{ x: 100, y: 100, w: 200, h: 100 }]);

  it('snaps to the page centre and draws a full-height guide', () => {
    const r = snapMove({ x: 447, y: 600, w: 100, h: 50 }, t, 6);
    expect(r.dx).toBeCloseTo(3); // centre 497 → 500
    expect(r.guides).toContainEqual({ axis: 'x', pos: 500, from: 0, to: 800 });
  });

  it('snaps edges to another element and stretches the guide over both', () => {
    const r = snapMove({ x: 296, y: 400, w: 50, h: 50 }, t, 6);
    expect(r.dx).toBeCloseTo(4); // left 296 → right edge 300
    const g = r.guides.find((g) => g.axis === 'x' && g.pos === 300)!;
    expect(g.from).toBe(100);
    expect(g.to).toBe(450);
  });

  it('leaves far moves alone', () => {
    const r = snapMove({ x: 620, y: 333, w: 50, h: 50 }, t, 6);
    expect([r.dx, r.dy, r.guides.length]).toEqual([0, 0, 0]);
  });

  it('finds equal spacing between neighbours', () => {
    const rects = [{ x: 0, y: 0, w: 100, h: 100 }, { x: 150, y: 0, w: 100, h: 100 }];
    const tt = snapTargets(5000, 5000, rects);
    const r = snapMove({ x: 297, y: 10, w: 100, h: 80 }, tt, 6);
    expect(r.dx).toBeCloseTo(3); // 250 + 50 gap = 300
    expect(r.gaps.filter((g) => g.axis === 'x')).toHaveLength(2);
    expect(r.gaps.every((g) => Math.abs(g.to - g.from - 50) < 1e-6)).toBe(true);
  });

  it('snaps to ruler guides', () => {
    const tg = snapTargets(1000, 800, [], [{ axis: 'y', pos: 333 }]);
    expect(snapMove({ x: 10, y: 330, w: 20, h: 20 }, tg, 6).dy).toBeCloseTo(3);
  });

  it('snaps a resized edge, and keeps the ratio from the fixed corner', () => {
    const a = snapResize({ x: 100, y: 100, w: 397, h: 100 }, 'e', snapTargets(1000, 800, []), 6);
    expect(a.rect.w).toBeCloseTo(400); // right edge to the page centre
    expect(a.guides[0]).toMatchObject({ axis: 'x', pos: 500 });
    const b = snapResize({ x: 100, y: 100, w: 397, h: 397 }, 'se', snapTargets(1000, 800, []), 6, true);
    expect(b.rect.w).toBeCloseTo(400);
    expect(b.rect.h).toBeCloseTo(400);
    expect([b.rect.x, b.rect.y]).toEqual([100, 100]);
  });
});

describe('groups', () => {
  const a = shape('rect', { x: 100, y: 100, w: 100, h: 100 });
  const b = shape('ellipse', { x: 300, y: 200, w: 100, h: 100 });
  const c = text('hi', { x: 600, y: 600, w: 100, h: 40 }, { fontSize: 20 });

  function grouped() {
    const g = groupElements(docWith(a, b, c), [a.id, b.id])!;
    return { doc: g.doc, id: g.id, g: get(g.doc, g.id) as GroupElement };
  }

  it('groups siblings into one element at the topmost place, box = union', () => {
    const { doc, g } = grouped();
    expect(els(doc).map((e) => e.type)).toEqual(['group', 'text']);
    expect(g.children.map((e) => e.id)).toEqual([a.id, b.id]);
    expect([g.x, g.y, g.w, g.h]).toEqual([100, 100, 300, 200]);
    expect(findElement(doc, b.id)!.parent?.id).toBe(g.id);
    expect(groupElements(doc, [c.id])).toBeNull();
  });

  it('moving a group moves its children', () => {
    const { doc, id } = grouped();
    const d = updateElements(doc, [id], (e) => ({ x: e.x + 50, y: e.y - 10 }));
    expect(get(d, a.id)).toMatchObject({ x: 150, y: 90 });
    expect(get(d, b.id)).toMatchObject({ x: 350, y: 190 });
  });

  it('resizing a group scales children and their text', () => {
    let doc = grouped().doc;
    const g = groupElements(doc, [els(doc)[0]!.id, c.id])!;
    doc = g.doc;
    const G = get(doc, g.id);
    doc = updateElements(doc, [g.id], { w: G.w * 2, h: G.h * 2 });
    expect(get(doc, a.id)).toMatchObject({ x: 100, y: 100, w: 200, h: 200 });
    expect((get(doc, c.id) as typeof c).style.fontSize).toBe(40);
  });

  it('rotating a group turns children around its centre', () => {
    const { doc, id, g } = grouped();
    const d = updateElements(doc, [id], { rotation: 90 });
    const A = get(d, a.id);
    expect(A.rotation).toBe(90);
    // a's centre (150,150) around the group centre (250,200) by 90° → (300,100)
    expect(A.x + A.w / 2).toBeCloseTo(300);
    expect(A.y + A.h / 2).toBeCloseTo(100);
    expect(get(d, id).w).toBe(g.w); // the box keeps its size, it is rotated
  });

  it('flipping a group mirrors children', () => {
    const { doc, id } = grouped();
    const d = updateElements(doc, [id], { flipX: true });
    expect(get(d, a.id)).toMatchObject({ x: 300, flipX: true });
    expect(get(d, b.id)).toMatchObject({ x: 100 });
  });

  it('editing a child refits the group; removing all children removes it', () => {
    const { doc, id } = grouped();
    const d = updateElements(doc, [b.id], { x: 500 });
    expect(get(d, id)).toMatchObject({ x: 100, w: 500 });
    const e = removeElements(d, [a.id, b.id]);
    expect(findElement(e, id)).toBeNull();
  });

  it('ungroup puts children back in place, with the group opacity', () => {
    const { doc, id } = grouped();
    const u = ungroupElements(updateElements(doc, [id], { opacity: 0.5 }), [id]);
    expect(u.ids).toEqual([a.id, b.id]);
    expect(els(u.doc).map((e) => e.id)).toEqual([a.id, b.id, c.id]);
    expect(get(u.doc, a.id).opacity).toBe(0.5);
  });

  it('hit testing goes through children', () => {
    const { doc, id } = grouped();
    expect(hitTest(page(doc), { x: 150, y: 150 })?.id).toBe(id);
    expect(hitTest(page(doc), { x: 250, y: 250 })).toBeNull(); // inside the box, between children
    expect(hitTestPath(page(doc), { x: 350, y: 250 })?.map((e) => e.id)).toEqual([id, b.id]);
  });

  it('hitTestAll lists every element under a point, topmost first', () => {
    const bg = shape('rect', { x: 0, y: 0, w: 1000, h: 800 });
    const top = shape('rect', { x: 100, y: 100, w: 100, h: 100 });
    const d = docWith(bg, top);
    expect(hitTestAll(page(d), { x: 150, y: 150 }).map((p) => p.map((e) => e.id))).toEqual([[top.id], [bg.id]]);
  });

  it('marquee picks touched, unlocked elements but not a backdrop that holds the whole box', () => {
    const bg = shape('rect', { x: 0, y: 0, w: 1000, h: 800 });
    const s1 = shape('rect', { x: 100, y: 100, w: 100, h: 100 });
    const s2 = { ...shape('rect', { x: 300, y: 100, w: 100, h: 100 }), locked: true };
    const s3 = shape('rect', { x: 600, y: 600, w: 100, h: 100 });
    const d = docWith(bg, s1, s2, s3);
    expect(marqueePick(page(d), { x: 150, y: 50, w: 300, h: 100 }).map((e) => e.id)).toEqual([s1.id]);
    expect(marqueePick(page(d), { x: -10, y: -10, w: 1100, h: 900 }).map((e) => e.id)).toEqual([bg.id, s1.id, s3.id]);
  });

  it('duplicate, duplicate page and arrange recurse with fresh ids', () => {
    const { doc, id } = grouped();
    const dup = duplicateElements(doc, [id]);
    const copy = get(dup.doc, dup.ids[0]!) as GroupElement;
    expect(copy.children.map((e) => e.id)).not.toContain(a.id);
    expect(copy.children[0]).toMatchObject({ x: 120, y: 120 });
    const dp = duplicatePage(doc, page(doc).id);
    const pg = dp.doc.pages[1]!.elements[0] as GroupElement;
    expect(pg.children[0]!.id).not.toBe(a.id);
    const ar = arrange(doc, [a.id], 'front');
    expect((get(ar, id) as GroupElement).children.map((e) => e.id)).toEqual([b.id, a.id]);
    const inGroup = duplicateElements(doc, [b.id]);
    expect((get(inGroup.doc, id) as GroupElement).children).toHaveLength(3);
  });

  it('assets inside groups are kept, and groups survive parsing', () => {
    const img = image('pic', { x: 0, y: 0, w: 10, h: 10 });
    const d0 = { ...docWith(img, a), assets: { pic: { mime: 'image/png' }, junk: { mime: 'image/png' } } };
    const g = groupElements(d0, [img.id, a.id])!.doc;
    expect(Object.keys(pruneAssets(g).assets)).toEqual(['pic']);
    expect(parseDoc(JSON.parse(JSON.stringify(g))).pages[0]!.elements[0]!.type).toBe('group');
  });
});

describe('distribute and tidy up', () => {
  const r = (x: number, y: number, w = 50, h = 50) => shape('rect', { x, y, w, h });

  it('distributes horizontally with equal gaps, ends fixed', () => {
    const [p, q, s] = [r(0, 0), r(70, 30), r(400, 10)];
    const d = distribute(docWith(p, q, s), [p.id, q.id, s.id], 'x');
    expect(get(d, p.id).x).toBe(0);
    expect(get(d, s.id).x).toBe(400);
    expect(get(d, q.id).x).toBeCloseTo(200);
    expect(get(d, q.id).y).toBe(30);
  });

  it('distributes vertically', () => {
    const [p, q, s] = [r(0, 0), r(0, 10), r(0, 300)];
    expect(get(distribute(docWith(p, q, s), [p.id, q.id, s.id], 'y'), q.id).y).toBeCloseTo(150);
  });

  it('tidies a rough row into an even, aligned row', () => {
    const [p, q, s] = [r(0, 0), r(80, 10), r(200, -5)];
    const d = tidyUp(docWith(p, q, s), [p.id, q.id, s.id]);
    const xs = [p, q, s].map((e) => get(d, e.id));
    expect(xs[1]!.x - (xs[0]!.x + 50)).toBeCloseTo(xs[2]!.x - (xs[1]!.x + 50));
    expect(new Set(xs.map((e) => e.y)).size).toBe(1);
  });

  it('tidies scattered elements into a grid', () => {
    const all = [r(0, 0), r(500, 20), r(30, 400), r(600, 500)];
    const d = tidyUp(docWith(...all), all.map((e) => e.id));
    const pos = all.map((e) => get(d, e.id));
    expect(pos[1]!.y).toBe(pos[0]!.y);
    expect(pos[2]!.x).toBe(pos[0]!.x);
    expect(pos[3]!.x).toBe(pos[1]!.x);
  });
});

describe('guides and margins', () => {
  it('add, move, remove', () => {
    const d = createDoc({ width: 500, height: 500 });
    const pid = d.pages[0]!.id;
    const a = addGuide(d, pid, { axis: 'x', pos: 100 });
    expect(a.doc.pages[0]!.guides).toEqual([{ axis: 'x', pos: 100 }]);
    const m = moveGuide(a.doc, pid, a.index, 120);
    expect(m.pages[0]!.guides![0]!.pos).toBe(120);
    expect(removeGuide(m, pid, 0).pages[0]!.guides).toBeUndefined();
  });

  it('safe margin: 5 mm in print, 5% on screen', () => {
    expect(safeMargin(createDoc({ width: 85, height: 55, unit: 'mm', print: true }))).toBeCloseTo(toPx(5, 'mm'));
    expect(safeMargin(createDoc({ width: 1080, height: 1920 }))).toBe(54);
  });
});

describe('resize a copy', () => {
  it('scales by the smaller ratio and centres; fonts scale; backgrounds cover', () => {
    const d0 = createDoc({ width: 1000, height: 1000, title: 'Post' });
    const t = text('Hello', { x: 100, y: 100, w: 400, h: 50 }, { fontSize: 40 });
    const bg = shape('rect', { x: 0, y: 0, w: 1000, h: 1000 });
    const d = addElements(d0, d0.pages[0]!.id, [bg, t]);
    const r = resizeDoc(d, { width: 1080, height: 1920, title: 'Post (story)' });
    expect(r.id).not.toBe(d.id);
    expect([r.width, r.height, r.title]).toEqual([1080, 1920, 'Post (story)']);
    const T = r.pages[0]!.elements[1] as typeof t;
    const s = 1.08;
    expect(T.x).toBeCloseTo(100 * s);
    expect(T.y).toBeCloseTo(100 * s + (1920 - 1000 * s) / 2);
    expect(T.style.fontSize).toBeCloseTo(40 * s);
    const B = r.pages[0]!.elements[0]!;
    expect(aabb(B).h).toBeCloseTo(1920);
    expect(B.x).toBeLessThanOrEqual(0);
    expect(r.assets).toBe(d.assets);
  });

  it('print targets get bleed and units', () => {
    const r = resizeDoc(createDoc({ width: 1080, height: 1080 }), { width: 85, height: 55, unit: 'mm', print: true });
    expect(r.unit).toBe('mm');
    expect(r.bleed).toBeGreaterThan(0);
  });
});

describe('presets', () => {
  it('about 200+, unique ids, positive sizes within limits, known categories', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(200);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    for (const p of PRESETS) {
      expect(p.width, p.id).toBeGreaterThan(0);
      expect(p.height, p.id).toBeGreaterThan(0);
      const w = toPx(p.width, p.unit), h = toPx(p.height, p.unit);
      expect(Math.min(w, h), p.id).toBeGreaterThanOrEqual(MIN_SIDE);
      expect(Math.max(w, h), p.id).toBeLessThanOrEqual(MAX_SIDE);
      expect(PRESET_CATEGORIES).toContain(p.category);
      if (p.unit !== 'px') expect(p.print, p.id).toBe(true);
    }
  });

  it('keeps the ids links and tests use', () => {
    for (const id of ['instagram-post', 'business-card', 'video', 'a4', 'logo', 'story']) expect(PRESETS.some((p) => p.id === id)).toBe(true);
  });

  it('covers the major networks', () => {
    for (const n of ['instagram', 'facebook', 'linkedin', 'x ', 'pinterest', 'youtube', 'tiktok', 'snapchat', 'whatsapp', 'twitch'])
      expect(searchPresets(n.trim()).length, n).toBeGreaterThan(0);
  });

  it('search matches words, sizes and keywords, within a category', () => {
    expect(searchPresets('pinterest pin').map((p) => p.id)).toContain('pinterest-pin');
    expect(searchPresets('twitter').every((p) => p.name.startsWith('X'))).toBe(true);
    expect(searchPresets('728x90').map((p) => p.id)).toContain('web-banner');
    expect(searchPresets('', 'Print').every((p) => p.category === 'Print')).toBe(true);
    expect(searchPresets('instagram', 'Video').every((p) => p.category === 'Video')).toBe(true);
  });
});
