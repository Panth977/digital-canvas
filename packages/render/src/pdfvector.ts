import {
  appendBezierCurve, clip, clipEvenOdd, closePath, cmyk, concatTransformationMatrix, drawObject, endPath, LineCapStyle, LineJoinStyle, lineTo, moveTo, PDFDocument, PDFName, PDFOperator,
  PDFOperatorNames, popGraphicsState, pushGraphicsState, rgb, setCharacterSpacing, setCharacterSqueeze, setDashPattern, setFillingCmykColor, setFillingRgbColor,
  setGraphicsState, setLineCap, setLineJoin, setLineWidth, setStrokingCmykColor, setStrokingRgbColor, StandardFonts, type Color as PdfColor, type PDFFont,
  type PDFPage, type PDFRef,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Path } from 'canvaskit-wasm';
import type { Color, Doc, Element, Fill, ImageElement, Page, PathElement, ShapeElement, Stroke, TextElement, VideoElement } from '@digital-canvas/scene';
import { applyMatrix, clipOf, dashArray, exactPart, exactText, mulMatrix, posterOf, walk, type Decomposed, type Matrix, type PathPart, type TextExact } from '@digital-canvas/scene';
import { actualTextOp, addLinks, cm, colorOps, exactWriter, parseD, strokeOps, textStateOps, tjOp, type ExactWriter } from './pdfexact.ts';
import type { FontFace } from './fonts.ts';
import { shapePath, transformPath, type Renderer } from './renderer.ts';
import { loadPicture, pictureNeedsRaster, textNeedsRaster, type VectorExportOptions } from './svgexport.ts';
import { pathCmds, pickFaces, rgba, type Cmd } from './vectorpath.ts';
import { printLayout, rgbaToCmyk, rgbToCmyk } from './print.ts';

export interface VectorPdfOptions extends VectorExportOptions {
  /** Page ids to include, in order (default: all visible pages). */
  pages?: string[];
  title?: string;
  /** Canva's "Crop marks and bleed": the sheet grows by the bleed (px) and, with `marks`, a slug with crop marks. */
  print?: { bleed: number; marks: boolean };
  /** Canva's "Flatten PDF": each page is one picture at `dpi` (crop marks stay vector). */
  flatten?: { dpi: number };
  /** Colour profile. 'cmyk' writes DeviceCMYK colours and images by a plain conversion (no ICC profile). */
  colorProfile?: 'rgb' | 'cmyk';
  /** Canva's "Include notes": a notes page after each page that has notes. */
  notes?: boolean;
}

type Paint = { fill: Color | null; stroke: (Stroke & { cap?: 'butt' | 'round' | 'square'; dashes?: number[] | null }) | null; evenOdd?: boolean };

const isLinear = (f: Fill | null | undefined) => f?.type === 'linear';

/** Elements vector PDF draws as an image: text effects, curved or gradient text, gradient fills, images with a look. */
function needsRaster(el: Element): boolean {
  if (el.type === 'text') return !exactText(el) && (textNeedsRaster(el) || !!el.gradient);
  if (el.type === 'shape') return isLinear(el.fill);
  if (el.type === 'path') return el.paths.some((p) => isLinear(p.fill));
  if (el.type === 'image' || el.type === 'video') return pictureNeedsRaster(el);
  return false;
}

/**
 * A PDF with real vectors: shapes, paths, lines, tables and charts as PDF
 * paths, text as text in embedded fonts, images embedded once. Only
 * what PDF can't express simply (text effects, curved text, gradients) is
 * drawn as an image of that one element. Page size is physical (96 px = 72 pt).
 */
export async function exportVectorPdf(renderer: Renderer, doc: Doc, opts: VectorPdfOptions): Promise<Uint8Array> {
  const ck = renderer.ck;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(opts.title ?? doc.title);
  pdf.setCreator('Digital Canvas');
  pdf.setProducer('Digital Canvas (CanvasKit + pdf-lib, vector)');
  const pages = opts.pages ? opts.pages.map((id) => doc.pages.find((p) => p.id === id)!).filter(Boolean) : doc.pages.filter((p) => !p.hidden);
  const lay = printLayout(doc.width, doc.height, opts.print ?? { bleed: 0, marks: false });
  const bl = opts.print ? Math.max(0, opts.print.bleed) : 0;
  const wPt = lay.mediaW * 0.75, hPt = lay.mediaH * 0.75;
  const isCmyk = opts.colorProfile === 'cmyk';
  /** Colour operators in the chosen profile (r, g, b in 0..1). */
  const fillOp = (c: { r: number; g: number; b: number }) => (isCmyk ? setFillingCmykColor(...rgbToCmyk(c.r, c.g, c.b)) : setFillingRgbColor(c.r, c.g, c.b));
  const strokeOp = (c: { r: number; g: number; b: number }) => (isCmyk ? setStrokingCmykColor(...rgbToCmyk(c.r, c.g, c.b)) : setStrokingRgbColor(c.r, c.g, c.b));
  const pdfColor = (c: { r: number; g: number; b: number }): PdfColor => (isCmyk ? cmyk(...rgbToCmyk(c.r, c.g, c.b)) : rgb(c.r, c.g, c.b));

  /** RGBA pixels as a DeviceCMYK image (alpha as a soft mask). */
  const cmykImage = (px: Uint8Array, w: number, h: number): PDFRef => {
    const { cmyk: data, alpha, opaque } = rgbaToCmyk(px);
    const dict: Record<string, unknown> = { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceCMYK', BitsPerComponent: 8 };
    if (!opaque) dict.SMask = pdf.context.register(pdf.context.flateStream(alpha, { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }));
    return pdf.context.register(pdf.context.flateStream(data, dict as never));
  };
  /** Decode any image CanvasKit reads into a CMYK image. */
  const cmykFromEncoded = (bytes: Uint8Array): PDFRef | null => {
    const img = ck.MakeImageFromEncoded(bytes);
    if (!img) return null;
    const w = img.width(), h = img.height();
    const px = img.readPixels(0, 0, { width: w, height: h, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array | null;
    img.delete();
    return px ? cmykImage(px, w, h) : null;
  };
  /** A PNG the renderer made (raster elements, backgrounds). */
  const embedPng = async (bytes: Uint8Array): Promise<PDFRef | null> => (isCmyk ? cmykFromEncoded(bytes) : (await pdf.embedPng(bytes)).ref);

  const fonts = new Map<FontFace, { font: PDFFont; chars: Set<number> }>();
  const embedFace = async (f: FontFace) => {
    let e = fonts.get(f);
    if (!e) {
      // whole font files: pdf-lib's subsetter drops glyphs of some fonts (Inter among them)
      const font = await pdf.embedFont(f.bytes, { subset: false });
      e = { font, chars: new Set(font.getCharacterSet()) };
      fonts.set(f, e);
    }
    return e;
  };
  const exact: ExactWriter | null = doc.pdf ? await exactWriter(pdf, doc, opts.assets) : null;
  const pendingLinks: { page: PDFPage; links: NonNullable<Page['links']>; toSheet: (x: number, y: number) => [number, number] }[] = [];
  const images = new Map<string, PDFRef | null>();
  const embedImage = async (key: string, bytes: Uint8Array, mime: string): Promise<PDFRef | null> => {
    if (images.has(key)) return images.get(key)!;
    let img: PDFRef | null = null;
    try {
      if (isCmyk) img = cmykFromEncoded(bytes);
      else if (mime === 'image/jpeg') img = (await pdf.embedJpg(bytes)).ref;
      else if (mime === 'image/png') img = (await pdf.embedPng(bytes)).ref;
      else {
        // WebP, GIF…: re-encode as PNG
        const decoded = ck.MakeImageFromEncoded(bytes);
        const png = decoded?.encodeToBytes(ck.ImageFormat.PNG, 100);
        decoded?.delete();
        if (png) img = (await pdf.embedPng(png)).ref;
      }
    } catch {
      img = null;
    }
    images.set(key, img);
    return img;
  };

  for (const page of pages) {
    // an imported page gets its own size back; `box` also moves it off the letterbox
    const box = !opts.print ? page.pdfPage : undefined;
    const sheetW = box ? box.w : wPt, sheetH = box ? box.h : hPt;
    const p = pdf.addPage([sheetW, sheetH]);
    if (opts.print) {
      // PDF boxes are y-up points; the layout is symmetric, so y = x
      p.setBleedBox(lay.bleed.x * 0.75, lay.bleed.y * 0.75, lay.bleed.w * 0.75, lay.bleed.h * 0.75);
      p.setTrimBox(lay.trim.x * 0.75, lay.trim.y * 0.75, lay.trim.w * 0.75, lay.trim.h * 0.75);
    }
    const blends = new Map<string, PDFName>();
    /** A blend mode, for elements of imported pages. */
    const blendOp = (b: string): PDFOperator => {
      let name = blends.get(b);
      if (!name) {
        const bm = b.split('-').map((w) => w[0]!.toUpperCase() + w.slice(1)).join('');
        name = p.node.newExtGState('BM', pdf.context.obj({ Type: 'ExtGState', BM: bm }));
        blends.set(b, name);
      }
      return setGraphicsState(name);
    };
    const states = new Map<string, PDFName>();
    /** Named graphics state for fill/stroke alpha. */
    const alpha = (ca: number, CA: number): PDFOperator[] => {
      if (ca >= 0.999 && CA >= 0.999) return [];
      const key = `${ca.toFixed(3)}/${CA.toFixed(3)}`;
      let name = states.get(key);
      if (!name) {
        name = p.node.newExtGState('GS', pdf.context.obj({ Type: 'ExtGState', ca: Number(ca.toFixed(3)), CA: Number(CA.toFixed(3)) }));
        states.set(key, name);
      }
      return [setGraphicsState(name)];
    };
    const ops = (...o: PDFOperator[]) => p.pushOperators(...o);
    const pathOps = (cmds: Cmd[]): PDFOperator[] => cmds.map((c) => (c.op === 'M' ? moveTo(c.x, c.y) : c.op === 'L' ? lineTo(c.x, c.y) : c.op === 'C' ? appendBezierCurve(c.x1, c.y1, c.x2, c.y2, c.x, c.y) : closePath()));

    const paint = (path: Path, how: Paint, opacity: number) => {
      const cmds = pathCmds(ck, path);
      if (!cmds.length) return;
      const f = how.fill ? rgba(how.fill) : null;
      const s = how.stroke && how.stroke.width > 0 ? rgba(how.stroke.color) : null;
      if (!f && !s) return;
      const o: PDFOperator[] = [pushGraphicsState(), ...alpha(opacity * (f?.a ?? 1), opacity * (s?.a ?? 1))];
      if (f) o.push(fillOp(f));
      if (s && how.stroke) {
        const cap = how.stroke.cap ?? 'butt';
        o.push(strokeOp(s), setLineWidth(how.stroke.width), setLineJoin(LineJoinStyle.Round),
          setLineCap(cap === 'round' ? LineCapStyle.Round : cap === 'square' ? LineCapStyle.Projecting : LineCapStyle.Butt));
        const dash = how.stroke.dashes === undefined ? dashArray(how.stroke, cap) : how.stroke.dashes;
        if (dash) o.push(setDashPattern(dash, 0));
      }
      o.push(...pathOps(cmds));
      const eo = how.evenOdd;
      o.push(PDFOperator.of(f && s ? (eo ? PDFOperatorNames.FillEvenOddAndStroke : PDFOperatorNames.FillNonZeroAndStroke) : f ? (eo ? PDFOperatorNames.FillEvenOdd : PDFOperatorNames.FillNonZero) : PDFOperatorNames.StrokePath));
      o.push(popGraphicsState());
      ops(...o);
    };
    const solid = (fill: Fill | null) => (fill?.type === 'solid' ? fill.color : null);

    /** Draw an image so the unit square lands on page px rect (x, y, w, h), y down. */
    const xobjects = new Map<PDFRef, PDFName>();
    const placeImage = (img: PDFRef, x: number, y: number, w: number, h: number, opacity = 1) => {
      let name = xobjects.get(img);
      if (!name) xobjects.set(img, (name = p.node.newXObject('Image', img)));
      ops(pushGraphicsState(), ...alpha(opacity, opacity), concatTransformationMatrix(w, 0, 0, -h, x, y + h), drawObject(name), popGraphicsState());
    };

    let root: Matrix = [1, 0, 0, 1, 0, 0];
    /** Rotation and flips of an element, as a matrix from its unrotated frame to page px. */
    const frameOf = (el: Element): Matrix => {
      const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
      let m: Matrix = [1, 0, 0, 1, 0, 0];
      if (el.rotation) {
        const r = (el.rotation * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
        m = mulMatrix(m, [cos, sin, -sin, cos, cx - cx * cos + cy * sin, cy - cx * sin - cy * cos]);
      }
      if (el.flipX || el.flipY) {
        const fx = el.flipX ? -1 : 1, fy = el.flipY ? -1 : 1;
        m = mulMatrix(m, [fx, 0, 0, fy, cx - fx * cx, cy - fy * cy]);
      }
      return m;
    };
    const fine = (m: Matrix): Matrix => m.map((v) => Math.round(v * 1e6) / 1e6) as Matrix;
    /** Path commands of an SVG `d`, moved by `m` straight to sheet points. */
    const absPath = (d: string, m: Matrix): PDFOperator[] => pathOps(parseD(d).map((c) => {
      if (c.op === 'Z') return c;
      const p = applyMatrix(m, c.x, c.y);
      if (c.op !== 'C') return { op: c.op, x: Math.round(p[0] * 1e4) / 1e4, y: Math.round(p[1] * 1e4) / 1e4 };
      const a = applyMatrix(m, c.x1, c.y1), b = applyMatrix(m, c.x2, c.y2);
      const f = (v: number) => Math.round(v * 1e4) / 1e4;
      return { op: 'C' as const, x1: f(a[0]), y1: f(a[1]), x2: f(b[0]), y2: f(b[1]), x: f(p[0]), y: f(p[1]) };
    }));

    /** The exact glyphs of an imported text box. */
    const exactRuns = (el: TextElement, x: TextExact, w: ExactWriter) => {
      const sx = x.w > 0 ? el.w / x.w : 1, sy = x.h > 0 ? el.h / x.h : 1;
      const recolor = el.style.color !== x.color ? el.style.color : null;
      const toSheet = mulMatrix(mulMatrix(root, frameOf(el)), [sx, 0, 0, sy, el.x, el.y]);
      for (const run of x.runs) {
        const f = w.font(p, run.font);
        const info = doc.pdf!.fonts[run.font]!;
        if (!f) {
          if (run.mode === 3) continue;
          continue;
        }
        const fill = rgba(recolor ?? run.color), st = run.stroke ? rgba(run.stroke) : null;
        const o: PDFOperator[] = [pushGraphicsState(), ...alpha(el.opacity * fill.a, el.opacity * (st?.a ?? 1)), cm(fine(mulMatrix(toSheet, run.m)))];
        const fillSrc = !recolor && run.colorSrc ? colorOps(w, p, run.colorSrc, false) : null;
        o.push(...(fillSrc ?? [fillOp(fill)]));
        if (st) {
          o.push(...((run.strokeSrc ? colorOps(w, p, run.strokeSrc, true) : null) ?? [strokeOp(st)]));
          if (run.lw !== undefined) o.push(setLineWidth(run.lw));
        }
        o.push(...textStateOps(f.gidCodes ? { ...run, tw: undefined } : run, f.name));
        if (run.actual !== undefined) o.push(actualTextOp(run.actual));
        o.push(tjOp(run, info.bytes, f.gidCodes ? info : null));
        if (run.actual !== undefined) o.push(PDFOperator.of('EMC' as never));
        o.push(PDFOperator.of(PDFOperatorNames.EndText), popGraphicsState());
        ops(...o);
      }
    };

    const text = async (el: TextElement, opacity: number) => {
      for (const piece of renderer.textPieces(el)) {
        const st = piece.style;
        const chain = [...pickFaces(renderer.fonts.faces, st.fontFamily, st.bold, st.italic), ...pickFaces(renderer.fonts.faces, 'Inter', st.bold, st.italic)];
        if (!chain.length) continue;
        const embedded = await Promise.all(chain.map(embedFace));
        // split the word where it needs another face (a subset, or Inter as the last resort)
        const segs: { font: PDFFont; text: string }[] = [];
        for (const ch of piece.text) {
          const cp = ch.codePointAt(0)!;
          const font = (embedded.find((e) => e.chars.has(cp)) ?? embedded[0]!).font;
          const last = segs[segs.length - 1];
          if (last && last.font === font) last.text += ch;
          else segs.push({ font, text: ch });
        }
        const c = rgba(st.color);
        const x = el.x + piece.x, y = el.y + piece.y;
        const ls = st.letterSpacing || 0;
        const widthOf = (s: { font: PDFFont; text: string }) => s.font.widthOfTextAtSize(s.text, st.fontSize) + ls * [...s.text].length;
        const natural = segs.reduce((a, s) => a + widthOf(s), 0);
        // stretch to the width Skia laid out (kerning and shaping differ a little)
        const squeeze = segs.length === 1 && piece.text.length > 1 && natural > 0 ? Math.max(0.7, Math.min(1.4, piece.width / natural)) : 1;
        ops(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, -1, x, y));
        if (ls) ops(setCharacterSpacing(ls));
        if (Math.abs(squeeze - 1) > 0.002) ops(setCharacterSqueeze(squeeze * 100));
        let dx = 0;
        for (const s of segs) {
          p.drawText(s.text, { x: dx, y: 0, size: st.fontSize, font: s.font, color: pdfColor(c), opacity: opacity * c.a < 1 ? opacity * c.a : undefined });
          dx += widthOf(s) * squeeze;
        }
        ops(popGraphicsState());
        const t = Math.max(0.75, st.fontSize / 16);
        const line = (yy: number) => {
          const b = new ck.PathBuilder();
          b.addRect(ck.XYWHRect(x, yy - t / 2, piece.width, t));
          const path = b.detachAndDelete();
          paint(path, { fill: st.color, stroke: null }, opacity);
          path.delete();
        };
        if (st.underline) line(y + st.fontSize * 0.12);
        if (st.strike) line(y - st.fontSize * 0.28);
      }
    };

    const pieces = async (d: Decomposed, opacity: number) => {
      for (const prim of d.paths) {
        const path = ck.Path.MakeFromSVGString(prim.d);
        if (!path) continue;
        paint(path, { fill: solid(prim.fill), stroke: prim.stroke ? { ...prim.stroke, cap: prim.cap } : null }, opacity);
        path.delete();
      }
      for (const t of d.texts) await text(t.el, opacity);
    };

    const shape = (el: ShapeElement) => {
      const path = shapePath(ck, el.shape, el.x, el.y, el.w, el.h, el.radius);
      const w = el.stroke?.width ?? 0;
      paint(path, { fill: solid(el.fill), stroke: el.stroke ? { ...el.stroke, dashes: el.stroke.dash === 'dashed' ? [w * 3, w * 2] : el.stroke.dash === 'dotted' ? [w, w] : null } : null }, el.opacity);
      path.delete();
    };

    /** A part as the PDF drew it, in viewBox units. */
    const exactPartOps = (part: PathPart, ex: NonNullable<ReturnType<typeof exactPart>>, w: ExactWriter, opacity: number, toSheet: Matrix) => {
      const cmds = ex.ctm ? absPath(part.d, [1, 0, 0, 1, 0, 0]) : absPath(part.d, toSheet);
      const k = ex.ctm ? 1 : Math.sqrt(Math.abs(toSheet[0] * toSheet[3] - toSheet[1] * toSheet[2]));
      const fill = part.fill?.type === 'solid' ? rgba(part.fill.color) : null;
      const st = part.stroke ? rgba(part.stroke.color) : null;
      const o: PDFOperator[] = [pushGraphicsState(), ...alpha(opacity * (fill?.a ?? 1), opacity * (st?.a ?? 1))];
      if (ex.ctm) o.push(cm(fine(mulMatrix(toSheet, ex.ctm))));
      const pattern = ex.pattern && !ex.ctm ? w.pattern(p, ex.pattern.obj, fine(mulMatrix(toSheet, ex.pattern.base))) : null;
      if (pattern) {
        o.push(PDFOperator.of(PDFOperatorNames.NonStrokingColorspace, [PDFName.of('Pattern')]), PDFOperator.of(PDFOperatorNames.NonStrokingColorN, [pattern]));
      } else if (ex.shade) {
        const own = ex.shading !== undefined && ex.base ? w.shadingObject(p, ex.shading) : null;
        const name = own ?? w.shading(p, ex.shade);
        ops(...o, pushGraphicsState(), ...cmds, part.evenOdd ? clipEvenOdd() : clip(), endPath(), cm(fine(mulMatrix(toSheet, own ? ex.base! : ex.shade.matrix))), PDFOperator.of(PDFOperatorNames.ShadingFill, [name]), popGraphicsState());
        o.length = 0;
        if (st) o.push(...strokeOps(ex, k), ...((ex.strokeSrc ? colorOps(w, p, ex.strokeSrc, true) : null) ?? [strokeOp(st)]), ...cmds, PDFOperator.of(PDFOperatorNames.StrokePath));
        ops(...o, popGraphicsState());
        return;
      }
      if (fill && !pattern) o.push(...((ex.fillSrc ? colorOps(w, p, ex.fillSrc, false) : null) ?? [fillOp(fill)]));
      if (st) o.push(...strokeOps(ex, k), ...((ex.strokeSrc ? colorOps(w, p, ex.strokeSrc, true) : null) ?? [strokeOp(st)]));
      o.push(...cmds);
      const eo = part.evenOdd;
      o.push(PDFOperator.of(fill && st ? (eo ? PDFOperatorNames.FillEvenOddAndStroke : PDFOperatorNames.FillNonZeroAndStroke) : fill ? (eo ? PDFOperatorNames.FillEvenOdd : PDFOperatorNames.FillNonZero) : PDFOperatorNames.StrokePath), popGraphicsState());
      ops(...o);
    };

    const vectorPath = (el: PathElement) => {
      const vb = el.viewBox;
      if (vb.w <= 0 || vb.h <= 0) return;
      const sx = el.w / vb.w, sy = el.h / vb.h;
      for (const part of el.paths) {
        const raw = ck.Path.MakeFromSVGString(part.d);
        if (!raw) continue;
        const path = transformPath(ck, raw, [sx, 0, el.x - vb.x * sx, 0, sy, el.y - vb.y * sy, 0, 0, 1]);
        paint(path, { fill: solid(part.fill), stroke: part.stroke ? { ...part.stroke, cap: 'round', dashes: null } : null, evenOdd: part.evenOdd }, el.opacity);
        path.delete();
      }
    };

    /** Whatever of an element keeps its PDF form, written in sheet points. True when nothing is left to draw. */
    const exactElement = (el: Exclude<Element, { type: 'group' }>, w: ExactWriter): boolean => {
      if (el.type === 'text') {
        const x = exactText(el);
        if (!x || !x.runs.every((r) => w.ok(r))) return false;
        exactRuns(el, x, w);
        return true;
      }
      if (el.type === 'path') {
        const vb = el.viewBox;
        if (vb.w <= 0 || vb.h <= 0 || el.paths.some((q) => !exactPart(q))) return false;
        const sx = el.w / vb.w, sy = el.h / vb.h;
        const toSheet = mulMatrix(mulMatrix(root, frameOf(el)), [sx, 0, 0, sy, el.x - vb.x * sx, el.y - vb.y * sy]);
        for (const part of el.paths) exactPartOps(part, exactPart(part)!, w, el.opacity, toSheet);
        return true;
      }
      if (el.type === 'image' && el.pdfVector?.asset === el.asset) {
        const v = el.pdfVector;
        const sx = v.box.w > 0 ? el.w / v.box.w : 1, sy = v.box.h > 0 ? el.h / v.box.h : 1;
        const move = mulMatrix(mulMatrix(root, frameOf(el)), [sx, 0, 0, sy, el.x - v.box.x * sx, el.y - v.box.y * sy]);
        const form = v.form ? w.form(p, v.form.obj) : null;
        const fills = (v.fills ?? []).map((f) => ({ f, name: f.tile ? w.tile(p, f.tile, fine(mulMatrix(move, f.base))) : w.pattern(p, f.obj!, fine(mulMatrix(move, f.base))) }));
        if ((v.form && !form) || fills.some((f) => !f.name)) return false;
        if (v.form && form) {
          ops(pushGraphicsState());
          for (const c of v.form.clips) ops(...absPath(c.d, move), c.evenOdd ? clipEvenOdd() : clip(), endPath());
          ops(...alpha(v.form.alpha * el.opacity, v.form.alpha * el.opacity), cm(fine(mulMatrix(move, v.form.m))), drawObject(form), popGraphicsState());
        }
        for (const { f, name } of fills) {
          ops(pushGraphicsState());
          for (const c of f.clips) ops(...absPath(c.d, move), c.evenOdd ? clipEvenOdd() : clip(), endPath());
          ops(...alpha(f.alpha * el.opacity, f.alpha * el.opacity), PDFOperator.of(PDFOperatorNames.NonStrokingColorspace, [PDFName.of('Pattern')]), PDFOperator.of(PDFOperatorNames.NonStrokingColorN, [name!]),
            ...absPath(f.d, move), PDFOperator.of(f.evenOdd ? PDFOperatorNames.FillEvenOdd : PDFOperatorNames.FillNonZero), popGraphicsState());
        }
        return true;
      }
      if (el.type === 'image' && el.pdfImage?.asset === el.asset) {
        const ref = w.image(el.pdfImage.obj);
        if (!ref) return false;
        const sc = el.pdfImage.stencil;
        if (sc) ops(...(colorOps(w, p, sc, false) ?? [fillOp(rgba(sc.rgb))]));
        let name = xobjects.get(ref);
        if (!name) xobjects.set(ref, (name = p.node.newXObject('Image', ref)));
        ops(...alpha(el.opacity, el.opacity), cm(fine(mulMatrix(mulMatrix(root, frameOf(el)), [el.w, 0, 0, -el.h, el.x, el.y + el.h]))), drawObject(name));
        return true;
      }
      return false;
    };

    const picture = async (el: ImageElement | VideoElement) => {
      const assetId = el.type === 'video' ? posterOf(el) : el.asset;
      const bytes = assetId ? opts.assets.get(assetId) : undefined;
      const size = bytes ? renderer.setImage(assetId, bytes) : null;
      const clipPath = (el.type === 'image' ? renderer.maskPath(el) : null) ?? shapePath(ck, 'rect', el.x, el.y, el.w, el.h, el.radius);
      const img = bytes && size ? await embedImage(assetId, bytes, el.type === 'video' ? 'image/png' : doc.assets[assetId]?.mime ?? 'image/png') : null;
      if (!img || !size) {
        paint(clipPath, { fill: el.type === 'video' ? '#1f2128' : '#d4d8e0', stroke: null }, el.opacity);
        clipPath.delete();
        return;
      }
      const full = el.crop && el.crop.x === 0 && el.crop.y === 0 && el.crop.w === 1 && el.crop.h === 1 && exact && el.radius === 0;
      ops(pushGraphicsState());
      if (!full) ops(...pathOps(pathCmds(ck, clipPath)), clip(), endPath());
      clipPath.delete();
      let crop = el.crop;
      if (!crop) {
        const s = Math.max(el.w / size.width, el.h / size.height);
        const cw = el.w / s / size.width, ch = el.h / s / size.height;
        crop = { x: (1 - cw) / 2, y: (1 - ch) / 2, w: cw, h: ch };
      }
      const W = el.w / crop.w, H = el.h / crop.h;
      placeImage(img, el.x - crop.x * W, el.y - crop.y * H, W, H, el.opacity);
      ops(popGraphicsState());
    };

    // sheet px (y down) → PDF points (y up); then page px (0,0 = the trim's top-left)
    const pt = box ? 1 / box.scale : 0.75;
    const rootMatrix: Matrix = [pt, 0, 0, -pt, (box ? -box.x : lay.trim.x) * pt, sheetH - (box ? -box.y : lay.trim.y) * pt];
    root = rootMatrix;
    // imported pages write absolute points, element by element: Splash floors device boxes, so a CTM
    // that lands 1e-13 under an integer moves an image by a pixel
    if (!doc.pdf) ops(pushGraphicsState(), concatTransformationMatrix(pt, 0, 0, -pt, 0, sheetH), concatTransformationMatrix(1, 0, 0, 1, lay.trim.x, lay.trim.y));
    if (page.links?.length) {
      const ox = box ? box.x : -lay.trim.x, oy = box ? box.y : -lay.trim.y;
      pendingLinks.push({ page: p, links: page.links, toSheet: (x, y) => [(x - ox) * pt, sheetH - (y - oy) * pt] });
    }
    // artwork stops at the bleed (the marks' slug stays clean)
    if (!doc.pdf) ops(...pathOps([{ op: 'M', x: -bl, y: -bl }, { op: 'L', x: doc.width + bl, y: -bl }, { op: 'L', x: doc.width + bl, y: doc.height + bl }, { op: 'L', x: -bl, y: doc.height + bl }, { op: 'Z' }]), clip(), endPath());
    // a blend mixes with what's under it, which vectors drawn one by one can't do: draw the page whole
    const blended = !doc.pdf && [...walk(page.elements)].some((e) => e.blend);
    if (opts.flatten || blended) {
      if (doc.pdf) ops(pushGraphicsState(), cm(root));
      // the whole page as one picture (bleed included)
      const scale = (opts.flatten?.dpi ?? 300) / 96;
      const bytes = renderer.exportPage(doc, page, { scale, format: isCmyk ? 'png' : 'jpeg', quality: 92, bleed: bl });
      const img = isCmyk ? cmykFromEncoded(bytes) : (await pdf.embedJpg(bytes)).ref;
      if (img) placeImage(img, -bl, -bl, doc.width + 2 * bl, doc.height + 2 * bl);
      ops(popGraphicsState());
      cropMarks(p);
      await notesPage(page);
      continue;
    }
    const plain = doc.pdf && page.background.type === 'solid' && /^#fff(fff)?$/i.test(page.background.color);
    if (doc.pdf) ops(pushGraphicsState(), cm(root));
    if (plain) { /* paper is white: an imported page adds nothing under its own content */ } else if (page.background.type === 'solid') {
      const b = new ck.PathBuilder();
      b.addRect(ck.XYWHRect(-bl, -bl, doc.width + 2 * bl, doc.height + 2 * bl));
      const path = b.detachAndDelete();
      paint(path, { fill: page.background.color, stroke: null }, 1);
      path.delete();
    } else {
      const bg = await embedPng(renderer.exportPage(doc, { ...page, elements: [] }, { format: 'png', bleed: bl }));
      if (bg) placeImage(bg, -bl, -bl, doc.width + 2 * bl, doc.height + 2 * bl);
    }
    if (doc.pdf) ops(popGraphicsState());
    for (const el of flattenGroups(page.elements)) {
      if (el.hidden) continue;
      if (needsRaster(el) && ((el.type !== 'image' && el.type !== 'video') || loadPicture(renderer, el, opts.assets))) {
        const r = renderer.rasterElement(el);
        const img = r ? await embedPng(r.png) : null;
        if (r && img) {
          if (doc.pdf) ops(pushGraphicsState(), cm(root));
          placeImage(img, r.x, r.y, r.w, r.h);
          if (doc.pdf) ops(popGraphicsState());
        }
        continue;
      }
      ops(pushGraphicsState());
      if (el.blend && doc.pdf) ops(blendOp(el.blend));
      const cl = clipOf(el);
      if (cl) {
        const m = mulMatrix(root, cl.m);
        for (const c of cl.clip.paths) ops(...absPath(c.d, m), c.evenOdd ? clipEvenOdd() : clip(), endPath());
      }
      if (exact) {
        if (exactElement(el, exact)) { ops(popGraphicsState()); continue; }
        ops(cm(root));
      }
      const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
      if (el.rotation) {
        const r = (el.rotation * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
        ops(concatTransformationMatrix(cos, sin, -sin, cos, cx - cx * cos + cy * sin, cy - cx * sin - cy * cos));
      }
      if (el.flipX || el.flipY) {
        const fx = el.flipX ? -1 : 1, fy = el.flipY ? -1 : 1;
        ops(concatTransformationMatrix(fx, 0, 0, fy, cx - fx * cx, cy - fy * cy));
      }
      if (el.type === 'shape') shape(el);
      else if (el.type === 'path') vectorPath(el);
      else if (el.type === 'text') await text(el, el.opacity);
      else if (el.type === 'line' || el.type === 'table' || el.type === 'chart') await pieces(renderer.vectorize(el), el.opacity);
      else await picture(el);
      ops(popGraphicsState());
    }
    if (!doc.pdf) ops(popGraphicsState());
    cropMarks(p);
    await notesPage(page);
  }
  const pageRefs = pdf.getPages();
  for (const l of pendingLinks) addLinks(l.page, l.links, l.toSheet, (i) => { const at = pages.indexOf(doc.pages[i]!); return at >= 0 ? pageRefs[at]?.ref : undefined; });
  return pdf.save({ objectsPerTick: Infinity });

  /** Hairline crop marks in registration colour (all inks in CMYK). */
  function cropMarks(p: PDFPage): void {
    if (!lay.marks.length) return;
    const o: PDFOperator[] = [pushGraphicsState(), concatTransformationMatrix(0.75, 0, 0, -0.75, 0, hPt),
      isCmyk ? setStrokingCmykColor(1, 1, 1, 1) : setStrokingRgbColor(0, 0, 0), setLineWidth(0.25 / 0.75), setLineCap(LineCapStyle.Butt)];
    for (const m of lay.marks) o.push(moveTo(m.x1, m.y1), lineTo(m.x2, m.y2), PDFOperator.of(PDFOperatorNames.StrokePath));
    o.push(popGraphicsState());
    p.pushOperators(...o);
  }

  /** Canva's "Include notes": the page's notes on a page of their own, right after it. */
  async function notesPage(page: Page): Promise<void> {
    const body = page.notes?.trim();
    if (!opts.notes || !body) return;
    const W = doc.width * 0.75, H = doc.height * 0.75;
    const np = pdf.addPage([W, H]);
    const face = pickFaces(renderer.fonts.faces, 'Inter', false, false)[0];
    const bold = pickFaces(renderer.fonts.faces, 'Inter', true, false)[0];
    const font = face ? (await embedFace(face)).font : await pdf.embedFont(StandardFonts.Helvetica);
    const head = bold ? (await embedFace(bold)).font : font;
    const chars = face ? fonts.get(face)!.chars : null;
    const safe = (t: string) => [...t].map((ch) => (chars ? (chars.has(ch.codePointAt(0)!) ? ch : '?') : ch.charCodeAt(0) < 256 ? ch : '?')).join('');
    const size = Math.max(9, Math.min(16, Math.min(W, H) / 36)), margin = Math.max(18, Math.min(W, H) * 0.08);
    const ink = pdfColor({ r: 0.1, g: 0.1, b: 0.12 });
    let y = H - margin - size * 1.4;
    np.drawText(safe(`Notes - page ${doc.pages.indexOf(page) + 1}`), { x: margin, y, size: size * 1.4, font: head, color: ink });
    y -= size * 2.6;
    const maxW = W - 2 * margin;
    for (const para of body.split(/\r?\n/)) {
      const words = safe(para).split(/\s+/);
      let line = '';
      const flush = () => {
        if (y < margin) return;
        np.drawText(line, { x: margin, y, size, font, color: ink });
        y -= size * 1.45;
        line = '';
      };
      for (const w of words) {
        const next = line ? `${line} ${w}` : w;
        if (line && font.widthOfTextAtSize(next, size) > maxW) { flush(); line = w; } else line = next;
      }
      flush();
    }
  }
}

/** Groups keep their children in page coordinates: export the children (the group's opacity carried down). */
function flattenGroups(els: readonly Element[]): Exclude<Element, { type: 'group' }>[] {
  return els.flatMap((e) => (e.type === 'group'
    ? flattenGroups(e.children.map((c) => ({ ...c, opacity: c.opacity * e.opacity, hidden: c.hidden || e.hidden })))
    : [e as Exclude<Element, { type: 'group' }>]));
}
