import { describe, expect, it } from 'vitest';
import { boxBlur, coverage, dilate, expandLayout, feather, guidedFilter, inpaintWindow, subjectBox } from '../src/lib/vision/matte.ts';

describe('mask maths', () => {
  it('coverage and subjectBox read the subject', () => {
    const a = new Uint8Array(100);
    for (let y = 2; y < 5; y++) for (let x = 3; x < 7; x++) a[y * 10 + x] = 255;
    expect(coverage(a)).toBeCloseTo(0.12, 5);
    expect(subjectBox(a, 10, 10)).toEqual({ x: 0.3, y: 0.2, w: 0.4, h: 0.3 });
    expect(subjectBox(new Uint8Array(100), 10, 10)).toBeNull();
  });
  it('boxBlur keeps a flat image flat and spreads an impulse', () => {
    const f = new Float32Array(25).fill(0.5);
    for (const v of boxBlur(f, 5, 5, 2)) expect(v).toBeCloseTo(0.5, 5);
    const d = new Float32Array(25); d[12] = 1;
    const b = boxBlur(d, 5, 5, 1);
    expect(b[12]).toBeCloseTo(1 / 9, 5);
    expect(b[0]).toBe(0);
  });
  it('guidedFilter snaps a soft mask to the edge in the guide', () => {
    const w = 40, h = 10, g = new Float32Array(w * h), m = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      g[y * w + x] = x < 20 ? 0 : 1;
      m[y * w + x] = Math.max(0, Math.min(1, (x - 12) / 16)); // a wide ramp across the edge
    }
    const o = guidedFilter(g, m, w, h, 4, 1e-4);
    const at = (x: number) => o[5 * w + x]!;
    expect(at(21) - at(18)).toBeGreaterThan((m[5 * w + 21]! - m[5 * w + 18]!) * 1.5);
  });
  it('dilate grows and feather softens', () => {
    const a = new Uint8Array(121); a[60] = 255;
    const d = dilate(a, 11, 11, 2);
    expect(d[60 - 2]).toBe(255);
    expect(d[60 - 4]).toBe(0);
    const f = feather(d, 11, 11, 2);
    expect(f[60]!).toBeGreaterThan(f[60 - 4]!);
    expect(f[60 - 4]!).toBeGreaterThan(0);
  });
  it('inpaintWindow keeps small repairs at native size and stays in the image', () => {
    const w = inpaintWindow({ x: 900, y: 900, w: 40, h: 40 }, 1000, 1000);
    expect(w).toEqual({ x: 488, y: 488, w: 512, h: 512 });
    const big = inpaintWindow({ x: 100, y: 100, w: 800, h: 300 }, 2000, 1500);
    expect(big.w).toBe(1440);
    expect(big.x + big.w).toBeLessThanOrEqual(2000);
    expect(inpaintWindow({ x: 0, y: 0, w: 50, h: 50 }, 300, 200).w).toBe(200);
  });
  it('expandLayout widens or heightens around the old image', () => {
    expect(expandLayout(100, 100, 2)).toEqual({ w: 200, h: 100, x: 50, y: 0 });
    expect(expandLayout(100, 100, 0.5)).toEqual({ w: 100, h: 200, x: 0, y: 50 });
    expect(expandLayout(100, 100, 1)).toEqual({ w: 100, h: 100, x: 0, y: 0 });
  });
});
