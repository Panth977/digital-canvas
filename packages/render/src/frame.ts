import type { Canvas } from 'canvaskit-wasm';
import { animateAt, frameAt, matchPairs, transitionEase, transitionLayers, tweenElement, type Doc, type Page, type TransitionLayer } from '@digital-canvas/scene';
import { color } from './fonts.ts';
import type { DrawOptions, Renderer } from './renderer.ts';

/**
 * One moment of a video design, drawn in page coordinates: the page showing at
 * `t` seconds with its animations and element timing (scene `animateAt`), and
 * while a page transition plays, the previous page under it. The editor's live
 * playback, the web MP4 export and the MCP exporters all draw frames with this,
 * so what plays in the editor is what the export holds.
 */
export function drawFrameAt(r: Renderer, canvas: Canvas, doc: Doc, t: number, opts: DrawOptions = {}): void {
  // shader effects see the page's own clock (like its animations)
  const was = r.time;
  try { drawFrame(r, canvas, doc, t, opts); } finally { r.time = was; }
}

function drawFrame(r: Renderer, canvas: Canvas, doc: Doc, t: number, opts: DrawOptions): void {
  const f = frameAt(doc, t);
  r.time = f.local;
  const now = animateAt(doc, f.page, f.local);
  if (!f.prev || !f.transition) {
    r.drawPage(canvas, doc, now, opts);
    return;
  }
  const ck = r.ck;
  const before = animateAt(doc, f.prev.page, f.prev.local);
  const prevTime = f.prev.local, nowTime = f.local;
  const L = transitionLayers(f.transition, f.progress ?? 1, doc.width, doc.height);
  canvas.save();
  canvas.clipRect(ck.XYWHRect(0, 0, doc.width, doc.height), ck.ClipOp.Intersect, true);
  if (L.black) {
    const black = new ck.Paint();
    black.setColor(ck.BLACK);
    canvas.drawRect(ck.XYWHRect(0, 0, doc.width, doc.height), black);
    black.delete();
  }
  if (f.transition.type === 'match') {
    // Match & Move: what is on both pages travels, the rest dissolves under it
    const pairs = matchPairs(before, now);
    const skip = new Set([...(opts.skip ?? []), ...pairs.flatMap((p) => [p.a.id, p.b.id])]);
    r.time = prevTime;
    drawLayer(r, canvas, doc, before, L.prev, { ...opts, skip });
    r.time = nowTime;
    drawLayer(r, canvas, doc, now, L.next, { ...opts, skip });
    const e = transitionEase(f.progress ?? 1);
    for (const p of pairs) if (!opts.skip?.has(p.b.id)) r.drawElement(canvas, tweenElement(p.a, p.b, e));
  } else {
    if (L.prevOnTop) drawLayer(r, canvas, doc, now, L.next, opts);
    r.time = prevTime;
    drawLayer(r, canvas, doc, before, L.prev, opts);
    r.time = nowTime;
    if (L.band) {
      const p = new ck.Paint();
      p.setAntiAlias(true);
      p.setColor(color(ck, L.band.color));
      const path = polyPath(r, [L.band.poly]);
      canvas.drawPath(path, p);
      path.delete();
      p.delete();
    }
    if (!L.prevOnTop) drawLayer(r, canvas, doc, now, L.next, opts);
  }
  canvas.restore();
}

function polyPath(r: Renderer, polys: number[][]) {
  const b = new r.ck.PathBuilder();
  for (const q of polys) if (q.length >= 6) b.addPolygon(q, true);
  return b.detachAndDelete();
}

/** Draw one page with a transition layer applied. */
function drawLayer(r: Renderer, canvas: Canvas, doc: Doc, page: Page, L: TransitionLayer, opts: DrawOptions): void {
  const ck = r.ck;
  if (L.alpha <= 0) return;
  canvas.save();
  if (L.clip) canvas.clipRect(ck.XYWHRect(L.clip.x, L.clip.y, L.clip.w, L.clip.h), ck.ClipOp.Intersect, true);
  if (L.circle) {
    const b = new ck.PathBuilder();
    b.addCircle(L.circle.x, L.circle.y, Math.max(0.01, L.circle.r));
    const path = b.detachAndDelete();
    canvas.clipPath(path, ck.ClipOp.Intersect, true);
    path.delete();
  }
  if (L.polys) {
    const path = polyPath(r, L.polys);
    canvas.clipPath(path, ck.ClipOp.Intersect, true);
    path.delete();
  }
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
  if (L.strips) {
    for (const s of L.strips) {
      canvas.save();
      canvas.translate(s.dx, s.dy);
      const path = polyPath(r, [s.poly]);
      canvas.clipPath(path, ck.ClipOp.Intersect, true);
      path.delete();
      r.drawPage(canvas, doc, page, { skip: opts.skip });
      canvas.restore();
    }
  } else r.drawPage(canvas, doc, page, { skip: opts.skip });
  if (L.alpha < 1) canvas.restore();
  canvas.restore();
}
