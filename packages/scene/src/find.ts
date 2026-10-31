import type { Doc, Element, TextElement, TextRun } from './types.ts';
import { childrenOf, withChildren } from './tree.ts';

/** Find and replace text across a design: text boxes (inside groups too) and table cells. */

export interface FindOptions {
  matchCase?: boolean;
  /** Only whole words: "art" doesn't match "start". */
  wholeWord?: boolean;
}

export interface FindMatch {
  pageId: string;
  elementId: string;
  /** Table cell, when it is in one. */
  cell?: [row: number, col: number];
  start: number;
  end: number;
  /** The text around the match, for the list. */
  before: string;
  match: string;
  after: string;
}

/** The search as a regular expression (null for an empty search). The query is literal text. */
export function findRegExp(query: string, opts: FindOptions = {}): RegExp | null {
  if (!query) return null;
  const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(opts.wholeWord ? `(?<![\\p{L}\\p{N}_])${q}(?![\\p{L}\\p{N}_])` : q, `gu${opts.matchCase ? '' : 'i'}`);
}

function hits(text: string, re: RegExp): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const m of text.matchAll(re)) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

const CONTEXT = 24;
function walkText(els: readonly Element[], f: (e: Element) => void): void {
  for (const e of els) {
    const kids = childrenOf(e);
    if (kids) walkText(kids, f);
    else f(e);
  }
}

/** Every match, in page and element order. */
export function findMatches(doc: Doc, query: string, opts: FindOptions = {}): FindMatch[] {
  const re = findRegExp(query, opts);
  if (!re) return [];
  const out: FindMatch[] = [];
  for (const page of doc.pages) {
    const note = (text: string, elementId: string, cell?: [number, number]) => {
      for (const h of hits(text, re)) {
        out.push({
          pageId: page.id, elementId, ...(cell ? { cell } : {}), start: h.start, end: h.end,
          before: text.slice(Math.max(0, h.start - CONTEXT), h.start), match: text.slice(h.start, h.end), after: text.slice(h.end, h.end + CONTEXT),
        });
      }
    };
    walkText(page.elements, (e) => {
      if (e.type === 'text') note(e.text, e.id);
      else if (e.type === 'table') e.cells.forEach((row, r) => row.forEach((c, k) => note(c.text, e.id, [r, k])));
    });
  }
  return out;
}

/** Replace `start`..`end` of the runs: the new text takes the style of the run it starts in. */
export function spliceRuns(runs: TextRun[], start: number, end: number, text: string): TextRun[] {
  const out: TextRun[] = [];
  let pos = 0, placed = false;
  for (const r of runs) {
    const a = pos, b = pos + r.text.length;
    pos = b;
    if (b <= start || a >= end) {
      if (a >= end && !placed) { out.push({ ...r, text: text + r.text }); placed = true; continue; }
      out.push(r);
      continue;
    }
    const head = r.text.slice(0, Math.max(0, start - a)), tail = r.text.slice(Math.max(0, end - a));
    const put = placed ? '' : text;
    placed = true;
    const t = head + put + tail;
    if (t) out.push({ ...r, text: t });
  }
  if (!placed) {
    const last = out[out.length - 1];
    if (last) out[out.length - 1] = { ...last, text: last.text + text };
    else out.push({ text });
  }
  return out;
}

function replaceText(text: string, spans: { start: number; end: number }[], rep: string): string {
  let t = text;
  for (const s of [...spans].reverse()) t = t.slice(0, s.start) + rep + t.slice(s.end);
  return t;
}

function replaceElement(e: TextElement, spans: { start: number; end: number }[], rep: string): TextElement {
  let runs = e.runs;
  if (runs) for (const s of [...spans].reverse()) runs = spliceRuns(runs, s.start, s.end, rep);
  return { ...e, text: replaceText(e.text, spans, rep), ...(runs ? { runs } : {}) };
}

/**
 * Replace matches (all of them, or only the one `match`) and return the new
 * design, how many were replaced, and the text boxes that changed.
 */
export function replaceMatches(doc: Doc, query: string, replacement: string, opts: FindOptions = {}, match?: FindMatch): { doc: Doc; count: number; changed: string[] } {
  const re = findRegExp(query, opts);
  if (!re) return { doc, count: 0, changed: [] };
  let count = 0;
  const changed: string[] = [];
  const pick = (text: string, id: string, cell?: [number, number]) => {
    const all = hits(text, re);
    if (!match) return all;
    if (match.elementId !== id || match.cell?.[0] !== cell?.[0] || match.cell?.[1] !== cell?.[1]) return [];
    return all.filter((h) => h.start === match.start);
  };
  const go = (els: Element[]): Element[] => {
    let touched = false;
    const next = els.map((e) => {
      const kids = childrenOf(e);
      if (kids) {
        const k = go(kids);
        if (k === kids) return e;
        touched = true;
        return withChildren(e, k);
      }
      if (e.type === 'text') {
        const s = pick(e.text, e.id);
        if (!s.length) return e;
        touched = true;
        count += s.length;
        changed.push(e.id);
        return replaceElement(e, s, replacement);
      }
      if (e.type === 'table') {
        let any = false;
        const cells = e.cells.map((row, r) => row.map((c, k) => {
          const s = pick(c.text, e.id, [r, k]);
          if (!s.length) return c;
          any = true;
          count += s.length;
          return { ...c, text: replaceText(c.text, s, replacement) };
        }));
        if (!any) return e;
        touched = true;
        return { ...e, cells };
      }
      return e;
    });
    return touched ? next : els;
  };
  let pages = doc.pages;
  for (const page of doc.pages) {
    if (match && page.id !== match.pageId) continue;
    const elements = go(page.elements);
    if (elements !== page.elements) pages = pages.map((p) => (p.id === page.id ? { ...p, elements } : p));
  }
  return { doc: pages === doc.pages ? doc : { ...doc, pages }, count, changed };
}
