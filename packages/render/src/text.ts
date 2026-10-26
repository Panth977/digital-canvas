import type { Canvas, CanvasKit, Paint, Paragraph } from 'canvaskit-wasm';
import { listMarker, runsOf, type Color, type TextElement, type TextRun, type TextStyle } from '@digital-canvas/scene';
import { color, type FontLibrary } from './fonts.ts';

/**
 * How the letters are painted in one pass. Effects draw the same layout
 * several times: e.g. Outline = a thick stroke pass, then a fill pass.
 */
export type TextPass =
  | { kind: 'fill'; lighten?: number }
  | { kind: 'solid'; color: Color; alpha: number }
  | { kind: 'stroke'; width: number; color?: Color };

const passKey = (m: TextPass) => JSON.stringify(m);

interface Block {
  p: Paragraph;
  x: number;
  y: number;
  marker?: { p: Paragraph; x: number };
}

interface Glyph {
  p: Paragraph;
  /** Transform to the glyph's baseline centre, in box coordinates. */
  x: number;
  y: number;
  rot: number;
  w: number;
  baseline: number;
}

export interface TextLayout {
  /** Straight text: blocks (one per list item, or one for the whole box). */
  blocks: Block[];
  /** Curved text: one paragraph per character, placed along the arc. */
  glyphs: Glyph[];
  /** Size the content needs. Straight text: the box width × content height. */
  width: number;
  height: number;
  /** Curved text: where the content's top-left sits relative to the drawing origin. */
  minX: number;
  minY: number;
  paragraphs: Paragraph[];
}

/** Characters [start, end) of a list of runs. */
function sliceRuns(runs: TextRun[], start: number, end: number): TextRun[] {
  const out: TextRun[] = [];
  let pos = 0;
  for (const r of runs) {
    const s = pos, e = pos + r.text.length;
    pos = e;
    const a = Math.max(s, start), b = Math.min(e, end);
    if (a < b) out.push({ ...r, text: r.text.slice(a - s, b - s) });
  }
  return out;
}

function lighten(hex: Color, amount: number): Color {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const ch = (i: number) => Math.round(parseInt(h.slice(i, i + 2), 16) + (255 - parseInt(h.slice(i, i + 2), 16)) * amount).toString(16).padStart(2, '0');
  return `#${ch(0)}${ch(2)}${ch(4)}`;
}

/** Bullet / number column width for a list, in px. */
export function listIndent(el: TextElement): number {
  return el.style.fontSize * (el.list === 'number' ? 1.8 : 1.3);
}

export class TextLayouts {
  private cache = new Map<string, { sig: string; layout: TextLayout }>();
  private segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

  constructor(private ck: CanvasKit, private fonts: FontLibrary) {}

  private textStyle(st: TextStyle) {
    const ck = this.ck;
    return new ck.TextStyle({
      color: color(ck, st.color),
      fontFamilies: [...this.fonts.chain(st.fontFamily), 'Noto Sans', 'Inter'], // Noto Sans when embedded: Canva's fallback (e.g. ₹)
      fontSize: st.fontSize,
      fontStyle: { weight: st.bold ? ck.FontWeight.Bold : ck.FontWeight.Normal, slant: st.italic ? ck.FontSlant.Italic : ck.FontSlant.Upright },
      decoration: (st.underline ? ck.UnderlineDecoration : 0) | (st.strike ? ck.LineThroughDecoration : 0),
      decorationThickness: 1,
      heightMultiplier: st.lineHeight,
      // Spread extra line spacing above and below each line, like CSS (and the in-place text editor).
      halfLeading: true,
      letterSpacing: st.letterSpacing,
    });
  }

  /** Build one paragraph from runs in the given pass. */
  private build(el: TextElement, runs: TextRun[], pass: TextPass, align: 'left' | 'center' | 'right' | 'justify', width: number): Paragraph {
    const ck = this.ck;
    const s = el.style;
    const ckAlign = { left: ck.TextAlign.Left, center: ck.TextAlign.Center, right: ck.TextAlign.Right, justify: ck.TextAlign.Justify }[align];
    const style = new ck.ParagraphStyle({ textStyle: this.textStyle(s), textAlign: ckAlign });
    const builder = ck.ParagraphBuilder.MakeFromFontProvider(style, this.fonts.provider);
    const paints: Paint[] = [];
    const bg = new ck.Paint();
    bg.setColor(ck.TRANSPARENT);
    paints.push(bg);
    for (const run of runs.length ? runs : [{ text: '' }]) {
      const st: TextStyle = { ...s, ...run.style };
      const text = st.uppercase ? run.text.toUpperCase() : run.text;
      if (pass.kind === 'fill' && !el.gradient) {
        builder.pushStyle(this.textStyle(pass.lighten ? { ...st, color: lighten(st.color, pass.lighten) } : st));
      } else {
        const fg = new ck.Paint();
        fg.setAntiAlias(true);
        paints.push(fg);
        if (pass.kind === 'stroke') {
          fg.setStyle(ck.PaintStyle.Stroke);
          fg.setStrokeWidth(pass.width);
          fg.setStrokeJoin(ck.StrokeJoin.Round);
          fg.setColor(color(ck, pass.color ?? st.color));
        } else if (pass.kind === 'solid') {
          fg.setColor(color(ck, pass.color, pass.alpha));
        } else {
          // gradient fill, in box coordinates (the box is drawn at its local origin)
          const g = el.gradient!;
          const rad = ((g.angle - 90) * Math.PI) / 180;
          const cx = el.w / 2, cy = el.h / 2;
          const half = (Math.abs(el.w * Math.cos(rad)) + Math.abs(el.h * Math.sin(rad))) / 2;
          const dx = Math.cos(rad) * half, dy = Math.sin(rad) * half;
          const shader = ck.Shader.MakeLinearGradient([cx - dx, cy - dy], [cx + dx, cy + dy],
            g.stops.map((x) => color(ck, pass.lighten ? lighten(x.color, pass.lighten) : x.color)), g.stops.map((x) => x.offset), ck.TileMode.Clamp);
          fg.setColor(ck.WHITE);
          fg.setShader(shader);
          shader.delete();
        }
        builder.pushPaintStyle(this.textStyle(st), fg, bg);
      }
      builder.addText(text);
      builder.pop();
    }
    const p = builder.build();
    builder.delete();
    for (const x of paints) x.delete();
    p.layout(Math.max(1, width));
    return p;
  }

  private make(el: TextElement, pass: TextPass): TextLayout {
    const runs = runsOf(el);
    const paragraphs: Paragraph[] = [];
    const keep = (p: Paragraph) => (paragraphs.push(p), p);
    if (el.curve) return this.makeCurved(el, runs, pass, keep, paragraphs);
    if (!el.list) {
      const p = keep(this.build(el, runs, pass, el.style.align, el.w));
      return { blocks: [{ p, x: 0, y: 0 }], glyphs: [], width: el.w, height: p.getHeight(), minX: 0, minY: 0, paragraphs };
    }
    // List: one paragraph per line, indented, with its marker in the gutter.
    const indent = listIndent(el);
    const blocks: Block[] = [];
    let y = 0, start = 0, n = 0;
    for (const line of el.text.split('\n')) {
      const lineRuns = sliceRuns(runs, start, start + line.length);
      const p = keep(this.build(el, lineRuns, pass, el.style.align === 'justify' ? 'justify' : el.style.align, el.w - indent));
      let marker: Block['marker'];
      if (line.length) {
        const first = { ...el.style, ...lineRuns[0]?.style, underline: false, strike: false };
        const mp = keep(this.build({ ...el, style: first, gradient: el.gradient }, [{ text: listMarker(el.list, n) }], pass, 'right', indent - el.style.fontSize * 0.35));
        marker = { p: mp, x: 0 };
        n++;
      }
      blocks.push({ p, x: indent, y, marker });
      y += p.getHeight();
      start += line.length + 1;
    }
    return { blocks, glyphs: [], width: el.w, height: y, minX: 0, minY: 0, paragraphs };
  }

  private makeCurved(el: TextElement, runs: TextRun[], pass: TextPass, keep: (p: Paragraph) => Paragraph, paragraphs: Paragraph[]): TextLayout {
    const ck = this.ck;
    // Curved text is one line.
    const flat = runs.map((r) => ({ ...r, text: r.text.replace(/\n/g, ' ') }));
    const text = flat.map((r) => r.text).join('');
    const line = this.build(el, flat, { kind: 'fill' }, 'left', 1e6);
    const total = line.getMaxIntrinsicWidth();
    const curve = Math.max(-100, Math.min(100, el.curve!));
    const theta = Math.min(1.97 * Math.PI, (Math.abs(curve) / 100) * 2 * Math.PI);
    const R = total / Math.max(theta, 1e-6);
    const glyphs: Glyph[] = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const pieces = this.segmenter ? [...this.segmenter.segment(text)].map((s) => ({ i: s.index, t: s.segment })) : [...text].reduce<{ i: number; t: string }[]>((a, t) => (a.push({ i: (a.at(-1)?.i ?? 0) + (a.at(-1)?.t.length ?? 0), t }), a), []);
    for (const { i, t } of pieces) {
      const rects = line.getRectsForRange(i, i + t.length, ck.RectHeightStyle.Tight, ck.RectWidthStyle.Tight);
      if (!rects.length) continue;
      const r = rects[0]!.rect;
      const left = r[0]!, right = r[2]!;
      if (!t.trim()) continue; // spaces only advance
      const p = keep(this.build(el, sliceRuns(flat, i, i + t.length), pass, 'left', 1e6));
      const w = p.getMaxIntrinsicWidth();
      const baseline = p.getAlphabeticBaseline();
      const s = (left + right) / 2 - total / 2;
      const phi = s / R;
      const x = R * Math.sin(phi);
      const y = curve > 0 ? R - R * Math.cos(phi) : -(R - R * Math.cos(phi));
      const rot = curve > 0 ? phi : -phi;
      glyphs.push({ p, x, y, rot, w, baseline });
      // bounds of the glyph's box (w × height, baseline at origin)
      const h = p.getHeight();
      const c = Math.cos(rot), sn = Math.sin(rot);
      for (const [gx, gy] of [[-w / 2, -baseline], [w / 2, -baseline], [w / 2, h - baseline], [-w / 2, h - baseline]] as const) {
        const X = x + gx * c - gy * sn, Y = y + gx * sn + gy * c;
        minX = Math.min(minX, X); maxX = Math.max(maxX, X); minY = Math.min(minY, Y); maxY = Math.max(maxY, Y);
      }
    }
    line.delete();
    if (!glyphs.length) { minX = 0; minY = 0; maxX = 1; maxY = el.style.fontSize * el.style.lineHeight; }
    return { blocks: [], glyphs, width: maxX - minX, height: maxY - minY, minX, minY, paragraphs };
  }

  layout(el: TextElement, pass: TextPass = { kind: 'fill' }): TextLayout {
    const key = `${el.id}|${passKey(pass)}`;
    const sig = `${this.fonts.version}|${el.w}|${el.h}|${el.text}|${JSON.stringify(el.style)}|${el.runs ? JSON.stringify(el.runs) : ''}|${el.curve ?? 0}|${el.list ?? ''}|${el.gradient ? JSON.stringify(el.gradient) : ''}`;
    const hit = this.cache.get(key);
    if (hit && hit.sig === sig) return hit.layout;
    if (hit) for (const p of hit.layout.paragraphs) p.delete();
    const layout = this.make(el, pass);
    this.cache.set(key, { sig, layout });
    return layout;
  }

  /** Draw one pass of the text at the box's local origin, offset by (dx, dy). */
  draw(canvas: Canvas, el: TextElement, pass: TextPass, dx = 0, dy = 0): void {
    const L = this.layout(el, pass);
    if (L.glyphs.length) {
      // centre the curve in the box
      const ox = (el.w - L.width) / 2 - L.minX + dx, oy = (el.h - L.height) / 2 - L.minY + dy;
      for (const g of L.glyphs) {
        canvas.save();
        canvas.translate(ox + g.x, oy + g.y);
        canvas.rotate((g.rot * 180) / Math.PI, 0, 0);
        canvas.drawParagraph(g.p, -g.w / 2, -g.baseline);
        canvas.restore();
      }
      return;
    }
    for (const b of L.blocks) {
      canvas.drawParagraph(b.p, b.x + dx, b.y + dy);
      if (b.marker) canvas.drawParagraph(b.marker.p, b.marker.x + dx, b.y + dy);
    }
  }

  /** Line boxes (for the Background effect), in box coordinates. */
  lineRects(el: TextElement): { x: number; y: number; w: number; h: number }[] {
    const L = this.layout(el);
    if (L.glyphs.length) return [{ x: (el.w - L.width) / 2, y: (el.h - L.height) / 2, w: L.width, h: L.height }];
    const out: { x: number; y: number; w: number; h: number }[] = [];
    for (const b of L.blocks) {
      for (const m of b.p.getLineMetrics()) {
        if (m.width < 0.5) continue;
        const fs = el.style.fontSize;
        out.push({ x: b.x + m.left - (b.marker && m.lineNumber === 0 ? listIndent(el) : 0), y: b.y + m.baseline - fs * 0.92, w: m.width + (b.marker && m.lineNumber === 0 ? listIndent(el) : 0), h: fs * 1.18 });
      }
    }
    return out;
  }

  gc(liveIds: ReadonlySet<string>): void {
    for (const [k, c] of this.cache) {
      if (liveIds.has(k.slice(0, k.indexOf('|')))) continue;
      for (const p of c.layout.paragraphs) p.delete();
      this.cache.delete(k);
    }
  }

  dispose(): void {
    for (const c of this.cache.values()) for (const p of c.layout.paragraphs) p.delete();
    this.cache.clear();
  }
}
