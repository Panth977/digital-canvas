import type { Element, ElementBase, Page, TextElement } from './types.ts';
import { aabb, center, corners, rotatePoint, union, type Point, type Rect } from './geometry.ts';

/**
 * Elements that hold other elements (groups, and any later container type).
 * Everything here is generic over "has a `children` array", so new container
 * types get recursion in lookups, edits, drawing and pruning for free.
 * Children are stored in page coordinates (see GroupElement).
 */

export function childrenOf(e: Element): Element[] | undefined {
  const c = (e as { children?: unknown }).children;
  return Array.isArray(c) ? (c as Element[]) : undefined;
}

export function withChildren<T extends Element>(e: T, children: Element[]): T {
  return { ...e, children };
}

/** Every element in `els`, depth first, containers before their children. */
export function* walk(els: readonly Element[]): Generator<Element> {
  for (const e of els) {
    yield e;
    const c = childrenOf(e);
    if (c) yield* walk(c);
  }
}

/** All elements of a page including those inside groups. */
export function allElements(page: Page): Element[] {
  return [...walk(page.elements)];
}

/** The chain from a top-level element down to `id` (inclusive), or null. */
export function pathTo(els: readonly Element[], id: string): Element[] | null {
  for (const e of els) {
    if (e.id === id) return [e];
    const c = childrenOf(e);
    if (c) {
      const p = pathTo(c, id);
      if (p) return [e, ...p];
    }
  }
  return null;
}

/**
 * Rebuild every element list in a tree, bottom up: `fn` gets each list (the
 * page's and every container's) after its children were rebuilt. Containers
 * whose children changed are refitted; a container left empty is dropped.
 */
export function mapLists(els: Element[], fn: (list: Element[]) => Element[]): Element[] {
  let changed = false;
  const inner: Element[] = [];
  for (const e of els) {
    const c = childrenOf(e);
    if (!c) { inner.push(e); continue; }
    const next = mapLists(c, fn);
    if (next === c) { inner.push(e); continue; }
    changed = true;
    if (next.length) inner.push(fitGroup(withChildren(e, next)));
  }
  return fn(changed ? inner : els);
}

/** Union of the axis-aligned bounds of `els`. */
export function boundsOf(els: readonly Element[]): Rect | null {
  return union(els.map((e) => aabb(e)));
}

/** A container's box refitted around its children, measured in the container's own (rotated) frame. */
export function fitGroup<T extends Element>(g: T): T {
  const kids = childrenOf(g);
  if (!kids?.length) return g;
  const c = center(g);
  const pts = kids.flatMap((k) => corners(k)).map((p) => rotatePoint(p, c, -g.rotation));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x1 = Math.min(...xs), y1 = Math.min(...ys), w = Math.max(...xs) - x1, h = Math.max(...ys) - y1;
  const wc = rotatePoint({ x: x1 + w / 2, y: y1 + h / 2 }, c, g.rotation);
  return { ...g, x: wc.x - w / 2, y: wc.y - h / 2, w, h };
}

const norm = (deg: number) => ((deg % 360) + 360) % 360;

type Frame = Pick<ElementBase, 'x' | 'y' | 'w' | 'h' | 'rotation' | 'flipX' | 'flipY'>;

/**
 * Children laid out in frame `from`, moved to frame `to` (a group was moved,
 * resized, rotated or flipped). Exact for children square to the group;
 * others keep their own aspect approximately. Font sizes, strokes and corner
 * radii scale with the area.
 */
export function transformChildren(from: Frame, to: Frame, children: Element[]): Element[] {
  const sx = to.w / (from.w || 1), sy = to.h / (from.h || 1);
  const oc = center(from), nc = center(to);
  const fx = !!to.flipX !== !!from.flipX, fy = !!to.flipY !== !!from.flipY;
  const map = (p: Point): Point => {
    const l = rotatePoint(p, oc, -from.rotation);
    let u = (l.x - from.x) / (from.w || 1), v = (l.y - from.y) / (from.h || 1);
    if (fx) u = 1 - u;
    if (fy) v = 1 - v;
    return rotatePoint({ x: to.x + u * to.w, y: to.y + v * to.h }, nc, to.rotation);
  };
  const s = Math.sqrt(Math.abs(sx * sy));
  return children.map((c) => {
    const rel = c.rotation - from.rotation;
    // a child turned ~90° to the group stretches along its other axis
    const swap = Math.abs((((rel % 180) + 180) % 180) - 90) < 45;
    const w = c.w * (swap ? sy : sx), h = c.h * (swap ? sx : sy);
    const cc = map(center(c));
    let n: Element = {
      ...c,
      x: cc.x - w / 2, y: cc.y - h / 2, w, h,
      rotation: norm(to.rotation + (fx !== fy ? -rel : rel)),
    };
    if ((fx && !swap) || (fy && swap)) n.flipX = !c.flipX;
    if ((fy && !swap) || (fx && swap)) n.flipY = !c.flipY;
    if (Math.abs(s - 1) > 1e-9) n = scaleStyle(n, s);
    const kids = childrenOf(c);
    if (kids) n = withChildren(n, transformChildren(c, n, kids));
    return n;
  });
}

/**
 * Lengths that are not the box (font size, letter spacing, stroke, corner radius) times `s`.
 * Not rounded: a group resize applies this on every pointer move.
 */
export function scaleStyle<T extends Element>(e: T, s: number): T {
  const el = e as Element;
  switch (el.type) {
    case 'text': {
      const st = (x: Partial<TextElement['style']>) => ({
        ...x,
        ...(x.fontSize !== undefined ? { fontSize: Math.max(1, x.fontSize * s) } : {}),
        ...(x.letterSpacing ? { letterSpacing: x.letterSpacing * s } : {}),
      });
      return { ...el, style: st(el.style), ...(el.runs ? { runs: el.runs.map((r) => (r.style ? { ...r, style: st(r.style) } : r)) } : {}) } as T;
    }
    case 'shape':
      return { ...el, radius: el.radius * s, stroke: el.stroke ? { ...el.stroke, width: el.stroke.width * s } : null } as T;
    case 'image':
    case 'video':
      return { ...el, radius: el.radius * s } as T;
    case 'path':
      return { ...el, paths: el.paths.map((p) => (p.stroke ? { ...p, stroke: { ...p.stroke, width: p.stroke.width * s } } : p)) } as T;
    default:
      return e;
  }
}

/**
 * Scale an element (and its children) about the page origin by `s`, then
 * shift by (`dx`, `dy`). Used to fit a design to a new size.
 */
export function scaleElement<T extends Element>(e: T, s: number, dx = 0, dy = 0): T {
  let n = scaleStyle({ ...e, x: e.x * s + dx, y: e.y * s + dy, w: e.w * s, h: e.h * s }, s);
  const kids = childrenOf(e);
  if (kids) n = withChildren(n, kids.map((k) => scaleElement(k, s, dx, dy)));
  return n;
}

/** Move an element and its children by (`dx`, `dy`). */
export function offsetElement<T extends Element>(e: T, dx: number, dy: number): T {
  const n = { ...e, x: e.x + dx, y: e.y + dy };
  const kids = childrenOf(e);
  return kids ? withChildren(n, kids.map((k) => offsetElement(k, dx, dy))) : n;
}

/** Topmost visible element of `els` under `p` (containers are hit through their children), with its path. */
/** Every chain (top-level element → innermost) under `p`, topmost first. */
export function hitPaths(els: readonly Element[], p: Point, pad = 0, hits: (e: Element, p: Point, pad: number) => boolean): Element[][] {
  const out: Element[][] = [];
  for (let i = els.length - 1; i >= 0; i--) {
    const e = els[i]!;
    if (e.hidden) continue;
    const c = childrenOf(e);
    if (c) for (const sub of hitPaths(c, p, pad, hits)) out.push([e, ...sub]);
    else if (hits(e, p, pad)) out.push([e]);
  }
  return out;
}

export function hitPath(els: readonly Element[], p: Point, pad = 0, hits: (e: Element, p: Point, pad: number) => boolean): Element[] | null {
  for (let i = els.length - 1; i >= 0; i--) {
    const e = els[i]!;
    if (e.hidden) continue;
    const c = childrenOf(e);
    if (c) {
      const sub = hitPath(c, p, pad, hits);
      if (sub) return [e, ...sub];
    } else if (hits(e, p, pad)) return [e];
  }
  return null;
}
