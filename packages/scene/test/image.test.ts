import { describe, expect, it } from 'vitest';
import {
  addElements, coverCrop, cropPatch, localToPage, pageToLocal, createDoc, cropFromBoxes, effectiveAdjust, findElement, hasLook, image, imageBox, IMAGE_FILTERS, panImage,
  resizeFrame, scaleImage, setAsBackground, shape, groupElements, pruneAssets, childrenOf, type ImageElement,
} from '../src/index.ts';

describe('filters and adjustments', () => {
  it('has a dozen named filters with known adjustments', () => {
    expect(IMAGE_FILTERS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(IMAGE_FILTERS.map((f) => f.name)).size).toBe(IMAGE_FILTERS.length);
  });
  it('adds a filter at its intensity to the own adjustments, clamped', () => {
    expect(effectiveAdjust({ filter: { name: 'mono', intensity: 50 } })).toEqual({ saturation: -50 });
    expect(effectiveAdjust({ adjust: { saturation: -80 }, filter: { name: 'mono', intensity: 100 } })).toEqual({ saturation: -100 });
    expect(effectiveAdjust({ adjust: { brightness: 0 } })).toEqual({});
    expect(effectiveAdjust({ filter: { name: 'nope', intensity: 100 } })).toEqual({});
  });
  it('hasLook is false for a plain picture', () => {
    expect(hasLook({})).toBe(false);
    expect(hasLook({ filter: { name: 'noir', intensity: 0 } })).toBe(false);
    expect(hasLook({ effect: { type: 'pixelate', size: 10 } })).toBe(true);
  });
});

describe('crop geometry', () => {
  it('cover crop centres the part that fills the box', () => {
    expect(coverCrop(200, 100, 100, 100)).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 });
    expect(coverCrop(100, 200, 100, 100)).toEqual({ x: 0, y: 0.25, w: 1, h: 0.5 });
  });
  it('image box and crop round-trip', () => {
    const frame = { x: 10, y: 20, w: 100, h: 50 };
    const crop = { x: 0.2, y: 0.1, w: 0.5, h: 0.4 };
    const img = imageBox(frame, crop);
    expect(img).toEqual({ x: -30, y: 7.5, w: 200, h: 125 });
    const back = cropFromBoxes(frame, img);
    for (const k of ['x', 'y', 'w', 'h'] as const) expect(back[k]).toBeCloseTo(crop[k], 9);
  });
  it('panning keeps the image covering the frame', () => {
    const frame = { x: 0, y: 0, w: 100, h: 100 };
    const img = { x: -50, y: -50, w: 200, h: 200 };
    expect(panImage(frame, img, 30, 10)).toEqual({ x: -20, y: -40, w: 200, h: 200 });
    expect(panImage(frame, img, 500, -500)).toEqual({ x: 0, y: -100, w: 200, h: 200 });
  });
  it('resizing the frame stays inside the image', () => {
    const frame = { x: 0, y: 0, w: 100, h: 100 };
    const img = { x: -50, y: -10, w: 200, h: 200 };
    expect(resizeFrame(frame, img, 'nw', { x: -100, y: -100 })).toEqual({ x: -50, y: -10, w: 150, h: 110 });
    expect(resizeFrame(frame, img, 'e', { x: 40, y: 999 })).toEqual({ x: 0, y: 0, w: 40, h: 100 });
    expect(resizeFrame(frame, img, 'e', { x: -40, y: 0 }, 8).w).toBe(8);
  });
  it('scaling the image keeps its aspect and covers the frame', () => {
    const frame = { x: 0, y: 0, w: 100, h: 100 };
    const img = { x: 0, y: 0, w: 200, h: 100 };
    const big = scaleImage(frame, img, 'se', { x: 400, y: 200 });
    expect(big).toEqual({ x: 0, y: 0, w: 400, h: 200 });
    const small = scaleImage(frame, img, 'se', { x: 10, y: 10 });
    expect(small.h).toBeCloseTo(100); // can't shrink below the frame
    expect(small.w / small.h).toBeCloseTo(2);
  });
});

describe('crop frame on a rotated, flipped element', () => {
  it('local ↔ page round-trips', () => {
    const el = { x: 10, y: 20, w: 100, h: 50, rotation: 30, flipX: true };
    const p = { x: 33, y: 41 };
    const back = pageToLocal(el, localToPage(el, p));
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });
  it('shrinking the frame keeps the image where it was on the page', () => {
    const el = { x: 0, y: 0, w: 100, h: 100, rotation: 90 };
    const img = { x: -50, y: 0, w: 200, h: 100 };
    const frame = { x: 0, y: 0, w: 50, h: 100 }; // keep the left half
    const patch = cropPatch(el, frame, img);
    const next = { ...el, ...patch };
    // the image's top-left corner lands on the same page point before and after
    const before = localToPage(el, { x: img.x, y: img.y });
    const after = localToPage(next, { x: next.x - patch.crop.x * (next.w / patch.crop.w), y: next.y - patch.crop.y * (next.h / patch.crop.h) });
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });
});

describe('set as background', () => {
  it('moves the image to the back, fills and locks it', () => {
    let doc = createDoc({ width: 400, height: 200 });
    const img = { ...image('a', { x: 50, y: 50, w: 100, h: 100 }), rotation: 30 };
    doc = addElements(doc, doc.pages[0]!.id, [shape('rect', { x: 0, y: 0, w: 10, h: 10 }), img]);
    doc = { ...doc, assets: { a: { mime: 'image/png', width: 100, height: 100 } } };
    const next = setAsBackground(doc, img.id);
    const hit = findElement(next, img.id)!;
    expect(hit.index).toBe(0);
    expect(hit.element).toMatchObject({ x: 0, y: 0, w: 400, h: 200, rotation: 0, locked: true, crop: { x: 0, y: 0.25, w: 1, h: 0.5 } });
    expect(setAsBackground(doc, 'nope')).toBe(doc);
  });
});

describe('image tools inside groups (M4 × M5)', () => {
  it('pruneAssets keeps a grouped image\'s asset and its pre-background-removal original', () => {
    let doc = createDoc({ width: 100, height: 100 });
    const img: ImageElement = { ...image('cut', { x: 0, y: 0, w: 50, h: 50 }), original: 'orig' };
    const other = shape('rect', { x: 60, y: 0, w: 10, h: 10 });
    doc = addElements(doc, doc.pages[0]!.id, [img, other]);
    doc = groupElements({ ...doc, assets: { cut: { mime: 'image/png' }, orig: { mime: 'image/jpeg' }, gone: { mime: 'image/png' } } }, [img.id, other.id])!.doc;
    expect(Object.keys(pruneAssets(doc).assets).sort()).toEqual(['cut', 'orig']);
  });

  it('set as background takes the image out of its group and drops a frame mask', () => {
    let doc = createDoc({ width: 400, height: 200 });
    const img: ImageElement = { ...image('a', { x: 50, y: 50, w: 100, h: 100 }), mask: 'ellipse' };
    const other = shape('rect', { x: 0, y: 0, w: 10, h: 10 });
    doc = addElements(doc, doc.pages[0]!.id, [other, img]);
    doc = groupElements({ ...doc, assets: { a: { mime: 'image/png', width: 100, height: 100 } } }, [img.id, other.id])!.doc;
    const next = setAsBackground(doc, img.id);
    const page = next.pages[0]!;
    expect(page.elements[0]!.id).toBe(img.id);
    expect((page.elements[0] as ImageElement).mask).toBeUndefined();
    const group = page.elements.find((e) => childrenOf(e));
    expect(group ? childrenOf(group)!.some((c) => c.id === img.id) : false).toBe(false);
    // an empty frame has nothing to put on the background
    expect(setAsBackground(doc, other.id)).toBe(doc);
  });
});
