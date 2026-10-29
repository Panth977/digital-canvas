import {
  appendBezierCurve, clip, closePath, cmyk, concatTransformationMatrix, drawObject, endPath, LineCapStyle, LineJoinStyle, lineTo, moveTo, PDFDocument, PDFOperator,
  PDFOperatorNames, popGraphicsState, pushGraphicsState, rgb, setCharacterSpacing, setCharacterSqueeze, setDashPattern, setFillingCmykColor, setFillingRgbColor,
  setGraphicsState, setLineCap, setLineJoin, setLineWidth, setStrokingCmykColor, setStrokingRgbColor, StandardFonts, type Color as PdfColor, type PDFFont,
  type PDFName, type PDFPage, type PDFRef,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Path } from 'canvaskit-wasm';
import type { Color, Doc, Element, Fill, ImageElement, Page, PathElement, ShapeElement, Stroke, TextElement, VideoElement } from '@digital-canvas/scene';
import { dashArray, posterOf, type Decomposed } from '@digital-canvas/scene';
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
  if (el.type === 'text') return textNeedsRaster(el) || !!el.gradient;
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
    const p = pdf.addPage([wPt, hPt]);
    if (opts.print) {
      // PDF boxes are y-up points; the layout is symmetric, so y = x
      p.setBleedBox(lay.bleed.x * 0.75, lay.bleed.y * 0.75, lay.bleed.w * 0.75, lay.bleed.h * 0.75);
      p.setTrimBox(lay.trim.x * 0.75, lay.trim.y * 0.75, lay.trim.w * 0.75, lay.trim.h * 0.75);
    }
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
      ops(pushGraphicsState(), ...pathOps(pathCmds(ck, clipPath)), clip(), endPath());
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
    ops(pushGraphicsState(), concatTransformationMatrix(0.75, 0, 0, -0.75, 0, hPt), concatTransformationMatrix(1, 0, 0, 1, lay.trim.x, lay.trim.y));
    // artwork stops at the bleed (the marks' slug stays clean)
    ops(...pathOps([{ op: 'M', x: -bl, y: -bl }, { op: 'L', x: doc.width + bl, y: -bl }, { op: 'L', x: doc.width + bl, y: doc.height + bl }, { op: 'L', x: -bl, y: doc.height + bl }, { op: 'Z' }]), clip(), endPath());
    if (opts.flatten) {
      // the whole page as one picture (bleed included)
      const scale = opts.flatten.dpi / 96;
      const bytes = renderer.exportPage(doc, page, { scale, format: isCmyk ? 'png' : 'jpeg', quality: 92, bleed: bl });
      const img = isCmyk ? cmykFromEncoded(bytes) : (await pdf.embedJpg(bytes)).ref;
      if (img) placeImage(img, -bl, -bl, doc.width + 2 * bl, doc.height + 2 * bl);
      ops(popGraphicsState());
      cropMarks(p);
      await notesPage(page);
      continue;
    }
    if (page.background.type === 'solid') {
      const b = new ck.PathBuilder();
      b.addRect(ck.XYWHRect(-bl, -bl, doc.width + 2 * bl, doc.height + 2 * bl));
      const path = b.detachAndDelete();
      paint(path, { fill: page.background.color, stroke: null }, 1);
      path.delete();
    } else {
      const bg = await embedPng(renderer.exportPage(doc, { ...page, elements: [] }, { format: 'png', bleed: bl }));
      if (bg) placeImage(bg, -bl, -bl, doc.width + 2 * bl, doc.height + 2 * bl);
    }
    for (const el of flattenGroups(page.elements)) {
      if (el.hidden) continue;
      if (needsRaster(el) && ((el.type !== 'image' && el.type !== 'video') || loadPicture(renderer, el, opts.assets))) {
        const r = renderer.rasterElement(el);
        const img = r ? await embedPng(r.png) : null;
        if (r && img) placeImage(img, r.x, r.y, r.w, r.h);
        continue;
      }
      ops(pushGraphicsState());
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
    ops(popGraphicsState());
    cropMarks(p);
    await notesPage(page);
  }
  return pdf.save();

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
