/**
 * Writes what a PDF import keeps: glyphs in their original fonts, colours in their
 * original spaces, images as their original objects, clips, strokes and shadings.
 * With the source file gone (or encrypted) fonts are embedded from the design instead.
 */
import {
  beginText, clip, clipEvenOdd, concatTransformationMatrix, endPath, endText, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFObjectCopier, PDFOperator, PDFOperatorNames, PDFRef, PDFString,
  popGraphicsState, pushGraphicsState, setCharacterSpacing, setDashPattern, setFillingCmykColor, setFillingGrayscaleColor, setFillingRgbColor, setCharacterSqueeze, setFontAndSize, setLineCap, setLineJoin, setLineWidth,
  setStrokingCmykColor, setStrokingGrayscaleColor, setStrokingRgbColor, setTextRenderingMode, setTextRise, setWordSpacing, type PDFPage,
} from 'pdf-lib';
import type { Doc, ExactRun, Matrix, PageLink, PathShade, PdfFont, SourceColor } from '@digital-canvas/scene';
import { rgba, type Cmd } from './vectorpath.ts';

export interface ExactWriter {
  ok(run: ExactRun): boolean;
  font(page: PDFPage, key: string): { name: PDFName; gidCodes: boolean } | null;
  image(obj: number): PDFRef | null;
  colorSpace(page: PDFPage, obj: number): PDFName | null;
  shading(page: PDFPage, s: PathShade): PDFName;
}

const res = (page: PDFPage, kind: string): PDFDict => {
  const { Resources } = page.node.normalizedEntries();
  const key = PDFName.of(kind);
  let d = Resources.lookupMaybe(key, PDFDict);
  if (!d) { d = page.doc.context.obj({}); Resources.set(key, d); }
  return d;
};

export async function exactWriter(pdf: PDFDocument, doc: Doc, assets: ReadonlyMap<string, Uint8Array>): Promise<ExactWriter> {
  const info = doc.pdf;
  const bytes = info?.source ? assets.get(info.source) : undefined;
  let src: PDFDocument | null = null;
  if (bytes) {
    try {
      const d = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
      src = d.isEncrypted ? null : d;
    } catch { src = null; }
  }
  const copier = src ? PDFObjectCopier.for(src.context, pdf.context) : null;
  const refs = new Map<number, PDFRef>();
  if (src) for (const [ref] of src.context.enumerateIndirectObjects()) refs.set(ref.objectNumber, ref);
  const copied = new Map<number, PDFRef | null>();
  const copy = (obj: number): PDFRef | null => {
    if (copied.has(obj)) return copied.get(obj)!;
    const ref = refs.get(obj);
    let out: PDFRef | null = null;
    if (ref && copier) {
      try {
        const c = copier.copy(ref);
        out = c instanceof PDFRef ? c : pdf.context.register(c);
      } catch { out = null; }
    }
    copied.set(obj, out);
    return out;
  };

  const embedded = new Map<string, PDFRef | null>();
  const embed = (key: string, f: PdfFont): PDFRef | null => {
    if (embedded.has(key)) return embedded.get(key)!;
    const file = f.asset ? assets.get(f.asset) : undefined;
    let ref: PDFRef | null = null;
    if (file) {
      const ctx = pdf.context;
      const cff = file[0] === 0x4f;
      const stream = ctx.register(ctx.flateStream(file, cff ? { Subtype: 'OpenType' } : { Length1: file.length }));
      const name = `${key.replace(/[^A-Za-z0-9]/g, '')}+${f.name.replace(/[^A-Za-z0-9-]/g, '')}`;
      const descriptor = ctx.register(ctx.obj({
        Type: 'FontDescriptor', FontName: name, Flags: 4, FontBBox: [-1000, -1000, 2000, 2000], ItalicAngle: 0, Ascent: 800, Descent: -200, CapHeight: 700, StemV: 80,
        [cff ? 'FontFile3' : 'FontFile2']: stream,
      }));
      const W: (number | number[])[] = [];
      const byGid = new Map<number, number>();
      for (const [code, gid] of Object.entries(f.gids)) byGid.set(gid, (f.widths[code] ?? 0) * (f.scale ?? 1));
      for (const [gid, w] of [...byGid].sort((a, b) => a[0] - b[0])) W.push(gid, [Math.round(w * 100) / 100]);
      const cid = ctx.register(ctx.obj({
        Type: 'Font', Subtype: cff ? 'CIDFontType0' : 'CIDFontType2', BaseFont: name, CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 },
        FontDescriptor: descriptor, DW: 0, W, ...(cff ? {} : { CIDToGIDMap: 'Identity' }),
      }));
      const lines: string[] = [];
      for (const [code, gid] of Object.entries(f.gids)) {
        const u = f.unicode[code];
        if (!u) continue;
        lines.push(`<${gid.toString(16).padStart(4, '0')}> <${[...u].flatMap((c) => { const cp = c.codePointAt(0)!; return cp > 0xffff ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 1023)] : [cp]; }).map((v) => v.toString(16).padStart(4, '0')).join('')}>`);
      }
      const chunks: string[] = [];
      for (let i = 0; i < lines.length; i += 100) { const part = lines.slice(i, i + 100); chunks.push(`${part.length} beginbfchar\n${part.join('\n')}\nendbfchar`); }
      const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <ffff>\nendcodespacerange\n${chunks.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
      const toUnicode = ctx.register(ctx.flateStream(new TextEncoder().encode(cmap)));
      ref = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: name, Encoding: 'Identity-H', DescendantFonts: [cid], ToUnicode: toUnicode }));
    }
    embedded.set(key, ref);
    return ref;
  };

  const names = new Map<string, Map<string, PDFName>>();
  const nameOn = (page: PDFPage, kind: string, id: string, make: () => PDFName): PDFName => {
    const k = `${page.ref.objectNumber}/${kind}`;
    let m = names.get(k);
    if (!m) names.set(k, (m = new Map()));
    let n = m.get(id);
    if (!n) m.set(id, (n = make()));
    return n;
  };

  return {
    ok(run) {
      const f = info?.fonts[run.font];
      if (!f) return false;
      if (run.mode === 3) return true;
      return (f.obj !== undefined && !!copy(f.obj)) || !!embed(run.font, f);
    },
    font(page, key) {
      const f = info?.fonts[key];
      if (!f) return null;
      const src = f.obj !== undefined ? copy(f.obj) : null;
      const ref = src ?? embed(key, f);
      if (!ref) return null;
      return { name: nameOn(page, 'Font', key, () => page.node.newFontDictionary('PF', ref)), gidCodes: !src };
    },
    image: (obj) => copy(obj),
    colorSpace(page, obj) {
      const ref = copy(obj);
      if (!ref) return null;
      return nameOn(page, 'ColorSpace', String(obj), () => {
        const d = res(page, 'ColorSpace');
        const n = PDFName.of(`PCS${obj}`);
        d.set(n, ref);
        return n;
      });
    },
    shading(page, s) {
      return nameOn(page, 'Shading', JSON.stringify(s), () => {
        const d = res(page, 'Shading');
        const n = PDFName.of(`PSh${d.keys().length}`);
        d.set(n, pdf.context.register(shadingDict(pdf, s)));
        return n;
      });
    },
  };
}

function shadingDict(pdf: PDFDocument, s: PathShade): PDFDict {
  const stops = s.stops.map((t) => ({ o: Math.min(1, Math.max(0, t.offset)), c: rgba(t.color) }));
  stops[0]!.o = 0;
  stops[stops.length - 1]!.o = 1;
  const seg = (a: typeof stops[0], b: typeof stops[0]) => ({ FunctionType: 2, Domain: [0, 1], N: 1, C0: [a.c.r, a.c.g, a.c.b], C1: [b.c.r, b.c.g, b.c.b] });
  const pairs: [typeof stops[0], typeof stops[0]][] = [];
  for (let i = 0; i + 1 < stops.length; i++) if (stops[i + 1]!.o > stops[i]!.o) pairs.push([stops[i]!, stops[i + 1]!]);
  const fn = pairs.length === 1 ? seg(...pairs[0]!) : {
    FunctionType: 3, Domain: [0, 1], Functions: pairs.map((p) => seg(...p)), Bounds: pairs.slice(1).map((p) => p[0].o), Encode: pairs.flatMap(() => [0, 1]),
  };
  return pdf.context.obj({ ShadingType: s.kind === 'axial' ? 2 : 3, ColorSpace: 'DeviceRGB', Coords: s.coords, Extend: s.extend, Function: fn }) as PDFDict;
}

export const cm = (m: Matrix) => concatTransformationMatrix(...m);

/** Colour operators for an original colour, or null to use RGB. */
export function colorOps(w: ExactWriter, page: PDFPage, c: SourceColor, stroke: boolean): PDFOperator[] | null {
  if (c.cs === 'g') return [(stroke ? setStrokingGrayscaleColor : setFillingGrayscaleColor)(c.v[0]!)];
  if (c.cs === 'k') return [(stroke ? setStrokingCmykColor : setFillingCmykColor)(c.v[0]!, c.v[1]!, c.v[2]!, c.v[3]!)];
  if (c.cs === 'rg') return [(stroke ? setStrokingRgbColor : setFillingRgbColor)(c.v[0]!, c.v[1]!, c.v[2]!)];
  const name = w.colorSpace(page, c.cs);
  if (!name) return null;
  return [PDFOperator.of(stroke ? PDFOperatorNames.StrokingColorspace : PDFOperatorNames.NonStrokingColorspace, [name]),
    PDFOperator.of(stroke ? PDFOperatorNames.StrokingColorN : PDFOperatorNames.NonStrokingColorN, c.v.map((v) => PDFNumber.of(v)))];
}

/** `k` converts the part's units to the space the operators run in. */
export function strokeOps(ex: { width?: number; cap?: 0 | 1 | 2; join?: 0 | 1 | 2; miter?: number; dash?: { array: number[]; phase: number } }, k = 1): PDFOperator[] {
  const fine = (v: number) => Math.round(v * k * 1e5) / 1e5;
  const o: PDFOperator[] = [setLineWidth(fine(ex.width ?? 1)), setLineCap(ex.cap ?? 0), setLineJoin(ex.join ?? 0), PDFOperator.of(PDFOperatorNames.SetLineMiterLimit, [PDFNumber.of(ex.miter ?? 10)])];
  if (ex.dash) o.push(setDashPattern(ex.dash.array.map(fine), fine(ex.dash.phase)));
  return o;
}

/** A TJ array as PDF syntax. `map` turns a character code into the code to write. */
export function tjOp(run: ExactRun, bytes: number, map: ((code: number) => number) | null): PDFOperator {
  const step = bytes * 2;
  const parts = run.tj.map((t) => {
    if (typeof t === 'number') return String(Math.round(t * 1000) / 1000);
    if (!map) return `<${t}>`;
    let out = '';
    for (let i = 0; i + step <= t.length; i += step) out += map(parseInt(t.slice(i, i + step), 16)).toString(16).padStart(4, '0');
    return `<${out}>`;
  });
  return PDFOperator.of(PDFOperatorNames.ShowTextAdjusted, [`[${parts.join(' ')}]`]);
}

export function textStateOps(run: ExactRun, name: PDFName): PDFOperator[] {
  const o: PDFOperator[] = [beginText(), setFontAndSize(name, run.size)];
  if (run.mode) o.push(setTextRenderingMode(run.mode));
  if (run.tc) o.push(setCharacterSpacing(run.tc));
  if (run.tw) o.push(setWordSpacing(run.tw));
  if (run.th !== undefined && run.th !== 1) o.push(setCharacterSqueeze(run.th * 100));
  if (run.rise) o.push(setTextRise(run.rise));
  return o;
}

export { clip, clipEvenOdd, endPath, endText, popGraphicsState, pushGraphicsState };

/** Link annotations: `pageRefs` are the exported pages, by index in the design. */
export function addLinks(page: PDFPage, links: PageLink[], toSheet: (x: number, y: number) => [number, number], pageRef: (i: number) => PDFRef | undefined): void {
  const ctx = page.doc.context;
  const annots = ctx.obj([]) as PDFArray;
  for (const l of links) {
    const a = toSheet(l.x, l.y), b = toSheet(l.x + l.w, l.y + l.h);
    const rect = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    const body: Record<string, unknown> = { Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0] };
    if (l.url) body.A = { S: 'URI', URI: PDFString.of(l.url) };
    else {
      const t = l.page !== undefined ? pageRef(l.page) : undefined;
      if (!t) continue;
      body.Dest = [t, 'Fit'];
    }
    annots.push(ctx.register(ctx.obj(body as never)));
  }
  if (annots.size()) page.node.set(PDFName.of('Annots'), annots);
}


/** SVG path data with absolute commands only (what the importer writes), as doubles: Skia paths are 32-bit. */
export function parseD(d: string): Cmd[] {
  const out: Cmd[] = [];
  let cx = 0, cy = 0;
  for (const m of d.matchAll(/([MLCQZ])([^MLCQZ]*)/g)) {
    const v = m[2]!.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (m[1] === 'Z') { out.push({ op: 'Z' }); continue; }
    if (m[1] === 'C') { out.push({ op: 'C', x1: v[0]!, y1: v[1]!, x2: v[2]!, y2: v[3]!, x: v[4]!, y: v[5]! }); cx = v[4]!; cy = v[5]!; continue; }
    if (m[1] === 'Q') {
      const [x1, y1, x, y] = v as [number, number, number, number];
      out.push({ op: 'C', x1: cx + ((x1 - cx) * 2) / 3, y1: cy + ((y1 - cy) * 2) / 3, x2: x + ((x1 - x) * 2) / 3, y2: y + ((y1 - y) * 2) / 3, x, y });
      cx = x; cy = y;
      continue;
    }
    out.push({ op: m[1] as 'M' | 'L', x: v[0]!, y: v[1]! });
    cx = v[0]!; cy = v[1]!;
  }
  return out;
}
