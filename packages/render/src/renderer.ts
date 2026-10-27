import type { Canvas, CanvasKit, Image, Paint, Path } from 'canvaskit-wasm';
import type { Doc, Element, Fill, ImageElement, Page, PathElement, ShapeElement, ShapeKind, TextElement, VideoElement } from '@digital-canvas/scene';
import { color, FontLibrary } from './fonts.ts';
import { listIndent, TextLayouts } from './text.ts';

export { color, FontLibrary };

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
  private text: TextLayouts;
  private paint: Paint;

  constructor(readonly ck: CanvasKit, readonly fonts: FontLibrary) {
    this.text = new TextLayouts(ck, fonts);
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

  /** Free a decoded image (e.g. when only one page is needed at a time). */
  forgetImage(assetId: string): void {
    this.images.get(assetId)?.delete();
    this.images.delete(assetId);
  }

  hasImage(assetId: string): boolean {
    return this.images.has(assetId);
  }

  private frames = new Map<string, Image>();

  /**
   * The frame a video asset shows right now (the caller decodes video; the renderer only draws).
   * Takes ownership of `frame`; null clears it so the poster (or a placeholder) shows.
   */
  setVideoFrame(assetId: string, frame: Image | null): void {
    this.frames.get(assetId)?.delete();
    if (frame) this.frames.set(assetId, frame);
    else this.frames.delete(assetId);
  }

  // ---- text ----

  /** Height a text box needs for its content at its current width. */
  textHeight(el: TextElement): number {
    return Math.ceil(this.text.layout(el).height);
  }

  /** Width the content needs: the longest line, or the curve's span for curved text. */
  textWidth(el: TextElement): number {
    if (el.curve) return Math.ceil(this.text.layout(el).width);
    return Math.ceil(this.text.layout({ ...el, w: 100000, list: undefined }).blocks[0]!.p.getMaxIntrinsicWidth() + (el.list ? listIndent(el) : 0));
  }

  /** Box size for text: straight text keeps its width; curved text takes the arc's bounds. */
  fitText(el: TextElement): { w: number; h: number } {
    if (el.curve) {
      const L = this.text.layout(el);
      return { w: Math.ceil(L.width), h: Math.ceil(L.height) };
    }
    return { w: el.w, h: this.textHeight(el) };
  }

  private drawText(canvas: Canvas, el: TextElement): void {
    const ck = this.ck, T = this.text;
    const fs = el.style.fontSize;
    const fx = el.effect;
    canvas.save();
    canvas.translate(el.x, el.y);
    const dir = (deg: number, dist: number) => [Math.cos((deg * Math.PI) / 180) * dist, Math.sin((deg * Math.PI) / 180) * dist] as const;
    const layer = (filter: ReturnType<typeof ck.ImageFilter.MakeBlur>, draw: () => void) => {
      const p = new ck.Paint();
      p.setImageFilter(filter);
      canvas.saveLayer(p);
      draw();
      canvas.restore();
      p.delete();
      filter.delete();
    };
    const fill = () => T.draw(canvas, el, { kind: 'fill' });
    switch (fx?.type) {
      case undefined:
        fill();
        break;
      case 'shadow': {
        const [dx, dy] = dir(fx.direction, (fx.offset / 100) * fs * 0.25);
        const sigma = (fx.blur / 100) * fs * 0.15;
        const shadow = () => T.draw(canvas, el, { kind: 'solid', color: fx.color, alpha: 1 - fx.transparency / 100 }, dx, dy);
        if (sigma > 0.01) layer(ck.ImageFilter.MakeBlur(sigma, sigma, ck.TileMode.Decal, null), shadow);
        else shadow();
        fill();
        break;
      }
      case 'lift': {
        const k = fx.intensity / 100;
        layer(ck.ImageFilter.MakeBlur(fs * (0.03 + 0.1 * k), fs * (0.03 + 0.1 * k), ck.TileMode.Decal, null),
          () => T.draw(canvas, el, { kind: 'solid', color: '#000000', alpha: 0.12 + 0.38 * k }, 0, fs * 0.04));
        fill();
        break;
      }
      case 'hollow':
        T.draw(canvas, el, { kind: 'stroke', width: Math.max(0.5, (fx.thickness / 100) * fs * 0.06) });
        break;
      case 'splice': {
        const [dx, dy] = dir(fx.direction, (fx.offset / 100) * fs * 0.15);
        T.draw(canvas, el, { kind: 'solid', color: fx.color, alpha: 1 }, dx, dy);
        T.draw(canvas, el, { kind: 'stroke', width: Math.max(0.5, (fx.thickness / 100) * fs * 0.06) });
        break;
      }
      case 'outline':
        // stroke is centred on the outline; the fill on top hides the inner half
        T.draw(canvas, el, { kind: 'stroke', width: Math.max(1, (fx.thickness / 100) * fs * 0.16), color: fx.color });
        fill();
        break;
      case 'echo': {
        const [dx, dy] = dir(fx.direction, (fx.offset / 100) * fs * 0.1);
        T.draw(canvas, el, { kind: 'solid', color: fx.color, alpha: 0.25 }, dx * 2, dy * 2);
        T.draw(canvas, el, { kind: 'solid', color: fx.color, alpha: 0.5 }, dx, dy);
        fill();
        break;
      }
      case 'glitch': {
        const [dx, dy] = dir(fx.direction, (fx.offset / 100) * fs * 0.1);
        const [a, b] = fx.colors === 'blue-red' ? ['#00ffff', '#ff0033'] : ['#00ffff', '#ffd600'];
        T.draw(canvas, el, { kind: 'solid', color: a, alpha: 1 }, -dx, -dy);
        T.draw(canvas, el, { kind: 'solid', color: b, alpha: 1 }, dx, dy);
        fill();
        break;
      }
      case 'neon': {
        const k = fx.intensity / 100;
        const sigma = fs * (0.04 + 0.12 * k);
        layer(ck.ImageFilter.MakeBlur(sigma, sigma, ck.TileMode.Decal, null), fill);
        layer(ck.ImageFilter.MakeBlur(sigma / 3, sigma / 3, ck.TileMode.Decal, null), fill);
        T.draw(canvas, el, { kind: 'fill', lighten: 0.35 + 0.4 * k });
        break;
      }
      case 'background': {
        const spread = (fx.spread / 100) * fs * 0.5;
        const p = new ck.Paint();
        p.setAntiAlias(true);
        p.setColor(color(ck, fx.color));
        // opaque boxes in a translucent layer, so overlapping line boxes don't double up
        const alpha = new ck.Paint();
        alpha.setAlphaf(1 - fx.transparency / 100);
        canvas.saveLayer(alpha);
        for (const r of T.lineRects(el)) {
          const rr = Math.min((fx.roundness / 100) * (r.h / 2 + spread), (r.h + spread) / 2);
          canvas.drawRRect(ck.RRectXY(ck.XYWHRect(r.x - spread, r.y - spread / 2, r.w + 2 * spread, r.h + spread), rr, rr), p);
        }
        canvas.restore();
        alpha.delete();
        p.delete();
        fill();
        break;
      }
    }
    canvas.restore();
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
    else if (el.type === 'path') this.drawPath(canvas, el);
    else if (el.type === 'text') this.drawText(canvas, el);
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

  private svgPaths = new Map<string, Path | null>();

  private drawPath(canvas: Canvas, el: PathElement): void {
    const ck = this.ck, paint = this.paint, vb = el.viewBox;
    if (vb.w <= 0 || vb.h <= 0) return;
    const sx = el.w / vb.w, sy = el.h / vb.h;
    canvas.save();
    canvas.translate(el.x, el.y);
    canvas.scale(sx, sy);
    canvas.translate(-vb.x, -vb.y);
    for (const part of el.paths) {
      let path = this.svgPaths.get(part.d);
      if (path === undefined) {
        path = ck.Path.MakeFromSVGString(part.d);
        this.svgPaths.set(part.d, path);
      }
      if (!path) continue;
      if (part.fill) {
        // gradients are laid out in viewBox units
        this.setFill(part.fill, vb.x, vb.y, vb.w, vb.h);
        canvas.drawPath(path, paint);
        paint.setShader(null);
      }
      if (part.stroke && part.stroke.width > 0) {
        paint.setStyle(ck.PaintStyle.Stroke);
        // stroke width is in page px: undo the (average) scale
        paint.setStrokeWidth(part.stroke.width / Math.sqrt(Math.abs(sx * sy)));
        paint.setStrokeCap(ck.StrokeCap.Round);
        paint.setStrokeJoin(ck.StrokeJoin.Round);
        paint.setColor(color(ck, part.stroke.color));
        canvas.drawPath(path, paint);
      }
    }
    canvas.restore();
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

  private drawImage(canvas: Canvas, el: ImageElement | VideoElement): void {
    const ck = this.ck;
    // a video shows its current frame, else its poster (stored as an image under `<asset>.poster`)
    const img = el.type === 'video' ? this.frames.get(el.asset) ?? this.images.get(`${el.asset}.poster`) : this.images.get(el.asset);
    const dst = ck.XYWHRect(el.x, el.y, el.w, el.h);
    if (el.radius > 0) canvas.clipRRect(ck.RRectXY(dst, el.radius, el.radius), ck.ClipOp.Intersect, true);
    if (!img) {
      // Not loaded yet (or missing): a neutral placeholder.
      this.paint.setStyle(ck.PaintStyle.Fill);
      this.paint.setColor(el.type === 'video' ? ck.Color4f(0.12, 0.13, 0.16, 1) : ck.Color4f(0.85, 0.86, 0.88, 1));
      canvas.drawRect(dst, this.paint);
      if (el.type === 'video') {
        // play triangle
        const r = Math.min(el.w, el.h) * 0.12, cx = el.x + el.w / 2, cy = el.y + el.h / 2;
        const b = new ck.PathBuilder();
        b.addPolygon([cx - r * 0.6, cy - r, cx + r, cy, cx - r * 0.6, cy + r], true);
        const path = b.detach();
        b.delete();
        this.paint.setColor(ck.Color4f(1, 1, 1, 0.85));
        canvas.drawPath(path, this.paint);
        path.delete();
      }
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
    this.text.gc(liveIds);
  }

  dispose(): void {
    this.text.dispose();
    for (const p of this.svgPaths.values()) p?.delete();
    this.svgPaths.clear();
    for (const img of this.images.values()) img.delete();
    for (const img of this.frames.values()) img.delete();
    this.frames.clear();
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
