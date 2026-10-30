import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CanvasKit } from 'canvaskit-wasm';
import { addElements, createDoc, defaultShadow, duotoneOf, hasLook, image, pruneAssets, shadowOf, straightenMatrix, stylizeOf, type ImageElement } from '@digital-canvas/scene';
import { applyMatrix, colorMatrix, exportSvg, FontLibrary, IDENTITY, Renderer } from '../src/index.ts';

const require = createRequire(import.meta.url);
const fontDir = new URL('../../../apps/web/public/fonts/', import.meta.url);
let ck: CanvasKit;
let renderer: Renderer;

/** Encode a w×h PNG painted by `paint(x, y)` → [r, g, b, a] 0..255. */
function png(w: number, h: number, paint: (x: number, y: number) => number[]): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set(paint(x, y), (y * w + x) * 4);
  const img = ck.MakeImage({ width: w, height: h, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }, px, w * 4)!;
  const bytes = img.encodeToBytes()!;
  img.delete();
  return bytes;
}

function pixels(bytes: Uint8Array) {
  const img = ck.MakeImageFromEncoded(bytes)!;
  const w = img.width(), h = img.height();
  const px = img.readPixels(0, 0, { width: w, height: h, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array;
  img.delete();
  return { w, h, at: (x: number, y: number) => Array.from(px.slice((y * w + x) * 4, (y * w + x) * 4 + 4)) };
}

beforeAll(async () => {
  const init = require('canvaskit-wasm/bin/full/canvaskit.js');
  ck = await init();
  const fonts = new FontLibrary(ck);
  await fonts.loadBundled(fontDir.href, async (url) => readFileSync(new URL(url)).buffer as ArrayBuffer);
  renderer = new Renderer(ck, fonts);
  // orange-ish photo stand-in, a left-red / right-green image, a black|white edge, a transparent PNG with a centred square
  renderer.setImage('orange', png(8, 8, () => [200, 120, 40, 255]));
  renderer.setImage('rg', png(20, 10, (x) => (x < 10 ? [255, 0, 0, 255] : [0, 255, 0, 255])));
  renderer.setImage('edge', png(20, 20, (x) => (x < 10 ? [0, 0, 0, 255] : [255, 255, 255, 255])));
  renderer.setImage('cut', png(20, 20, (x, y) => (x >= 6 && x < 14 && y >= 6 && y < 14 ? [0, 0, 255, 255] : [0, 0, 0, 0])));
  renderer.setImage('grey', png(1, 1, () => [128, 128, 128, 255]));
  renderer.setImage('ramp', png(64, 1, (x) => { const v = Math.round((x / 63) * 255); return [v, v, v, 255]; }));
  renderer.setImage('checker', png(16, 16, (x, y) => ((x + y) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255])));
});

/** Render one image element (with `look`) on a `size` page with a white background. */
function render(asset: string, look: Partial<ImageElement> = {}, size = { w: 100, h: 100 }, box = { x: 0, y: 0, w: 100, h: 100 }) {
  let doc = createDoc({ width: size.w, height: size.h });
  doc = addElements(doc, doc.pages[0]!.id, [{ ...image(asset, box), ...look }]);
  return pixels(renderer.exportPage(doc, doc.pages[0]!));
}

describe('colour matrix', () => {
  it('is null with no linear adjustments', () => {
    expect(colorMatrix({})).toBeNull();
    expect(colorMatrix({ blur: 50, vignette: 20 })).toBeNull();
  });
  it('saturation -100 makes grey, +100 pushes channels apart', () => {
    const [r, g, b] = applyMatrix(colorMatrix({ saturation: -100 })!, [0.8, 0.4, 0.2, 1]);
    expect(r).toBeCloseTo(g, 5);
    expect(g).toBeCloseTo(b, 5);
    const [r2, , b2] = applyMatrix(colorMatrix({ saturation: 100 })!, [0.6, 0.4, 0.3, 1]);
    expect(r2 - b2).toBeGreaterThan(0.3);
  });
  it('brightness lifts, contrast spreads around mid-grey', () => {
    expect(applyMatrix(colorMatrix({ brightness: 50 })!, [0.4, 0.4, 0.4, 1])[0]).toBeGreaterThan(0.5);
    const hi = applyMatrix(colorMatrix({ contrast: 50 })!, [0.7, 0.7, 0.7, 1])[0], lo = applyMatrix(colorMatrix({ contrast: 50 })!, [0.3, 0.3, 0.3, 1])[0];
    expect(hi).toBeGreaterThan(0.75);
    expect(lo).toBeLessThan(0.25);
    expect(applyMatrix(colorMatrix({ contrast: 50 })!, [0.5, 0.5, 0.5, 1])[0]).toBeCloseTo(0.5, 5);
  });
  it('temperature warms (red up, blue down) and tint shifts green', () => {
    const [r, g, b] = applyMatrix(colorMatrix({ temperature: 100 })!, [0.5, 0.5, 0.5, 1]);
    expect(r).toBeGreaterThan(g);
    expect(b).toBeLessThan(g);
    expect(applyMatrix(colorMatrix({ tint: 100 })!, [0.5, 0.5, 0.5, 1])[1]).toBeLessThan(0.45);
  });
  it('duotone maps black to the dark colour and white to the light one', () => {
    const m = colorMatrix({}, { dark: '#ff0000', light: '#0000ff' })!;
    expect(applyMatrix(m, [0, 0, 0, 1]).slice(0, 3)).toEqual([1, 0, 0]);
    expect(applyMatrix(m, [1, 1, 1, 1]).map((v) => Math.round(v * 1000) / 1000).slice(0, 3)).toEqual([0, 0, 1]);
  });
  it('concatenation keeps identity', () => {
    expect(colorMatrix({ brightness: 0 })).toBeNull();
    expect(IDENTITY).toHaveLength(20);
  });
});

describe('image look (rendered)', () => {
  it('crop picks the part of the image that fills the box', () => {
    const p = render('rg', { crop: { x: 0.5, y: 0, w: 0.5, h: 1 } });
    expect(p.at(10, 50)[1]).toBeGreaterThan(200);
    expect(p.at(10, 50)[0]).toBeLessThan(40);
    const q = render('rg', { crop: { x: 0, y: 0, w: 0.5, h: 1 } });
    expect(q.at(90, 50)[0]).toBeGreaterThan(200);
  });

  it('adjust: saturation -100 renders grey, brightness lifts', () => {
    const plain = render('orange').at(50, 50);
    const grey = render('orange', { adjust: { saturation: -100 } }).at(50, 50);
    expect(Math.abs(grey[0]! - grey[2]!)).toBeLessThan(3);
    const bright = render('orange', { adjust: { brightness: 60 } }).at(50, 50);
    expect(bright[1]!).toBeGreaterThan(plain[1]! + 20);
  });

  it('a filter at 0% intensity changes nothing; mono at 100% is grey', () => {
    expect(render('orange', { filter: { name: 'mono', intensity: 0 } }).at(50, 50)).toEqual(render('orange').at(50, 50));
    const m = render('orange', { filter: { name: 'mono', intensity: 100 } }).at(50, 50);
    expect(Math.abs(m[0]! - m[2]!)).toBeLessThan(3);
    const half = render('orange', { filter: { name: 'mono', intensity: 50 } }).at(50, 50);
    expect(half[0]! - half[2]!).toBeGreaterThan(20);
  });

  it('blur softens a hard edge and stays inside the frame', () => {
    const sharp = render('edge', {}, { w: 120, h: 100 }, { x: 0, y: 0, w: 100, h: 100 });
    const soft = render('edge', { adjust: { blur: 100 } }, { w: 120, h: 100 }, { x: 0, y: 0, w: 100, h: 100 });
    expect(sharp.at(47, 50)[0]).toBeLessThan(10);
    expect(soft.at(47, 50)[0]).toBeGreaterThan(30);
    expect(soft.at(110, 50)).toEqual([255, 255, 255, 255]); // page, not blurred image
  });

  it('vignette darkens the corners, not the centre', () => {
    const p = render('grey', { adjust: { vignette: 100 } });
    expect(Math.abs(p.at(50, 50)[0]! - 128)).toBeLessThan(4);
    expect(p.at(2, 2)[0]).toBeLessThan(60);
    const light = render('grey', { adjust: { vignette: -100 } });
    expect(light.at(2, 2)[0]).toBeGreaterThan(200);
  });

  it('highlights and shadows move the bright and dark ends (SkSL)', () => {
    const full = { crop: { x: 0, y: 0, w: 1, h: 1 } };
    const base = render('ramp', full, { w: 64, h: 10 }, { x: 0, y: 0, w: 64, h: 10 });
    const p = render('ramp', { ...full, adjust: { shadows: 100, highlights: -100 } }, { w: 64, h: 10 }, { x: 0, y: 0, w: 64, h: 10 });
    expect(p.at(6, 5)[0]!).toBeGreaterThan(base.at(6, 5)[0]! + 30); // shadows lifted
    expect(p.at(58, 5)[0]!).toBeLessThan(base.at(58, 5)[0]! - 30); // highlights pulled down
  });

  it('sharpen increases local contrast', () => {
    const box = { x: 0, y: 0, w: 32, h: 32 };
    const contrast = (p: ReturnType<typeof render>) => { let s = 0; for (let x = 4; x < 28; x++) s += Math.abs(p.at(x, 10)[0]! - p.at(x + 1, 10)[0]!); return s; };
    const plain = render('checker', { adjust: { blur: 20 } }, { w: 32, h: 32 }, box);
    const sharp = render('checker', { adjust: { blur: 20, sharpen: 100 } }, { w: 32, h: 32 }, box);
    expect(contrast(sharp)).toBeGreaterThan(contrast(plain));
  });

  it('pixelate turns detail into flat cells', () => {
    const p = render('ramp', { crop: { x: 0, y: 0, w: 1, h: 1 }, effect: { type: 'pixelate', size: 100 } }, { w: 200, h: 100 }, { x: 0, y: 0, w: 200, h: 100 });
    // cells are 8 px wide (8% of the short side): neighbours inside one cell match
    expect(p.at(1, 50)).toEqual(p.at(6, 50));
    expect(p.at(1, 50)[0]).not.toEqual(p.at(150, 50)[0]);
  });

  it('duotone recolours by brightness', () => {
    const p = render('edge', { effect: { type: 'duotone', dark: '#ff0000', light: '#0000ff' } });
    expect(p.at(20, 50).slice(0, 3)).toEqual([255, 0, 0]);
    expect(p.at(80, 50)[2]).toBeGreaterThan(240);
    expect(p.at(80, 50)[0]).toBeLessThan(15);
  });

  it('drop shadow paints outside the frame in the direction given', () => {
    const p = render('grey', { effect: { type: 'shadow', offset: 100, direction: 0, blur: 0, transparency: 0, color: '#ff0000' } }, { w: 200, h: 100 }, { x: 20, y: 20, w: 60, h: 60 });
    // offset = 15% of 60 px = 9 px to the right
    expect(p.at(84, 50).slice(0, 3)).toEqual([255, 0, 0]);
    expect(p.at(14, 50)).toEqual([255, 255, 255, 255]);
  });

  it('glow surrounds the image with its colour', () => {
    const p = render('grey', { effect: { type: 'glow', size: 100, transparency: 0, color: '#00ff00' } }, { w: 200, h: 200 }, { x: 50, y: 50, w: 100, h: 100 });
    const out = p.at(45, 100);
    expect(out[1]!).toBeGreaterThan(out[0]! + 30);
  });

  it('outline follows the shape of a transparent PNG', () => {
    const p = render('cut', { effect: { type: 'outline', thickness: 100, color: '#ff0000' } });
    expect(p.at(50, 50).slice(0, 3)).toEqual([0, 0, 255]); // the square itself
    expect(p.at(50, 27).slice(0, 3)).toEqual([255, 0, 0]); // just above it: outline (5.5 px)
    expect(p.at(5, 5)).toEqual([255, 255, 255, 255]); // far away: untouched page
  });

  it('corner radius still clips an adjusted image', () => {
    const p = render('grey', { radius: 40, adjust: { brightness: -50 } });
    expect(p.at(1, 1)).toEqual([255, 255, 255, 255]);
    expect(p.at(50, 50)[0]).toBeLessThan(110);
  });
});

describe('image look with M6 frames and vector export', () => {
  it('a masked (framed) image keeps its look and its frame shape', () => {
    const p = render('grey', { mask: 'ellipse', adjust: { brightness: -50 } });
    expect(p.at(2, 2)).toEqual([255, 255, 255, 255]); // outside the circle: page
    expect(p.at(50, 50)[0]).toBeLessThan(110); // inside: darkened
  });

  it('a shadow on a framed image follows the frame', () => {
    const p = render('grey', { mask: 'ellipse', effect: { type: 'shadow', color: '#000000', offset: 100, direction: 0, blur: 0, transparency: 0 } }, { w: 140, h: 140 }, { x: 20, y: 20, w: 100, h: 100 });
    expect(p.at(130, 70)[0]).toBeLessThan(60); // the circle's shadow, 15 px to the right
    expect(p.at(37, 22)).toEqual([255, 255, 255, 255]); // where a box's shadow would be: still page
  });

  it('SVG export draws an image with a look as a picture of that element', () => {
    let doc = createDoc({ width: 100, height: 100 });
    doc = addElements(doc, doc.pages[0]!.id, [{ ...image('grey', { x: 0, y: 0, w: 100, h: 100 }), adjust: { saturation: -100 } }]);
    doc = { ...doc, assets: { grey: { mime: 'image/png' } } };
    const greyPng = renderer.exportPage(createDoc({ width: 1, height: 1 }), createDoc({ width: 1, height: 1 }).pages[0]!, { format: 'png' });
    const svg = exportSvg(renderer, doc, doc.pages[0]!, { assets: new Map([['grey', greyPng]]) });
    expect(svg).toContain('data:image/png;base64,');
    expect(svg).not.toContain('clip-path'); // rastered, not the plain vector picture
  });
});

describe('image look (r15)', () => {
  const sum = (a: number[], b: number[]) => a.slice(0, 3).reduce((s, v, i) => s + Math.abs(v - b[i]!), 0);

  it('whites and blacks move only their end of the tones', () => {
    const whole = { crop: { x: 0, y: 0, w: 1, h: 1 } };
    const base = render('ramp', whole, { w: 64, h: 8 }, { x: 0, y: 0, w: 64, h: 8 });
    const whites = render('ramp', { ...whole, adjust: { whites: -100 } }, { w: 64, h: 8 }, { x: 0, y: 0, w: 64, h: 8 });
    const blacks = render('ramp', { ...whole, adjust: { blacks: 100 } }, { w: 64, h: 8 }, { x: 0, y: 0, w: 64, h: 8 });
    expect(whites.at(62, 4)[0]!).toBeLessThan(base.at(62, 4)[0]! - 30);
    expect(whites.at(5, 4)[0]!).toBeCloseTo(base.at(5, 4)[0]!, -1);
    expect(blacks.at(2, 4)[0]!).toBeGreaterThan(base.at(2, 4)[0]! + 30);
    expect(blacks.at(60, 4)[0]!).toBeCloseTo(base.at(60, 4)[0]!, -1);
  });

  it('vibrance lifts a dull colour more than a strong one', () => {
    renderer.setImage('dull', png(4, 4, () => [150, 120, 110, 255]));
    renderer.setImage('strong', png(4, 4, () => [230, 30, 30, 255]));
    const gain = (id: string) => {
      const a = render(id).at(50, 50), b = render(id, { adjust: { vibrance: 100 } }).at(50, 50);
      return (b[0]! - b[2]!) / (a[0]! - a[2]!);
    };
    expect(gain('dull')).toBeGreaterThan(1.5);
    expect(gain('dull')).toBeGreaterThan(gain('strong'));
  });

  it('texture and clarity raise local contrast; negative texture softens', () => {
    const edge = (look: Partial<ImageElement>) => render('edge', look).at(47, 50)[0]!;
    expect(edge({ adjust: { texture: -100 } })).toBeGreaterThan(edge({}));
    const hi = render('checker', { adjust: { clarity: 100 } }), lo = render('checker', { adjust: { clarity: -100 } });
    const spread = (r: ReturnType<typeof render>) => Math.abs(r.at(50, 50)[0]! - r.at(53, 50)[0]!);
    expect(spread(hi)).toBeGreaterThanOrEqual(spread(lo));
  });

  it('grain is noise, and the same on every render', () => {
    const a = render('grey', { adjust: { grain: 100 } }), b = render('grey', { adjust: { grain: 100 } });
    const seen = new Set<number>();
    for (let x = 0; x < 100; x++) seen.add(a.at(x, 50)[0]!);
    expect(seen.size).toBeGreaterThan(10);
    expect(a.at(33, 33)).toEqual(b.at(33, 33));
  });

  it('colour edit moves one band and leaves others and greys alone', () => {
    const r = render('rg', { colorEdit: { red: { hue: 100 } } });
    expect(r.at(25, 50)[1]!).toBeGreaterThan(50); // red turned towards orange
    expect(sum(r.at(75, 50), [0, 255, 0])).toBeLessThan(8);
    const s = render('rg', { colorEdit: { green: { saturation: -100 } } });
    expect(Math.abs(s.at(75, 50)[0]! - s.at(75, 50)[1]!)).toBeLessThan(12);
    expect(sum(render('grey', { colorEdit: { red: { hue: 100, saturation: 100, lightness: 100 } } }).at(50, 50), [128, 128, 128])).toBeLessThan(4);
    const light = render('rg', { colorEdit: { red: { lightness: 100 } } });
    expect(light.at(25, 50)[1]!).toBeGreaterThan(40);
  });

  it('invert gives the negative; duotone has an intensity', () => {
    expect(sum(render('rg', { invert: true }).at(25, 50), [0, 255, 255])).toBeLessThan(6);
    const full = render('grey', { duotone: { dark: '#ff0000', light: '#ff0000' } }).at(50, 50);
    const half = render('grey', { duotone: { dark: '#ff0000', light: '#ff0000', intensity: 50 } }).at(50, 50);
    expect(sum(full, [255, 0, 0])).toBeLessThan(6);
    expect(sum(half, [191, 64, 64])).toBeLessThan(10);
  });

  it('shadow, duotone and stylize can be on together', () => {
    const r = render('rg', { shadow: { style: 'drop', size: 50, blur: 0, angle: 0, distance: 60, transparency: 0, color: '#0000ff' }, duotone: { dark: '#00ff00', light: '#00ff00' } }, { w: 200, h: 100 }, { x: 40, y: 0, w: 100, h: 100 });
    expect(sum(r.at(80, 50), [0, 255, 0])).toBeLessThan(6);
    expect(sum(r.at(146, 50), [0, 0, 255])).toBeLessThan(6);
  });

  for (const style of ['glow', 'angle', 'curved', 'lift', 'backdrop', 'outline'] as const) {
    it(`${style} shadow draws outside the picture`, () => {
      const plain = render('grey', {}, { w: 200, h: 200 }, { x: 50, y: 50, w: 100, h: 100 });
      const r = render('grey', { shadow: { ...defaultShadow(style), transparency: 0, color: '#ff00ff', blur: 10, size: 80, distance: 60, angle: style === 'angle' ? 135 : 45 } }, { w: 200, h: 200 }, { x: 50, y: 50, w: 100, h: 100 });
      let changed = 0;
      for (let y = 0; y < 200; y += 3) for (let x = 0; x < 200; x += 3) {
        if (x >= 50 && x < 150 && y >= 50 && y < 150) continue;
        if (sum(r.at(x, y), plain.at(x, y)) > 40) changed++;
      }
      expect(changed).toBeGreaterThan(5);
    });
  }

  for (const st of ['halftone', 'posterize', 'glitch', 'screen', 'sketch', 'pixelate'] as const) {
    it(`${st} stylize changes the picture`, () => {
      const whole = { crop: { x: 0, y: 0, w: 1, h: 1 } };
      const asset = st === 'pixelate' || st === 'glitch' ? 'checker' : 'ramp';
      const plain = render(asset, whole), r = render(asset, { ...whole, stylize: { type: st, amount: 70 } });
      let changed = 0;
      for (let y = 0; y < 100; y += 2) for (let x = 0; x < 100; x += 2) if (sum(r.at(x, y), plain.at(x, y)) > 30) changed++;
      expect(changed).toBeGreaterThan(50);
    });
  }

  it('older effects still draw through the new fields', () => {
    const r = render('rg', { effect: { type: 'duotone', dark: '#00ff00', light: '#00ff00' } });
    expect(sum(r.at(25, 50), [0, 255, 0])).toBeLessThan(6);
    expect(duotoneOf({ effect: { type: 'duotone', dark: '#000000', light: '#ffffff' } })?.dark).toBe('#000000');
    expect(shadowOf({ effect: { type: 'glow', size: 1, transparency: 2, color: '#123456' } })?.style).toBe('glow');
    expect(stylizeOf({ effect: { type: 'pixelate', size: 9 } })).toEqual({ type: 'pixelate', amount: 9 });
  });

  it('selective edits follow the matte; without one they do nothing', () => {
    renderer.setImage('half-matte', png(20, 20, (x) => (x < 10 ? [255, 255, 255, 255] : [0, 0, 0, 0])));
    const on = render('grey', { matte: 'half-matte', selective: { foreground: { brightness: 100 }, background: { brightness: -100 } } });
    expect(on.at(20, 50)[0]!).toBeGreaterThan(150);
    expect(on.at(80, 50)[0]!).toBeLessThan(110);
    expect(hasLook({ selective: { foreground: { brightness: 100 } } })).toBe(false);
    const pop = render('rg', { matte: 'half-matte', selective: { background: { saturation: -100 } } });
    expect(sum(pop.at(25, 50), [255, 0, 0])).toBeLessThan(6);
    expect(Math.abs(pop.at(75, 50)[0]! - pop.at(75, 50)[1]!)).toBeLessThan(12);
  });

  it('auto focus blurs only behind the subject', () => {
    renderer.setImage('left-matte', png(20, 20, (x) => (x < 10 ? [255, 255, 255, 255] : [0, 0, 0, 0])));
    const r = render('checker', { matte: 'left-matte', autoFocus: 100 });
    const range = (x0: number, x1: number) => { let lo = 255, hi = 0; for (let x = x0; x < x1; x++) { const v = r.at(x, 48)[0]!; lo = Math.min(lo, v); hi = Math.max(hi, v); } return hi - lo; };
    expect(range(5, 40)).toBeGreaterThan(100);
    expect(range(65, 95)).toBeLessThan(60);
  });

  it('a blur brush blurs only where it was painted', () => {
    renderer.setImage('brush', png(20, 20, (x) => (x >= 10 ? [255, 255, 255, 255] : [0, 0, 0, 0])));
    const r = render('checker', { blurBrush: { asset: 'brush', intensity: 100 } });
    const range = (x0: number, x1: number) => { let lo = 255, hi = 0; for (let x = x0; x < x1; x++) { const v = r.at(x, 48)[0]!; lo = Math.min(lo, v); hi = Math.max(hi, v); } return hi - lo; };
    expect(range(5, 40)).toBeGreaterThan(100);
    expect(range(65, 95)).toBeLessThan(60);
  });

  it('skin smoothing leaves non-skin colours alone', () => {
    renderer.setImage('skin', png(32, 32, (x, y) => ((x + y) % 2 ? [226, 170, 140, 255] : [200, 140, 112, 255])));
    const spread = (id: string, look: Partial<ImageElement>) => { const r = render(id, look); let lo = 255, hi = 0; for (let x = 20; x < 60; x++) { const v = r.at(x, 41)[0]!; lo = Math.min(lo, v); hi = Math.max(hi, v); } return hi - lo; };
    expect(spread('skin', { retouch: 100 })).toBeLessThan(spread('skin', {}));
    expect(spread('checker', { retouch: 100 })).toBeGreaterThan(80);
  });

  it('straighten keeps the box covered; tilt warps', () => {
    const r = render('rg', { straighten: 30 });
    for (const [x, y] of [[1, 1], [98, 1], [1, 98], [98, 98]] as const) expect(r.at(x, y)[3]).toBe(255);
    expect(render('rg').at(50, 2)).not.toEqual(r.at(50, 2));
    const t = render('edge', { tiltX: 60 });
    expect(t.at(50, 2)).not.toEqual(render('edge').at(50, 2));
    expect(straightenMatrix({ x: 0, y: 0, w: 10, h: 10 }, {})).toBeNull();
  });

  it('a border follows a frame and rounded corners', () => {
    const r = render('grey', { border: { color: '#ff0000', width: 8 }, radius: 0 });
    expect(sum(r.at(50, 1), [255, 0, 0])).toBeLessThan(6);
    const round = render('grey', { border: { color: '#ff0000', width: 8 }, mask: 'ellipse' });
    expect(sum(round.at(50, 2), [255, 0, 0])).toBeLessThan(10);
    expect(sum(round.at(2, 2), [255, 255, 255])).toBeLessThan(6);
  });

  it('blend modes mix with the page; multiply on white keeps the picture, on black goes black', () => {
    let doc = createDoc({ width: 100, height: 100 });
    doc = addElements(doc, doc.pages[0]!.id, [{ ...image('grey', { x: 0, y: 0, w: 100, h: 100 }), blend: 'multiply' }]);
    const white = pixels(renderer.exportPage(doc, doc.pages[0]!, { format: 'png', scale: 1 }));
    expect(sum(white.at(50, 50), [128, 128, 128])).toBeLessThan(6);
    const dark = { ...doc.pages[0]!, background: { type: 'solid' as const, color: '#000000' } };
    expect(pixels(renderer.exportPage(doc, dark, { format: 'png', scale: 1 })).at(50, 50).slice(0, 3)).toEqual([0, 0, 0]);
  });

  it('matte and brush assets survive pruneAssets', () => {
    let doc = createDoc({ width: 10, height: 10 });
    const meta = { name: 'x', mime: 'image/png', width: 1, height: 1, size: 1 } as any;
    doc = { ...doc, assets: { a: meta, m: meta, b: meta, gone: meta } };
    doc = addElements(doc, doc.pages[0]!.id, [{ ...image('a', { x: 0, y: 0, w: 5, h: 5 }), matte: 'm', blurBrush: { asset: 'b', intensity: 5 } }]);
    expect(Object.keys(pruneAssets(doc).assets).sort()).toEqual(['a', 'b', 'm']);
  });
});
