import type { Attach, Element, LineElement, LineEnd } from './types.ts';

/**
 * Line geometry: where a line's ends are, the route between them (straight,
 * elbow or curved) and how far a point is from it. Pure, so the renderer,
 * exporters and hit testing agree.
 */

interface P { x: number; y: number }

const RAD = Math.PI / 180;

function rot(p: P, c: P, deg: number): P {
  if (!deg) return p;
  const r = deg * RAD, cos = Math.cos(r), sin = Math.sin(r);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** A point in an element's box (fractions) → page point, with rotation and flips. */
export function boxPoint(e: Element, f: { x: number; y: number }): P {
  const c = { x: e.x + e.w / 2, y: e.y + e.h / 2 };
  const fx = e.flipX ? 1 - f.x : f.x, fy = e.flipY ? 1 - f.y : f.y;
  return rot({ x: e.x + fx * e.w, y: e.y + fy * e.h }, c, e.rotation);
}

/** Page point of one end of a line, before its own rotation. */
const local = (el: LineElement, end: LineEnd): P => ({ x: el.x + end.x, y: el.y + end.y });

/** Page positions of a line's two ends (rotation and flips applied). */
export function lineEnds(el: LineElement): [P, P] {
  const c = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
  const t = (e: LineEnd) => {
    let p = local(el, e);
    if (el.flipX) p = { x: 2 * c.x - p.x, y: p.y };
    if (el.flipY) p = { x: p.x, y: 2 * c.y - p.y };
    return rot(p, c, el.rotation);
  };
  return [t(el.start), t(el.end)];
}

/** New box and ends for a line whose ends sit at page points `a` and `b` (rotation and flips reset). */
export function setLineEnds(el: LineElement, a: P, b: P, attach?: { start?: Attach | null; end?: Attach | null }): Partial<LineElement> {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  const pick = (cur: Attach | undefined, next: Attach | null | undefined) => (next === null ? undefined : next ?? cur);
  const start: LineEnd = { ...el.start, x: a.x - x, y: a.y - y, attach: pick(el.start.attach, attach?.start) };
  const end: LineEnd = { ...el.end, x: b.x - x, y: b.y - y, attach: pick(el.end.attach, attach?.end) };
  if (!start.attach) delete start.attach;
  if (!end.attach) delete end.attach;
  return { x, y, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y), rotation: 0, flipX: false, flipY: false, start, end };
}

/** Direction a connector leaves its element: out of the side it is stuck to, else null. */
function sideDir(end: LineEnd): P | null {
  const p = end.attach?.point;
  if (!p) return null;
  if (p.x <= 0.001) return { x: -1, y: 0 };
  if (p.x >= 0.999) return { x: 1, y: 0 };
  if (p.y <= 0.001) return { x: 0, y: -1 };
  if (p.y >= 0.999) return { x: 0, y: 1 };
  return null;
}

export type Route = { kind: 'poly'; pts: P[] } | { kind: 'cubic'; pts: [P, P, P, P] };

/** The path from start to end in page coordinates, before the line's rotation. */
export function lineRoute(el: LineElement): Route {
  const a = local(el, el.start), b = local(el, el.end);
  if (el.route === 'straight') return { kind: 'poly', pts: [a, b] };
  const dx = b.x - a.x, dy = b.y - a.y;
  const horiz = Math.abs(dx) >= Math.abs(dy);
  const da = sideDir(el.start) ?? (horiz ? { x: Math.sign(dx) || 1, y: 0 } : { x: 0, y: Math.sign(dy) || 1 });
  const db = sideDir(el.end) ?? (horiz ? { x: -(Math.sign(dx) || 1), y: 0 } : { x: 0, y: -(Math.sign(dy) || 1) });
  if (el.route === 'curved') {
    const k = Math.max(Math.abs(dx), Math.abs(dy)) * 0.5;
    return { kind: 'cubic', pts: [a, { x: a.x + da.x * k, y: a.y + da.y * k }, { x: b.x + db.x * k, y: b.y + db.y * k }, b] };
  }
  // elbow: right angles only
  const aH = da.x !== 0, bH = db.x !== 0;
  let pts: P[];
  if (aH && bH) {
    const mx = (a.x + b.x) / 2;
    pts = [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
  } else if (!aH && !bH) {
    const my = (a.y + b.y) / 2;
    pts = [a, { x: a.x, y: my }, { x: b.x, y: my }, b];
  } else if (aH) pts = [a, { x: b.x, y: a.y }, b];
  else pts = [a, { x: a.x, y: b.y }, b];
  // drop zero-length legs so end directions stay meaningful
  return { kind: 'poly', pts: pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1]!.x, p.y - pts[i - 1]!.y) > 0.01) };
}

/** Points along a route (curves sampled), for hit testing. */
export function routePoints(r: Route, steps = 24): P[] {
  if (r.kind === 'poly') return r.pts;
  const [p0, p1, p2, p3] = r.pts;
  const out: P[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return out;
}

function segDist(p: P, a: P, b: P): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance from page point `p` to the drawn line. */
export function lineDistance(el: LineElement, p: P): number {
  const c = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
  let q = rot(p, c, -el.rotation);
  if (el.flipX) q = { x: 2 * c.x - q.x, y: q.y };
  if (el.flipY) q = { x: q.x, y: 2 * c.y - q.y };
  const pts = routePoints(lineRoute(el));
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(q, pts[i - 1]!, pts[i]!));
  return pts.length === 1 ? Math.hypot(q.x - pts[0]!.x, q.y - pts[0]!.y) : d;
}

/** Spots a connector can stick to: the centre and the middle of each side. */
export const ANCHORS: { x: number; y: number }[] = [
  { x: 0.5, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }, { x: 0.5, y: 0.5 },
];
