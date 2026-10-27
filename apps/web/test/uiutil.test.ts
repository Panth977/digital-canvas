import { describe, expect, it } from 'vitest';
import { shape, text } from '@digital-canvas/scene';
import { colorFromQuery, colorMatches, hexToHsv, hsvToHex, normHex, paletteOf, parseSize, splitTip } from '../src/lib/uiutil.ts';
import { copyStyle, pasteStyle } from '../src/lib/copystyle.ts';

describe('tooltips', () => {
  it('splits a trailing shortcut off the label', () => {
    expect(splitTip('Bold (⌘B)')).toEqual({ label: 'Bold', keys: '⌘B' });
    expect(splitTip('Redo (⇧⌘Z)')).toEqual({ label: 'Redo', keys: '⇧⌘Z' });
    expect(splitTip('Add a text box (T)')).toEqual({ label: 'Add a text box', keys: 'T' });
    expect(splitTip('Instagram post (square)')).toEqual({ label: 'Instagram post (square)', keys: '' });
    expect(splitTip('All changes saved')).toEqual({ label: 'All changes saved', keys: '' });
  });
});

describe('font size box', () => {
  it('accepts sizes as typed, rejects the rest', () => {
    expect(parseSize('24')).toBe(24);
    expect(parseSize(' 12,5 ')).toBe(12.5);
    expect(parseSize('0')).toBeNull();
    expect(parseSize('abc')).toBeNull();
    expect(parseSize('5000')).toBe(800);
  });
});

describe('colours', () => {
  it('normalises hex', () => {
    expect(normHex('F00')).toBe('#ff0000');
    expect(normHex('#38B6FF')).toBe('#38b6ff');
    expect(normHex('#38b6ff80')).toBe('#38b6ff');
    expect(normHex('nope')).toBeNull();
  });
  it('round-trips HSV', () => {
    for (const h of ['#ff0000', '#38b6ff', '#000000', '#ffffff', '#7c3aed', '#00bf63']) expect(hsvToHex(hexToHsv(h))).toBe(h);
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 });
  });
  it('searches by hex prefix or by colour name', () => {
    expect(colorMatches('#38b6ff', '38b')).toBe(true);
    expect(colorMatches('#38b6ff', '#38B6')).toBe(true);
    expect(colorMatches('#38b6ff', 'blue')).toBe(true);
    expect(colorMatches('#ff3131', 'blue')).toBe(false);
    expect(colorMatches('#ff3131', 'red')).toBe(true);
    expect(colorMatches('#000000', 'black')).toBe(true);
    expect(colorFromQuery('navy')).toBe('#000080');
    expect(colorFromQuery('abc')).toBe('#aabbcc');
    expect(colorFromQuery('zz')).toBeNull();
  });
  it('finds the main colours of a picture', () => {
    const px = new Uint8ClampedArray(4 * 100);
    for (let i = 0; i < 100; i++) px.set(i < 70 ? [250, 10, 10, 255] : i < 95 ? [10, 10, 240, 255] : [12, 12, 238, 0], i * 4);
    const p = paletteOf(px);
    expect(p).toHaveLength(2);
    expect(p[0]).toBe('#fa0a0a');
  });
});

describe('copy style', () => {
  it('text to text: font, size, colour and effect; words stay', () => {
    const a = { ...text('Hello', { x: 0, y: 0, w: 100, h: 20 }, { fontFamily: 'Lobster', fontSize: 64, color: '#ff0000', bold: true }), opacity: 0.5, effect: { type: 'neon' as const, intensity: 50 } };
    const b = { ...text('World', { x: 0, y: 0, w: 100, h: 20 }), runs: [{ text: 'World', style: { color: '#00ff00' } }] };
    const p = pasteStyle(copyStyle(a as never), b) as Record<string, any>;
    expect(p.style.fontFamily).toBe('Lobster');
    expect(p.style.fontSize).toBe(64);
    expect(p.effect).toEqual({ type: 'neon', intensity: 50 });
    expect(p.opacity).toBe(0.5);
    expect('runs' in p && p.runs === undefined).toBe(true);
    expect(p.text).toBeUndefined();
  });
  it('shape to shape, and a colour across kinds', () => {
    const a = { ...shape('rect', { x: 0, y: 0, w: 10, h: 10 }), fill: { type: 'solid' as const, color: '#123456' }, radius: 8 };
    const b = shape('ellipse', { x: 0, y: 0, w: 10, h: 10 });
    const p = pasteStyle(copyStyle(a), b) as Record<string, any>;
    expect(p.fill).toEqual({ type: 'solid', color: '#123456' });
    expect(p.radius).toBeUndefined(); // only rectangles have corners
    const t = text('Hi', { x: 0, y: 0, w: 10, h: 10 });
    expect((pasteStyle(copyStyle(a), t) as any).style.color).toBe('#123456');
  });
});

import { createDoc, addElements, line } from '@digital-canvas/scene';
import { countUses, recolorDoc } from '../src/lib/recolor.ts';

describe('change all', () => {
  it('swaps a colour everywhere and counts its uses', () => {
    let d = createDoc({ width: 100, height: 100 });
    d = { ...d, pages: [{ ...d.pages[0]!, background: { type: 'solid', color: '#ff0000' } }] };
    const t = { ...text('Hi', { x: 0, y: 0, w: 10, h: 10 }, { color: '#FF0000' }), runs: [{ text: 'H', style: { color: '#ff0000' } }, { text: 'i' }] };
    const s = { ...shape('rect', { x: 0, y: 0, w: 10, h: 10 }), fill: { type: 'solid' as const, color: '#ff0000' }, stroke: { color: '#00ff00', width: 2 } };
    d = addElements(d, d.pages[0]!.id, [t, s]);
    expect(countUses(d, '#ff0000')).toBe(3);
    const n = recolorDoc(d, '#ff0000', '#0000ff');
    expect(countUses(n, '#ff0000')).toBe(0);
    expect(countUses(n, '#0000ff')).toBe(3);
    const [nt, ns] = n.pages[0]!.elements as any[];
    expect(nt.style.color).toBe('#0000ff');
    expect(nt.runs[0].style.color).toBe('#0000ff');
    expect(ns.stroke.color).toBe('#00ff00');
    expect(n.pages[0]!.background).toEqual({ type: 'solid', color: '#0000ff' });
    expect(recolorDoc(d, '#123456', '#000000').pages[0]!.elements).toBe(d.pages[0]!.elements);
    void line;
  });
});
