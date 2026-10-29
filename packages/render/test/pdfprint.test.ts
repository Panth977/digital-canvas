import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CanvasKit } from 'canvaskit-wasm';
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { addElements, createDoc, shape, text, updatePage, type Doc } from '@digital-canvas/scene';
import { exportVectorPdf, FontLibrary, MM, Renderer } from '../src/index.ts';

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

/** A 96×96 px (1 in) print page with a 3 mm bleed, a red square past the left edge and notes. */
function printDoc(): Doc {
  let doc = { ...createDoc({ width: 96, height: 96 }), bleed: 3 * MM };
  const p = doc.pages[0]!.id;
  doc = updatePage(doc, p, { background: { type: 'solid', color: '#3366ff' }, notes: 'Print on matte stock.' });
  return addElements(doc, p, [shape('rect', { x: -20, y: 10, w: 60, h: 30 }, { type: 'solid', color: '#ff0000' }), text('Hi', { x: 20, y: 50, w: 60, h: 30 }, { fontSize: 20 })]);
}

async function ops(pdf: PDFDocument, i = 0) {
  const contents = pdf.getPage(i).node.Contents()!;
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => pdf.context.lookup(r)) : [contents];
  return streams.map((s) => Buffer.from(decodePDFRawStream(s as PDFRawStream).decode()).toString('latin1')).join('\n');
}

describe('PDF Print', () => {
  it('crop marks and bleed: bigger sheet, TrimBox and BleedBox, eight marks, still vector text', async () => {
    const bytes = await exportVectorPdf(renderer, printDoc(), { assets: new Map(), print: { bleed: 3 * MM, marks: true } });
    const pdf = await PDFDocument.load(bytes);
    const page = pdf.getPage(0);
    const slug = (9 * MM) * 0.75; // 3 mm bleed + 6 mm marks, in pt
    expect(page.getWidth()).toBeCloseTo(72 + 2 * slug, 2);
    const trim = page.getTrimBox(), bleed = page.getBleedBox();
    expect(trim.width).toBeCloseTo(72, 3);
    expect(trim.x).toBeCloseTo(slug, 3);
    expect(bleed.width).toBeCloseTo(72 + 2 * 3 * MM * 0.75, 3);
    const o = await ops(pdf);
    expect((o.match(/ m\n[\d. -]+ l\nS/g) ?? []).length).toBe(8); // the crop marks
    expect(o).toMatch(/BT[\s\S]*Tj[\s\S]*ET/);
    if (process.env.DC_PDF_OUT) { mkdirSync(process.env.DC_PDF_OUT, { recursive: true }); writeFileSync(`${process.env.DC_PDF_OUT}/print-marks.pdf`, bytes); }
  });

  it('CMYK: colours as k/K operators, no RGB colour operators', async () => {
    const pdf = await PDFDocument.load(await exportVectorPdf(renderer, printDoc(), { assets: new Map(), print: { bleed: 3 * MM, marks: true }, colorProfile: 'cmyk' }));
    const o = await ops(pdf);
    expect(o).toMatch(/\n0 1 1 0 k\n/); // the red square
    expect(o).toMatch(/1 1 1 1 K/); // registration-colour marks
    expect(o).not.toMatch(/ rg\n/);
    expect(o).not.toMatch(/ RG\n/);
  });

  it('flatten: one picture per page (CMYK image when asked), marks stay vector', async () => {
    const rgbPdf = await PDFDocument.load(await exportVectorPdf(renderer, printDoc(), { assets: new Map(), print: { bleed: 3 * MM, marks: true }, flatten: { dpi: 150 } }));
    const o = await ops(rgbPdf);
    expect(o).not.toContain('Tj');
    expect((o.match(/ Do/g) ?? []).length).toBe(1);
    expect((o.match(/ l\nS/g) ?? []).length).toBe(8);
    const cmykPdf = await PDFDocument.load(await exportVectorPdf(renderer, printDoc(), { assets: new Map(), flatten: { dpi: 96 }, colorProfile: 'cmyk' }));
    let cmykImages = 0;
    for (const [, obj] of cmykPdf.context.enumerateIndirectObjects()) {
      const dict = obj instanceof PDFRawStream ? obj.dict : obj instanceof PDFDict ? obj : null;
      if (dict?.get(PDFName.of('ColorSpace'))?.toString() === '/DeviceCMYK') cmykImages++;
    }
    expect(cmykImages).toBe(1);
  });

  it('include notes: a notes page after a page with notes', async () => {
    const pdf = await PDFDocument.load(await exportVectorPdf(renderer, printDoc(), { assets: new Map(), notes: true }));
    expect(pdf.getPageCount()).toBe(2);
    expect(await ops(pdf, 1)).toContain('Tj');
    const none = await PDFDocument.load(await exportVectorPdf(renderer, printDoc(), { assets: new Map() }));
    expect(none.getPageCount()).toBe(1);
  });
});
