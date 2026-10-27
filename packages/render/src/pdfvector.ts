import {
  appendBezierCurve, clip, closePath, concatTransformationMatrix, endPath, LineCapStyle, LineJoinStyle, lineTo, moveTo, PDFDocument, PDFOperator,
  PDFOperatorNames, popGraphicsState, pushGraphicsState, rgb, setCharacterSpacing, setCharacterSqueeze, setDashPattern, setFillingRgbColor,
  setGraphicsState, setLineCap, setLineJoin, setLineWidth, setStrokingRgbColor, type PDFFont, type PDFName, type PDFImage, type PDFPage,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Path } from 'canvaskit-wasm';
import type { Color, Doc, Element, Fill, ImageElement, Page, PathElement, ShapeElement, Stroke, TextElement, VideoElement } from '@digital-canvas/scene';
import { dashArray, type Decomposed } from '@digital-canvas/scene';
import type { FontFace } from './fonts.ts';
import { shapePath, transformPath, type Renderer } from './renderer.ts';
import { loadPicture, pictureNeedsRaster, textNeedsRaster, type VectorExportOptions } from './svgexport.ts';
import { pathCmds, pickFaces, rgba, type Cmd } from './vectorpath.ts';

export interface VectorPdfOptions extends VectorExportOptions {
  /** Page ids to include, in order (default: all visible pages). */
  pages?: string[];
  title?: string;
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
  const wPt = (doc.width * 72) / 96, hPt = (doc.height * 72) / 96;

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
  const images = new Map<string, PDFImage | null>();
  const embedImage = async (key: string, bytes: Uint8Array, mime: string): Promise<PDFImage | null> => {
    if (images.has(key)) return images.get(key)!;
    let img: PDFImage | null = null;
    try {
      if (mime === 'image/jpeg') img = await pdf.embedJpg(bytes);
      else if (mime === 'image/png') img = await pdf.embedPng(bytes);
      else {
        // WebP, GIF…: re-encode as PNG
        const decoded = ck.MakeImageFromEncoded(bytes);
        const png = decoded?.encodeToBytes(ck.ImageFormat.PNG, 100);
        decoded?.delete();
        if (png) img = await pdf.embedPng(png);
      }
    } catch {
      img = null;
    }
    images.set(key, img);
    return img;
  };

  for (const page of pages) {
    const p = pdf.addPage([wPt, hPt]);
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
      if (f) o.push(setFillingRgbColor(f.r, f.g, f.b));
      if (s && how.stroke) {
        const cap = how.stroke.cap ?? 'butt';
        o.push(setStrokingRgbColor(s.r, s.g, s.b), setLineWidth(how.stroke.width), setLineJoin(LineJoinStyle.Round),
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
    const placeImage = (img: PDFImage, x: number, y: number, w: number, h: number, opacity = 1) => {
      ops(pushGraphicsState(), concatTransformationMatrix(w, 0, 0, -h, x, y + h));
      p.drawImage(img, { x: 0, y: 0, width: 1, height: 1, opacity: opacity < 1 ? opacity : undefined });
      ops(popGraphicsState());
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
          p.drawText(s.text, { x: dx, y: 0, size: st.fontSize, font: s.font, color: rgb(c.r, c.g, c.b), opacity: opacity * c.a < 1 ? opacity * c.a : undefined });
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
      const assetId = el.type === 'video' ? `${el.asset}.poster` : el.asset;
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

    // page px (y down) → PDF points (y up)
    ops(pushGraphicsState(), concatTransformationMatrix(0.75, 0, 0, -0.75, 0, hPt));
    if (page.background.type === 'solid') {
      const b = new ck.PathBuilder();
      b.addRect(ck.XYWHRect(0, 0, doc.width, doc.height));
      const path = b.detachAndDelete();
      paint(path, { fill: page.background.color, stroke: null }, 1);
      path.delete();
    } else {
      const bg = await pdf.embedPng(renderer.rasterBackground(doc, page));
      placeImage(bg, 0, 0, doc.width, doc.height);
    }
    for (const el of flattenGroups(page.elements)) {
      if (el.hidden) continue;
      if (needsRaster(el) && ((el.type !== 'image' && el.type !== 'video') || loadPicture(renderer, el, opts.assets))) {
        const r = renderer.rasterElement(el);
        if (r) placeImage(await pdf.embedPng(r.png), r.x, r.y, r.w, r.h);
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
  }
  return pdf.save();
}

/** Groups keep their children in page coordinates: export the children (the group's opacity carried down). */
function flattenGroups(els: readonly Element[]): Exclude<Element, { type: 'group' }>[] {
  return els.flatMap((e) => (e.type === 'group'
    ? flattenGroups(e.children.map((c) => ({ ...c, opacity: c.opacity * e.opacity, hidden: c.hidden || e.hidden })))
    : [e as Exclude<Element, { type: 'group' }>]));
}
