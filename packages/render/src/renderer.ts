import type { Canvas, CanvasKit, Image, Paint, Paragraph, Path, TypefaceFontProvider } from 'canvaskit-wasm';
import type { Doc, Element, Fill, ImageElement, Page, ShapeElement, ShapeKind, TextElement, Color } from '@digital-canvas/scene';

/** Parse `#rgb`, `#rrggbb` or `#rrggbbaa` into a CanvasKit colour. */
export function color(ck: CanvasKit, hex: Color, alpha = 1): Float32Array {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  const a = h.length >= 8 ? n(6) : 1;
  return ck.Color4f(n(0) || 0, n(2) || 0, n(4) || 0, a * alpha);
}

/** Fonts the renderer can draw with. Several faces may share a family. */
export class FontLibrary {
  readonly provider: TypefaceFontProvider;
  readonly families = new Set<string>();
  /** Bumped on every new font, so cached text layouts know to redo. */
  version = 0;

  constructor(private ck: CanvasKit) {
    this.provider = ck.TypefaceFontProvider.Make();
  }

  add(family: string, bytes: ArrayBuffer | Uint8Array): void {
    this.provider.registerFont(bytes, family);
    this.families.add(family);
    this.version++;
  }

  /** Load the faces that ship with the app (Inter regular/bold/italic). */
  async loadBundled(baseUrl: string, fetcher: (url: string) => Promise<ArrayBuffer> = defaultFetch): Promise<void> {
    const faces = ['Inter-Regular', 'Inter-Bold', 'Inter-Italic', 'Inter-BoldItalic'];
    const bytes = await Promise.all(faces.map((f) => fetcher(`${baseUrl}${f}.ttf`)));
    bytes.forEach((b) => this.add('Inter', b));
  }

  dispose(): void {
    this.provider.delete();
  }
}

async function defaultFetch(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`font ${url}: HTTP ${r.status}`);
  return r.arrayBuffer();
}

interface CachedParagraph {
  sig: string;
  p: Paragraph;
}

export interface DrawOptions {
  /** Element ids to leave out (e.g. the text box being edited). */
  skip?: ReadonlySet<string>;
}

export interface ExportOptions {
  /** Multiplier on the page's px size (2 = double resolution). */
  scale?: number;
  format?: 'png' | 'jpeg' | 'webp';
  /** 0..100 for jpeg/webp. */
  quality?: number;
  /** Leave the page background out (PNG/WebP only). */
  transparent?: boolean;
}

/**
 * Draws Digital Canvas pages with CanvasKit (Skia compiled to WebAssembly).
 * Pure drawing: no DOM, so the same code exports in Node or a worker.
 */
export class Renderer {
  private images = new Map<string, Image>();
  private paragraphs = new Map<string, CachedParagraph>();
  private paint: Paint;

  constructor(readonly ck: CanvasKit, readonly fonts: FontLibrary) {
    this.paint = new ck.Paint();
    this.paint.setAntiAlias(true);
  }

  // ---- assets ----

  /** Decode an image asset; returns its size, or null if it can't be decoded. */
  setImage(assetId: string, bytes: Uint8Array): { width: number; height: number } | null {
    if (this.images.has(assetId)) {
      const img = this.images.get(assetId)!;
      return { width: img.width(), height: img.height() };
    }
    const img = this.ck.MakeImageFromEncoded(bytes);
    if (!img) return null;
    this.images.set(assetId, img);
    return { width: img.width(), height: img.height() };
  }

  hasImage(assetId: string): boolean {
    return this.images.has(assetId);
  }

  // ---- text ----

  private paragraph(el: TextElement): Paragraph {
    const s = el.style;
    const sig = `${this.fonts.version}|${el.w}|${el.text}|${JSON.stringify(s)}`;
    const hit = this.paragraphs.get(el.id);
    if (hit && hit.sig === sig) return hit.p;
    hit?.p.delete();
    const ck = this.ck;
    const align = { left: ck.TextAlign.Left, center: ck.TextAlign.Center, right: ck.TextAlign.Right, justify: ck.TextAlign.Justify }[s.align];
    const textStyle = new ck.TextStyle({
      color: color(ck, s.color),
      fontFamilies: [s.fontFamily, 'Inter'],
      fontSize: s.fontSize,
      fontStyle: { weight: s.bold ? ck.FontWeight.Bold : ck.FontWeight.Normal, slant: s.italic ? ck.FontSlant.Italic : ck.FontSlant.Upright },
      decoration: (s.underline ? ck.UnderlineDecoration : 0) | (s.strike ? ck.LineThroughDecoration : 0),
      decorationThickness: 1,
      heightMultiplier: s.lineHeight,
      // Spread extra line spacing above and below each line, like CSS (and the in-place text editor).
      halfLeading: true,
      letterSpacing: s.letterSpacing,
    });
    const style = new ck.ParagraphStyle({ textStyle, textAlign: align });
    const builder = ck.ParagraphBuilder.MakeFromFontProvider(style, this.fonts.provider);
    builder.addText(s.uppercase ? el.text.toUpperCase() : el.text);
    const p = builder.build();
    builder.delete();
    p.layout(Math.max(1, el.w));
    this.paragraphs.set(el.id, { sig, p });
    return p;
  }

  /** Height a text box needs for its content at its current width. */
  textHeight(el: TextElement): number {
    return Math.ceil(this.paragraph(el).getHeight());
  }

  /** Width of the longest line, for shrink-to-fit on new text. */
  textWidth(el: TextElement): number {
    return Math.ceil(this.paragraph({ ...el, w: 100000 }).getMaxIntrinsicWidth());
  }

  // ---- drawing ----

  /** Draw one page in page coordinates (0,0 = top-left of the page). */
  drawPage(canvas: Canvas, doc: Doc, page: Page, opts: DrawOptions = {}, background = true): void {
    const ck = this.ck;
    canvas.save();
    canvas.clipRect(ck.XYWHRect(0, 0, doc.width, doc.height), ck.ClipOp.Intersect, true);
    if (background) this.fillRect(canvas, page.background, 0, 0, doc.width, doc.height);
    for (const el of page.elements) {
      if (el.hidden || opts.skip?.has(el.id)) continue;
      this.drawElement(canvas, el);
    }
    canvas.restore();
  }

  drawElement(canvas: Canvas, el: Element): void {
    const ck = this.ck;
    canvas.save();
    const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
    if (el.rotation) canvas.rotate(el.rotation, cx, cy);
    if (el.flipX || el.flipY) {
      canvas.translate(cx, cy);
      canvas.scale(el.flipX ? -1 : 1, el.flipY ? -1 : 1);
      canvas.translate(-cx, -cy);
    }
    const layered = el.opacity < 1;
    if (layered) {
      const p = new ck.Paint();
      p.setAlphaf(Math.max(0, el.opacity));
      canvas.saveLayer(p);
      p.delete();
    }
    if (el.type === 'shape') this.drawShape(canvas, el);
    else if (el.type === 'text') canvas.drawParagraph(this.paragraph(el), el.x, el.y);
    else this.drawImage(canvas, el);
    if (layered) canvas.restore();
    canvas.restore();
  }

  private setFill(fill: Fill, x: number, y: number, w: number, h: number): void {
    const ck = this.ck, paint = this.paint;
    paint.setStyle(ck.PaintStyle.Fill);
    paint.setPathEffect(null);
    paint.setShader(null);
    if (fill.type === 'solid') {
      paint.setColor(color(ck, fill.color));
    } else {
      const rad = ((fill.angle - 90) * Math.PI) / 180;
      const cx = x + w / 2, cy = y + h / 2;
      const half = (Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad))) / 2;
      const dx = Math.cos(rad) * half, dy = Math.sin(rad) * half;
      const shader = ck.Shader.MakeLinearGradient(
        [cx - dx, cy - dy], [cx + dx, cy + dy],
        fill.stops.map((s) => color(ck, s.color)), fill.stops.map((s) => s.offset), ck.TileMode.Clamp,
      );
      paint.setColor(ck.WHITE);
      paint.setShader(shader);
      shader.delete();
    }
  }

  private fillRect(canvas: Canvas, fill: Fill, x: number, y: number, w: number, h: number): void {
    this.setFill(fill, x, y, w, h);
    canvas.drawRect(this.ck.XYWHRect(x, y, w, h), this.paint);
    this.paint.setShader(null);
  }

  private drawShape(canvas: Canvas, el: ShapeElement): void {
    const ck = this.ck, paint = this.paint;
    const path = shapePath(ck, el.shape, el.x, el.y, el.w, el.h, el.radius);
    if (el.fill) {
      this.setFill(el.fill, el.x, el.y, el.w, el.h);
      canvas.drawPath(path, paint);
      paint.setShader(null);
    }
    if (el.stroke && el.stroke.width > 0) {
      paint.setStyle(ck.PaintStyle.Stroke);
      paint.setStrokeWidth(el.stroke.width);
      paint.setColor(color(ck, el.stroke.color));
      const w = el.stroke.width;
      const dash = el.stroke.dash === 'dashed' ? ck.PathEffect.MakeDash([w * 3, w * 2]) : el.stroke.dash === 'dotted' ? ck.PathEffect.MakeDash([w, w]) : null;
      paint.setPathEffect(dash);
      canvas.drawPath(path, paint);
      paint.setPathEffect(null);
      dash?.delete();
    }
    path.delete();
  }

  private drawImage(canvas: Canvas, el: ImageElement): void {
    const ck = this.ck;
    const img = this.images.get(el.asset);
    const dst = ck.XYWHRect(el.x, el.y, el.w, el.h);
    if (el.radius > 0) canvas.clipRRect(ck.RRectXY(dst, el.radius, el.radius), ck.ClipOp.Intersect, true);
    if (!img) {
      // Not loaded yet (or missing): a neutral placeholder.
      this.paint.setStyle(ck.PaintStyle.Fill);
      this.paint.setColor(ck.Color4f(0.85, 0.86, 0.88, 1));
      canvas.drawRect(dst, this.paint);
      return;
    }
    const iw = img.width(), ih = img.height();
    let src;
    if (el.crop) src = ck.XYWHRect(el.crop.x * iw, el.crop.y * ih, el.crop.w * iw, el.crop.h * ih);
    else {
      // cover-fit, centred
      const scale = Math.max(el.w / iw, el.h / ih);
      const sw = el.w / scale, sh = el.h / scale;
      src = ck.XYWHRect((iw - sw) / 2, (ih - sh) / 2, sw, sh);
    }
    this.paint.setColor(ck.BLACK);
    canvas.drawImageRectOptions(img, src, dst, ck.FilterMode.Linear, ck.MipmapMode.Linear, this.paint);
  }

  // ---- export ----

  /** Render a page off-screen and encode it. */
  exportPage(doc: Doc, page: Page, opts: ExportOptions = {}): Uint8Array {
    const ck = this.ck;
    const scale = opts.scale ?? 1;
    const w = Math.max(1, Math.round(doc.width * scale)), h = Math.max(1, Math.round(doc.height * scale));
    const surface = ck.MakeSurface(w, h);
    if (!surface) throw new Error(`could not make a ${w}×${h} surface`);
    try {
      const canvas = surface.getCanvas();
      const format = opts.format ?? 'png';
      const transparent = opts.transparent && format !== 'jpeg';
      canvas.clear(transparent ? ck.TRANSPARENT : ck.WHITE);
      canvas.scale(scale, scale);
      this.drawPage(canvas, doc, page, {}, !transparent);
      surface.flush();
      const img = surface.makeImageSnapshot();
      const fmt = format === 'jpeg' ? ck.ImageFormat.JPEG : format === 'webp' ? ck.ImageFormat.WEBP : ck.ImageFormat.PNG;
      const bytes = img.encodeToBytes(fmt, opts.quality ?? 92);
      img.delete();
      if (!bytes) throw new Error('encode failed');
      return bytes;
    } finally {
      surface.delete();
    }
  }

  /** Forget cached layouts for elements that no longer exist. */
  gc(liveIds: ReadonlySet<string>): void {
    for (const [id, c] of this.paragraphs) if (!liveIds.has(id)) { c.p.delete(); this.paragraphs.delete(id); }
  }

  dispose(): void {
    for (const c of this.paragraphs.values()) c.p.delete();
    for (const img of this.images.values()) img.delete();
    this.paragraphs.clear();
    this.images.clear();
    this.paint.delete();
  }
}

/** Outline of a shape kind inside the box (x, y, w, h). The caller deletes it. */
export function shapePath(ck: CanvasKit, kind: ShapeKind, x: number, y: number, w: number, h: number, radius = 0): Path {
  const b = new ck.PathBuilder();
  const poly = (pts: [number, number][]) => b.addPolygon(pts.flatMap(([px, py]) => [x + px * w, y + py * h]), true);
  const regular = (n: number, inner = 0) => {
    const pts: [number, number][] = [];
    const steps = inner ? n * 2 : n;
    for (let i = 0; i < steps; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / steps;
      const r = inner && i % 2 ? inner : 0.5;
      pts.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]);
    }
    poly(pts);
  };
  switch (kind) {
    case 'rect': {
      const r = Math.max(0, Math.min(radius, w / 2, h / 2));
      b.addRRect(ck.RRectXY(ck.XYWHRect(x, y, w, h), r, r));
      break;
    }
    case 'ellipse':
      b.addOval(ck.XYWHRect(x, y, w, h));
      break;
    case 'triangle':
      poly([[0.5, 0], [1, 1], [0, 1]]);
      break;
    case 'diamond':
      poly([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]);
      break;
    case 'pentagon':
      regular(5);
      break;
    case 'hexagon':
      poly([[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]]);
      break;
    case 'star':
      regular(5, 0.2);
      break;
    case 'arrow':
      poly([[0, 0.3], [0.6, 0.3], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.7], [0, 0.7]]);
      break;
  }
  const path = b.detach();
  b.delete();
  return path;
}
