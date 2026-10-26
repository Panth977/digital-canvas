import { describe, expect, it } from 'vitest';
import {
  History, addElements, addPage, aabb, arrange, contains, createDoc, duplicateElements, duplicatePage, findElement,
  hitTest, moveElementTo, movePage, parseDoc, removeElements, removePage, resizeBox, shape, text, toPx, updateElements,
  DocFormatError, pruneAssets, image,
} from '../src/index.ts';

const box = { x: 10, y: 10, w: 100, h: 50 };

describe('createDoc', () => {
  it('stores sizes in px and adds bleed for print', () => {
    const d = createDoc({ width: 85, height: 55, unit: 'mm', print: true });
    expect(d.width).toBeCloseTo(toPx(85, 'mm'), 1);
    expect(d.bleed).toBeCloseTo(toPx(3, 'mm'), 3);
    expect(d.pages).toHaveLength(1);
  });
  it('clamps to Canva limits', () => {
    const d = createDoc({ width: 10, height: 99999 });
    expect(d.width).toBe(40);
    expect(d.height).toBe(8000);
  });
});

describe('element ops', () => {
  it('add, update, remove without mutating', () => {
    const d0 = createDoc({ width: 500, height: 500 });
    const page = d0.pages[0]!.id;
    const r = shape('rect', box);
    const d1 = addElements(d0, page, [r]);
    expect(d0.pages[0]!.elements).toHaveLength(0);
    const d2 = updateElements(d1, [r.id], { x: 50 });
    expect(findElement(d2, r.id)!.element.x).toBe(50);
    expect(findElement(d1, r.id)!.element.x).toBe(10);
    expect(removeElements(d2, [r.id]).pages[0]!.elements).toHaveLength(0);
  });
  it('update with no match returns the same doc', () => {
    const d0 = createDoc({ width: 500, height: 500 });
    expect(updateElements(d0, ['nope'], { x: 1 })).toBe(d0);
  });
  it('duplicate offsets and gives new ids', () => {
    const d0 = createDoc({ width: 500, height: 500 });
    const r = shape('rect', box);
    const { doc, ids } = duplicateElements(addElements(d0, d0.pages[0]!.id, [r]), [r.id]);
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toBe(r.id);
    expect(findElement(doc, ids[0]!)!.element.x).toBe(30);
  });
  it('arrange and move in the stack', () => {
    const d0 = createDoc({ width: 500, height: 500 });
    const [a, b, c] = [shape('rect', box), shape('ellipse', box), text('hi', box)];
    const d1 = addElements(d0, d0.pages[0]!.id, [a, b, c]);
    const order = (d: typeof d1) => d.pages[0]!.elements.map((e) => e.id);
    expect(order(arrange(d1, [a.id], 'front'))).toEqual([b.id, c.id, a.id]);
    expect(order(arrange(d1, [c.id], 'back'))).toEqual([c.id, a.id, b.id]);
    expect(order(arrange(d1, [a.id], 'forward'))).toEqual([b.id, a.id, c.id]);
    expect(order(arrange(d1, [c.id], 'backward'))).toEqual([a.id, c.id, b.id]);
    expect(order(moveElementTo(d1, c.id, 0))).toEqual([c.id, a.id, b.id]);
  });
  it('prunes unused assets', () => {
    const d0 = { ...createDoc({ width: 500, height: 500 }), assets: { a: { mime: 'image/png' }, b: { mime: 'image/png' } } };
    const d1 = addElements(d0, d0.pages[0]!.id, [image('a', box)]);
    expect(Object.keys(pruneAssets(d1).assets)).toEqual(['a']);
  });
});

describe('page ops', () => {
  it('add, duplicate, move, remove; never removes the last page', () => {
    let d = createDoc({ width: 500, height: 500 });
    const first = d.pages[0]!.id;
    d = addElements(d, first, [shape('rect', box)]);
    const dup = duplicatePage(d, first);
    d = dup.doc;
    expect(d.pages).toHaveLength(2);
    expect(d.pages[1]!.elements[0]!.id).not.toBe(d.pages[0]!.elements[0]!.id);
    const added = addPage(d, first);
    d = added.doc;
    expect(d.pages[1]!.id).toBe(added.pageId);
    d = movePage(d, first, 2);
    expect(d.pages[2]!.id).toBe(first);
    d = removePage(d, d.pages[0]!.id);
    d = removePage(d, d.pages[0]!.id);
    expect(d.pages).toHaveLength(1);
    expect(removePage(d, d.pages[0]!.id).pages).toHaveLength(1);
  });
});

describe('geometry', () => {
  it('hit tests rotated boxes', () => {
    const e = { ...shape('rect', { x: 0, y: 0, w: 100, h: 10 }), rotation: 90 };
    expect(contains(e, { x: 50, y: 40 })).toBe(true); // rotated: now vertical through centre
    expect(contains(e, { x: 90, y: 5 })).toBe(false);
    const b = aabb(e);
    expect(b.w).toBeCloseTo(10);
    expect(b.h).toBeCloseTo(100);
  });
  it('hitTest returns the topmost', () => {
    const d = createDoc({ width: 500, height: 500 });
    const a = shape('rect', box), b = shape('rect', box);
    const page = addElements(d, d.pages[0]!.id, [a, b]).pages[0]!;
    expect(hitTest(page, { x: 20, y: 20 })!.id).toBe(b.id);
    expect(hitTest(page, { x: 300, y: 300 })).toBeNull();
  });
  it('resize keeps the opposite corner fixed', () => {
    const start = { x: 0, y: 0, w: 100, h: 100, rotation: 0 };
    expect(resizeBox(start, 'se', { x: 150, y: 120 })).toEqual({ x: 0, y: 0, w: 150, h: 120 });
    expect(resizeBox(start, 'nw', { x: 20, y: 30 })).toEqual({ x: 20, y: 30, w: 80, h: 70 });
    const r = resizeBox(start, 'se', { x: 200, y: 120 }, { keepRatio: true });
    expect(r.w).toBeCloseTo(200);
    expect(r.h).toBeCloseTo(200);
  });
  it('resize of a rotated box keeps the fixed corner on screen', () => {
    const start = { x: 0, y: 0, w: 100, h: 50, rotation: 30 };
    const fixedBefore = (r: { x: number; y: number; w: number; h: number }) => {
      const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      const rad = (30 * Math.PI) / 180;
      const dx = r.x - c.x, dy = r.y - c.y; // nw corner
      return { x: c.x + dx * Math.cos(rad) - dy * Math.sin(rad), y: c.y + dx * Math.sin(rad) + dy * Math.cos(rad) };
    };
    const before = fixedBefore(start);
    const after = fixedBefore(resizeBox(start, 'se', { x: 160, y: 140 }));
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});

describe('History', () => {
  it('undo/redo and coalescing', () => {
    const h = new History(0);
    h.push(1);
    h.push(2, 'drag');
    h.push(3, 'drag');
    expect(h.undo()).toBe(1);
    expect(h.undo()).toBe(0);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBe(1);
    h.push(9);
    expect(h.canRedo).toBe(false);
  });
});

describe('parseDoc', () => {
  it('round-trips and rejects bad input', () => {
    const d = createDoc({ width: 500, height: 500 });
    expect(parseDoc(JSON.parse(JSON.stringify(d)))).toEqual(d);
    expect(() => parseDoc({})).toThrow(DocFormatError);
    expect(() => parseDoc({ ...d, version: 99 })).toThrow(/newer/);
    expect(() => parseDoc({ ...d, pages: [] })).toThrow(/no pages/);
  });
});

describe('embedded fonts', () => {
  it('pruneAssets keeps font assets', () => {
    const d0 = { ...createDoc({ width: 100, height: 100 }), assets: { f: { mime: 'font/ttf' }, x: { mime: 'image/png' } }, fonts: [{ family: 'F', asset: 'f' }] };
    expect(Object.keys(pruneAssets(d0).assets)).toEqual(['f']);
  });
});
