import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CanvasKit } from 'canvaskit-wasm';
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { addElements, chart, createDoc, frame, freehand, line, qrCode, shape, table, tableSetCell, text, type Doc, type Element } from '@digital-canvas/scene';
import { exportSvg, exportVectorPdf, FontLibrary, Renderer } from '../src/index.ts';

const require = createRequire(import.meta.url);
const fontDir = new URL('../../../apps/web/public/fonts/', import.meta.url);
let ck: CanvasKit;
let renderer: Renderer;

beforeAll(async () => {
  ck = await require('canvaskit-wasm/bin/full/canvaskit.js')();
  const fonts = new FontLibrary(ck);
  await fonts.loadBundled(fontDir.href, async (url) => readFileSync(new URL(url)).buffer as ArrayBuffer);
  renderer = new Renderer(ck, fonts);
});

function pixels(png: Uint8Array) {
  const img = ck.MakeImageFromEncoded(png)!;
  const w = img.width(), h = img.height();
  const px = img.readPixels(0, 0, { width: w, height: h, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array;
  img.delete();
  return { w, h, at: (x: number, y: number) => Array.from(px.slice((y * w + x) * 4, (y * w + x) * 4 + 4)) };
}

const docOf = (els: Element[], w = 200, h = 200): Doc => {
  const d = createDoc({ width: w, height: h });
  return addElements(d, d.pages[0]!.id, els);
};
const render = (doc: Doc) => pixels(renderer.exportPage(doc, doc.pages[0]!));
/** Pixels in a region matching a test. */
function count(p: ReturnType<typeof pixels>, test: (c: number[]) => boolean, x0 = 0, y0 = 0, x1 = p.w, y1 = p.h): number {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (test(p.at(x, y))) n++;
  return n;
}
const red = (c: number[]) => c[0]! > 200 && c[1]! < 60 && c[2]! < 60;
const dark = (c: number[]) => c[0]! < 90 && c[1]! < 90 && c[2]! < 90;

describe('M6 elements render', () => {
  it('a line with an arrow head and a dashed line', () => {
    const p = render(docOf([
      line({ x: 20, y: 50 }, { x: 180, y: 50 }, { end: 'triangle', stroke: { color: '#ff0000', width: 6 } }),
      line({ x: 20, y: 150 }, { x: 180, y: 150 }, { stroke: { color: '#ff0000', width: 6, dash: 'dashed' } }),
    ]));
    expect(red(p.at(100, 50))).toBe(true);
    // the triangle head is wider than the line
    expect(red(p.at(165, 50 - 8))).toBe(true);
    expect(red(p.at(100, 50 - 7))).toBe(false);
    // dashes: a run of red then a gap
    const row = Array.from({ length: 160 }, (_, i) => red(p.at(20 + i, 150)));
    expect(row.filter(Boolean).length).toBeGreaterThan(60);
    expect(row.filter((x) => !x).length).toBeGreaterThan(30);
  });

  it('a table: cell fills, borders and cell text', () => {
    let t = { ...table(2, 2, { x: 10, y: 10, w: 180, h: 100 }, { fontSize: 20, color: '#000000' }), border: { color: '#0000ff', width: 2 } };
    t = { ...t, ...tableSetCell(t, 1, 1, { text: 'Hi', fill: '#ff0000' }) };
    const p = render(docOf([t]));
    expect(p.at(100, 11)[2]).toBeGreaterThan(200); // top border is blue
    expect(red(p.at(180, 100))).toBe(true); // filled cell
    expect(count(p, dark, 100, 60, 190, 110)).toBeGreaterThan(30); // "Hi" in that cell
  });

  it('charts: column bars and a pie in the series colours', () => {
    const col = { ...chart('column', { x: 0, y: 0, w: 200, h: 200 }), colors: ['#ff0000', '#00ff00'], series: [{ name: 'a', values: [5, 10] }], labels: ['x', 'y'] };
    const p = render(docOf([col]));
    expect(count(p, red)).toBeGreaterThan(1000);
    const pie = { ...chart('pie', { x: 0, y: 0, w: 200, h: 200 }), legend: false, colors: ['#ff0000'], series: [{ name: 'a', values: [1] }], labels: ['all'] };
    const q = render(docOf([pie]));
    expect(red(q.at(100, 130))).toBe(true);
    expect(count(q, red)).toBeGreaterThan(25000); // ~π·94²
  });

  it('a QR code has dark finder squares in its corners', () => {
    const p = render(docOf([qrCode('hello', { x: 0, y: 0, w: 200, h: 200 })]));
    const m = 200 / 25; // module size: 21 modules + 2×2 quiet zone
    expect(dark(p.at(Math.round(m * 2.5), Math.round(m * 2.5)))).toBe(true); // finder ring
    expect(dark(p.at(Math.round(m * 3.5), Math.round(m * 3.5)))).toBe(false); // gap inside the finder
    expect(dark(p.at(Math.round(m * 4.5), Math.round(m * 4.5)))).toBe(true); // finder centre
    expect(dark(p.at(2, 2))).toBe(false); // quiet zone
  });

  it('a freehand path and a frame: the photo only shows inside the mask', () => {
    const stroke = freehand([{ x: 20, y: 20 }, { x: 100, y: 30 }, { x: 180, y: 20 }], { color: '#ff0000', size: 10, brush: 'pen' })!;
    const s = ck.MakeSurface(4, 4)!;
    const paint = new ck.Paint();
    paint.setColor(ck.Color4f(0, 0, 1, 1));
    s.getCanvas().drawRect(ck.XYWHRect(0, 0, 4, 4), paint);
    renderer.setImage('blue', s.makeImageSnapshot().encodeToBytes()!);
    s.delete(); paint.delete();
    const p = render(docOf([stroke, frame('ellipse', { x: 50, y: 80, w: 100, h: 100 }, 'blue'), frame('rect', { x: 0, y: 150, w: 40, h: 40 })]));
    expect(count(p, red, 0, 0, 200, 60)).toBeGreaterThan(400);
    expect(p.at(100, 130)[2]).toBeGreaterThan(200); // centre of the circle: photo
    expect(p.at(52, 82)).toEqual([255, 255, 255, 255]); // the box corner is outside the circle
    expect(p.at(3, 153)).toEqual([212, 217, 224, 255]); // an empty frame is grey
  });
});

describe('SVG export', () => {
  it('writes shapes, paths, lines, charts, text with its font and images as data URIs', () => {
    const s = ck.MakeSurface(2, 2)!;
    const png = s.makeImageSnapshot().encodeToBytes()!;
    s.delete();
    let doc = docOf([
      shape('rect', { x: 10, y: 10, w: 50, h: 50 }, { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] }),
      { ...text('Hello <World> & co', { x: 10, y: 80, w: 180, h: 40 }, { fontSize: 20, bold: true }), rotation: 15 },
      { ...text('Shadow', { x: 10, y: 130, w: 180, h: 40 }), effect: { type: 'shadow', offset: 50, direction: 45, blur: 20, transparency: 40, color: '#000000' } },
      line({ x: 0, y: 0 }, { x: 100, y: 100 }, { end: 'arrow' }),
      chart('bar', { x: 0, y: 0, w: 100, h: 100 }),
      frame('star', { x: 100, y: 100, w: 80, h: 80 }, 'img'),
    ]);
    doc = { ...doc, assets: { img: { mime: 'image/png', width: 2, height: 2 } } };
    const svg = exportSvg(renderer, doc, doc.pages[0]!, { assets: new Map([['img', png]]) });
    expect(svg).toMatch(/^<\?xml[^>]*>\n<svg xmlns="http:\/\/www.w3.org\/2000\/svg"[^>]* width="200" height="200" viewBox="0 0 200 200">/);
    expect(svg).toContain('<linearGradient');
    expect(svg).toContain('>&lt;World&gt;</text>');
    expect(svg).toContain('font-weight="700"');
    expect(svg).toContain('transform="rotate(15 ');
    expect(svg).toMatch(/@font-face\{font-family:'Inter';src:url\(data:font\/ttf;base64,[A-Za-z0-9+/]{1000}/);
    expect(svg).toContain('font-weight:700'); // the bold face is embedded for the bold text
    expect(svg).toContain('<clipPath');
    expect(svg).toContain('href="data:image/png;base64,');
    expect(svg).toContain('>Jan</text>');
    expect(svg).not.toContain('>Shadow</text>'); // effects become an image
    expect((svg.match(/<image /g) ?? []).length).toBe(2);
  });
});

describe('vector PDF export', () => {
  async function inspect(bytes: Uint8Array) {
    const pdf = await PDFDocument.load(bytes);
    const page = pdf.getPage(0);
    const contents = page.node.Contents()!;
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => pdf.context.lookup(r)) : [contents];
    const ops = streams.map((s) => Buffer.from(decodePDFRawStream(s as PDFRawStream).decode()).toString('latin1')).join('\n');
    let fontFiles = 0;
    for (const [, obj] of pdf.context.enumerateIndirectObjects()) if (obj instanceof PDFDict && obj.get(PDFName.of('FontFile2'))) fontFiles++;
    return { pdf, ops, fontFiles };
  }

  it('has real text operators in an embedded font, vector paths and images', async () => {
    const s = ck.MakeSurface(2, 2)!;
    const png = s.makeImageSnapshot().encodeToBytes()!;
    s.delete();
    let doc = docOf([
      shape('ellipse', { x: 10, y: 10, w: 50, h: 50 }, { type: 'solid', color: '#ff000080' }),
      text('Vector text', { x: 10, y: 80, w: 180, h: 40 }, { fontSize: 20 }),
      line({ x: 0, y: 0 }, { x: 100, y: 100 }, { end: 'triangle', stroke: { color: '#000000', width: 3, dash: 'dashed' } }),
      { ...table(2, 2, { x: 0, y: 120, w: 200, h: 60 }), cells: [[{ text: 'Cell' }, { text: '' }], [{ text: '' }, { text: '' }]] },
      frame('ellipse', { x: 100, y: 100, w: 80, h: 80 }, 'img'),
    ], 192, 192);
    doc = { ...doc, assets: { img: { mime: 'image/png', width: 2, height: 2 } } };
    const { pdf, ops, fontFiles } = await inspect(await exportVectorPdf(renderer, doc, { assets: new Map([['img', png]]) }));
    expect(pdf.getPage(0).getSize()).toEqual({ width: 144, height: 144 }); // 192 px = 2 in
    expect(ops).toMatch(/BT[\s\S]*Tj[\s\S]*ET/); // text, not pictures of text
    expect((ops.match(/ Tj/g) ?? []).length).toBe(3); // "Vector", "text", "Cell"
    expect(fontFiles).toBe(2); // Inter regular and bold (the table's header row), embedded
    expect(ops).toContain(' c\n'); // Bézier curves (the ellipse)
    expect(ops).toMatch(/\[[\d. ]+\] 0 d/); // a dash pattern
    expect(ops).toContain('\nW\nn\n'); // clipped image (frame)
    expect(ops).toContain(' Do');
    expect(ops).toContain(' gs'); // half-transparent fill
  });

  it('draws text effects as an image of that element only', async () => {
    const doc = docOf([
      { ...text('Neon', { x: 10, y: 10, w: 180, h: 60 }, { fontSize: 40 }), effect: { type: 'neon', intensity: 50 } },
      text('Plain', { x: 10, y: 100, w: 180, h: 60 }, { fontSize: 40 }),
    ]);
    const { ops } = await inspect(await exportVectorPdf(renderer, doc, { assets: new Map() }));
    expect((ops.match(/ Tj/g) ?? []).length).toBe(1);
    expect((ops.match(/ Do/g) ?? []).length).toBe(1);
  });
});
