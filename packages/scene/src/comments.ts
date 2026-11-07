/**
 * Comments on a design: where a thread is pinned and how to find that spot
 * again after the design changed.
 *
 * Comments are not part of the Doc. They live next to it (Drive keeps them
 * as the file's own comments; local stores keep a sidecar file, see
 * storage/comments.ts), so a manager and an editor can comment while the
 * other one saves the design without overwriting each other. Same model as
 * Figma (comments outside the file, pinned to a node with an offset) and
 * Frame.io (time-coded comments on video).
 *
 * An anchor is pure data: a page, optionally an element and the spot inside
 * it as a fraction of its box (so the pin follows the element when it moves
 * or resizes), the absolute page point as a fallback when the element is
 * gone, and optionally a time range inside the page (video).
 */
import { findElement } from './doc.ts';
import type { Doc } from './types.ts';

export interface CommentAnchor {
  /** The page (a scene in a video). */
  page: string;
  /** The element the comment is about, when it is about one. */
  el?: string;
  /** Spot inside the element's box, 0..1 from its top-left. */
  fx?: number;
  fy?: number;
  /** Spot on the page in page px when the comment was made (fallback when the element is gone). */
  x?: number;
  y?: number;
  /** Seconds from the page's start (video): the moment the comment is about. */
  t?: number;
  /** Seconds from the page's start: end of the range, when it is a range. */
  t1?: number;
}

/** Who wrote a comment or reply. */
export interface CommentAuthor {
  name: string;
  /** The person using the app wrote it (they may edit and delete it). */
  me?: boolean;
  photo?: string;
  email?: string;
}

export interface CommentReply {
  id: string;
  text: string;
  author: CommentAuthor;
  createdAt: string;
  updatedAt?: string;
  /** A reply that resolved or reopened the thread (its text may be empty). */
  action?: 'resolve' | 'reopen';
}

/** One comment thread. */
export interface DesignComment {
  id: string;
  text: string;
  author: CommentAuthor;
  createdAt: string;
  updatedAt: string;
  resolved: boolean;
  /** Absent = about the whole design. */
  anchor?: CommentAnchor;
  replies: CommentReply[];
}

/** Marks our anchors inside a store's opaque anchor string (Drive's `anchor`). */
const TAG = 'dc';

export function encodeAnchor(a: CommentAnchor): string {
  return JSON.stringify({ [TAG]: 1, ...a });
}

/** Reads an anchor string; anything that isn't ours (e.g. a Drive UI comment) is "whole design". */
export function decodeAnchor(s: string | undefined | null): CommentAnchor | undefined {
  if (!s) return undefined;
  try {
    const o = JSON.parse(s) as Record<string, unknown>;
    if (!o || o[TAG] !== 1 || typeof o.page !== 'string') return undefined;
    const out: CommentAnchor = { page: o.page };
    if (typeof o.el === 'string') out.el = o.el;
    for (const k of ['fx', 'fy', 'x', 'y', 't', 't1'] as const) if (typeof o[k] === 'number' && Number.isFinite(o[k])) out[k] = o[k] as number;
    return out;
  } catch {
    return undefined;
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * An anchor for a spot. `element` pins it to that element (at `point` inside
 * it, else its top-right corner, like Canva). `point` is in page px.
 * `time`/`timeEnd` are seconds from the page's start.
 */
export function makeAnchor(doc: Doc, spot: { page: string; element?: string; point?: { x: number; y: number }; time?: number; timeEnd?: number }): CommentAnchor {
  let page = spot.page;
  const a: CommentAnchor = { page };
  if (spot.element) {
    const hit = findElement(doc, spot.element);
    if (!hit) throw new Error(`no element "${spot.element}" in this design`);
    page = a.page = hit.page.id;
    a.el = hit.element.id;
    const { x, y, w, h } = hit.element;
    const p = spot.point ?? { x: x + w, y };
    a.fx = r4(w ? Math.min(1, Math.max(0, (p.x - x) / w)) : 0);
    a.fy = r4(h ? Math.min(1, Math.max(0, (p.y - y) / h)) : 0);
    a.x = r2(p.x);
    a.y = r2(p.y);
  } else if (spot.point) {
    a.x = r2(spot.point.x);
    a.y = r2(spot.point.y);
  }
  if (!doc.pages.some((p) => p.id === page)) throw new Error(`no page "${page}" in this design`);
  if (spot.time != null && Number.isFinite(spot.time)) a.t = r2(Math.max(0, spot.time));
  if (spot.timeEnd != null && Number.isFinite(spot.timeEnd) && a.t != null && spot.timeEnd > a.t) a.t1 = r2(spot.timeEnd);
  return a;
}

export interface PinPlace {
  /** The page the pin is on (absent: the page was deleted). */
  page?: string;
  /** Page px. */
  x: number;
  y: number;
  /** The element it was about no longer exists (the pin stays where it was). */
  orphan?: boolean;
}

/** Where a comment's pin goes now. Whole-design comments and deleted pages give `page` undefined. */
export function pinPlace(doc: Doc, a: CommentAnchor | undefined): PinPlace {
  if (!a) return { x: 0, y: 0 };
  const page = doc.pages.find((p) => p.id === a.page);
  if (a.el) {
    const hit = findElement(doc, a.el);
    if (hit) {
      const { x, y, w, h } = hit.element;
      return { page: hit.page.id, x: x + (a.fx ?? 1) * w, y: y + (a.fy ?? 0) * h };
    }
    return { page: page?.id, x: a.x ?? 0, y: a.y ?? 0, orphan: true };
  }
  return { page: page?.id, x: a.x ?? doc.width, y: a.y ?? 0 };
}

/** Comments in reading order: pages in order, then top to bottom, left to right; whole-design ones first. */
export function sortComments(doc: Doc, list: DesignComment[]): DesignComment[] {
  const order = new Map(doc.pages.map((p, i) => [p.id, i]));
  const key = (c: DesignComment) => {
    const p = pinPlace(doc, c.anchor);
    return [c.anchor ? (p.page ? order.get(p.page)! : 1e6) : -1, c.anchor?.t ?? 0, p.y, p.x, Date.parse(c.createdAt) || 0];
  };
  return [...list].sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! - kb[i]!;
    return 0;
  });
}

/** "1:05.2" */
export function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec < 10 ? '0' : ''}${sec.toFixed(1)}`;
}
