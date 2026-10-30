import { describe, expect, it } from 'vitest';
import { compositeMockup, mockupCrop, parseHex, parseMockupIndex, prepareMockup, renderMockup, type MockupBuffers, type Rgba } from '../src/mockup.ts';

/** RGBA buffer from a per-pixel function. */
function img(w: number, h: number, f: (x: number, y: number) => [number, number, number, number?]): Rgba {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b, a = 255] = f(x, y);
    data.set([r, g, b, a], (y * w + x) * 4);
  }
  return { width: w, height: h, data };
}
const grey = (w: number, h: number, f: (x: number, y: number) => number) => img(w, h, (x, y) => { const g = f(x, y); return [g, g, g]; });
const at = (r: Rgba | { width: number; data: Uint8ClampedArray }, x: number, y: number) => Array.from(r.data.slice((y * r.width + x) * 4, (y * r.width + x) * 4 + 4));

/** UV maps that send pixel (x, y) of a W×H mockup to design texel (x, y) of a W×H design: u = x/(W-1). */
function identity(W: number, H: number, cover = (_x: number, _y: number) => 255): { uvHi: Rgba; uvLo: Rgba } {
  const u16 = (x: number, n: number) => Math.round((x / (n - 1)) * 65535);
  return {
    uvHi: img(W, H, (x, y) => [u16(x, W) >> 8, u16(y, H) >> 8, cover(x, y)]),
    uvLo: img(W, H, (x, y) => [u16(x, W) & 255, u16(y, H) & 255, 0]),
  };
}

function mockup(W: number, H: number, opts: { base?: [number, number, number]; shade?: number; tint?: number; cover?: (x: number, y: number) => number } = {}): MockupBuffers {
  const b = opts.base ?? [200, 200, 200];
  return {
    base: img(W, H, () => b),
    ...identity(W, H, opts.cover),
    shade: grey(W, H, () => opts.shade ?? 128),
    tint: opts.tint !== undefined ? grey(W, H, () => opts.tint!) : null,
  };
}

/** A design whose every texel is distinct. */
const design = (w: number, h: number) => img(w, h, (x, y) => [x * 40, y * 40, 100]);

describe('mockup compositor', () => {
  it('identity UV copies the design texel for texel', () => {
    const d = design(4, 4);
    const out = renderMockup(mockup(4, 4), d, { aspect: 1 });
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) expect(at(out, x, y)).toEqual([x * 40, y * 40, 100, 255]);
  });

  it('flipped UV mirrors the design', () => {
    const W = 4, H = 3;
    const m = mockup(W, H);
    // u = 1 - x/(W-1): mirror left-right
    const id = identity(W, H);
    const flip = (src: Rgba, mirror: (x: number) => number) => img(W, H, (x, y) => {
      const p = (y * W + mirror(x)) * 4;
      return [src.data[p]!, src.data[p + 1]!, src.data[p + 2]!];
    });
    m.uvHi = flip(id.uvHi, (x) => W - 1 - x);
    m.uvHi = img(W, H, (x, y) => { const p = (y * W + x) * 4; return [m.uvHi.data[p]!, m.uvHi.data[p + 1]!, 255]; });
    m.uvLo = flip(id.uvLo, (x) => W - 1 - x);
    const d = design(W, H);
    const out = renderMockup(m, d, { aspect: W / H });
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) expect(at(out, x, y)).toEqual([(W - 1 - x) * 40, y * 40, 100, 255]);
  });

  it('coverage: 0 keeps the base, 255 is the design, in between blends', () => {
    const m = mockup(3, 1, { base: [0, 0, 0], cover: (x) => [0, 128, 255][x]! });
    const d = img(3, 1, () => [200, 100, 50]);
    const out = renderMockup(m, d, { aspect: 3 });
    expect(at(out, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(at(out, 1, 0)).toEqual([100, 50, 25, 255]); // 128/255 ≈ 0.502
    expect(at(out, 2, 0)).toEqual([200, 100, 50, 255]);
  });

  it('design alpha scales the blend', () => {
    const m = mockup(1, 1, { base: [0, 0, 0] });
    const out = renderMockup(m, img(1, 1, () => [200, 200, 200, 51]), { aspect: 1 });
    expect(at(out, 0, 0)).toEqual([40, 40, 40, 255]);
    const none = renderMockup(m, img(1, 1, () => [200, 200, 200, 0]), { aspect: 1 });
    expect(at(none, 0, 0)).toEqual([0, 0, 0, 255]);
  });

  it('shade multiplies: 128 = unchanged, 255 ≈ 2× (clamped), 64 = half', () => {
    const d = img(1, 1, () => [100, 200, 40]);
    expect(at(renderMockup(mockup(1, 1, { shade: 128 }), d, { aspect: 1 }), 0, 0)).toEqual([100, 200, 40, 255]);
    expect(at(renderMockup(mockup(1, 1, { shade: 255 }), d, { aspect: 1 }), 0, 0)).toEqual([199, 255, 80, 255]);
    expect(at(renderMockup(mockup(1, 1, { shade: 64 }), d, { aspect: 1 }), 0, 0)).toEqual([50, 100, 20, 255]);
  });

  it('tint recolours the product only where the mask is, and only with a colour', () => {
    const m = mockup(2, 1, { base: [200, 200, 200], cover: () => 0, tint: 255 });
    m.tint = grey(2, 1, (x) => (x === 0 ? 255 : 0));
    const red = renderMockup(m, design(2, 1), { aspect: 2, color: '#ff8000' });
    expect(at(red, 0, 0)).toEqual([200, 100, 0, 255]);
    expect(at(red, 1, 0)).toEqual([200, 200, 200, 255]);
    const half = renderMockup({ ...m, tint: grey(2, 1, () => 128) }, design(2, 1), { aspect: 2, color: '#000' });
    expect(at(half, 0, 0)).toEqual([100, 100, 100, 255]);
    expect(at(renderMockup(m, design(2, 1), { aspect: 2 }), 0, 0)).toEqual([200, 200, 200, 255]);
    // no tint map: the colour is ignored
    expect(at(renderMockup({ ...m, tint: null }, design(2, 1), { aspect: 2, color: '#ff0000' }), 0, 0)).toEqual([200, 200, 200, 255]);
  });

  it('bilinear sampling between texels', () => {
    // 1×1 mockup looking at the centre of a 2×1 design: u = 0.5
    const m = mockup(1, 1);
    m.uvHi = img(1, 1, () => [128, 0, 255]);
    m.uvLo = img(1, 1, () => [0, 0, 0]); // u = 32768/65535 ≈ 0.5
    const d = img(2, 1, (x) => (x ? [200, 0, 0] : [0, 0, 200]));
    const [r, , b] = at(renderMockup(m, d, { aspect: 2 }), 0, 0);
    expect(r).toBeGreaterThanOrEqual(99); expect(r).toBeLessThanOrEqual(101);
    expect(b).toBeGreaterThanOrEqual(99); expect(b).toBeLessThanOrEqual(101);
  });

  it('transparent texels do not darken the edge of opaque ones', () => {
    const m = mockup(1, 1, { base: [0, 0, 0] });
    m.uvHi = img(1, 1, () => [128, 0, 255]);
    m.uvLo = img(1, 1, () => [0, 0, 0]);
    const d = img(2, 1, (x) => (x ? [255, 255, 255, 0] : [200, 100, 0, 255]));
    const [r, g] = at(renderMockup(m, d, { aspect: 2 }), 0, 0);
    // half covered by an opaque (200,100,0): colour stays (200,100,0) at half strength
    expect(r).toBeGreaterThanOrEqual(99); expect(r).toBeLessThanOrEqual(101);
    expect(g).toBeGreaterThanOrEqual(49); expect(g).toBeLessThanOrEqual(51);
  });

  it('cover-fits the design to the print aspect (centre crop)', () => {
    expect(mockupCrop(200, 100, 1)).toEqual({ x: 50, y: 0, w: 100, h: 100 });
    expect(mockupCrop(100, 200, 1)).toEqual({ x: 0, y: 50, w: 100, h: 100 });
    expect(mockupCrop(100, 100, 2)).toEqual({ x: 0, y: 25, w: 100, h: 50 });
    // a 6×2 design on a square print area shows its middle 2×2
    const d = img(6, 2, (x) => [x * 40, 0, 0]);
    const out = renderMockup(mockup(2, 2), d, { aspect: 1 });
    expect(at(out, 0, 0)[0]).toBe(80);
    expect(at(out, 1, 0)[0]).toBe(120);
  });

  it('small mode box-filters the maps and keeps the print area', () => {
    const W = 40, H = 20;
    const m = mockup(W, H, { base: [0, 0, 0], cover: (x) => (x < 20 ? 255 : 0) });
    const small = prepareMockup(m, 10);
    expect([small.width, small.height]).toEqual([10, 5]);
    const d = img(1, 1, () => [255, 255, 255]);
    const out = compositeMockup(small, d, { aspect: 1 });
    expect(at({ width: 10, data: out }, 2, 2)).toEqual([255, 255, 255, 255]);
    expect(at({ width: 10, data: out }, 8, 2)).toEqual([0, 0, 0, 255]);
    // u is averaged: the left column of the small map still points near u = 0
    expect(small.u[0]!).toBeLessThan(0.06);
  });

  it('rejects maps of the wrong size', () => {
    const m = mockup(4, 4);
    m.shade = grey(3, 4, () => 128);
    expect(() => prepareMockup(m)).toThrow(/shade/);
  });

  it('parses colours and the index', () => {
    expect(parseHex('#f80')).toEqual([1, 0x88 / 255, 0]);
    expect(parseHex('nope')).toBeNull();
    const list = parseMockupIndex({ version: 1, mockups: [
      { id: 'tee', label: 'T-shirt', category: 'Apparel', width: 10, height: 10, aspect: 0.8, tint: true, colors: ['#fff', 'bad'] },
      { id: '../x', label: 'evil', width: 1, height: 1, aspect: 1 },
      { label: 'no id' },
    ] });
    expect(list.map((e) => e.id)).toEqual(['tee']);
    expect(list[0]!.colors).toEqual(['#fff']);
    expect(parseMockupIndex(null)).toEqual([]);
  });

  it('is fast: 1600 px well under 150 ms (logged), 400 px in a few ms', () => {
    const W = 1600, H = 1600;
    const n = W * H;
    const mk = (fill: (i: number, p: number, d: Uint8Array) => void): Rgba => { const data = new Uint8Array(n * 4); for (let i = 0; i < n; i++) fill(i, i * 4, data); return { width: W, height: H, data }; };
    const b: MockupBuffers = {
      base: mk((_i, p, d) => { d[p] = d[p + 1] = d[p + 2] = 220; d[p + 3] = 255; }),
      uvHi: mk((i, p, d) => { const x = i % W, y = (i / W) | 0; const inside = x > 200 && x < 1400 && y > 200 && y < 1400; d[p] = ((x - 200) / 1200 * 255) | 0; d[p + 1] = ((y - 200) / 1200 * 255) | 0; d[p + 2] = inside ? 255 : 0; }),
      uvLo: mk(() => {}),
      shade: mk((_i, p, d) => { d[p] = 140; }),
      tint: mk((_i, p, d) => { d[p] = 255; }),
    };
    const dsg = img(1600, 1600, (x, y) => [x & 255, y & 255, 128]);
    // best of 3: the suite runs files in parallel, so a single run measures the neighbours too
    const best = (f: () => void) => Math.min(...[0, 1, 2].map(() => { const t = performance.now(); f(); return performance.now() - t; }));
    let prep = prepareMockup(b);
    const tPrep = best(() => { prep = prepareMockup(b); });
    const tComp = best(() => compositeMockup(prep, dsg, { aspect: 1, color: '#336699' }));
    let small = prepareMockup(b, 400);
    const tPrepS = best(() => { small = prepareMockup(b, 400); });
    const tCompS = best(() => compositeMockup(small, dsg, { aspect: 1 }));
    console.log(`mockup 1600px: prepare ${tPrep.toFixed(1)} ms + composite ${tComp.toFixed(1)} ms; 400px: prepare ${tPrepS.toFixed(1)} ms + composite ${tCompS.toFixed(1)} ms`);
    // Target 150 ms for 1600 px (about 60 ms when this file runs alone on an M-series laptop). The full
    // suite runs files in parallel (video encoders, renders), so the guard here only catches gross regressions.
    expect(tPrep + tComp).toBeLessThan(500);
    expect(tCompS).toBeLessThan(60);
  });
});
