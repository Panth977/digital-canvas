import { describe, expect, it } from 'vitest';
import { addElements, createDoc, decodeAnchor, encodeAnchor, makeAnchor, pinPlace, removeElements, shape, sortComments, updateElements, type DesignComment } from '../src/index.ts';

const base = () => {
  let doc = createDoc({ title: 't', width: 1000, height: 1000 } as never);
  const el = shape('rect', { x: 100, y: 200, w: 200, h: 100 });
  doc = addElements(doc, doc.pages[0]!.id, [el]);
  return { doc, el, page: doc.pages[0]!.id };
};

describe('comment anchors', () => {
  it('round-trip through the opaque string; foreign anchors are "whole design"', () => {
    const a = { page: 'p1', el: 'e1', fx: 0.5, fy: 1, x: 10, y: 20, t: 1.5, t1: 2 };
    expect(decodeAnchor(encodeAnchor(a))).toEqual(a);
    expect(decodeAnchor('{"r":"head","a":[{"page":{"p":1}}]}')).toBeUndefined();
    expect(decodeAnchor('not json')).toBeUndefined();
    expect(decodeAnchor(undefined)).toBeUndefined();
  });

  it('an element pin follows the element and stays put when it is deleted', () => {
    const { doc, el, page } = base();
    const a = makeAnchor(doc, { page, element: el.id, point: { x: 200, y: 250 } });
    expect(a).toMatchObject({ page, el: el.id, fx: 0.5, fy: 0.5, x: 200, y: 250 });
    expect(makeAnchor(doc, { page, element: el.id })).toMatchObject({ fx: 1, fy: 0 }); // top-right corner, like Canva
    const moved = updateElements(doc, [el.id], { x: 500, w: 400 });
    expect(pinPlace(moved, a)).toEqual({ page, x: 700, y: 250 });
    expect(pinPlace(removeElements(doc, [el.id]), a)).toEqual({ page, x: 200, y: 250, orphan: true });
    expect(() => makeAnchor(doc, { page, element: 'nope' })).toThrow();
    expect(() => makeAnchor(doc, { page: 'nope' })).toThrow();
  });

  it('times and reading order', () => {
    const { doc, page } = base();
    expect(makeAnchor(doc, { page, time: 2, timeEnd: 1 })).toEqual({ page, t: 2 });
    const c = (id: string, anchor?: DesignComment['anchor']): DesignComment => ({ id, text: id, author: { name: 'a' }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '', resolved: false, replies: [], ...(anchor ? { anchor } : {}) });
    const list = [c('low', { page, x: 10, y: 900 }), c('top', { page, x: 900, y: 10 }), c('whole'), c('gone', { page: 'deleted', x: 0, y: 0 })];
    expect(sortComments(doc, list).map((x) => x.id)).toEqual(['whole', 'top', 'low', 'gone']);
  });
});
