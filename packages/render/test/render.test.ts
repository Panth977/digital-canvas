import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CanvasKit } from 'canvaskit-wasm';
import { addElements, createDoc, shape, text, image, updatePage } from '@digital-canvas/scene';
import { FontLibrary, Renderer } from '../src/index.ts';

const require = createRequire(import.meta.url);
const fontDir = new URL('../../../apps/web/public/fonts/', import.meta.url);
let ck: CanvasKit;
let renderer: Renderer;

beforeAll(async () => {
  const init = require('canvaskit-wasm/bin/full/canvaskit.js');
  ck = await init();
  const fonts = new FontLibrary(ck);
  await fonts.loadBundled(fontDir.href, async (url) => readFileSync(new URL(url)).buffer as ArrayBuffer);
  renderer = new Renderer(ck, fonts);
});

/** Decode a PNG back into RGBA pixels. */
function pixels(png: Uint8Array) {
  const img = ck.MakeImageFromEncoded(png)!;
  const w = img.width(), h = img.height();
  const px = img.readPixels(0, 0, { width: w, height: h, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array;
  img.delete();
  return { w, h, at: (x: number, y: number) => Array.from(px.slice((y * w + x) * 4, (y * w + x) * 4 + 4)) };
}

describe('Renderer', () => {
  it('draws background, shapes with rotation and opacity', () => {
    let doc = createDoc({ width: 200, height: 100 });
    const page = doc.pages[0]!.id;
    doc = updatePage(doc, page, { background: { type: 'solid', color: '#0000ff' } });
    doc = addElements(doc, page, [
      shape('rect', { x: 0, y: 0, w: 100, h: 100 }, { type: 'solid', color: '#ff0000' }),
      { ...shape('ellipse', { x: 120, y: 20, w: 60, h: 60 }, { type: 'solid', color: '#00ff00' }), opacity: 0.5 },
    ]);
    const p = pixels(renderer.exportPage(doc, doc.pages[0]!));
    expect([p.w, p.h]).toEqual([200, 100]);
    expect(p.at(50, 50)).toEqual([255, 0, 0, 255]);
    expect(p.at(190, 5)).toEqual([0, 0, 255, 255]);
    const mid = p.at(150, 50); // 50% green over blue
    expect(mid[1]).toBeGreaterThan(110);
    expect(mid[2]).toBeGreaterThan(110);
  });

  it('exports at scale and transparent', () => {
    const doc = createDoc({ width: 100, height: 50 });
    const p = pixels(renderer.exportPage(doc, doc.pages[0]!, { scale: 2, transparent: true }));
    expect([p.w, p.h]).toEqual([200, 100]);
    expect(p.at(10, 10)[3]).toBe(0);
  });

  it('lays out and draws text with the bundled font', () => {
    const t = text('Hello Digital Canvas, wrapping onto lines', { x: 10, y: 10, w: 180, h: 10 }, { fontSize: 24, color: '#000000' });
    const h = renderer.textHeight(t);
    expect(h).toBeGreaterThan(50); // wraps to 2+ lines
    let doc = createDoc({ width: 200, height: 120 });
    doc = addElements(doc, doc.pages[0]!.id, [{ ...t, h }]);
    const p = pixels(renderer.exportPage(doc, doc.pages[0]!));
    let dark = 0;
    for (let y = 10; y < 10 + h; y++) for (let x = 10; x < 190; x++) if (p.at(x, y)[0]! < 100) dark++;
    expect(dark).toBeGreaterThan(300);
    const bold = renderer.textWidth({ ...t, style: { ...t.style, bold: true } });
    expect(bold).toBeGreaterThan(renderer.textWidth(t));
  });

  it('draws images cover-fit and placeholders for missing ones', () => {
    // a 2x1 PNG: left red, right green
    const s = ck.MakeSurface(2, 1)!;
    const c = s.getCanvas();
    const pt = new ck.Paint();
    pt.setColor(ck.RED); c.drawRect(ck.XYWHRect(0, 0, 1, 1), pt);
    pt.setColor(ck.Color4f(0, 1, 0, 1)); c.drawRect(ck.XYWHRect(1, 0, 1, 1), pt);
    const png = s.makeImageSnapshot().encodeToBytes()!;
    s.delete(); pt.delete();
    expect(renderer.setImage('a1', png)).toEqual({ width: 2, height: 1 });
    let doc = createDoc({ width: 100, height: 100 });
    doc = addElements(doc, doc.pages[0]!.id, [image('a1', { x: 0, y: 0, w: 100, h: 50 }), image('missing', { x: 0, y: 50, w: 100, h: 50 })]);
    const p = pixels(renderer.exportPage(doc, doc.pages[0]!));
    expect(p.at(10, 25)[0]).toBeGreaterThan(200);
    expect(p.at(90, 25)[1]).toBeGreaterThan(200);
    expect(p.at(50, 75)).toEqual([217, 219, 224, 255]);
  });
});

describe('exportPdf', () => {
  it('writes one PDF page per design page at physical size', async () => {
    const { exportPdf } = await import('../src/index.ts');
    const { PDFDocument } = await import('pdf-lib');
    let doc = createDoc({ width: 210, height: 297, unit: 'mm' });
    doc = addElements(doc, doc.pages[0]!.id, [shape('rect', { x: 10, y: 10, w: 100, h: 100 })]);
    doc = { ...doc, pages: [...doc.pages, { ...doc.pages[0]!, id: 'p2' }] };
    const bytes = await exportPdf(renderer, doc, { dpi: 72 });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2);
    const { width, height } = pdf.getPage(0).getSize();
    expect(width).toBeCloseTo(595.3, 0); // A4 in points
    expect(height).toBeCloseTo(841.9, 0);
  });
});

describe('text runs and embedded fonts', () => {
  it('draws runs with their own colour', () => {
    const t = { ...text('Red Blue', { x: 0, y: 0, w: 300, h: 60 }, { fontSize: 40, color: '#ff0000' }), runs: [{ text: 'Red ' }, { text: 'Blue', style: { color: '#0000ff' } }] };
    let doc = createDoc({ width: 300, height: 60 });
    doc = addElements(doc, doc.pages[0]!.id, [{ ...t, h: renderer.textHeight(t) }]);
    const p = pixels(renderer.exportPage(doc, doc.pages[0]!));
    let red = 0, blue = 0;
    for (let y = 0; y < 60; y++) for (let x = 0; x < 300; x++) { const c = p.at(x, y); if (c[0]! > 200 && c[2]! < 80) red++; if (c[2]! > 200 && c[0]! < 80) blue++; }
    expect(red).toBeGreaterThan(50);
    expect(blue).toBeGreaterThan(50);
  });
  it('a font registered once by key is not registered again', () => {
    const fonts = new FontLibrary(ck);
    const bytes = readFileSync(new URL('Inter-Bold.ttf', fontDir));
    fonts.addOnce('X', 'k1', bytes);
    fonts.addOnce('X', 'k1', bytes);
    expect(fonts.version).toBe(1);
    fonts.dispose();
  });
});
