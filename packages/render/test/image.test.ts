import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CanvasKit } from 'canvaskit-wasm';
import { addElements, createDoc, image, type ImageElement } from '@digital-canvas/scene';
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
