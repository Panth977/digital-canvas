import { rotatePoint } from './geometry.ts';
import { walk } from './tree.ts';
import type { Element, PathElement } from './types.ts';

/** A freehand drawing (pen, marker, highlighter): what the eraser may remove. */
export const isDrawing = (e: Element): e is PathElement =>
  e.type === 'path' && !e.qr && e.paths.length > 0 && e.paths.every((p) => !p.fill && !!p.stroke) && (e.name === 'Drawing' || e.name === 'Highlight');

/** Points along a path's `d` (end and control points; good enough for hit tests of smooth strokes). */
function pathPoints(d: string): { x: number; y: number }[] {
  const nums = d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi)?.map(Number) ?? [];
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push({ x: nums[i]!, y: nums[i + 1]! });
  return out;
}

/**
 * Drawings an eraser stroke touches: every freehand element on the list (and in
 * groups) with a point within `radius` (plus half its own line width) of the
 * eraser's path. Points are page px.
 */
export function erasedBy(elements: readonly Element[], eraser: { x: number; y: number }[], radius: number): string[] {
  if (!eraser.length) return [];
  // densify the eraser path so fast strokes don't skip over thin lines
  const pts: { x: number; y: number }[] = [eraser[0]!];
  for (let i = 1; i < eraser.length; i++) {
    const a = eraser[i - 1]!, b = eraser[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(2, radius / 2)));
    for (let k = 1; k <= n; k++) pts.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  const hit: string[] = [];
  for (const e of walk(elements)) {
    if (!isDrawing(e)) continue;
    const sx = e.w / (e.viewBox.w || 1), sy = e.h / (e.viewBox.h || 1);
    const c = { x: e.x + e.w / 2, y: e.y + e.h / 2 };
    const reach = radius + (e.paths[0]!.stroke!.width * Math.max(sx, sy)) / 2;
    const touches = e.paths.some((p) => {
      const raw = pathPoints(p.d);
      // also test midpoints between successive points
      const dense = raw.flatMap((q, i) => (i ? [{ x: (q.x + raw[i - 1]!.x) / 2, y: (q.y + raw[i - 1]!.y) / 2 }, q] : [q]));
      return dense.some((q) => {
        let pt = { x: e.x + (q.x - e.viewBox.x) * sx, y: e.y + (q.y - e.viewBox.y) * sy };
        if (e.rotation) pt = rotatePoint(pt, c, e.rotation);
        return pts.some((r) => Math.hypot(r.x - pt.x, r.y - pt.y) <= reach);
      });
    });
    if (touches) hit.push(e.id);
  }
  return hit;
}
