import type { Doc, Element, Guide, Unit } from './types.ts';
import { createDoc, findElement, updateElements, updatePage } from './doc.ts';
import { aabb, type Rect } from './geometry.ts';
import { scaleElement } from './tree.ts';
import { toPx } from './units.ts';

/**
 * Layout tools: distribute, tidy up, ruler guides, safe margins and
 * "resize a copy" (fit a design to another size).
 */

function boxes(doc: Doc, ids: string[]): { id: string; b: Rect }[] {
  const out: { id: string; b: Rect }[] = [];
  for (const id of ids) {
    const hit = findElement(doc, id);
    if (hit && !hit.element.locked) out.push({ id, b: aabb(hit.element) });
  }
  return out;
}

/** Move each element by its own (dx, dy). Groups carry their children. */
function moveBy(doc: Doc, moves: Map<string, { dx: number; dy: number }>): Doc {
  return updateElements(doc, [...moves.keys()], (e) => {
    const m = moves.get(e.id)!;
    return { x: e.x + m.dx, y: e.y + m.dy };
  });
}

/**
 * Equal space between three or more elements along `axis`; the first and
 * last (by position) stay where they are.
 */
export function distribute(doc: Doc, ids: string[], axis: 'x' | 'y'): Doc {
  const els = boxes(doc, ids);
  if (els.length < 3) return doc;
  const a = (r: Rect) => (axis === 'x' ? r.x : r.y), s = (r: Rect) => (axis === 'x' ? r.w : r.h);
  els.sort((p, q) => a(p.b) + s(p.b) / 2 - (a(q.b) + s(q.b) / 2));
  const first = els[0]!.b, last = els[els.length - 1]!.b;
  const span = a(last) + s(last) - a(first);
  const gap = (span - els.reduce((t, e) => t + s(e.b), 0)) / (els.length - 1);
  const moves = new Map<string, { dx: number; dy: number }>();
  let pos = a(first);
  for (const e of els) {
    const d = pos - a(e.b);
    moves.set(e.id, axis === 'x' ? { dx: d, dy: 0 } : { dx: 0, dy: d });
    pos += s(e.b) + gap;
  }
  return moveBy(doc, moves);
}

/**
 * Tidy up (Canva's name): elements roughly in a row become an evenly spaced
 * row (centres aligned), roughly in a column an even column, anything else a
 * grid of equal cells. Order follows the current positions.
 */
export function tidyUp(doc: Doc, ids: string[]): Doc {
  const els = boxes(doc, ids);
  if (els.length < 2) return doc;
  const cx = (r: Rect) => r.x + r.w / 2, cy = (r: Rect) => r.y + r.h / 2;
  const left = Math.min(...els.map((e) => e.b.x)), top = Math.min(...els.map((e) => e.b.y));
  const meanMin = els.reduce((t, e) => t + Math.min(e.b.w, e.b.h), 0) / els.length;
  const fallbackGap = Math.max(8, Math.round(meanMin * 0.1));
  // average of the positive gaps between neighbours, else a tenth of the element size
  const avgGap = (sorted: Rect[], axis: 'x' | 'y') => {
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const p = sorted[i - 1]!, q = sorted[i]!;
      const g = axis === 'x' ? q.x - (p.x + p.w) : q.y - (p.y + p.h);
      if (g > 0) gaps.push(g);
    }
    return gaps.length ? gaps.reduce((t, g) => t + g, 0) / gaps.length : fallbackGap;
  };
  const moves = new Map<string, { dx: number; dy: number }>();
  const inRow = Math.max(...els.map((e) => e.b.y)) < Math.min(...els.map((e) => e.b.y + e.b.h));
  const inCol = Math.max(...els.map((e) => e.b.x)) < Math.min(...els.map((e) => e.b.x + e.b.w));
  if (inRow || inCol) {
    const axis = inRow ? 'x' : 'y';
    els.sort((p, q) => (axis === 'x' ? cx(p.b) - cx(q.b) : cy(p.b) - cy(q.b)));
    const gap = avgGap(els.map((e) => e.b), axis);
    const mid = els.reduce((t, e) => t + (axis === 'x' ? cy(e.b) : cx(e.b)), 0) / els.length;
    let pos = axis === 'x' ? left : top;
    for (const { id, b } of els) {
      if (axis === 'x') { moves.set(id, { dx: pos - b.x, dy: mid - cy(b) }); pos += b.w + gap; }
      else { moves.set(id, { dx: mid - cx(b), dy: pos - b.y }); pos += b.h + gap; }
    }
    return moveBy(doc, moves);
  }
  const cols = Math.ceil(Math.sqrt(els.length));
  els.sort((p, q) => cy(p.b) - cy(q.b));
  const rows: (typeof els)[] = [];
  for (let i = 0; i < els.length; i += cols) rows.push(els.slice(i, i + cols).sort((p, q) => cx(p.b) - cx(q.b)));
  const cw = Math.max(...els.map((e) => e.b.w)), ch = Math.max(...els.map((e) => e.b.h));
  rows.forEach((row, r) => row.forEach(({ id, b }, c) => {
    const x = left + c * (cw + fallbackGap) + (cw - b.w) / 2;
    const y = top + r * (ch + fallbackGap) + (ch - b.h) / 2;
    moves.set(id, { dx: x - b.x, dy: y - b.y });
  }));
  return moveBy(doc, moves);
}

// ---- guides ----

export function addGuide(doc: Doc, pageId: string, guide: Guide): { doc: Doc; index: number } {
  const page = doc.pages.find((p) => p.id === pageId);
  const guides = [...(page?.guides ?? []), guide];
  return { doc: updatePage(doc, pageId, { guides }), index: guides.length - 1 };
}

export function moveGuide(doc: Doc, pageId: string, index: number, pos: number): Doc {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page?.guides?.[index]) return doc;
  return updatePage(doc, pageId, { guides: page.guides.map((g, i) => (i === index ? { ...g, pos } : g)) });
}

export function removeGuide(doc: Doc, pageId: string, index: number): Doc {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page?.guides?.[index]) return doc;
  const guides = page.guides.filter((_, i) => i !== index);
  return updatePage(doc, pageId, { guides: guides.length ? guides : undefined });
}

/** Inset of the safe-area lines: 5 mm on print designs, 5% of the short side on screen designs. */
export function safeMargin(doc: Pick<Doc, 'width' | 'height' | 'bleed'>): number {
  return doc.bleed > 0 ? toPx(5, 'mm') : Math.round(Math.min(doc.width, doc.height) * 0.05);
}

// ---- resize a copy ----

export interface ResizeTarget {
  width: number;
  height: number;
  unit?: Unit;
  print?: boolean;
  title?: string;
}

/** Does `e` cover the whole page (a background picture or panel)? */
const coversPage = (e: Element, w: number, h: number) => {
  const b = aabb(e);
  const tol = Math.min(w, h) * 0.01;
  return e.type !== 'text' && b.x <= tol && b.y <= tol && b.x + b.w >= w - tol && b.y + b.h >= h - tol;
};

/**
 * A copy of `doc` at another size (Canva's "Resize"). Everything is scaled by
 * the smaller ratio and centred, so the layout keeps its proportions; font
 * sizes, strokes and corners scale too. Elements covering the whole page
 * (backgrounds) scale by the larger ratio so they still cover it. New ids for
 * the design; elements keep theirs (they live in another file).
 */
export function resizeDoc(doc: Doc, target: ResizeTarget): Doc {
  const base = createDoc({ width: target.width, height: target.height, unit: target.unit ?? 'px', print: target.print, title: target.title ?? doc.title });
  const W = base.width, H = base.height;
  const fit = Math.min(W / doc.width, H / doc.height), cover = Math.max(W / doc.width, H / doc.height);
  const place = (s: number) => ({ s, dx: (W - doc.width * s) / 2, dy: (H - doc.height * s) / 2 });
  const f = place(fit), c = place(cover);
  return {
    ...base,
    pages: doc.pages.map((p) => ({
      ...p,
      elements: p.elements.map((e) => {
        const t = coversPage(e, doc.width, doc.height) ? c : f;
        return scaleElement(e, t.s, t.dx, t.dy);
      }),
      ...(p.guides ? { guides: p.guides.map((g) => ({ ...g, pos: g.pos * fit + (g.axis === 'x' ? f.dx : f.dy) })) } : {}),
    })),
    assets: doc.assets,
    ...(doc.fonts ? { fonts: doc.fonts } : {}),
    ...(doc.audio ? { audio: doc.audio } : {}),
  };
}
