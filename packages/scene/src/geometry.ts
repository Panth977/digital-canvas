import type { Element, Page } from './types.ts';
import { lineDistance } from './line.ts';

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

const RAD = Math.PI / 180;

export function center(e: Rect): Point {
  return { x: e.x + e.w / 2, y: e.y + e.h / 2 };
}

export function rotatePoint(p: Point, c: Point, deg: number): Point {
  if (!deg) return p;
  const r = deg * RAD;
  const cos = Math.cos(r), sin = Math.sin(r);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** The four corners of a (possibly rotated) element: tl, tr, br, bl. */
export function corners(e: Rect & { rotation: number }): [Point, Point, Point, Point] {
  const c = center(e);
  const pts: Point[] = [
    { x: e.x, y: e.y },
    { x: e.x + e.w, y: e.y },
    { x: e.x + e.w, y: e.y + e.h },
    { x: e.x, y: e.y + e.h },
  ];
  return pts.map((p) => rotatePoint(p, c, e.rotation)) as [Point, Point, Point, Point];
}

/** Axis-aligned bounds of a rotated element. */
export function aabb(e: Rect & { rotation: number }): Rect {
  const pts = corners(e);
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function union(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Is page point `p` inside element `e` (respecting rotation)? */
export function contains(e: Rect & { rotation: number }, p: Point, pad = 0): boolean {
  const local = rotatePoint(p, center(e), -e.rotation);
  return local.x >= e.x - pad && local.x <= e.x + e.w + pad && local.y >= e.y - pad && local.y <= e.y + e.h + pad;
}

/** Topmost visible element under `p`, or null. */
export function hitTest(page: Page, p: Point, pad = 0): Element | null {
  for (let i = page.elements.length - 1; i >= 0; i--) {
    const e = page.elements[i]!;
    if (e.hidden) continue;
    // a line is hit near its stroke, not anywhere in its (maybe large, diagonal) box
    if (e.type === 'line' ? lineDistance(e, p) <= Math.max(e.stroke.width / 2, 3) + pad * 3 : contains(e, p, pad)) return e;
  }
  return null;
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function normalizeRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/**
 * Resize an element by dragging `handle` to page point `p`, keeping the
 * opposite side fixed, in the element's own rotated frame. Corner handles
 * keep the aspect ratio when `keepRatio` is set.
 */
export function resizeBox(
  start: Rect & { rotation: number },
  handle: Handle,
  p: Point,
  opts: { keepRatio?: boolean; min?: number } = {},
): Rect {
  const min = opts.min ?? 4;
  const c = center(start);
  const local = rotatePoint(p, c, -start.rotation);
  let x1 = start.x, y1 = start.y, x2 = start.x + start.w, y2 = start.y + start.h;
  if (handle.includes('w')) x1 = Math.min(local.x, x2 - min);
  if (handle.includes('e')) x2 = Math.max(local.x, x1 + min);
  if (handle.includes('n')) y1 = Math.min(local.y, y2 - min);
  if (handle.includes('s')) y2 = Math.max(local.y, y1 + min);
  if (opts.keepRatio && handle.length === 2 && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h;
    let w = x2 - x1, h = y2 - y1;
    if (w / h > ratio) h = w / ratio; else w = h * ratio;
    if (handle.includes('w')) x1 = x2 - w; else x2 = x1 + w;
    if (handle.includes('n')) y1 = y2 - h; else y2 = y1 + h;
  }
  // The fixed corner must stay put on screen: re-anchor around the new centre.
  const w = x2 - x1, h = y2 - y1;
  const fixedLocal = {
    x: handle.includes('w') ? start.x + start.w : handle.includes('e') ? start.x : start.x + start.w / 2,
    y: handle.includes('n') ? start.y + start.h : handle.includes('s') ? start.y : start.y + start.h / 2,
  };
  const fixedWorld = rotatePoint(fixedLocal, c, start.rotation);
  const newFixedLocal = {
    x: handle.includes('w') ? x2 : handle.includes('e') ? x1 : (x1 + x2) / 2,
    y: handle.includes('n') ? y2 : handle.includes('s') ? y1 : (y1 + y2) / 2,
  };
  const newCenterLocal = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  // vector from fixed point to centre, rotated into world space
  const v = rotatePoint({ x: newCenterLocal.x - newFixedLocal.x, y: newCenterLocal.y - newFixedLocal.y }, { x: 0, y: 0 }, start.rotation);
  const nc = { x: fixedWorld.x + v.x, y: fixedWorld.y + v.y };
  return { x: nc.x - w / 2, y: nc.y - h / 2, w, h };
}

/** Angle in degrees from centre `c` to `p`, 0 = straight up. */
export function angleTo(c: Point, p: Point): number {
  return (Math.atan2(p.y - c.y, p.x - c.x) / RAD + 90 + 360) % 360;
}
