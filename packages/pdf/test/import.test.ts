import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportVectorPdf, FontLibrary, Renderer } from '@digital-canvas/render';
import { closestFamily, exactPart, exactText, missingGlyphs, placeGlyphs, pruneAssets, pruneFonts, type Doc, type ImageElement, type PathElement, type TextElement } from '@digital-canvas/scene';
import { pack, unpack } from '@digital-canvas/storage';
import { encodePng } from '../src/png.ts';
import { buildCmap, readCmap } from '../src/fontfile.ts';
import { PdfImportError, tileOf } from '../src/import.ts';
import { actualText } from '../src/source.ts';
import { importPdfNode } from '../src/node.ts';

const fixture = (n: string) => new Uint8Array(readFileSync(new URL(`../../../e2e/fixtures/${n}`, import.meta.url)));
const hasPoppler = (() => { try { execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();

async function exporter(r: { doc: Doc; assets: Map<string, Uint8Array> }): Promise<{ renderer: Renderer; pdf: (d?: Doc) => Promise<Uint8Array> }> {
  const ck = await createRequire(import.meta.url)('canvaskit-wasm/bin/full/canvaskit.js')();
  const fonts = new FontLibrary(ck);
  await fonts.loadBundled(new URL('../../../apps/web/public/fonts/', import.meta.url).href, async (u) => readFileSync(new URL(u)).buffer as ArrayBuffer);
  const renderer = new Renderer(ck, fonts);
  for (const f of r.doc.fonts ?? []) { const b = r.assets.get(f.asset); if (b) fonts.add(f.family, b, f.subset); }
  for (const [id, b] of r.assets) if (r.doc.assets[id]?.mime.startsWith('image/')) renderer.setImage(id, b);
  return { renderer, pdf: (d = r.doc) => exportVectorPdf(renderer, d, { assets: r.assets }) };
}

const ppm = (pdf: Uint8Array, page: number, dpi = 150, tag = 'a') => {
  const dir = mkdtempSync(join(tmpdir(), 'pdf-'));
  writeFileSync(join(dir, `${tag}.pdf`), pdf);
  execFileSync('pdftoppm', ['-r', String(dpi), '-f', String(page), '-l', String(page), '-singlefile', join(dir, `${tag}.pdf`), join(dir, tag)]);
  const b = readFileSync(join(dir, `${tag}.ppm`));
  const head = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(b.subarray(0, 40).toString('latin1'))!;
  return { w: +head[1]!, h: +head[2]!, px: b.subarray(head[0].length) };
};

const mismatch = (a: ReturnType<typeof ppm>, b: ReturnType<typeof ppm>) => {
  expect([a.w, a.h]).toEqual([b.w, b.h]);
  let bad = 0;
  for (let i = 0; i < a.px.length; i += 3) if (Math.max(Math.abs(a.px[i]! - b.px[i]!), Math.abs(a.px[i + 1]! - b.px[i + 1]!), Math.abs(a.px[i + 2]! - b.px[i + 2]!)) > 16) bad++;
  return bad / (a.w * a.h);
};

describe('importPdf mapping', () => {
  it('turns content into real elements', async () => {
    const { doc, report } = await importPdfNode(fixture('roundtrip.pdf'));
    expect(doc.pages).toHaveLength(2);
    const els = doc.pages[0]!.elements;
    const texts = els.filter((e): e is TextElement => e.type === 'text');
    expect(texts.map((t) => t.text)).toEqual(expect.arrayContaining(['Hello from the fixture', 'Standard font line']));
    const hello = texts.find((t) => t.text.startsWith('Hello'))!;
    expect(exactText(hello)).toBeTruthy();
    expect(hello.style.color).toBe('#1a3399');
    expect(hello.style.fontSize).toBeCloseTo(20 * (96 / 72), 3);
    expect(hello.x).toBeCloseTo(30 * (96 / 72), 2);
    const images = els.filter((e): e is ImageElement => e.type === 'image');
    expect(images[0]?.pdfImage?.obj).toBeGreaterThan(0);
    expect(report.flattened).toEqual([]);
    expect(report.mixedSizes).toBe(true);
    expect(report.links).toBe(1);
  });

  it('keeps CMYK, dashes, caps, clips and gradients', async () => {
    const { doc } = await importPdfNode(fixture('roundtrip.pdf'));
    const parts = doc.pages[0]!.elements.filter((e): e is PathElement => e.type === 'path').flatMap((e) => e.paths.map((p) => ({ p, e })));
    expect(parts.some(({ p }) => exactPart(p)?.fillSrc?.cs === 'k')).toBe(true);
    const dashed = parts.find(({ p }) => exactPart(p)?.dash)!;
    expect(exactPart(dashed.p)).toMatchObject({ cap: 1 });
    expect(exactPart(dashed.p)!.dash!.array).toEqual([8 * (96 / 72), 4 * (96 / 72)]);
    expect(parts.some(({ p }) => exactPart(p)?.shade?.kind === 'axial')).toBe(true);
    expect(parts.some(({ e }) => e.pdfClip)).toBe(true);
  });

  it('fits smaller pages on the design and remembers their size', async () => {
    const { doc } = await importPdfNode(fixture('roundtrip.pdf'));
    expect(doc.width).toBeCloseTo(400 * (96 / 72));
    expect(doc.pages[1]!.pdfPage).toMatchObject({ w: 200, h: 200 });
    expect(doc.pages[0]!.pdfPage).toBeUndefined();
  });

  it('asks for a password, rejects a wrong one, opens with the right one', async () => {
    await expect(importPdfNode(fixture('password.pdf'))).rejects.toMatchObject({ code: 'password' });
    const seen: boolean[] = [];
    const answers = ['nope', 'secret'];
    const { doc } = await importPdfNode(fixture('password.pdf'), { askPassword: async (wrong) => { seen.push(wrong); return answers.shift()!; } });
    expect(seen).toEqual([false, true]);
    expect(doc.pages[0]!.elements.some((e) => e.type === 'text' && e.text === 'Locked text')).toBe(true);
    expect(doc.pdf!.source).toBeUndefined(); // pdf-lib can't read it: the design stands on its own
  });

  it('cancels, and refuses what is not a PDF', async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(importPdfNode(fixture('roundtrip.pdf'), { signal: ctl.signal })).rejects.toBeInstanceOf(PdfImportError);
    await expect(importPdfNode(new TextEncoder().encode('hello'))).rejects.toMatchObject({ code: 'invalid' });
  });

  it('survives storage and pruning', async () => {
    const r = await importPdfNode(fixture('roundtrip.pdf'));
    const pruned = pruneFonts(pruneAssets(r.doc));
    expect(Object.keys(pruned.assets).sort()).toEqual(Object.keys(r.doc.assets).sort());
    const back = unpack(pack({ doc: pruned, assets: r.assets }));
    expect(back.doc.pdf?.source).toBe(r.doc.pdf?.source);
    expect(back.assets.get(r.doc.pdf!.source!)?.length).toBe(fixture('roundtrip.pdf').length);
  });
});

describe('exact content', () => {
  it('stands aside when the text or colour changes', async () => {
    const { doc } = await importPdfNode(fixture('roundtrip.pdf'));
    const t = doc.pages[0]!.elements.find((e): e is TextElement => e.type === 'text')!;
    expect(exactText({ ...t, style: { ...t.style, color: '#ff0000' } })).toBeTruthy(); // recolour keeps the glyphs
    expect(exactText({ ...t, text: `${t.text}!` })).toBeNull();
    expect(exactText({ ...t, style: { ...t.style, fontFamily: 'Inter' } })).toBeNull();
    const p = doc.pages[0]!.elements.find((e): e is PathElement => e.type === 'path')!.paths[0]!;
    expect(exactPart({ ...p, fill: { type: 'solid', color: '#123456' } })).toBeNull();
  });

  it('places TJ arrays like a PDF viewer', () => {
    const { glyphs, end } = placeGlyphs({ size: 10, tc: 1, tw: 2, tj: ['4120', -500, '42'] }, { 65: 500, 32: 250, 66: 600 }, 1);
    expect(glyphs.map((g) => g.x)).toEqual([0, 6, 16.5]);
    expect(end).toBeCloseTo(23.5);
  });

  it('knows which letters a subset lacks, and the closest full font', () => {
    const f = { name: 'Arial-BoldMT', bytes: 1 as const, widths: {}, gids: { 65: 3 }, unicode: { 65: 'A', 66: 'B' } };
    expect(missingGlyphs('A B', f)).toEqual(['B']); // B has text but no glyph
    expect(closestFamily(f)).toBe('Arimo');
    expect(closestFamily({ name: 'Calibri' })).toBe('Carlito');
    expect(closestFamily({ name: 'Foo', serif: true })).toBe('Noto Serif');
  });
});

describe('helpers', () => {
  it('reads /ActualText in both string forms', () => {
    expect(actualText('<</ActualText <FEFF0930093E>>>')).toBe('रा');
    expect(actualText('<</MCID 3/ActualText (fi\\051)>>')).toBe('fi)');
    expect(actualText('<</MCID 3>>')).toBeUndefined();
  });

  it('writes tiling cells of plain paths, and refuses anything else', async () => {
    const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const list = { fnArray: [OPS.setFillRGBColor, OPS.constructPath], argsArray: [['#ff0000'], [OPS.fill, [[0, 0, 0, 1, 4, 0, 4]]]] };
    const t = tileOf(['TilingPattern', null, list, null, [0, 0, 4, 4], 4, 4, 1], OPS)!;
    expect(t.content).toBe('1 0 0 rg\n0 0 m 4 0 l h f');
    expect(t.matrix).toEqual([1, 0, 0, 1, 0, 0]);
    expect(tileOf(['TilingPattern', null, { fnArray: [OPS.paintImageXObject], argsArray: [[]] }, null, [0, 0, 1, 1], 1, 1, 1], OPS)).toBeNull();
  });

  it('cmap tables round trip', () => {
    const map = new Map([[65, 3], [66, 4], [0x1f600, 9]]);
    const cmap = buildCmap(map);
    // wrap the table as a one-table font
    const font = new Uint8Array(12 + 16 + cmap.length);
    const dv = new DataView(font.buffer);
    dv.setUint32(0, 0x00010000); dv.setUint16(4, 1);
    font.set([99, 109, 97, 112], 12);
    dv.setUint32(12 + 8, 28); dv.setUint32(12 + 12, cmap.length);
    font.set(cmap, 28);
    expect(readCmap(font)).toEqual(map);
  });

  it('encodes PNGs the renderer reads', async () => {
    const png = encodePng(new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128]), 2, 1, 4);
    const ck = await createRequire(import.meta.url)('canvaskit-wasm/bin/full/canvaskit.js')();
    const img = ck.MakeImageFromEncoded(png);
    expect([img.width(), img.height()]).toEqual([2, 1]);
    img.delete();
  });
});

describe.skipIf(!hasPoppler)('round trip', () => {
  it('unedited export matches the source under 0.5 % on every page, each at its own size', async () => {
    const src = fixture('roundtrip.pdf');
    const r = await importPdfNode(src);
    const { pdf } = await exporter(r);
    const out = await pdf();
    for (const p of [1, 2]) expect(mismatch(ppm(src, p), ppm(out, p))).toBeLessThan(0.005);
    expect(execFileSync('pdftotext', ['-', '-'], { input: out }).toString()).toContain('Hello from the fixture');
  }, 30_000);

  it('also without the source objects (fonts embedded from the design)', async () => {
    const src = fixture('roundtrip.pdf');
    const r = await importPdfNode(src);
    const doc: Doc = { ...r.doc, pdf: { fonts: r.doc.pdf!.fonts } };
    const { pdf } = await exporter(r);
    const out = await pdf(doc);
    expect(mismatch(ppm(src, 1), ppm(out, 1))).toBeLessThan(0.005);
    expect(execFileSync('pdftotext', ['-', '-'], { input: out }).toString()).toContain('Hello from the fixture');
  }, 30_000);

  it('an edit changes that line and nothing else', async () => {
    const r = await importPdfNode(fixture('roundtrip.pdf'));
    const { pdf } = await exporter(r);
    const a = ppm(await pdf(), 1);
    const t = r.doc.pages[0]!.elements.find((e): e is TextElement => e.type === 'text' && e.text.startsWith('Hello'))!;
    const edited: Doc = { ...r.doc, pages: r.doc.pages.map((p, i) => (i ? p : { ...p, elements: p.elements.map((e) => (e === t ? { ...t, text: 'Hello from the edit' } : e)) })) };
    const b = ppm(await pdf(edited), 1);
    const k = 150 / 96;
    let outside = 0, inside = 0;
    for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
      const i = (y * a.w + x) * 3;
      if (Math.abs(a.px[i]! - b.px[i]!) <= 16) continue;
      const near = y > (t.y - t.h) * k && y < (t.y + 2 * t.h) * k;
      if (near) inside++; else outside++;
    }
    expect(inside).toBeGreaterThan(20);
    expect(outside).toBe(0);
  }, 30_000);
});
