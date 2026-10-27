/**
 * Canva's "Change all": a colour swapped everywhere it is used in the design
 * (text and its runs, shape fills and borders, lines, graphics, tables,
 * charts, gradients, page backgrounds). Pure: returns a new Doc.
 */
import { mapLists, walk, type Doc, type Element, type Fill, type Page } from '@digital-canvas/scene';

const same = (a: string | undefined, b: string) => !!a && a.slice(0, 7).toLowerCase() === b.slice(0, 7).toLowerCase();

/** Every colour an element uses (6-digit hex, lowercase). */
export function colorsOfElement(e: Element): string[] {
  const out: string[] = [];
  const add = (c: string | undefined) => { if (c && /^#[0-9a-f]{6}/i.test(c)) out.push(c.slice(0, 7).toLowerCase()); };
  const fill = (f: Fill | null | undefined) => { if (f?.type === 'solid') add(f.color); else if (f) f.stops.forEach((s) => add(s.color)); };
  if (e.type === 'text') { add(e.style.color); e.runs?.forEach((r) => add(r.style?.color)); e.gradient?.stops.forEach((s) => add(s.color)); }
  else if (e.type === 'shape') { fill(e.fill); add(e.stroke?.color); }
  else if (e.type === 'line') add(e.stroke.color);
  else if (e.type === 'path') e.paths.forEach((p) => { fill(p.fill); add(p.stroke?.color); });
  else if (e.type === 'table') { add(e.style.color); add(e.border?.color); e.cells.forEach((row) => row.forEach((c) => { add(c?.fill); add(c?.style?.color); })); }
  else if (e.type === 'chart') { add(e.style.color); e.colors.forEach(add); }
  return out;
}

/** How many things use `hex`: elements (inside groups too) and page backgrounds. */
export function countUses(doc: Doc, hex: string): number {
  let n = 0;
  for (const p of doc.pages) {
    if (pageUses(p, hex)) n++;
    for (const e of walk(p.elements)) if (colorsOfElement(e).includes(hex.slice(0, 7).toLowerCase())) n++;
  }
  return n;
}

const pageUses = (p: Page, hex: string) => (p.background.type === 'solid' ? same(p.background.color, hex) : p.background.stops.some((s) => same(s.color, hex)));

export function recolorDoc(doc: Doc, from: string, to: string): Doc {
  const c = (v: string): string => (same(v, from) ? to.slice(0, 7) + v.slice(7) : v);
  const co = <T extends string | undefined>(v: T): T => (v ? (c(v) as T) : v);
  const fill = <F extends Fill | null | undefined>(f: F): F => {
    if (!f) return f;
    return (f.type === 'solid' ? { ...f, color: c(f.color) } : { ...f, stops: f.stops.map((s) => ({ ...s, color: c(s.color) })) }) as F;
  };
  const el = (e: Element): Element => {
    if (!colorsOfElement(e).includes(from.slice(0, 7).toLowerCase())) return e;
    switch (e.type) {
      case 'text': return { ...e, style: { ...e.style, color: c(e.style.color) }, ...(e.runs ? { runs: e.runs.map((r) => (r.style?.color ? { ...r, style: { ...r.style, color: c(r.style.color) } } : r)) } : {}), ...(e.gradient ? { gradient: fill(e.gradient) } : {}) };
      case 'shape': return { ...e, fill: fill(e.fill), stroke: e.stroke ? { ...e.stroke, color: c(e.stroke.color) } : null };
      case 'line': return { ...e, stroke: { ...e.stroke, color: c(e.stroke.color) } };
      case 'path': return { ...e, paths: e.paths.map((p) => ({ ...p, fill: fill(p.fill), stroke: p.stroke ? { ...p.stroke, color: c(p.stroke.color) } : p.stroke })) };
      case 'table': return { ...e, style: { ...e.style, color: c(e.style.color) }, border: e.border ? { ...e.border, color: c(e.border.color) } : e.border,
        cells: e.cells.map((row) => row.map((x) => (x ? { ...x, ...(x.fill ? { fill: co(x.fill) } : {}), ...(x.style?.color ? { style: { ...x.style, color: c(x.style.color) } } : {}) } : x))) };
      case 'chart': return { ...e, style: { ...e.style, color: c(e.style.color) }, colors: e.colors.map(c) };
      default: return e;
    }
  };
  return {
    ...doc,
    pages: doc.pages.map((p) => ({
      ...p,
      background: pageUses(p, from) ? fill(p.background) : p.background,
      elements: mapLists(p.elements, (list) => {
        const next = list.map(el);
        return next.some((x, i) => x !== list[i]) ? next : list;
      }),
    })),
  };
}
