import type { Canvas } from 'canvaskit-wasm';
import { animateAt, frameAt, transitionLayers, type Doc, type Page, type TransitionLayer } from '@digital-canvas/scene';
import type { DrawOptions, Renderer } from './renderer.ts';

/**
 * One moment of a video design, drawn in page coordinates: the page showing at
 * `t` seconds with its animations and element timing (scene `animateAt`), and
 * while a page transition plays, the previous page under it. The editor's live
 * playback, the web MP4 export and the MCP exporters all draw frames with this,
 * so what plays in the editor is what the export holds.
 */
export function drawFrameAt(r: Renderer, canvas: Canvas, doc: Doc, t: number, opts: DrawOptions = {}): void {
  const f = frameAt(doc, t);
  const now = animateAt(doc, f.page, f.local);
  if (!f.prev || !f.transition) {
    r.drawPage(canvas, doc, now, opts);
    return;
  }
  const ck = r.ck;
  const L = transitionLayers(f.transition, f.progress ?? 1, doc.width, doc.height);
  canvas.save();
  canvas.clipRect(ck.XYWHRect(0, 0, doc.width, doc.height), ck.ClipOp.Intersect, true);
  if (L.black) {
    const black = new ck.Paint();
    black.setColor(ck.BLACK);
    canvas.drawRect(ck.XYWHRect(0, 0, doc.width, doc.height), black);
    black.delete();
  }
  drawLayer(r, canvas, doc, animateAt(doc, f.prev.page, f.prev.local), L.prev, opts);
  drawLayer(r, canvas, doc, now, L.next, opts);
  canvas.restore();
}

/** Draw one page with a transition layer applied. */
function drawLayer(r: Renderer, canvas: Canvas, doc: Doc, page: Page, L: TransitionLayer, opts: DrawOptions): void {
  const ck = r.ck;
  if (L.alpha <= 0) return;
  canvas.save();
  if (L.clip) canvas.clipRect(ck.XYWHRect(L.clip.x, L.clip.y, L.clip.w, L.clip.h), ck.ClipOp.Intersect, true);
  canvas.translate(L.dx, L.dy);
  if (L.scale !== 1) {
    canvas.translate(doc.width / 2, doc.height / 2);
    canvas.scale(L.scale, L.scale);
    canvas.translate(-doc.width / 2, -doc.height / 2);
  }
  if (L.alpha < 1) {
    const p = new ck.Paint();
    p.setAlphaf(L.alpha);
    canvas.saveLayer(p);
    p.delete();
  }
  r.drawPage(canvas, doc, page, { skip: opts.skip });
  if (L.alpha < 1) canvas.restore();
  canvas.restore();
}
