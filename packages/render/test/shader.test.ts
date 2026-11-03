import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CanvasKit } from 'canvaskit-wasm';
import { addElements, createDoc, groupElements, image, shape, text, type Element, type ShaderFx } from '@digital-canvas/scene';
import { compileShader, drawFrameAt, exportSvg, exportVectorPdf, FontLibrary, Renderer } from '../src/index.ts';

const require = createRequire(import.meta.url);
const fontDir = new URL('../../../apps/web/public/fonts/', import.meta.url);
let ck: CanvasKit;
let renderer: Renderer;

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
  return { w, h, px, at: (x: number, y: number) => Array.from(px.slice((y * w + x) * 4, (y * w + x) * 4 + 4)) };
}

const INVERT = `uniform shader image; uniform float2 resolution; uniform float time; uniform float amount;
half4 main(float2 p) { half4 c = image.eval(p); return half4(mix(c.rgb, c.a - c.rgb, amount), c.a); }`;
const invert = (amount = 1): ShaderFx => ({ name: 'Invert', sksl: INVERT, params: { amount } });
const BROKEN: ShaderFx = { name: 'Broken', sksl: 'uniform shader image; half4 main(float2 p) { return nope(p); }' };

function page(els: Element[], w = 100, h = 100) {
  let doc = createDoc({ width: w, height: h });
  doc = addElements(doc, doc.pages[0]!.id, els);
  return doc;
}
const render = (els: Element[], scale = 1) => { const d = page(els); return pixels(renderer.exportPage(d, d.pages[0]!, { scale })); };

beforeAll(async () => {
  const init = require('canvaskit-wasm/bin/full/canvaskit.js');
  ck = await init();
  const fonts = new FontLibrary(ck);
  await fonts.loadBundled(fontDir.href, async (url) => readFileSync(new URL(url)).buffer as ArrayBuffer);
  renderer = new Renderer(ck, fonts);
  renderer.setImage('orange', png(8, 8, () => [200, 120, 40, 255]));
});

describe('compileShader', () => {
  it('lists the uniforms of a good shader', () => {
    const r = compileShader(ck, INVERT);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.uniforms.map((u) => [u.name, u.floats])).toEqual([['resolution', 2], ['time', 1], ['amount', 1]]);
  });
  it('reports the compiler error', () => {
    const r = compileShader(ck, BROKEN.sksl);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/nope/);
  });
  it('needs exactly one child shader', () => {
    const r = compileShader(ck, 'half4 main(float2 p) { return half4(1); }');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/uniform shader image/);
  });
});

describe('shader effects', () => {
  it('inverts an image', () => {
    const box = { x: 10, y: 10, w: 80, h: 80 };
    expect(render([image('orange', box)]).at(50, 50)).toEqual([200, 120, 40, 255]);
    const p = render([{ ...image('orange', box), shader: invert() }]);
    expect(p.at(50, 50)).toEqual([55, 135, 215, 255]);
    expect(p.at(5, 5)).toEqual([255, 255, 255, 255]); // the page around it is untouched
  });

  it('uses params (amount 0 = no change) and works at any scale', () => {
    const box = { x: 10, y: 10, w: 80, h: 80 };
    expect(render([{ ...image('orange', box), shader: invert(0) }]).at(50, 50)).toEqual([200, 120, 40, 255]);
    const p = render([{ ...image('orange', box), shader: invert(), rotation: 30 }], 2.5);
    expect(p.w).toBe(250);
    expect(p.at(125, 125)).toEqual([55, 135, 215, 255]);
  });

  it('inverts a text element', () => {
    const t = { ...text('MMMM', { x: 5, y: 20, w: 90, h: 60 }, { fontSize: 40, color: '#000000', fontWeight: 700 }) };
    const dark = (p: ReturnType<typeof render>) => { let n = 0; for (let i = 0; i < p.px.length; i += 4) if (p.px[i]! < 60) n++; return n; };
    const light = (p: ReturnType<typeof render>) => { let n = 0; for (let i = 0; i < p.px.length; i += 4) if (p.px[i]! > 200 && p.px[i + 1]! > 200 && p.px[i + 2]! > 200) n++; return n; };
    const plain = render([shape('rect', { x: 0, y: 0, w: 100, h: 100 }, { type: 'solid', color: '#808080' }), t]);
    const shaded = render([shape('rect', { x: 0, y: 0, w: 100, h: 100 }, { type: 'solid', color: '#808080' }), { ...t, shader: invert() }]);
    expect(dark(plain)).toBeGreaterThan(300); // black glyphs on grey
    expect(dark(shaded)).toBe(0); // …now white glyphs: only the text was inverted, not the grey under it
    expect(light(shaded)).toBeGreaterThan(300);
    expect(shaded.at(2, 2)).toEqual(plain.at(2, 2));
  });

  it('a broken shader draws the element unshaded', () => {
    const box = { x: 10, y: 10, w: 80, h: 80 };
    expect(render([{ ...image('orange', box), shader: BROKEN }]).at(50, 50)).toEqual([200, 120, 40, 255]);
  });

  it('shades a whole group', () => {
    const a = shape('rect', { x: 0, y: 0, w: 50, h: 100 }, { type: 'solid', color: '#ff0000' });
    const b = shape('rect', { x: 50, y: 0, w: 50, h: 100 }, { type: 'solid', color: '#0000ff' });
    let doc = page([a, b]);
    doc = groupElements(doc, [a.id, b.id])!.doc;
    const g = doc.pages[0]!.elements[0]!;
    doc = { ...doc, pages: [{ ...doc.pages[0]!, elements: [{ ...g, shader: invert() }] }] };
    const p = pixels(renderer.exportPage(doc, doc.pages[0]!));
    expect(p.at(25, 50)).toEqual([0, 255, 255, 255]);
    expect(p.at(75, 50)).toEqual([255, 255, 0, 255]);
  });

  it('gives time and resolution to the shader', () => {
    // red = time / 4, green = resolution.x / 1000
    const sksl = `uniform shader image; uniform float2 resolution; uniform float time; uniform float unknown;
      half4 main(float2 p) { half4 c = image.eval(p); return half4(time / 4, resolution.x / 1000, unknown, 1) * c.a; }`;
    const doc = { ...page([{ ...shape('rect', { x: 0, y: 0, w: 100, h: 100 }, { type: 'solid', color: '#ffffff' }), shader: { name: 't', sksl } }]), video: true };
    const still = pixels(renderer.exportPage(doc, doc.pages[0]!));
    expect(still.at(50, 50)[0]).toBe(0);
    expect(still.at(50, 50)[2]).toBe(0);
    const w = still.at(50, 50)[1]! / 255 * 1000; // the layer: the box plus a little room, 100..120 px
    expect(w).toBeGreaterThan(95);
    expect(w).toBeLessThan(125);
    const surface = ck.MakeSurface(100, 100)!;
    drawFrameAt(renderer, surface.getCanvas(), doc, 2);
    const img = surface.makeImageSnapshot();
    const px = img.readPixels(50, 50, { width: 1, height: 1, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array;
    img.delete(); surface.delete();
    expect(Math.abs(px[0]! - 128)).toBeLessThan(3); // time 2 s → 0.5
    expect(renderer.time).toBe(0);
  });

  it('vector exports draw a shaded element as an image', async () => {
    const box = { x: 10, y: 10, w: 80, h: 80 };
    const doc = page([{ ...shape('rect', box, { type: 'solid', color: '#ff0000' }), shader: invert() }, shape('rect', { x: 0, y: 0, w: 5, h: 5 }, { type: 'solid', color: '#00ff00' })]);
    const svg = exportSvg(renderer, doc, doc.pages[0]!, { assets: new Map() });
    expect(svg.match(/<image /g)?.length).toBe(1);
    expect(svg).toContain('fill="#00ff00"');
    const pdf = await exportVectorPdf(renderer, doc, { assets: new Map() });
    expect(pdf.length).toBeGreaterThan(500);
  });
});
