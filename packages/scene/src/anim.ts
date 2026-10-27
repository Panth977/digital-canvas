import type { Animation, AnimationDirection, AnimationType, Doc, Element, Page, TextElement } from './types.ts';
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

/**
 * The page `t` seconds after it starts. Elements with their own animation
 * start at 0; the page animation applies to the others, staggered by order.
 * After every animation ends the input elements come back unchanged (same objects).
 */
export function animateAt(doc: Doc, page: Page, t: number): Page {
  if (!hasAnimation(page)) return page;
  let changed = false;
  const elements = page.elements.map((e, i) => {
    const a = e.animation ?? page.animation;
    if (!a) return e;
    const delay = e.animation ? 0 : i * PAGE_STAGGER;
    const p = clamp01((t - delay) / animationDuration(a));
    if (p >= 1) return e;
    changed = true;
    return animateElement(doc, e, a, p);
  });
  return changed ? { ...page, elements } : page;
}
