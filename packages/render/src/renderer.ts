import type { Canvas, CanvasKit, Image, ImageFilter, Paint, Path, RuntimeEffect, Shader } from 'canvaskit-wasm';
import { addAdjust, childrenOf, colorEditUniforms, cropOf, duotoneOf, posterOf, effectiveAdjust, hasLook, imageBox, shadowOf, straightenMatrix, stylizeOf, type BlendMode, type ImageAdjust, type ImageShadow, type Doc, type Element, type Fill, type ImageElement, type Page, type PathElement, type ShapeElement, type ShapeKind, type TextElement, type VideoElement } from '@digital-canvas/scene';
import { aabb, dashArray, decompose, type Decomposed, type Prim, type PrimText } from '@digital-canvas/scene';
import { colorMatrix, LOOK_SKSL, lookFloats, needsLookShader, STYLE_ID, type LookUniforms } from './look.ts';
import { color, FontLibrary } from './fonts.ts';
import { listIndent, TextLayouts, type TextPiece } from './text.ts';

export { color, FontLibrary };

export interface DrawOptions {
  /** Element ids to leave out (e.g. the text box being edited). */
  skip?: ReadonlySet<string>;
  /** Also draw this far (px) outside the page: the print bleed area. */
  bleed?: number;
}

export interface ExportOptions {
  /** Multiplier on the page's px size (2 = double resolution). */
  scale?: number;
  format?: 'png' | 'jpeg' | 'webp';
  /** 0..100 for jpeg/webp. */
  quality?: number;
  /** Leave the page background out (PNG/WebP only). */
  transparent?: boolean;
  /** Also render this far (px) outside the page on every side: the print bleed. */
  bleed?: number;
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
    const b = opts.bleed ?? 0;
    canvas.save();
    canvas.clipRect(ck.XYWHRect(-b, -b, doc.width + 2 * b, doc.height + 2 * b), ck.ClipOp.Intersect, true);
    if (background) this.fillRect(canvas, page.background, -b, -b, doc.width + 2 * b, doc.height + 2 * b);
    for (const el of page.elements) {
      if (el.hidden || opts.skip?.has(el.id)) continue;
      this.drawElement(canvas, el, opts.skip);
    }
    canvas.restore();
  }

  drawElement(canvas: Canvas, el: Element, skip?: ReadonlySet<string>): void {
    const ck = this.ck;
    const kids = childrenOf(el);
    if (kids) {
      // a group: children are in page coordinates; only its opacity applies
      if (el.opacity <= 0) return;
      const layered = el.opacity < 1 || !!el.blend;
      if (layered) {
        const p = new ck.Paint();
        p.setAlphaf(el.opacity);
        if (el.blend) p.setBlendMode(this.blendMode(el.blend));
        canvas.saveLayer(p);
        p.delete();
      }
      for (const k of kids) if (!k.hidden && !skip?.has(k.id)) this.drawElement(canvas, k, skip);
      if (layered) canvas.restore();
      return;
    }
    canvas.save();
    this.transform(canvas, el);
    const layered = el.opacity < 1 || !!el.blend;
    if (layered) {
      const p = new ck.Paint();
      p.setAlphaf(Math.max(0, el.opacity));
      if (el.blend) p.setBlendMode(this.blendMode(el.blend));
      canvas.saveLayer(p);
      p.delete();
    }
    if (el.type === 'shape') this.drawShape(canvas, el);
    else if (el.type === 'path') this.drawPath(canvas, el);
    else if (el.type === 'text') this.drawText(canvas, el);
    else if (el.type === 'line' || el.type === 'table' || el.type === 'chart') this.drawPieces(canvas, this.vectorize(el));
    else if (el.type === 'image' || el.type === 'video') this.drawImage(canvas, el);
    if (layered) canvas.restore();
    canvas.restore();
  }

  private blendMode(m: BlendMode) {
    const b = this.ck.BlendMode;
    return { multiply: b.Multiply, screen: b.Screen, overlay: b.Overlay, darken: b.Darken, lighten: b.Lighten, 'color-dodge': b.ColorDodge, 'color-burn': b.ColorBurn, 'hard-light': b.HardLight, 'soft-light': b.SoftLight, difference: b.Difference, exclusion: b.Exclusion, hue: b.Hue, saturation: b.Saturation, color: b.Color, luminosity: b.Luminosity }[m];
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
      path.setFillType(part.evenOdd ? ck.FillType.EvenOdd : ck.FillType.Winding);
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

  /** The picture an image or video element shows right now, if decoded. */
  private pictureOf(el: ImageElement | VideoElement): Image | undefined {
    // a video shows its current frame, else its poster (stored as an image under `<asset>.poster`)
    return el.type === 'video' ? this.frames.get(el.asset) ?? this.images.get(posterOf(el)) : this.images.get(el.asset);
  }

  /** Pixel size of a decoded image asset (or a video's current picture). */
  imageSize(el: ImageElement | VideoElement): { width: number; height: number } | null {
    const img = this.pictureOf(el);
    return img ? { width: img.width(), height: img.height() } : null;
  }

  /**
   * Crop mode: the whole image, faded, where it lies behind the element's frame.
   * Drawn in page coordinates with the element's rotation and flips.
   */
  drawCropGhost(canvas: Canvas, el: ImageElement | VideoElement, alpha = 0.4): void {
    const ck = this.ck, img = this.pictureOf(el);
    if (!img) return;
    const box = imageBox(el, cropOf(el, img.width(), img.height()));
    canvas.save();
    this.transform(canvas, el);
    const p = new ck.Paint();
    p.setAlphaf(alpha);
    const turn = straightenMatrix(el, el);
    if (turn) canvas.concat(turn);
    canvas.drawImageRectOptions(img, ck.XYWHRect(0, 0, img.width(), img.height()), ck.XYWHRect(box.x, box.y, box.w, box.h), ck.FilterMode.Linear, ck.MipmapMode.Linear, p);
    p.delete();
    canvas.restore();
  }

  private lookEffect: RuntimeEffect | null | undefined;

  /** The SkSL effect for sharpen, highlights/shadows and pixelate (null if this CanvasKit can't compile it). */
  private look(): RuntimeEffect | null {
    if (this.lookEffect === undefined) {
      this.lookEffect = this.ck.RuntimeEffect?.Make(LOOK_SKSL, (err) => console.warn('image look shader:', err)) ?? null;
    }
    return this.lookEffect;
  }

  /** Clip to what an image shows through: its frame (mask), else its rounded corners, else (if `always`) its box. */
  private clipFrame(canvas: Canvas, el: ImageElement | VideoElement, dst: Float32Array, always = false): void {
    const ck = this.ck;
    const mask = el.type === 'image' ? this.maskPath(el) : null;
    if (mask) {
      canvas.clipPath(mask, ck.ClipOp.Intersect, true);
      mask.delete();
    } else if (el.radius > 0) canvas.clipRRect(ck.RRectXY(dst, el.radius, el.radius), ck.ClipOp.Intersect, true);
    else if (always) canvas.clipRect(dst, ck.ClipOp.Intersect, true);
  }

  private drawImage(canvas: Canvas, el: ImageElement | VideoElement): void {
    const ck = this.ck;
    const img = this.pictureOf(el);
    const dst = ck.XYWHRect(el.x, el.y, el.w, el.h);
    if (el.type === 'image' && el.mask && !img) {
      // an empty frame: grey, with a little picture sign in the middle
      this.clipFrame(canvas, el, dst);
      this.paint.setStyle(ck.PaintStyle.Fill);
      this.paint.setColor(ck.Color4f(0.83, 0.85, 0.88, 1));
      canvas.drawRect(dst, this.paint);
      const s = Math.min(el.w, el.h) * 0.16, cx = el.x + el.w / 2, cy = el.y + el.h / 2;
      const b = new ck.PathBuilder();
      b.addPolygon([cx - s, cy + s * 0.6, cx - s * 0.3, cy - s * 0.3, cx + s * 0.15, cy + s * 0.25, cx + s * 0.45, cy - s * 0.05, cx + s, cy + s * 0.6], true);
      b.addCircle(cx + s * 0.45, cy - s * 0.5, s * 0.18);
      const path = b.detachAndDelete();
      this.paint.setColor(ck.Color4f(1, 1, 1, 0.9));
      canvas.drawPath(path, this.paint);
      path.delete();
      return;
    }
    if (!img) {
      this.clipFrame(canvas, el, dst);
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
    const crop = cropOf(el, iw, ih);
    const src = ck.XYWHRect(crop.x * iw, crop.y * ih, crop.w * iw, crop.h * ih);
    if (!hasLook(el)) {
      this.clipFrame(canvas, el, dst);
      this.paint.setColor(ck.BLACK);
      canvas.drawImageRectOptions(img, src, dst, ck.FilterMode.Linear, ck.MipmapMode.Linear, this.paint);
      return;
    }

    // ---- with adjustments, a filter or an effect ----
    const adj = effectiveAdjust(el);
    const short = Math.min(el.w, el.h);
    const shadow = shadowOf(el);
    this.drawBehind(canvas, el, img, src, dst, shadow, short);
    const outer = this.outerEffect(shadow, short);
    if (outer) {
      const p = new ck.Paint();
      p.setImageFilter(outer);
      canvas.saveLayer(p);
      p.delete();
      outer.delete();
    }
    canvas.save();
    this.clipFrame(canvas, el, dst, true); // inside the layer, so shadow/glow/outline follow a frame's shape

    const sx = el.w / (crop.w * iw), sy = el.h / (crop.h * ih);
    const local = this.pictureMatrix(el, crop, iw, ih);
    const matte = el.matte ? this.images.get(el.matte) : undefined;
    const fg = el.selective?.foreground, bg = el.selective?.background;
    const selective = !!matte && (!!fg || !!bg || !!el.autoFocus);
    const backAdj = selective ? addAdjust(adj, { ...bg, blur: (bg?.blur ?? 0) + (el.autoFocus ?? 0) }) : adj;
    this.drawPass(canvas, el, img, dst, local, sx, sy, short, backAdj);
    if (selective) this.drawMasked(canvas, el, matte!, dst, () => this.drawPass(canvas, el, img, dst, local, sx, sy, short, addAdjust(adj, fg)));
    const brush = el.blurBrush ? this.images.get(el.blurBrush.asset) : undefined;
    if (brush) this.drawMasked(canvas, el, brush, dst, () => this.drawPass(canvas, el, img, dst, local, sx, sy, short, addAdjust(adj, { blur: el.blurBrush!.intensity })));

    if (adj.vignette) {
      // darker (or, below 0, lighter) towards the edges, inside the frame
      const v = adj.vignette / 100;
      const edge = v > 0 ? ck.Color4f(0, 0, 0, 0.85 * v) : ck.Color4f(1, 1, 1, -0.85 * v);
      const clear = v > 0 ? ck.Color4f(0, 0, 0, 0) : ck.Color4f(1, 1, 1, 0);
      const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
      // a unit circle stretched so it passes through the frame's corners
      const rx = el.w / Math.SQRT2, ry = el.h / Math.SQRT2;
      const g = ck.Shader.MakeRadialGradient([0, 0], 1, [clear, clear, edge], [0, 0.45, 1], ck.TileMode.Clamp, [rx, 0, cx, 0, ry, cy, 0, 0, 1]);
      const vp = new ck.Paint();
      vp.setShader(g);
      vp.setBlendMode(ck.BlendMode.SrcATop); // a cut-out keeps its transparent parts
      canvas.drawRect(dst, vp);
      vp.delete();
      g.delete();
    }
    canvas.restore();
    if (el.border && el.border.width > 0) this.drawBorder(canvas, el);
    if (outer) canvas.restore();
  }

  /** Image pixels → page coordinates, with the straighten and tilt on top. */
  private pictureMatrix(el: ImageElement | VideoElement, crop: { x: number; y: number; w: number; h: number }, iw: number, ih: number): number[] {
    const sx = el.w / (crop.w * iw), sy = el.h / (crop.h * ih);
    const m = [sx, 0, el.x - crop.x * iw * sx, 0, sy, el.y - crop.y * ih * sy, 0, 0, 1];
    const t = straightenMatrix(el, el);
    if (!t) return m;
    const out: number[] = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push(t[r * 3]! * m[c]! + t[r * 3 + 1]! * m[c + 3]! + t[r * 3 + 2]! * m[c + 6]!);
    return out;
  }

  /** One full draw of the picture with these adjustments. */
  private drawPass(canvas: Canvas, el: ImageElement | VideoElement, img: Image, dst: Float32Array, local: number[], sx: number, sy: number, short: number, adj: ImageAdjust): void {
    const ck = this.ck;
    const base = img.makeShaderOptions(ck.TileMode.Clamp, ck.TileMode.Clamp, ck.FilterMode.Linear, ck.MipmapMode.Linear, local);
    let shader: Shader = base;
    const st = stylizeOf(el);
    const amount = (st?.amount ?? 0) / 100;
    const u: LookUniforms = {
      px: [Math.max(sx, 1), Math.max(sy, 1)],
      sharpen: ((adj.sharpen ?? 0) / 100) * 0.6, hi: (adj.highlights ?? 0) / 100, sh: (adj.shadows ?? 0) / 100,
      cell: st?.type === 'pixelate' ? Math.max(2, amount * short * 0.08) : 0,
      origin: [el.x, el.y],
      whites: (adj.whites ?? 0) / 100, blacks: (adj.blacks ?? 0) / 100, vibrance: (adj.vibrance ?? 0) / 100, texture: (adj.texture ?? 0) / 100,
      clarity: (adj.clarity ?? 0) / 100, grain: (adj.grain ?? 0) / 100, retouch: (el.retouch ?? 0) / 100,
      size: short, style: st ? STYLE_ID[st.type] : 0, amount, bands: colorEditUniforms(el.colorEdit),
    };
    const effect = needsLookShader(u) ? this.look() : null;
    if (effect) {
      shader = effect.makeShaderWithChildren(lookFloats(u), [base]);
      base.delete();
    }
    const p = new ck.Paint();
    p.setAntiAlias(true);
    p.setShader(shader);
    const m = colorMatrix(adj, duotoneOf(el), !!el.invert);
    if (m) {
      const cf = ck.ColorFilter.MakeMatrix(m);
      p.setColorFilter(cf);
      cf.delete();
    }
    if (adj.blur) {
      const sigma = (adj.blur / 100) * Math.max(2, short * 0.04);
      const blur = ck.ImageFilter.MakeBlur(sigma, sigma, ck.TileMode.Clamp, null);
      p.setImageFilter(blur);
      blur.delete();
    }
    canvas.drawRect(dst, p);
    p.delete();
    shader.delete();
  }

  /** Draw something only where a mask (an image asset of the same picture, any size) has alpha. */
  private drawMasked(canvas: Canvas, el: ImageElement | VideoElement, mask: Image, dst: Float32Array, draw: () => void): void {
    const ck = this.ck;
    const layer = new ck.Paint();
    canvas.saveLayer(layer);
    layer.delete();
    draw();
    const crop = cropOf(el, mask.width(), mask.height());
    const shader = mask.makeShaderOptions(ck.TileMode.Clamp, ck.TileMode.Clamp, ck.FilterMode.Linear, ck.MipmapMode.None, this.pictureMatrix(el, crop, mask.width(), mask.height()));
    const p = new ck.Paint();
    p.setShader(shader);
    p.setBlendMode(ck.BlendMode.DstIn);
    canvas.drawRect(dst, p);
    p.delete();
    shader.delete();
    canvas.restore();
  }

  private drawBorder(canvas: Canvas, el: ImageElement | VideoElement): void {
    const ck = this.ck, b = el.border!;
    const path = (el.type === 'image' ? this.maskPath(el) : null) ?? shapePath(ck, 'rect', el.x, el.y, el.w, el.h, el.radius);
    const p = new ck.Paint();
    p.setAntiAlias(true);
    p.setStyle(ck.PaintStyle.Stroke);
    p.setStrokeWidth(b.width);
    p.setColor(color(ck, b.color));
    const w = b.width;
    const dash = b.dash === 'dashed' ? ck.PathEffect.MakeDash([w * 3, w * 2]) : b.dash === 'dotted' ? ck.PathEffect.MakeDash([w, w]) : null;
    p.setPathEffect(dash);
    canvas.drawPath(path, p);
    dash?.delete();
    p.delete();
    path.delete();
  }

  /** Shadows that are a shape of their own under the picture (angle, curved, page lift, backdrop). */
  private drawBehind(canvas: Canvas, el: ImageElement | VideoElement, img: Image, src: Float32Array, dst: Float32Array, s: ImageShadow | undefined, short: number): void {
    if (!s || s.style === 'drop' || s.style === 'glow' || s.style === 'outline') return;
    const ck = this.ck;
    const alpha = 1 - s.transparency / 100;
    const sigma = (s.blur / 100) * short * 0.06;
    const p = new ck.Paint();
    p.setAntiAlias(true);
    if (sigma > 0.01) {
      const f = ck.ImageFilter.MakeBlur(sigma, sigma, ck.TileMode.Decal, null);
      p.setImageFilter(f);
      f.delete();
    }
    const l = el.x, r = el.x + el.w, b = el.y + el.h;
    if (s.style === 'curved' || s.style === 'lift') {
      p.setColor(color(ck, s.color, alpha));
      const k = (s.size / 100) * el.h * 0.08;
      const bl = new ck.PathBuilder();
      if (s.style === 'curved') {
        // a bow under the bottom edge, deepest in the middle
        bl.moveTo(l + el.w * 0.02, b - k * 0.5);
        bl.quadTo((l + r) / 2, b + k * 1.6, r - el.w * 0.02, b - k * 0.5);
        bl.lineTo(r - el.w * 0.02, b - el.h * 0.1);
        bl.lineTo(l + el.w * 0.02, b - el.h * 0.1);
        bl.close();
      } else {
        // the two bottom corners lift off the page
        const w = el.w * 0.42;
        bl.addPolygon([l + el.w * 0.03, b - el.h * 0.12, l + w, b - el.h * 0.06, l + w, b - k * 0.1, l + el.w * 0.02, b + k], true);
        bl.addPolygon([r - el.w * 0.03, b - el.h * 0.12, r - w, b - el.h * 0.06, r - w, b - k * 0.1, r - el.w * 0.02, b + k], true);
      }
      const path = bl.detachAndDelete();
      canvas.drawPath(path, p);
      path.delete();
    } else {
      // the picture's own silhouette: laid on the floor (angle) or offset behind it (backdrop)
      const cf = ck.ColorFilter.MakeBlend(color(ck, s.color, alpha), ck.BlendMode.SrcIn);
      p.setColorFilter(cf);
      cf.delete();
      canvas.save();
      const a = (s.angle * Math.PI) / 180;
      if (s.style === 'backdrop') {
        const d = (s.distance / 100) * short * 0.15;
        canvas.translate(Math.cos(a) * d, Math.sin(a) * d);
      } else {
        const len = 0.15 + (s.size / 100) * 0.85, skew = -Math.cos(a) / Math.max(0.2, Math.sin(a));
        canvas.concat([1, skew * len, -skew * len * b, 0, len, b * (1 - len), 0, 0, 1]);
      }
      this.clipFrame(canvas, el, dst);
      canvas.drawImageRectOptions(img, src, dst, ck.FilterMode.Linear, ck.MipmapMode.Linear, p);
      canvas.restore();
    }
    p.delete();
  }

  /** Drop shadow, glow and outline draw around the picture: an image filter for a layer holding it. */
  private outerEffect(s: ImageShadow | undefined, short: number): ImageFilter | null {
    const ck = this.ck;
    if (!s) return null;
    const tinted = (hex: string, alpha: number, input: ImageFilter) => {
      const cf = ck.ColorFilter.MakeBlend(color(ck, hex, alpha), ck.BlendMode.SrcIn);
      const f = ck.ImageFilter.MakeColorFilter(cf, input);
      cf.delete();
      return f;
    };
    const under = (bg: ImageFilter) => {
      const f = ck.ImageFilter.MakeBlend(ck.BlendMode.SrcOver, bg, null);
      bg.delete();
      return f;
    };
    switch (s.style) {
      case 'drop': {
        const dist = (s.distance / 100) * short * 0.15;
        const rad = (s.angle * Math.PI) / 180;
        const sigma = (s.blur / 100) * short * 0.08;
        return ck.ImageFilter.MakeDropShadow(Math.cos(rad) * dist, Math.sin(rad) * dist, sigma, sigma, color(ck, s.color, 1 - s.transparency / 100), null);
      }
      case 'glow': {
        const size = (s.size / 100) * short * 0.06;
        const dil = ck.ImageFilter.MakeDilate(size / 2, size / 2, null);
        const sig = size * (s.blur / 50) + 0.5;
        const blur = ck.ImageFilter.MakeBlur(sig, sig, ck.TileMode.Decal, dil);
        dil.delete();
        const t = tinted(s.color, 1 - s.transparency / 100, blur);
        blur.delete();
        return under(t);
      }
      case 'outline': {
        const r = (s.size / 100) * short * 0.05 + 0.5;
        const dil = ck.ImageFilter.MakeDilate(r, r, null);
        const t = tinted(s.color, 1, dil);
        dil.delete();
        return under(t);
      }
      default:
        return null;
    }
  }

  /** Rotation and flips of an element around its centre. */
  private transform(canvas: Canvas, el: Element): void {
    const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
    if (el.rotation) canvas.rotate(el.rotation, cx, cy);
    if (el.flipX || el.flipY) {
      canvas.translate(cx, cy);
      canvas.scale(el.flipX ? -1 : 1, el.flipY ? -1 : 1);
      canvas.translate(-cx, -cy);
    }
  }

  /** A frame's outline in page coordinates (null when the image has no mask). The caller deletes it. */
  maskPath(el: ImageElement): Path | null {
    const ck = this.ck, m = el.mask;
    if (!m) return null;
    if (typeof m === 'string') return shapePath(ck, m, el.x, el.y, el.w, el.h, el.radius);
    const path = ck.Path.MakeFromSVGString(m.d);
    if (!path || m.viewBox.w <= 0 || m.viewBox.h <= 0) {
      path?.delete();
      return shapePath(ck, 'rect', el.x, el.y, el.w, el.h);
    }
    const sx = el.w / m.viewBox.w, sy = el.h / m.viewBox.h;
    return transformPath(ck, path, [sx, 0, el.x - m.viewBox.x * sx, 0, sy, el.y - m.viewBox.y * sy, 0, 0, 1]);
  }

  // ---- lines, tables, charts: drawn from vector pieces ----

  /** The pieces of a line, table or chart, with text boxes moved to their vertical alignment. */
  vectorize(el: Parameters<typeof decompose>[0]): Decomposed {
    const d = decompose(el);
    return { paths: d.paths, texts: d.texts.map((t) => ({ ...t, el: this.placeText(t) })) };
  }

  private placeText(t: PrimText): TextElement {
    if (t.valign === 'top') return t.el;
    const h = this.textHeight(t.el);
    return { ...t.el, y: t.el.y + (t.valign === 'middle' ? (t.el.h - h) / 2 : t.el.h - h), h };
  }

  private drawPieces(canvas: Canvas, d: Decomposed): void {
    for (const p of d.paths) this.drawPrim(canvas, p);
    for (const t of d.texts) this.drawText(canvas, t.el);
  }

  private drawPrim(canvas: Canvas, prim: Prim): void {
    const ck = this.ck, paint = this.paint;
    const path = ck.Path.MakeFromSVGString(prim.d);
    if (!path) return;
    if (prim.fill) {
      const b = path.computeTightBounds();
      this.setFill(prim.fill, b[0]!, b[1]!, b[2]! - b[0]!, b[3]! - b[1]!);
      canvas.drawPath(path, paint);
      paint.setShader(null);
    }
    if (prim.stroke && prim.stroke.width > 0) {
      const cap = prim.cap ?? 'butt';
      paint.setStyle(ck.PaintStyle.Stroke);
      paint.setStrokeWidth(prim.stroke.width);
      paint.setStrokeCap(cap === 'round' ? ck.StrokeCap.Round : cap === 'square' ? ck.StrokeCap.Square : ck.StrokeCap.Butt);
      paint.setStrokeJoin(ck.StrokeJoin.Round);
      paint.setColor(color(ck, prim.stroke.color));
      const dash = dashArray(prim.stroke, cap);
      const effect = dash ? ck.PathEffect.MakeDash(dash) : null;
      paint.setPathEffect(effect);
      canvas.drawPath(path, paint);
      paint.setPathEffect(null);
      effect?.delete();
    }
    path.delete();
  }

  /**
   * One element alone as a PNG, for exports that can't express it as vectors
   * (text effects, curved text). Returns the image and where it goes on the page.
   */
  rasterElement(el: Element, scale = 3): { png: Uint8Array; x: number; y: number; w: number; h: number } | null {
    const ck = this.ck;
    const b = aabb(el);
    const pad = el.type === 'text' ? el.style.fontSize * 0.8
      : (el.type === 'image' || el.type === 'video') && (el.effect || el.shadow || el.border) ? 4 + Math.min(el.w, el.h) * 0.5 // shadow, glow, outline reach outside the box
      : 4 + ('stroke' in el && el.stroke ? el.stroke.width * 4 : 0);
    const x = Math.floor(b.x - pad), y = Math.floor(b.y - pad), w = Math.ceil(b.w + 2 * pad), h = Math.ceil(b.h + 2 * pad);
    const surface = ck.MakeSurface(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
    if (!surface) return null;
    try {
      const canvas = surface.getCanvas();
      canvas.clear(ck.TRANSPARENT);
      canvas.scale(scale, scale);
      canvas.translate(-x, -y);
      this.drawElement(canvas, el);
      surface.flush();
      const img = surface.makeImageSnapshot();
      const png = img.encodeToBytes(ck.ImageFormat.PNG, 100);
      img.delete();
      return png ? { png, x, y, w, h } : null;
    } finally {
      surface.delete();
    }
  }

  /** The page background alone as a PNG (for gradients in vector PDF). */
  rasterBackground(doc: Doc, page: Page, scale = 1): Uint8Array {
    return this.exportPage(doc, { ...page, elements: [] }, { scale, format: 'png' });
  }

  /** Each character's box, in box coordinates (null for line breaks / curved text). */
  textCharRects(el: TextElement): ({ x: number; y: number; w: number; h: number } | null)[] {
    return this.text.charRects(el);
  }

  /** Text as positioned words, for vector export (see `textPieces`). */
  textPieces(el: TextElement): TextPiece[] {
    return this.text.pieces(el);
  }

  // ---- export ----

  /** Render a page off-screen and encode it. */
  exportPage(doc: Doc, page: Page, opts: ExportOptions = {}): Uint8Array {
    const ck = this.ck;
    const scale = opts.scale ?? 1;
    const b = Math.max(0, opts.bleed ?? 0);
    const w = Math.max(1, Math.round((doc.width + 2 * b) * scale)), h = Math.max(1, Math.round((doc.height + 2 * b) * scale));
    const surface = ck.MakeSurface(w, h);
    if (!surface) throw new Error(`could not make a ${w}×${h} surface`);
    try {
      const canvas = surface.getCanvas();
      const format = opts.format ?? 'png';
      const transparent = opts.transparent && format !== 'jpeg';
      canvas.clear(transparent ? ck.TRANSPARENT : ck.WHITE);
      canvas.scale(scale, scale);
      if (b) canvas.translate(b, b);
      this.drawPage(canvas, doc, page, b ? { bleed: b } : {}, !transparent);
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

  /** Render a page off-screen at exactly `width × height` px and read it back as straight-alpha RGBA (mockups). */
  renderPageRgba(doc: Doc, page: Page, width: number, height: number): { width: number; height: number; data: Uint8Array } {
    const ck = this.ck;
    const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
    const surface = ck.MakeSurface(w, h);
    if (!surface) throw new Error(`could not make a ${w}×${h} surface`);
    try {
      const canvas = surface.getCanvas();
      canvas.clear(ck.TRANSPARENT);
      canvas.scale(w / doc.width, h / doc.height);
      this.drawPage(canvas, doc, page);
      surface.flush();
      const img = surface.makeImageSnapshot();
      const data = img.readPixels(0, 0, { width: w, height: h, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array | null;
      img.delete();
      if (!data) throw new Error('could not read the page pixels');
      return { width: w, height: h, data };
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
    this.lookEffect?.delete();
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

/** A copy of `path` transformed by a 3×3 matrix (row-major). Deletes `path`. */
export function transformPath(ck: CanvasKit, path: Path, m: number[]): Path {
  const b = new ck.PathBuilder(path);
  b.transform(m);
  path.delete();
  return b.detachAndDelete();
}
