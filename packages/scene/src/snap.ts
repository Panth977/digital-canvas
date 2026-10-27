import type { Guide } from './types.ts';
import type { Handle, Rect } from './geometry.ts';

/**
 * Snapping and smart guides, Canva style: while moving or resizing, edges and
 * centres pull to the page's edges and centre, to other elements' edges and
 * centres, to ruler guides, and (moving only) to equal spacing between
 * neighbours. Everything is in page px; the threshold too (screen px / zoom).
 */

/** A line something can snap to: `pos` on its axis, spanning `from`..`to` on the other. */
export interface SnapLine { pos: number; from: number; to: number }

export interface SnapTargets {
  /** Vertical lines (x positions). */
  x: SnapLine[];
  /** Horizontal lines (y positions). */
  y: SnapLine[];
  /** Other elements' bounds, for equal-spacing hints. */
  rects: Rect[];
}

/** A guide to draw: axis 'x' = vertical line at x = pos, from y = from to y = to (and vice versa). */
export interface SnapGuide { axis: 'x' | 'y'; pos: number; from: number; to: number }

/** An equal-spacing hint: a gap along `axis` from `from` to `to`, drawn across at `at`. */
export interface GapHint { axis: 'x' | 'y'; from: number; to: number; at: number }

export interface SnapResult { dx: number; dy: number; guides: SnapGuide[]; gaps: GapHint[] }

/** Lines to snap to on a `width` × `height` page holding `rects`, plus ruler guides. */
export function snapTargets(width: number, height: number, rects: Rect[], guides: readonly Guide[] = []): SnapTargets {
  const x: SnapLine[] = [0, width / 2, width].map((pos) => ({ pos, from: 0, to: height }));
  const y: SnapLine[] = [0, height / 2, height].map((pos) => ({ pos, from: 0, to: width }));
  for (const r of rects) {
    for (const pos of [r.x, r.x + r.w / 2, r.x + r.w]) x.push({ pos, from: r.y, to: r.y + r.h });
    for (const pos of [r.y, r.y + r.h / 2, r.y + r.h]) y.push({ pos, from: r.x, to: r.x + r.w });
  }
  for (const g of guides) (g.axis === 'x' ? x : y).push({ pos: g.pos, from: 0, to: g.axis === 'x' ? height : width });
  return { x, y, rects };
}

const EPS = 1e-3;

/** Rect seen along one axis: `a` = start, `s` = size; `b`/`t` = the other axis. */
interface Span { a: number; s: number; b: number; t: number }
const along = (r: Rect, axis: 'x' | 'y'): Span => (axis === 'x' ? { a: r.x, s: r.w, b: r.y, t: r.h } : { a: r.y, s: r.h, b: r.x, t: r.w });

interface Candidate { d: number; line?: SnapLine; gaps?: (moved: Span) => GapHint[] }

/** Equal-spacing positions for span `m` among `rects` along `axis` (as moves `d`). */
function spacing(m: Span, rects: Rect[], axis: 'x' | 'y'): Candidate[] {
  // neighbours: rects that share some of the moving rect's extent across the axis
  const ns = rects.map((r) => along(r, axis)).filter((n) => n.b < m.b + m.t && n.b + n.t > m.b).sort((p, q) => p.a - q.a);
  const out: Candidate[] = [];
  const across = (p: Span, q: Span) => (Math.max(p.b, q.b) + Math.min(p.b + p.t, q.b + q.t)) / 2;
  const hint = (from: number, to: number, at: number): GapHint => ({ axis, from, to, at });
  for (let i = 0; i + 1 < ns.length; i++) {
    const p = ns[i]!, q = ns[i + 1]!;
    const g = q.a - (p.a + p.s);
    if (g <= 0) continue;
    // after q, the same gap
    out.push({ d: q.a + q.s + g - m.a, gaps: (mv) => [hint(p.a + p.s, q.a, across(p, q)), hint(q.a + q.s, mv.a, across(q, mv))] });
    // before p, the same gap
    out.push({ d: p.a - g - m.s - m.a, gaps: (mv) => [hint(mv.a + mv.s, p.a, across(mv, p)), hint(p.a + p.s, q.a, across(p, q))] });
    // centred between p and q
    if (g > m.s) out.push({ d: (p.a + p.s + q.a - m.s) / 2 - m.a, gaps: (mv) => [hint(p.a + p.s, mv.a, across(p, mv)), hint(mv.a + mv.s, q.a, across(mv, q))] });
  }
  return out;
}

function snapAxis(r: Rect, t: SnapTargets, axis: 'x' | 'y', threshold: number, gaps: boolean): { d: number; guides: SnapGuide[]; gaps: GapHint[] } {
  const m = along(r, axis);
  const cands: Candidate[] = [];
  for (const line of t[axis]) for (const edge of [m.a, m.a + m.s / 2, m.a + m.s]) cands.push({ d: line.pos - edge, line });
  if (gaps) cands.push(...spacing(m, t.rects, axis));
  let best: Candidate | null = null;
  for (const c of cands) if (Math.abs(c.d) <= threshold && (!best || Math.abs(c.d) < Math.abs(best.d))) best = c;
  if (!best) return { d: 0, guides: [], gaps: [] };
  const d = best.d;
  const moved = { ...m, a: m.a + d };
  const guides: SnapGuide[] = [];
  const hints: GapHint[] = [];
  for (const c of cands) {
    if (Math.abs(c.d - d) > EPS) continue;
    if (c.line) guides.push({ axis, pos: c.line.pos, from: Math.min(c.line.from, moved.b), to: Math.max(c.line.to, moved.b + moved.t) });
    if (c.gaps) hints.push(...c.gaps(moved));
  }
  return { d, guides, gaps: hints };
}

/** Snap a rect being moved: the move to add and what to draw. */
export function snapMove(r: Rect, t: SnapTargets, threshold: number): SnapResult {
  const sx = snapAxis(r, t, 'x', threshold, true);
  const moved = { ...r, x: r.x + sx.d };
  const sy = snapAxis(moved, t, 'y', threshold, true);
  // x guides were measured before the y snap: stretch them to the final box
  const fy = moved.y + sy.d;
  const guides = [
    ...sx.guides.map((g) => ({ ...g, from: Math.min(g.from, fy), to: Math.max(g.to, fy + r.h) })),
    ...sy.guides,
  ];
  return { dx: sx.d, dy: sy.d, guides, gaps: [...sx.gaps, ...sy.gaps] };
}

/**
 * Snap the edges a resize handle moves (unrotated boxes). With `keepRatio`
 * and a corner handle, the closer of the two edges wins and the other follows
 * the ratio, keeping the opposite corner fixed.
 */
export function snapResize(box: Rect, handle: Handle, t: SnapTargets, threshold: number, keepRatio = false): { rect: Rect; guides: SnapGuide[] } {
  const edge = (axis: 'x' | 'y') => {
    const lo = axis === 'x' ? handle.includes('w') : handle.includes('n');
    const hi = axis === 'x' ? handle.includes('e') : handle.includes('s');
    if (!lo && !hi) return null;
    const pos = axis === 'x' ? (lo ? box.x : box.x + box.w) : lo ? box.y : box.y + box.h;
    let best: SnapLine | null = null;
    for (const l of t[axis]) if (Math.abs(l.pos - pos) <= threshold && (!best || Math.abs(l.pos - pos) < Math.abs(best.pos - pos))) best = l;
    return best ? { lo, d: best.pos - pos, line: best } : null;
  };
  let ex = edge('x'), ey = edge('y');
  if (keepRatio && ex && ey) {
    if (Math.abs(ex.d) <= Math.abs(ey.d)) ey = null;
    else ex = null;
  }
  const r = { ...box };
  if (ex) {
    if (ex.lo) { r.x += ex.d; r.w -= ex.d; } else r.w += ex.d;
  }
  if (ey) {
    if (ey.lo) { r.y += ey.d; r.h -= ey.d; } else r.h += ey.d;
  }
  if (keepRatio && handle.length === 2 && (ex || ey) && box.w > 0 && box.h > 0) {
    const ratio = box.w / box.h;
    if (ex) {
      const h = r.w / ratio;
      if (handle.includes('n')) r.y = box.y + box.h - h;
      r.h = h;
    } else {
      const w = r.h * ratio;
      if (handle.includes('w')) r.x = box.x + box.w - w;
      r.w = w;
    }
  }
  const guides: SnapGuide[] = [];
  if (ex) guides.push({ axis: 'x', pos: ex.line.pos, from: Math.min(ex.line.from, r.y), to: Math.max(ex.line.to, r.y + r.h) });
  if (ey) guides.push({ axis: 'y', pos: ey.line.pos, from: Math.min(ey.line.from, r.x), to: Math.max(ey.line.to, r.x + r.w) });
  return { rect: r, guides };
}
