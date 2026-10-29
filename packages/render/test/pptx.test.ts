import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CanvasKit } from 'canvaskit-wasm';
import { strFromU8, unzipSync } from 'fflate';
import { addElements, addPage, createDoc, shape, text, updatePage, type Doc } from '@digital-canvas/scene';
import { buildPptx, exportPptx, FontLibrary, Renderer, textParagraphs } from '../src/index.ts';

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

/** A two-page 1920×1080 deck: styled text, a shape, an effect text, a gradient page with notes. */
export function sampleDoc(): Doc {
  let doc = createDoc({ width: 1920, height: 1080, title: 'Quarterly <review> & plan' });
  const p1 = doc.pages[0]!.id;
  doc = updatePage(doc, p1, { background: { type: 'solid', color: '#fff4e0' }, notes: 'Welcome everyone.\nKeep it short.' });
  doc = addElements(doc, p1, [
    shape('ellipse', { x: 1300, y: 200, w: 500, h: 500 }, { type: 'solid', color: '#ff5757' }),
    {
      ...text('Quarterly review', { x: 120, y: 160, w: 1100, h: 200 }, { fontSize: 120, bold: true, color: '#1d1d3a', align: 'left' }),
      runs: [{ text: 'Quarterly ' }, { text: 'review', style: { italic: true, color: '#e03131' } }],
    },
    { ...text('Line one\nLine two', { x: 120, y: 420, w: 900, h: 200 }, { fontSize: 48, align: 'center', underline: true, letterSpacing: 4 }), rotation: 15 },
    { ...text('Neon glow', { x: 120, y: 700, w: 900, h: 160 }, { fontSize: 80 }), effect: { type: 'neon', intensity: 50 } },
  ]);
  const r = addPage(doc);
  doc = updatePage(r.doc, r.pageId, { background: { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#4f46e5' }, { offset: 1, color: '#06b6d4' }] } });
  doc = addElements(doc, r.pageId, [{ ...text('Bullets\nSecond', { x: 200, y: 200, w: 1200, h: 300 }, { fontSize: 64, color: '#ffffff' }), list: 'bullet' }]);
  return doc;
}

describe('PPTX writer', () => {
  it('writes an OOXML package: parts, relationships, slide size and count', () => {
    const doc = sampleDoc();
    const bytes = exportPptx(renderer, doc, { assets: new Map() });
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]); // PK
    const zip = unzipSync(bytes);
    const names = Object.keys(zip);
    expect(names[0]).toBe('[Content_Types].xml');
    for (const part of ['_rels/.rels', 'docProps/core.xml', 'docProps/app.xml', 'ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels',
      'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml', 'ppt/theme/theme1.xml', 'ppt/slides/slide1.xml', 'ppt/slides/slide2.xml',
      'ppt/notesMasters/notesMaster1.xml', 'ppt/notesSlides/notesSlide1.xml']) expect(names).toContain(part);
    expect(names).not.toContain('ppt/notesSlides/notesSlide2.xml'); // page 2 has no notes
    const pres = strFromU8(zip['ppt/presentation.xml']!);
    expect((pres.match(/<p:sldId /g) ?? []).length).toBe(2);
    expect(pres).toContain('<p:sldSz cx="18288000" cy="10287000"/>'); // 1920×1080 px = 20×11.25 in
    const types = strFromU8(zip['[Content_Types].xml']!);
    expect(types).toContain('/ppt/slides/slide2.xml');
    expect(types).toContain('Extension="png"');
    // every relationship target exists
    for (const [name, data] of Object.entries(zip)) {
      if (!name.endsWith('.rels')) continue;
      const dir = name.replace(/(^|\/)_rels\/[^/]*\.rels$/, '$1');
      for (const m of strFromU8(data).matchAll(/Target="([^"]+)"/g)) {
        const parts = (dir + m[1]).split('/');
        const out: string[] = [];
        for (const p of parts) if (p === '..') out.pop(); else if (p) out.push(p);
        expect(names, `${name} → ${m[1]}`).toContain(out.join('/'));
      }
    }
    expect(strFromU8(zip['docProps/core.xml']!)).toContain('Quarterly &lt;review&gt; &amp; plan');
  });

  it('keeps clean text as editable runs with font, size, colour, alignment, bold and italic', () => {
    const zip = unzipSync(exportPptx(renderer, sampleDoc(), { assets: new Map() }));
    const s1 = strFromU8(zip['ppt/slides/slide1.xml']!);
    const runs = [...s1.matchAll(/<a:r><a:rPr ([^>]*)>([\s\S]*?)<\/a:rPr><a:t>([^<]*)<\/a:t><\/a:r>/g)].map((m) => ({ attrs: m[1]!, inner: m[2]!, text: m[3]! }));
    expect(runs.map((r) => r.text)).toEqual(['Quarterly ', 'review', 'Line one', 'Line two']);
    const [q, rv, l1] = runs;
    expect(q!.attrs).toContain('sz="9000"'); // 120 px = 90 pt
    expect(q!.attrs).toContain('b="1"');
    expect(q!.attrs).toContain('i="0"');
    expect(q!.inner).toContain('<a:srgbClr val="1D1D3A"/>');
    expect(q!.inner).toContain('<a:latin typeface="Inter"/>');
    expect(rv!.attrs).toContain('i="1"');
    expect(rv!.inner).toContain('val="E03131"');
    expect(l1!.attrs).toContain('u="sng"');
    expect(l1!.attrs).toContain('spc="300"'); // 4 px = 3 pt
    expect(s1).toContain('algn="ctr"');
    expect(s1).toContain('rot="900000"'); // 15°
    expect((s1.match(/<a:p>/g) ?? []).length).toBe(3); // 1 + 2 paragraphs
    // the shape and the neon text are pictures, the background is the slide's own fill
    expect((s1.match(/<p:pic>/g) ?? []).length).toBe(2);
    expect(s1).toContain('<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFF4E0"/>');
    expect(s1).not.toContain('Neon glow');
    const s2 = strFromU8(zip['ppt/slides/slide2.xml']!);
    expect((s2.match(/<p:pic>/g) ?? []).length).toBe(1); // the gradient background
    expect(s2).toContain('<a:buChar char="&#8226;"/>');
    expect(strFromU8(zip['ppt/notesSlides/notesSlide1.xml']!)).toContain('<a:t>Keep it short.</a:t>');
    // pictures are real PNGs
    const media = Object.keys(zip).filter((n) => n.startsWith('ppt/media/'));
    expect(media).toHaveLength(3);
    for (const m of media) expect(Array.from(zip[m]!.subarray(1, 4))).toEqual([0x50, 0x4e, 0x47]);
    if (process.env.DC_PPTX_OUT) {
      mkdirSync(process.env.DC_PPTX_OUT, { recursive: true });
      writeFileSync(`${process.env.DC_PPTX_OUT}/sample.pptx`, exportPptx(renderer, sampleDoc(), { assets: new Map() }));
    }
  });

  it('splits runs at line breaks and carries opacity', () => {
    const el = { ...text('', { x: 0, y: 0, w: 100, h: 100 }, { fontSize: 20 }), opacity: 0.5, runs: [{ text: 'a\nb' }, { text: 'c', style: { bold: true } }] };
    const paras = textParagraphs({ ...el, text: 'a\nbc' });
    expect(paras.map((p) => p.runs.map((r) => r.text))).toEqual([['a'], ['b', 'c']]);
    expect(paras[1]!.runs[1]!.bold).toBe(true);
    expect(paras[0]!.runs[0]!.opacity).toBe(0.5);
    expect(paras[0]!.runs[0]!.size).toBe(15);
  });

  it('shrinks huge designs to PowerPoint\'s 56 in limit and leaves out notes when asked', () => {
    const bytes = buildPptx({ width: 10000, height: 5000, slides: [{ items: [], notes: 'n' }] });
    const zip = unzipSync(bytes);
    expect(strFromU8(zip['ppt/presentation.xml']!)).toContain('<p:sldSz cx="51206400" cy="25603200"/>');
    const none = unzipSync(exportPptx(renderer, sampleDoc(), { assets: new Map(), notes: false }));
    expect(Object.keys(none).some((n) => n.includes('notes'))).toBe(false);
  });
});
