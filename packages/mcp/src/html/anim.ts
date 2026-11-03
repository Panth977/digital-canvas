/**
 * CSS animations ⇄ canvas animations, for set_page_html / get_page_html.
 *
 *   animation: <name> <duration> [<delay>] [infinite]
 *   --dc-direction: left|right|up|down · --dc-by: element|line|word|letter|page
 *   --dc-phase: in|out|both · --dc-intensity: 0..1 · --dc-order: forward|reverse|center|random|together
 *
 * <name> is, in order: an @keyframes in the page's CSS (carried into the
 * design as a keyframe animation), a built-in animation (rise, pop, bounceIn…),
 * or one of the user's animation plugins (by name or id). The delay becomes the
 * element's timing start. On <body>: `animation` animates the whole page,
 * `--dc-transition: slide 0.6s left` is the page transition and
 * `--dc-duration: 6s` the page length.
 */
import {
  ANIMATION_TYPES, KEYFRAMES_ANIMATION, TRANSITIONS, animationFrom, recipeToCss,
  type Animation, type AnimationPlugin, type MotionRecipe, type Page, type Transition, type TransitionType,
} from '@digital-canvas/scene';
import { words, type Decls } from './css.ts';

const secs = (v: string | undefined): number | undefined => {
  if (!v) return undefined;
  const m = v.trim().match(/^(-?[\d.]+)(ms|s)$/);
  return m ? parseFloat(m[1]!) / (m[2] === 'ms' ? 1000 : 1) : undefined;
};

const DIRS = ['left', 'right', 'up', 'down'];
const BYS = ['element', 'line', 'word', 'letter', 'page'];
const PHASES = ['in', 'out', 'both'];
const ORDERS = ['forward', 'reverse', 'center', 'random', 'together'];
const KEYWORDS = new Set(['infinite', 'normal', 'reverse', 'alternate', 'alternate-reverse', 'none', 'forwards', 'backwards', 'both', 'running', 'paused', 'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end']);

/** `animation` shorthand → longhands. */
export function expandAnimation(v: string): Decls {
  const first = v.split(',')[0]!; // one animation per element on the canvas
  const out: Decls = {};
  const times: string[] = [];
  for (const w of words(first)) {
    if (/^-?[\d.]+(ms|s)$/.test(w)) times.push(w);
    else if (w === 'infinite' || /^[\d.]+$/.test(w)) out['animation-iteration-count'] = w;
    else if (/^(cubic-bezier|steps)\(/.test(w) || KEYWORDS.has(w)) { if (['reverse', 'alternate', 'alternate-reverse'].includes(w)) out['animation-direction'] = w; }
    else out['animation-name'] = w;
  }
  if (times[0]) out['animation-duration'] = times[0];
  if (times[1]) out['animation-delay'] = times[1];
  return out;
}

export interface AnimResolver {
  keyframes: Record<string, MotionRecipe>;
  plugins: AnimationPlugin[];
  warn: (w: string) => void;
}

/** A node's CSS → animation (+ timing start from the delay). */
export function animationOf(s: Decls, r: AnimResolver): { animation?: Animation; start?: number } {
  const name = s['animation-name']?.trim();
  if (!name || name === 'none') return {};
  const more: Partial<Animation> = {};
  const dur = secs(s['animation-duration']);
  if (dur && dur > 0) more.duration = Math.min(dur, 10);
  const dir = s['--dc-direction']?.trim(); if (dir && DIRS.includes(dir)) more.direction = dir as Animation['direction'];
  const by = s['--dc-by']?.trim(); if (by && BYS.includes(by)) more.by = by as Animation['by'];
  const ph = s['--dc-phase']?.trim(); if (ph && PHASES.includes(ph)) more.phase = ph as Animation['phase'];
  const ord = s['--dc-order']?.trim(); if (ord && ORDERS.includes(ord)) more.order = ord as Animation['order'];
  const it = parseFloat(s['--dc-intensity'] ?? ''); if (Number.isFinite(it)) more.intensity = Math.max(0, Math.min(1, it));
  const loop = s['animation-iteration-count']?.trim() === 'infinite';
  const delay = secs(s['animation-delay']);
  const start = delay && delay > 0 ? delay : undefined;
  const kf = r.keyframes[name];
  if (kf) return { animation: { type: KEYFRAMES_ANIMATION, keyframes: { ...kf, name, ...(loop ? { loop: true } : {}) }, ...more }, start };
  const builtIn = ANIMATION_TYPES.find((t) => t.toLowerCase() === name.toLowerCase() && t !== 'custom' && t !== KEYFRAMES_ANIMATION);
  if (builtIn) return { animation: { type: builtIn, ...more }, start };
  const pl = r.plugins.find((p) => p.id === name || p.name.toLowerCase() === name.toLowerCase() || slug(p.name) === name.toLowerCase());
  if (pl) return { animation: animationFrom(pl, more), start };
  r.warn(`animation "${name}": no @keyframes ${name} in the CSS, no built-in animation and no animation plugin by that name (list_animations / list_plugins)`);
  return {};
}

export const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'anim';

/** The page settings <body> can carry. */
export function pageFrom(s: Decls, r: AnimResolver): Partial<Pick<Page, 'animation' | 'transition' | 'duration'>> {
  const out: Partial<Pick<Page, 'animation' | 'transition' | 'duration'>> = {};
  const a = animationOf(s, r).animation;
  if (a) out.animation = a;
  const d = secs(s['--dc-duration']);
  if (d && d > 0) out.duration = d;
  const t = s['--dc-transition'] ?? (s.transition && TRANSITIONS.some((x) => x.type === words(s.transition!)[0]) ? s.transition : undefined);
  if (t) {
    const w = words(t);
    const type = TRANSITIONS.find((x) => x.type === w[0]);
    if (!type) r.warn(`--dc-transition "${w[0]}" is not a page transition (${TRANSITIONS.map((x) => x.type).join(', ')})`);
    else {
      const tr: Transition = { type: type.type as TransitionType };
      for (const x of w.slice(1)) {
        const sec = secs(x);
        if (sec !== undefined) tr.duration = Math.max(0.1, Math.min(2.5, sec));
        else if (DIRS.includes(x)) tr.direction = x as Transition['direction'];
        else if (/^#|^rgb/.test(x)) (tr as Transition & { color?: string }).color = x;
      }
      out.transition = tr;
    }
  }
  return out;
}

// ---------------------------------------------------------------- canvas → CSS

/** CSS for an element's animation; keyframe animations add their @keyframes to `sheet`. */
export function animationCss(a: Animation | undefined, timingStart: number | undefined, sheet: Map<string, string>): Record<string, string> {
  if (!a) return {};
  let name = a.type;
  if (a.type === KEYFRAMES_ANIMATION && a.keyframes) {
    name = slug(a.keyframes.name ?? 'keyframes');
    // the same name with different frames gets a suffix
    const css = recipeToCss(name, a.keyframes);
    let n = name, i = 2;
    while (sheet.has(n) && sheet.get(n) !== recipeToCss(n, a.keyframes)) n = `${name}-${i++}`;
    name = n;
    sheet.set(name, n === slug(a.keyframes.name ?? 'keyframes') ? css : recipeToCss(name, a.keyframes));
  } else if (a.type === 'custom') return {}; // a drawn path: carried by data-spec (see sync.ts)
  const parts = [name];
  if (a.duration) parts.push(`${Math.round(a.duration * 1000) / 1000}s`);
  if (timingStart) { if (!a.duration) parts.push('0.8s'); parts.push(`${Math.round(timingStart * 1000) / 1000}s`); }
  if (a.type === KEYFRAMES_ANIMATION && a.keyframes?.loop) parts.push('infinite');
  const out: Record<string, string> = { animation: parts.join(' ') };
  if (a.direction) out['--dc-direction'] = a.direction;
  if (a.by) out['--dc-by'] = a.by;
  if (a.phase) out['--dc-phase'] = a.phase;
  if (a.order) out['--dc-order'] = a.order;
  if (a.intensity !== undefined) out['--dc-intensity'] = String(a.intensity);
  return out;
}

export function pageCss(p: Page, sheet: Map<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...animationCss(p.animation, undefined, sheet) };
  if (p.duration) out['--dc-duration'] = `${p.duration}s`;
  if (p.transition) {
    const t = p.transition as Transition & { color?: string };
    out['--dc-transition'] = [t.type, t.duration ? `${t.duration}s` : '', t.direction ?? '', t.color ?? ''].filter(Boolean).join(' ');
  }
  return out;
}

export const sheetCss = (sheet: Map<string, string>) => [...sheet.values()].join('\n');
