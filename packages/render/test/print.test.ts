import { describe, expect, it } from 'vitest';
import { MM, printLayout, rgbToCmyk, rgbaToCmyk } from '../src/print.ts';

describe('printLayout (crop marks and bleed)', () => {
  it('no bleed, no marks: the sheet is the page', () => {
    const l = printLayout(400, 300, { bleed: 0, marks: false });
    expect([l.mediaW, l.mediaH]).toEqual([400, 300]);
    expect(l.trim).toEqual({ x: 0, y: 0, w: 400, h: 300 });
    expect(l.bleed).toEqual(l.trim);
    expect(l.marks).toEqual([]);
  });

  it('bleed only grows the sheet by the bleed on every side', () => {
    const b = 3 * MM;
    const l = printLayout(400, 300, { bleed: b, marks: false });
    expect(l.mediaW).toBeCloseTo(400 + 2 * b);
    expect(l.mediaH).toBeCloseTo(300 + 2 * b);
    expect(l.trim.x).toBeCloseTo(b);
    expect(l.bleed).toEqual({ x: 0, y: 0, w: 400 + 2 * b, h: 300 + 2 * b });
    expect(l.marks).toEqual([]);
  });

  it('marks: eight segments on the trim lines, outside the bleed, inside the sheet', () => {
    const b = 3 * MM, len = 6 * MM;
    const l = printLayout(400, 300, { bleed: b, marks: true });
    const m = b + len; // slug: marks start at the bleed edge and run 6 mm
    expect(l.mediaW).toBeCloseTo(400 + 2 * m);
    expect(l.trim.x).toBeCloseTo(m);
    expect(l.bleed.x).toBeCloseTo(m - b);
    expect(l.marks).toHaveLength(8);
    const trimX = [l.trim.x, l.trim.x + 400], trimY = [l.trim.y, l.trim.y + 300];
    for (const s of l.marks) {
      const horizontal = s.y1 === s.y2;
      // each mark extends a trim line
      if (horizontal) expect(trimY.some((y) => Math.abs(y - s.y1) < 1e-9)).toBe(true);
      else expect(trimX.some((x) => Math.abs(x - s.x1) < 1e-9)).toBe(true);
      expect(Math.hypot(s.x2 - s.x1, s.y2 - s.y1)).toBeCloseTo(len);
      // never on the artwork (bleed box), always on the sheet
      for (const [x, y] of [[s.x1, s.y1], [s.x2, s.y2]] as const) {
        const inBleed = x > l.bleed.x + 1e-6 && x < l.bleed.x + l.bleed.w - 1e-6 && y > l.bleed.y + 1e-6 && y < l.bleed.y + l.bleed.h - 1e-6;
        expect(inBleed).toBe(false);
        expect(x).toBeGreaterThanOrEqual(-1e-9);
        expect(y).toBeGreaterThanOrEqual(-1e-9);
        expect(x).toBeLessThanOrEqual(l.mediaW + 1e-9);
        expect(y).toBeLessThanOrEqual(l.mediaH + 1e-9);
      }
    }
    // top-left corner: a horizontal mark ending at the sheet's left edge, a vertical one at its top
    expect(l.marks[0]).toMatchObject({ y1: m, y2: m });
    expect(l.marks[0]!.x1).toBeCloseTo(m - b);
    expect(l.marks[0]!.x2).toBeCloseTo(0);
    expect(l.marks[1]!.y2).toBeCloseTo(0);
  });

  it('marks keep a 3 mm gap from the trim even without bleed', () => {
    const l = printLayout(100, 100, { bleed: 0, marks: true });
    expect(l.bleed).toEqual(l.trim);
    expect(l.trim.x - l.marks[0]!.x1).toBeCloseTo(3 * MM);
  });
});

describe('CMYK conversion (best effort, no ICC profile)', () => {
  it('maps primaries, black and white', () => {
    expect(rgbToCmyk(1, 1, 1)).toEqual([0, 0, 0, 0]);
    expect(rgbToCmyk(0, 0, 0)).toEqual([0, 0, 0, 1]);
    expect(rgbToCmyk(1, 0, 0)).toEqual([0, 1, 1, 0]);
    const [c, m, y, k] = rgbToCmyk(0.5, 0.5, 0.5);
    expect([c, m, y]).toEqual([0, 0, 0]);
    expect(k).toBeCloseTo(0.5);
  });

  it('converts pixels and keeps alpha apart', () => {
    const px = new Uint8Array([255, 0, 0, 255, 0, 0, 0, 128]);
    const r = rgbaToCmyk(px);
    expect(Array.from(r.cmyk)).toEqual([0, 255, 255, 0, 0, 0, 0, 255]);
    expect(Array.from(r.alpha)).toEqual([255, 128]);
    expect(r.opaque).toBe(false);
  });
});
