import type { Animation, AnimationDirection, AnimationType, Doc, Element, Page, TextElement, Transition, TransitionType } from './types.ts';
import { offsetElement, scaleElement } from './tree.ts';

/**
 * Canva's basic animations, as a pure function of time: `animateAt` returns
 * the page as it looks `t` seconds after it starts. The renderer draws that
 * page like any other, so the preview, MP4 and GIF exports share one motion.
 * Animations play "in" (enter) at the start of the page.
 */

export const ANIMATIONS: readonly { type: AnimationType; label: string; directional?: boolean }[] = [
  { type: 'rise', label: 'Rise' },
  { type: 'pan', label: 'Pan', directional: true },
  { type: 'fade', label: 'Fade' },
  { type: 'pop', label: 'Pop' },
  { type: 'wipe', label: 'Wipe', directional: true },
  { type: 'typewriter', label: 'Typewriter' },
  { type: 'baseline', label: 'Baseline' },
  { type: 'drift', label: 'Drift', directional: true },
  { type: 'tumble', label: 'Tumble' },
];

export const DEFAULT_ANIMATION_DURATION = 0.8;
/** Delay between elements when the whole page is animated (Canva staggers them). */
export const PAGE_STAGGER = 0.12;

export function animationLabel(a: Animation | undefined | null): string {
  if (!a) return 'None';
  return ANIMATIONS.find((x) => x.type === a.type)?.label ?? 'None';
}

export const animationDuration = (a: Animation): number => (a.duration && a.duration > 0 ? a.duration : DEFAULT_ANIMATION_DURATION);

/** Seconds until every element of the page has finished animating (0 = nothing animates). */
export function animationEnd(page: Page): number {
  let end = 0;
  page.elements.forEach((e, i) => {
    const a = e.animation ?? page.animation;
    if (!a) return;
    end = Math.max(end, (e.animation ? 0 : i * PAGE_STAGGER) + animationDuration(a));
  });
  return end;
}

/** Does anything on the page (or the page itself) animate? */
export const hasAnimation = (page: Page): boolean => !!page.animation || page.elements.some((e) => !!e.animation);

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (p: number) => 1 - (1 - p) ** 3;
const easeOutBack = (p: number) => { const c = 1.70158; return 1 + (c + 1) * (p - 1) ** 3 + c * (p - 1) ** 2; };

/** Unit vector pointing where the element comes FROM. */
function from(dir: AnimationDirection | undefined, fallback: AnimationDirection): { x: number; y: number } {
  switch (dir ?? fallback) {
    case 'left': return { x: -1, y: 0 };
    case 'right': return { x: 1, y: 0 };
    case 'up': return { x: 0, y: -1 };
    default: return { x: 0, y: 1 };
  }
}

const fade = <T extends Element>(e: T, k: number): T => ({ ...e, opacity: e.opacity * clamp01(k) });

function scaleAbout<T extends Element>(e: T, s: number): T {
  const s2 = Math.max(0.001, s);
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  return scaleElement(e, s2, cx * (1 - s2), cy * (1 - s2));
}

/** The first `n` characters of a text element (runs cut to match). */
export function typeText(e: TextElement, n: number): TextElement {
  if (n >= e.text.length) return e;
  const text = e.text.slice(0, Math.max(0, n));
  if (!e.runs) return { ...e, text };
  const runs: NonNullable<TextElement['runs']> = [];
  let left = n;
  for (const r of e.runs) {
    if (left <= 0) break;
    runs.push(r.text.length <= left ? r : { ...r, text: r.text.slice(0, left) });
    left -= r.text.length;
  }
  return { ...e, text, runs };
}

/** One element at progress `p` (0..1, linear) of animation `a`. */
function animateElement(doc: Doc, e: Element, a: Animation, p: number): Element {
  const k = easeOut(p);
  switch (a.type) {
    case 'fade':
    case 'wipe': // no clipping in the renderer: a wipe reads as a short slide-in reveal
      if (a.type === 'wipe') {
        const d = from(a.direction, 'left');
        const dist = Math.min(e.w, e.h) * 0.15;
        return fade(offsetElement(e, d.x * dist * (1 - k), d.y * dist * (1 - k)), k);
      }
      return fade(e, k);
    case 'rise': {
      const dist = Math.min(doc.height * 0.1, Math.max(e.h * 0.5, 20));
      return fade(offsetElement(e, 0, dist * (1 - k)), k);
    }
    case 'baseline': {
      const dist = e.h * 0.6;
      return fade(offsetElement(e, 0, dist * (1 - k)), Math.min(1, p * 2));
    }
    case 'pan': {
      const d = from(a.direction, 'left');
      const dist = (d.x ? doc.width : doc.height) * 0.15;
      return fade(offsetElement(e, d.x * dist * (1 - k), d.y * dist * (1 - k)), k);
    }
    case 'drift': {
      const d = from(a.direction, 'left');
      const dist = (d.x ? doc.width : doc.height) * 0.06;
      const lin = p; // slow, even movement
      return fade(offsetElement(e, d.x * dist * (1 - lin), d.y * dist * (1 - lin)), Math.min(1, p * 1.5));
    }
    case 'pop': {
      const s = easeOutBack(p);
      return fade(scaleAbout(e, s), Math.min(1, p * 3));
    }
    case 'tumble': {
      const s = 0.6 + 0.4 * k;
      const n = scaleAbout(e, s);
      return fade({ ...n, rotation: (((e.rotation - 90 * (1 - k)) % 360) + 360) % 360 }, k);
    }
    case 'typewriter':
      if (e.type === 'text') return typeText(e, Math.round(e.text.length * p));
      return fade(e, k);
    default:
      return e;
  }
}

/** Is the element on screen `t` seconds into its page (its `timing` window)? */
export function shownAt(e: Element, t: number): boolean {
  const w = e.timing;
  if (!w) return true;
  return t >= (w.start ?? 0) && (w.end === undefined || t < w.end);
}

const anyIn = (els: Element[], f: (e: Element) => boolean): boolean =>
  els.some((e) => f(e) || (e.type === 'group' && anyIn(e.children, f)));
const timed = (page: Page) => anyIn(page.elements, (e) => !!e.timing);

/**
 * The page `t` seconds after it starts. Elements with their own animation
 * start at 0 (or when their `timing` window opens); the page animation applies
 * to the others, staggered by order. Elements outside their `timing` window are
 * left out. After every animation ends the input elements come back unchanged (same objects).
 */
export function animateAt(doc: Doc, page: Page, t: number): Page {
  if (!hasAnimation(page) && !anyIn(page.elements, (e) => !!e.animation) && !timed(page)) return page;
  let changed = false;
  // Elements inside a group keep their own animation and timing (Canva animates them one by one);
  // a group with its own animation moves as one.
  const list = (els: Element[], order: (i: number) => number): Element[] => {
    const out: Element[] = [];
    els.forEach((e, i) => {
      if (!shownAt(e, t)) { changed = true; return; }
      if (e.type === 'group' && !e.animation) {
        const children = list(e.children, () => order(i));
        out.push(children === e.children ? e : { ...e, children });
        return;
      }
      const a = e.animation ?? page.animation;
      if (!a) { out.push(e); return; }
      const delay = (e.timing?.start ?? 0) + (e.animation ? 0 : order(i) * PAGE_STAGGER);
      const p = clamp01((t - delay) / animationDuration(a));
      if (p >= 1) { out.push(e); return; }
      changed = true;
      out.push(animateElement(doc, e, a, p));
    });
    return out.length === els.length && out.every((e, k) => e === els[k]) ? els : out;
  };
  const elements = list(page.elements, (i) => i);
  return changed ? { ...page, elements } : page;
}

// ---- page transitions (video) ----

export const TRANSITIONS: readonly { type: TransitionType; label: string; directional?: boolean }[] = [
  { type: 'dissolve', label: 'Dissolve' },
  { type: 'fade', label: 'Fade through black' },
  { type: 'slide', label: 'Slide', directional: true },
  { type: 'wipe', label: 'Wipe', directional: true },
  { type: 'zoom', label: 'Zoom' },
];

export const DEFAULT_TRANSITION_DURATION = 0.5;
export const transitionDuration = (tr: Transition): number => (tr.duration && tr.duration > 0 ? tr.duration : DEFAULT_TRANSITION_DURATION);

/** What a video frame shows at time `t`: the page, and while a transition plays, the page before it. */
export interface FrameAt {
  page: Page;
  /** Seconds into `page`. */
  local: number;
  /** While a transition plays: the previous page (held at its last moment) and how far the transition is (0..1). */
  prev?: { page: Page; local: number };
  progress?: number;
  transition?: Transition;
}

/**
 * The frame at `t` seconds on the timeline. A page's transition plays over its
 * own first seconds, on top of the previous page held still at its end, so the
 * total length never changes.
 */
export function frameAt(doc: Doc, t: number): FrameAt {
  const pages = doc.pages.filter((p) => !p.hidden);
  let start = 0;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    const d = p.duration && p.duration > 0 ? p.duration : 5;
    if (t < start + d || i === pages.length - 1) {
      const local = Math.max(0, Math.min(d, t - start));
      const tr = p.transition;
      if (tr && i > 0) {
        const len = Math.min(transitionDuration(tr), d);
        if (local < len) {
          const before = pages[i - 1]!;
          const bd = before.duration && before.duration > 0 ? before.duration : 5;
          return { page: p, local, prev: { page: before, local: bd }, progress: local / len, transition: tr };
        }
      }
      return { page: p, local };
    }
    start += d;
  }
  return { page: doc.pages[0]!, local: 0 };
}

/**
 * How to draw a transition at `progress` (0..1) on a `w`×`h` page: the previous
 * page and the new page each get an offset, a scale (about the centre), an
 * opacity and a clip rectangle (null = whole page), drawn previous first.
 */
export interface TransitionLayer { dx: number; dy: number; scale: number; alpha: number; clip: { x: number; y: number; w: number; h: number } | null }
export function transitionLayers(tr: Transition, progress: number, w: number, h: number): { prev: TransitionLayer; next: TransitionLayer; black?: number } {
  const p = clamp01(progress);
  const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // ease in-out
  const full: TransitionLayer = { dx: 0, dy: 0, scale: 1, alpha: 1, clip: null };
  const dir = tr.direction ?? 'right';
  // the vector pointing where the new page comes from
  const v = dir === 'left' ? [-1, 0] : dir === 'right' ? [1, 0] : dir === 'up' ? [0, -1] : [0, 1];
  switch (tr.type) {
    case 'dissolve':
      return { prev: full, next: { ...full, alpha: e } };
    case 'fade':
      // through black: the old page fades out, then the new one fades in
      return p < 0.5 ? { prev: { ...full, alpha: 1 - 2 * p }, next: { ...full, alpha: 0 }, black: 1 } : { prev: { ...full, alpha: 0 }, next: { ...full, alpha: 2 * p - 1 }, black: 1 };
    case 'slide':
      return { prev: { ...full, dx: -v[0]! * w * e, dy: -v[1]! * h * e }, next: { ...full, dx: v[0]! * w * (1 - e), dy: v[1]! * h * (1 - e) } };
    case 'wipe': {
      const cw = w * e, ch = h * e;
      const clip = dir === 'right' ? { x: w - cw, y: 0, w: cw, h } : dir === 'left' ? { x: 0, y: 0, w: cw, h } : dir === 'down' ? { x: 0, y: h - ch, w, h: ch } : { x: 0, y: 0, w, h: ch };
      return { prev: full, next: { ...full, clip } };
    }
    case 'zoom':
      return { prev: { ...full, scale: 1 + 0.15 * e, alpha: 1 - e }, next: { ...full, scale: 0.85 + 0.15 * e, alpha: e } };
  }
}
