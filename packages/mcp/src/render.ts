/**
 * Pictures for the agent to look at: one page (optionally at a moment of a
 * video, optionally with numbered element outlines), or every page in a grid.
 */
import { DEFAULT_TEXT_STYLE, animateAt, frameAt, pageStart, type Doc, type Element, type Page, type TextElement } from '@digital-canvas/scene';
import type { ProjectFile } from '@digital-canvas/storage';
import { withRenderer, type Engine } from './engine.ts';
import { drawAt, framesAt } from './video.ts';

const OUTLINE_COLORS = ['#ff2d55', '#007aff', '#34c759', '#ff9500', '#af52de', '#00c7be', '#ff3b30', '#5856d6'];

/** A label text element drawn on top of the page (never saved). */
function label(n: number, e: Element, size: number, color: string, doc: Doc): TextElement {
  const fs = Math.max(12, size);
  return {
    id: `__label${n}`, type: 'text', text: String(n), x: Math.max(0, Math.min(doc.width - fs * 2, e.x)), y: Math.max(0, Math.min(doc.height - fs * 1.4, e.y)),
    w: fs * 2.4, h: fs * 1.3, rotation: 0, opacity: 1,
    style: { ...DEFAULT_TEXT_STYLE, fontSize: fs, bold: true, color: '#ffffff', align: 'center', lineHeight: 1.1 },
    effect: { type: 'background', roundness: 40, spread: 30, transparency: 0, color },
  };
}

export interface RenderOptions {
  /** Longest side of the PNG (default 1024). */
  maxSide?: number;
  /** Seconds into the page (video/animation): shows that moment. */
  at?: number;
  /** Draw numbered outlines over the top-level elements. */
  labels?: boolean;
  format?: 'png' | 'jpeg';
}

export async function renderPage(file: ProjectFile, page: Page, opts: RenderOptions = {}): Promise<{ bytes: Uint8Array; width: number; height: number; legend: Record<string, string> }> {
  const doc = file.doc;
  const max = opts.maxSide ?? 1024;
  const scale = Math.min(4, max / Math.max(doc.width, doc.height));
  const W = Math.max(1, Math.round(doc.width * scale)), H = Math.max(1, Math.round(doc.height * scale));
  const legend: Record<string, string> = {};
  const frames = opts.at !== undefined ? await framesAt(file, pageStart(doc, page.id) + opts.at) : new Map<string, Uint8Array>();
  const bytes = await withRenderer(file, (r, eng: Engine) => {
    const ck = eng.ck;
    for (const [asset, png] of frames) {
      const img = ck.MakeImageFromEncoded(png);
      if (img) r.setVideoFrame(asset, img);
    }
    const surface = ck.MakeSurface(W, H);
    if (!surface) throw new Error('could not make a drawing surface');
    try {
      const canvas = surface.getCanvas();
      canvas.clear(ck.WHITE);
      canvas.save();
      canvas.scale(scale, scale);
      if (opts.at !== undefined && !page.hidden) drawAt(eng, r, canvas, doc, pageStart(doc, page.id) + Math.max(0, opts.at));
      else r.drawPage(canvas, doc, opts.at !== undefined ? animateAt(doc, page, opts.at) : page);
      if (opts.labels) {
        const paint = new ck.Paint();
        paint.setStyle(ck.PaintStyle.Stroke);
        paint.setAntiAlias(true);
        paint.setStrokeWidth(Math.max(1.5, 2.5 / scale));
        const shown = opts.at !== undefined ? (frameAt(doc, pageStart(doc, page.id) + opts.at).page.id === page.id ? animateAt(doc, page, opts.at).elements : []) : page.elements;
        shown.forEach((e, i) => {
          if (e.hidden) return;
          const n = i + 1;
          const color = OUTLINE_COLORS[i % OUTLINE_COLORS.length]!;
          legend[String(n)] = e.id;
          paint.setColor(ck.parseColorString(color));
          canvas.save();
          canvas.translate(e.x + e.w / 2, e.y + e.h / 2);
          canvas.rotate(e.rotation, 0, 0);
          canvas.drawRect(ck.XYWHRect(-e.w / 2, -e.h / 2, e.w, e.h), paint);
          canvas.restore();
          r.drawElement(canvas, label(n, e, 18 / scale, color, doc));
        });
        paint.delete();
      }
      canvas.restore();
      surface.flush();
      const img = surface.makeImageSnapshot();
      const out = img.encodeToBytes(opts.format === 'jpeg' ? ck.ImageFormat.JPEG : ck.ImageFormat.PNG, 88);
      img.delete();
      if (!out) throw new Error('encode failed');
      return out;
    } finally {
      surface.delete();
    }
  }, [page]);
  return { bytes, width: W, height: H, legend };
}

/** Every page (or the listed ones) side by side, numbered. */
export async function renderGrid(file: ProjectFile, pages: Page[], opts: { maxSide?: number; columns?: number } = {}): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const doc = file.doc;
  const n = pages.length;
  const cols = Math.max(1, Math.min(n, opts.columns ?? Math.ceil(Math.sqrt(n * (doc.height / doc.width)))));
  const rows = Math.ceil(n / cols);
  const max = opts.maxSide ?? 1600;
  const gap = 24, head = 30;
  const cell = Math.min((max - gap * (cols + 1)) / cols / doc.width, (max - gap * (rows + 1) - head * rows) / rows / doc.height);
  const cw = doc.width * cell, chh = doc.height * cell;
  const W = Math.round(cols * cw + gap * (cols + 1)), H = Math.round(rows * (chh + head) + gap * (rows + 1));
  return withRenderer(file, (r, eng) => {
    const ck = eng.ck;
    const surface = ck.MakeSurface(W, H)!;
    try {
      const canvas = surface.getCanvas();
      canvas.clear(ck.parseColorString('#e9ebef'));
      pages.forEach((p, i) => {
        const cx = gap + (i % cols) * (cw + gap), cy = gap + Math.floor(i / cols) * (chh + head + gap);
        const num = doc.pages.indexOf(p) + 1;
        const t: TextElement = { id: `__h${i}`, type: 'text', text: `Page ${num}${p.duration ? ` · ${p.duration}s` : ''}${p.hidden ? ' (hidden)' : ''}`, x: cx, y: cy, w: cw, h: head, rotation: 0, opacity: 1, style: { ...DEFAULT_TEXT_STYLE, fontSize: 18, bold: true, color: '#3b3f47' } };
        r.drawElement(canvas, t);
        canvas.save();
        canvas.translate(cx, cy + head);
        canvas.scale(cell, cell);
        r.drawPage(canvas, doc, p);
        canvas.restore();
      });
      surface.flush();
      const img = surface.makeImageSnapshot();
      const out = img.encodeToBytes(ck.ImageFormat.PNG, 100)!;
      img.delete();
      return { bytes: out, width: W, height: H };
    } finally {
      surface.delete();
    }
  }, pages);
}
