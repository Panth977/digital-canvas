import { describe, expect, it } from 'vitest';
import { commonStyle, createDoc, addElements, normalizeRuns, pruneFonts, styleAt, styleRange, text, DEFAULT_TEXT_STYLE } from '../src/index.ts';

const box = { x: 0, y: 0, w: 100, h: 20 };

describe('rich text', () => {
  it('styles a range by splitting runs', () => {
    const t = text('Hello world', box);
    const r = styleRange(t, 6, 11, { bold: true });
    expect(r.runs).toEqual([{ text: 'Hello ' }, { text: 'world', style: { bold: true } }]);
    expect(r.style).toBe(t.style);
  });
  it('a whole-text range changes the box style and clears that key on runs', () => {
    let t = text('Hello world', box);
    t = { ...t, ...styleRange(t, 0, 5, { color: '#ff0000', bold: true }) };
    const r = styleRange(t, 0, t.text.length, { color: '#00ff00' });
    expect(r.style.color).toBe('#00ff00');
    expect(r.runs).toEqual([{ text: 'Hello', style: { bold: true } }, { text: ' world' }]);
  });
  it('merges neighbours and drops runs equal to the base', () => {
    expect(normalizeRuns([{ text: 'a', style: { bold: true } }, { text: 'b', style: { bold: true } }, { text: 'c' }], DEFAULT_TEXT_STYLE))
      .toEqual([{ text: 'ab', style: { bold: true } }, { text: 'c' }]);
    expect(normalizeRuns([{ text: 'a', style: { bold: false } }, { text: 'b' }], DEFAULT_TEXT_STYLE)).toBeUndefined();
  });
  it('reports the style at a point and the common style of a range', () => {
    let t = text('Hello world', box);
    t = { ...t, ...styleRange(t, 6, 11, { bold: true, color: '#ff0000' }) };
    expect(styleAt(t, 7).bold).toBe(true);
    expect(styleAt(t, 2).bold).toBe(false);
    const c = commonStyle(t, 3, 9);
    expect('bold' in c).toBe(false);
    expect(c.fontFamily).toBe('Inter');
  });
  it('prunes added fonts no text uses, keeps imported ones', () => {
    let d = createDoc({ width: 100, height: 100 });
    d = addElements(d, d.pages[0]!.id, [text('x', box, { fontFamily: 'Lobster' })]);
    d = { ...d, fonts: [
      { family: 'Lobster', asset: 'a', source: 'fontsource:lobster' },
      { family: 'Pacifico', asset: 'b', source: 'fontsource:pacifico' },
      { family: 'Noto Sans', asset: 'c' },
    ] };
    expect(pruneFonts(d).fonts!.map((f) => f.family)).toEqual(['Lobster', 'Noto Sans']);
  });
});
