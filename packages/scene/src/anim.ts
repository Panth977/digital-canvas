import type { Animation, AnimationDirection, AnimationOrder, AnimationUnit, Color, Doc, Element, Fx, GroupElement, LiveFx, MotionPath, Page, TextElement, Transition, TransitionType } from './types.ts';
import { offsetElement, scaleElement } from './tree.ts';
import { backOut, bounceOut, cubicBezier, cubicIn, cubicInOut, cubicOut, expoOut, quadInOut, sineInOut } from './ease.ts';
import MOTION from './motion-data.json' with { type: 'json' };

/**
 * Animations, as a pure function of time: `animateAt` returns the page as it
 * looks `t` seconds after it starts. The renderer draws that page like any
 * other, so the preview, presentation, MP4, GIF and MCP share one motion.
 *
 * Three kinds of recipe, all ending in an `Fx` the renderer applies:
 * - keyframes from Animate.css 4.1.1 and magic.css (MIT), as data
 *   (`motion-data.json`, written by tools/catalogs/motion.ts);
 * - recipes below, named after Canva's and written here;
 * - the nine first animations, whose frames stay as they were for old designs.
 * Every recipe gets its progress 0 → 1; Out plays it backwards.
 */

export type AnimationGroup = 'basic' | 'exaggerate' | 'photo' | 'text' | 'writing' | 'ambient';
export const ANIMATION_GROUPS: readonly { id: AnimationGroup; label: string }[] = [
  { id: 'basic', label: 'Basic' }, { id: 'exaggerate', label: 'Exaggerate' }, { id: 'photo', label: 'Photo motion' },
  { id: 'text', label: 'Text' }, { id: 'writing', label: 'Writing' }, { id: 'ambient', label: 'Ambient' },
];

export interface AnimationInfo {
  type: string;
  label: string;
  /** Shown in these sets of the panel. */
  groups: readonly AnimationGroup[];
  directional?: boolean;
  /** Only these directions (keyframe families). */
  dirs?: readonly AnimationDirection[];
  /** Plays over and over while the element shows. */
  loop?: boolean;
  /** One slow play across the whole time the element shows. */
  span?: boolean;
  /** The recipe is a way out: it defaults to Out. */
  exit?: boolean;
  /** Photos and videos only. */
  photo?: boolean;
  /** Default unit in the Text and Writing sets. */
  by?: 'line' | 'word' | 'letter';
  /** Default seconds. */
  dur?: number;
  /** Where the recipe comes from. */
  src: 'animate.css' | 'magic.css' | 'canva-name' | 'user';
}

type Dirs = Partial<Record<AnimationDirection, string>>;
/** A keyframe recipe: `key` in motion-data.json, or one per direction. */
const KF: Record<string, { key?: string; dirs?: Dirs }> = {
  bounceIn: { key: 'bounceIn', dirs: { up: 'bounceInDown', down: 'bounceInUp', left: 'bounceInLeft', right: 'bounceInRight' } },
  backIn: { dirs: { up: 'backInDown', down: 'backInUp', left: 'backInLeft', right: 'backInRight' } },
  flyIn: { dirs: { up: 'fadeInDownBig', down: 'fadeInUpBig', left: 'fadeInLeftBig', right: 'fadeInRightBig' } },
  fadeSlide: { dirs: { up: 'fadeInDown', down: 'fadeInUp', left: 'fadeInLeft', right: 'fadeInRight' } },
  flipX: { key: 'flipInX' },
  flipY: { key: 'flipInY' },
  lightSpeed: { dirs: { left: 'lightSpeedInLeft', right: 'lightSpeedInRight' } },
  spinIn: { key: 'rotateIn', dirs: { up: 'rotateInDownLeft', down: 'rotateInUpRight', left: 'rotateInUpLeft', right: 'rotateInDownRight' } },
  rollIn: { key: 'rollIn' },
  jack: { key: 'jackInTheBox' },
  zoomIn: { key: 'zoomIn', dirs: { up: 'zoomInDown', down: 'zoomInUp', left: 'zoomInLeft', right: 'zoomInRight' } },
  slideIn: { dirs: { up: 'slideInDown', down: 'slideInUp', left: 'slideInLeft', right: 'slideInRight' } },
  hinge: { key: 'hinge' },
  puff: { key: 'm_puffIn' },
  vanish: { key: 'm_vanishIn' },
  boing: { key: 'm_boingInUp' },
  twister: { dirs: { up: 'm_twisterInDown', down: 'm_twisterInUp' } },
  foolish: { key: 'm_foolishIn' },
  swash: { key: 'm_swashIn' },
  space: { dirs: { up: 'm_spaceInDown', down: 'm_spaceInUp', left: 'm_spaceInLeft', right: 'm_spaceInRight' } },
  tin: { dirs: { up: 'm_tinUpIn', down: 'm_tinDownIn', left: 'm_tinLeftIn', right: 'm_tinRightIn' } },
  swap: { key: 'm_swap' },
  magic: { key: 'm_magic' },
  hole: { key: 'm_holeOut' },
  bomb: { dirs: { left: 'm_bombLeftOut', right: 'm_bombRightOut' } },
  // looped attention seekers
  pulse: { key: 'pulse' }, heartBeat: { key: 'heartBeat' }, flash: { key: 'flash' }, rubberBand: { key: 'rubberBand' },
  shake: { key: 'shakeX' }, tremble: { key: 'shakeY' }, headShake: { key: 'headShake' }, swing: { key: 'swing' },
  tada: { key: 'tada' }, wobble: { key: 'wobble' }, jello: { key: 'jello' }, hop: { key: 'bounce' },
};

const a = (type: string, label: string, groups: AnimationGroup[], src: AnimationInfo['src'], more: Partial<AnimationInfo> = {}): AnimationInfo => {
  const dirs = KF[type]?.dirs ? (Object.keys(KF[type]!.dirs!) as AnimationDirection[]) : undefined;
  return { type, label, groups, src, ...(dirs ? { directional: true, dirs } : {}), ...more };
};
const NAMED = 'canva-name' as const, CSS = 'animate.css' as const, MAGIC = 'magic.css' as const;

export const ANIMATIONS: readonly AnimationInfo[] = [
  // the first nine keep their place: old designs and MCP callers know them
  a('rise', 'Rise', ['basic', 'text'], NAMED, { by: 'word' }),
  a('pan', 'Pan', ['basic', 'text'], NAMED, { directional: true, by: 'word' }),
  a('fade', 'Fade', ['basic', 'text'], NAMED, { by: 'letter' }),
  a('pop', 'Pop', ['basic', 'text'], NAMED, { by: 'word' }),
  a('wipe', 'Wipe', ['basic'], NAMED, { directional: true }),
  a('typewriter', 'Typewriter', ['text', 'writing'], NAMED),
  a('baseline', 'Baseline', ['basic', 'text'], NAMED, { by: 'line' }),
  a('drift', 'Drift', ['basic', 'text'], NAMED, { directional: true, by: 'word', dur: 1.4 }),
  a('tumble', 'Tumble', ['basic', 'text'], NAMED, { by: 'word' }),
  // Basic
  a('stomp', 'Stomp', ['basic', 'text'], NAMED, { by: 'word' }),
  a('block', 'Block', ['basic', 'text'], NAMED, { directional: true, by: 'line', dur: 1 }),
  a('breathe', 'Breathe', ['basic'], NAMED, { dur: 1.4 }),
  a('scale', 'Scale', ['basic'], NAMED),
  a('slide', 'Slide', ['basic'], NAMED, { directional: true }),
  // Exaggerate
  a('neon', 'Neon', ['exaggerate', 'text'], NAMED, { by: 'letter', dur: 1.2 }),
  a('scrapbook', 'Scrapbook', ['exaggerate', 'text'], NAMED, { by: 'word' }),
  a('tectonic', 'Tectonic', ['exaggerate', 'text'], NAMED, { by: 'line', dur: 1 }),
  a('jelly', 'Jelly', ['exaggerate'], NAMED, { dur: 1 }),
  a('bounceIn', 'Bounce in', ['exaggerate'], CSS, { dur: 1 }),
  a('backIn', 'Back in', ['exaggerate'], CSS, { dur: 1 }),
  a('flyIn', 'Fly in', ['exaggerate'], CSS, { dur: 1 }),
  a('fadeSlide', 'Fade slide', ['basic'], CSS),
  a('flipX', 'Flip', ['exaggerate'], CSS, { dur: 1 }),
  a('flipY', 'Turn', ['exaggerate'], CSS, { dur: 1 }),
  a('lightSpeed', 'Light speed', ['exaggerate'], CSS),
  a('spinIn', 'Spin in', ['exaggerate'], CSS, { dur: 1 }),
  a('rollIn', 'Roll in', ['exaggerate'], CSS, { dur: 1 }),
  a('jack', 'Jack in the box', ['exaggerate'], CSS, { dur: 1 }),
  a('zoomIn', 'Zoom in', ['exaggerate'], CSS),
  a('slideIn', 'Fly past', ['exaggerate'], CSS),
  a('hinge', 'Hinge', ['exaggerate'], CSS, { exit: true, dur: 2 }),
  a('puff', 'Puff', ['exaggerate'], MAGIC),
  a('vanish', 'Vanish', ['exaggerate'], MAGIC),
  a('boing', 'Boing', ['exaggerate'], MAGIC),
  a('twister', 'Twister', ['exaggerate'], MAGIC, { dur: 1 }),
  a('foolish', 'Foolish', ['exaggerate'], MAGIC, { dur: 1.4 }),
  a('swash', 'Swash', ['exaggerate'], MAGIC),
  a('space', 'Space', ['exaggerate'], MAGIC, { dur: 1 }),
  a('tin', 'Tin', ['exaggerate'], MAGIC, { dur: 1 }),
  a('swap', 'Swap', ['exaggerate'], MAGIC),
  a('magic', 'Magic', ['exaggerate'], MAGIC, { exit: true, dur: 1 }),
  a('hole', 'Black hole', ['exaggerate'], MAGIC, { exit: true }),
  a('bomb', 'Bomb', ['exaggerate'], MAGIC, { exit: true }),
  // Photo motion
  a('photoZoomIn', 'Photo zoom in', ['photo'], NAMED, { photo: true, span: true }),
  a('photoZoomOut', 'Photo zoom out', ['photo'], NAMED, { photo: true, span: true }),
  a('photoPan', 'Photo pan', ['photo'], NAMED, { photo: true, span: true, directional: true }),
  a('kenBurns', 'Ken Burns', ['photo'], NAMED, { photo: true, span: true }),
  a('photoRise', 'Photo rise', ['photo'], NAMED, { photo: true, dur: 1.2 }),
  a('photoFlow', 'Photo flow', ['photo'], NAMED, { photo: true, directional: true, dur: 1.2 }),
  a('photoTumble', 'Photo tumble', ['photo'], NAMED, { photo: true, dur: 1.2 }),
  // Text, per word or letter
  a('ascend', 'Ascend', ['text', 'writing'], NAMED, { by: 'line' }),
  a('shift', 'Shift', ['text', 'writing'], NAMED, { directional: true, by: 'letter' }),
  a('merge', 'Merge', ['text'], NAMED, { by: 'letter', dur: 1 }),
  a('burst', 'Burst', ['text', 'writing'], NAMED, { by: 'letter', dur: 1 }),
  a('bounce', 'Bounce', ['text'], NAMED, { by: 'letter', dur: 1.2 }),
  a('roll', 'Roll', ['text', 'writing'], NAMED, { by: 'letter', dur: 1 }),
  a('skate', 'Skate', ['text'], NAMED, { directional: true, by: 'word', dur: 1 }),
  a('spread', 'Spread', ['text'], NAMED, { by: 'letter', dur: 1 }),
  a('clarify', 'Clarify', ['text'], NAMED, { by: 'word', dur: 1 }),
  // Writing
  a('write', 'Write', ['writing'], NAMED, { by: 'letter', dur: 1.6 }),
  a('marker', 'Marker', ['writing'], NAMED, { by: 'line', dur: 1.2 }),
  // Ambient
  a('pulse', 'Pulse', ['ambient'], CSS, { loop: true, dur: 1 }),
  a('wiggle', 'Wiggle', ['ambient'], NAMED, { loop: true, dur: 0.6 }),
  a('flicker', 'Flicker', ['ambient'], NAMED, { loop: true, dur: 1.2 }),
  a('rotate', 'Rotate', ['ambient'], NAMED, { loop: true, dur: 4 }),
  a('float', 'Float', ['ambient'], NAMED, { loop: true, dur: 3 }),
  a('sway', 'Sway', ['ambient'], NAMED, { loop: true, dur: 2 }),
  a('breatheLoop', 'Breathing', ['ambient'], NAMED, { loop: true, dur: 3 }),
  a('heartBeat', 'Heartbeat', ['ambient'], CSS, { loop: true, dur: 1.3 }),
  a('flash', 'Flash', ['ambient'], CSS, { loop: true, dur: 1 }),
  a('rubberBand', 'Rubber band', ['ambient'], CSS, { loop: true, dur: 1 }),
  a('shake', 'Shake', ['ambient'], CSS, { loop: true, dur: 1 }),
  a('tremble', 'Tremble', ['ambient'], CSS, { loop: true, dur: 1 }),
  a('headShake', 'Head shake', ['ambient'], CSS, { loop: true, dur: 1 }),
  a('swing', 'Swing', ['ambient'], CSS, { loop: true, dur: 1 }),
  a('tada', 'Tada', ['ambient'], CSS, { loop: true, dur: 1 }),
  a('wobble', 'Wobble', ['ambient'], CSS, { loop: true, dur: 1 }),
  a('jello', 'Jello', ['ambient'], CSS, { loop: true, dur: 1 }),
  a('hop', 'Hop', ['ambient'], CSS, { loop: true, dur: 1 }),
];

const INFO = new Map(ANIMATIONS.map((x) => [x.type, x]));
export const animationInfo = (type: string | undefined): AnimationInfo | undefined => (type ? INFO.get(type) : undefined);
/** The type of a hand-drawn motion path. */
export const CUSTOM_ANIMATION = 'custom';
/** The type of a keyframe animation carried in the design (CSS @keyframes, animation plugins). */
export const KEYFRAMES_ANIMATION = 'keyframes';
/** Every type a design may name. */
export const ANIMATION_TYPES: readonly string[] = [...ANIMATIONS.map((x) => x.type), CUSTOM_ANIMATION, KEYFRAMES_ANIMATION];

/** What we know about an animation: the catalogue entry, or one made from its own keyframes. */
export function infoOf(a: Animation): AnimationInfo | undefined {
  if (a.type === KEYFRAMES_ANIMATION && a.keyframes) {
    const k = a.keyframes;
    return { type: KEYFRAMES_ANIMATION, label: k.name ?? 'Keyframes', groups: [], src: 'user', ...(k.loop ? { loop: true } : {}), ...(k.exit ? { exit: true } : {}), ...(k.len ? { dur: k.len } : {}) };
  }
  return INFO.get(a.type);
}

export const DEFAULT_ANIMATION_DURATION = 0.8;
/** Delay between elements when the whole page is animated (Canva staggers them). */
export const PAGE_STAGGER = 0.12;
/** Canva's custom animations run up to 10 s. */
export const MAX_ANIMATION_DURATION = 10;

export function animationLabel(a: Animation | undefined | null): string {
  if (!a) return 'None';
  if (a.type === CUSTOM_ANIMATION) return 'Custom';
  return infoOf(a)?.label ?? 'None';
}

export const animationDuration = (a: Animation): number => (a.duration && a.duration > 0 ? a.duration : infoOf(a)?.dur ?? DEFAULT_ANIMATION_DURATION);

/** Is this animation still doing something when the page ends (a loop, an exit, a slow move)? */
export function playsToEnd(a: Animation): boolean {
  const i = infoOf(a);
  return !!i?.loop || !!i?.span || phaseOf(a) !== 'in';
}
const phaseOf = (a: Animation) => a.phase ?? (infoOf(a)?.exit ? 'out' : 'in');

const lengthOf = (page: Page): number => (page.duration && page.duration > 0 ? page.duration : 5);

/** Seconds into the page of element `i` of `n`, by the page animation's order. */
function pageDelay(order: AnimationOrder | undefined, i: number, n: number): number {
  return rank(order, i, n) * Math.max(0, n - 1) * PAGE_STAGGER;
}

/** 0..1: when this one starts among `n`. */
function rank(order: AnimationOrder | undefined, i: number, n: number): number {
  if (n <= 1 || order === 'together') return 0;
  switch (order) {
    case 'reverse': return (n - 1 - i) / (n - 1);
    case 'center': { const c = (n - 1) / 2; return Math.abs(i - c) / c; }
    case 'random': return randomRank(i, n);
    default: return i / (n - 1);
  }
}
/** A fixed shuffle (the same in every frame and export). */
function randomRank(i: number, n: number): number {
  const key = (k: number) => noise(k * 7.13 + n);
  const order = Array.from({ length: n }, (_, k) => k).sort((x, y) => key(x) - key(y));
  return order.indexOf(i) / (n - 1);
}
/** Repeatable noise, 0..1. */
const noise = (x: number) => { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/** All elements, children of ungrouped-animation groups included, with their stagger index. */
function animated(page: Page, f: (e: Element, a: Animation, delay: number) => void): void {
  const n = page.elements.length;
  const go = (els: Element[], order: (i: number) => number) => els.forEach((e, i) => {
    if (e.type === 'group' && !e.animation) { go(e.children, () => order(i)); return; }
    const a = e.animation ?? (page.animation?.by === 'page' ? undefined : page.animation);
    if (a) f(e, a, (e.timing?.start ?? 0) + (e.animation ? 0 : pageDelay(page.animation?.order, order(i), n)));
  });
  go(page.elements, (i) => i);
}

/** Seconds until every element of the page has finished animating (0 = nothing animates). A loop or an exit lasts as long as the page. */
export function animationEnd(page: Page): number {
  let end = 0;
  if (page.animation?.by === 'page') end = playsToEnd(page.animation) ? lengthOf(page) : animationDuration(page.animation);
  animated(page, (_, a, delay) => { end = Math.max(end, playsToEnd(a) ? lengthOf(page) : delay + animationDuration(a)); });
  return end;
}

/** Does the page need its full length to show its animations (loops, exits)? */
export function animationFillsPage(page: Page): boolean {
  let fills = !!page.animation && playsToEnd(page.animation);
  animated(page, (_, a) => { fills ||= playsToEnd(a); });
  return fills;
}

/**
 * The last moment the page is complete: its first exit starts here. A speaker
 * holding on a slide waits at this time, so a click doesn't find it empty.
 */
export function holdTime(page: Page): number {
  const len = lengthOf(page);
  let hold = len;
  const note = (a: Animation, e?: Element) => {
    if (phaseOf(a) === 'in' || infoOf(a)?.loop || infoOf(a)?.span) return;
    hold = Math.min(hold, (e?.timing?.end ?? len) - animationDuration(a));
  };
  if (page.animation) note(page.animation);
  animated(page, (e, a) => note(a, e));
  return Math.max(0, hold);
}

/** Does anything on the page (or the page itself) animate? */
export const hasAnimation = (page: Page): boolean => !!page.animation || page.elements.some((e) => !!e.animation);

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = cubicOut;
const easeOutBack = backOut;

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

/** The first nine animations: their frames stay as they were, so old designs play the same. */
function classicElement(doc: Doc, e: Element, a: Animation, p: number): Element | null {
  const k = easeOut(p);
  switch (a.type) {
    case 'fade':
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
      return fade(offsetElement(e, d.x * dist * (1 - p), d.y * dist * (1 - p)), Math.min(1, p * 1.5));
    }
    case 'pop':
      return fade(scaleAbout(e, easeOutBack(p)), Math.min(1, p * 3));
    case 'tumble': {
      const n = scaleAbout(e, 0.6 + 0.4 * k);
      return fade({ ...n, rotation: (((e.rotation - 90 * (1 - k)) % 360) + 360) % 360 }, k);
    }
    case 'typewriter':
      if (e.type === 'text' && (!a.by || a.by === 'element' || a.by === 'page')) return typeText(e, Math.round(e.text.length * p));
      return e.type === 'text' ? null : fade(e, k);
    default:
      return null;
  }
}

// ---- recipes ----

interface Ctx {
  /** Size of what moves (the element, or the unit). */
  w: number; h: number;
  /** The whole element, the page. */
  W: number; PW: number; PH: number;
  /** Where it comes from. */
  dir: { x: number; y: number };
  /** Unit index and count (0, 1 for a whole element). */
  i: number; n: number;
  color: Color;
  unit: boolean;
}

const scaled = (s: number): Fx => ({ sx: s, sy: s });
const flickerAt = (p: number) => (noise(Math.floor(p * 14)) > 0.45 + 0.45 * (1 - p) ? 1 : 0.15);

const RECIPES: Record<string, (p: number, c: Ctx) => Fx> = {
  fade: (p) => ({ alpha: cubicOut(p) }),
  rise: (p, c) => { const k = cubicOut(p); return { ty: (c.unit ? c.h * 0.7 : Math.min(c.PH * 0.1, Math.max(c.h * 0.5, 20))) * (1 - k), alpha: k }; },
  pan: (p, c) => { const k = cubicOut(p), d = c.unit ? c.w * 1.2 : (c.dir.x ? c.PW : c.PH) * 0.15; return { tx: c.dir.x * d * (1 - k), ty: c.dir.y * d * (1 - k), alpha: k }; },
  pop: (p) => ({ ...scaled(Math.max(0.001, backOut(p))), alpha: Math.min(1, p * 3) }),
  drift: (p, c) => { const d = c.unit ? c.w * 0.6 : (c.dir.x ? c.PW : c.PH) * 0.06; return { tx: c.dir.x * d * (1 - p), ty: c.dir.y * d * (1 - p), alpha: Math.min(1, p * 1.5) }; },
  tumble: (p) => { const k = cubicOut(p); return { ...scaled(0.6 + 0.4 * k), r: -90 * (1 - k), alpha: k }; },
  baseline: (p, c) => { const k = cubicOut(p); return { ty: c.h * (1 - k), clip: { x: 0, y: 0, w: 1, h: 1 }, reveal: true }; },
  wipe: (p, c) => {
    const k = quadInOut(p);
    const clip = c.dir.x < 0 ? { x: 0, y: 0, w: k, h: 1 } : c.dir.x > 0 ? { x: 1 - k, y: 0, w: k, h: 1 } : c.dir.y < 0 ? { x: 0, y: 0, w: 1, h: k } : { x: 0, y: 1 - k, w: 1, h: k };
    return { clip };
  },
  typewriter: (p) => ({ alpha: p > 0 ? 1 : 0 }),
  stomp: (p) => {
    if (p < 0.55) { const q = cubicIn(p / 0.55); return { ...scaled(2.4 - 1.5 * q), alpha: Math.min(1, p * 5) }; }
    const q = (p - 0.55) / 0.45; // lands, squashed, and settles
    return scaled(1 - 0.1 * (1 - q) * Math.cos(q * Math.PI * 2.5));
  },
  block: (p, c) => {
    const k = cubicInOut(p < 0.5 ? p * 2 : (p - 0.5) * 2);
    const flip = c.dir.x > 0; // default: the block runs from the left
    if (p < 0.5) return { clip: { x: 0, y: 0, w: 0, h: 0 }, reveal: true, block: { x: flip ? 1 - k : 0, y: 0, w: k, h: 1, color: c.color } };
    return { block: { x: flip ? 0 : k, y: 0, w: 1 - k, h: 1, color: c.color } };
  },
  breathe: (p) => { const k = sineInOut(p); return { ...scaled(0.88 + 0.12 * k), alpha: k }; },
  scale: (p) => { const k = cubicOut(p); return { ...scaled(1.35 - 0.35 * k), alpha: k }; },
  slide: (p, c) => { const k = cubicInOut(p); return { tx: c.dir.x * c.PW * (1 - k), ty: c.dir.y * c.PH * (1 - k) }; },
  neon: (p, c) => ({ alpha: p >= 0.95 ? 1 : flickerAt((p + noise(c.i)) % 1) * Math.min(1, p * 4), glow: c.h * 0.12 * (1 - p) }),
  scrapbook: (p, c) => { // stop motion: six held poses
    const q = Math.floor(p * 6) / 6;
    return { r: (noise(c.i + Math.floor(p * 6)) - 0.5) * 24 * (1 - q), ...scaled(1.25 - 0.25 * q), alpha: p > 0 ? 1 : 0 };
  },
  tectonic: (p, c) => {
    const k = cubicOut(p), s = c.i % 2 ? 1 : -1;
    return { tx: s * c.W * 0.5 * (1 - k) + (p > 0.6 ? Math.sin(p * 60) * c.h * 0.03 * (1 - p) : 0), alpha: Math.min(1, p * 2.5) };
  },
  jelly: (p) => { const d = Math.exp(-5 * p) * Math.sin(p * Math.PI * 7) * 0.45; return { sx: Math.max(0.01, p * (1 + d) + (1 - p) * 0.2), sy: Math.max(0.01, p * (1 - d) + (1 - p) * 0.2), alpha: Math.min(1, p * 4) }; },
  ascend: (p, c) => ({ ty: c.h * 1.05 * (1 - cubicOut(p)), clip: { x: 0, y: 0, w: 1, h: 1 }, reveal: true }),
  shift: (p, c) => { const k = cubicOut(p), d = from(undefined, 'right'), v = c.dir.x || c.dir.y ? c.dir : d; return { tx: v.x * c.h * 0.8 * (1 - k), ty: v.y * c.h * 0.8 * (1 - k), alpha: k }; },
  merge: (p, c) => { const k = cubicInOut(p); return { ty: (c.i % 2 ? 1 : -1) * c.h * 1.1 * (1 - k), alpha: Math.min(1, p * 2) }; },
  burst: (p, c) => {
    const k = expoOut(p), ang = noise(c.i + 1) * Math.PI * 2, d = c.h * (1.5 + noise(c.i + 2) * 2);
    return { tx: Math.cos(ang) * d * (1 - k), ty: Math.sin(ang) * d * (1 - k), r: (noise(c.i + 3) - 0.5) * 180 * (1 - k), ...scaled(0.2 + 0.8 * k), alpha: Math.min(1, p * 3) };
  },
  bounce: (p, c) => ({ ty: -c.h * 1.6 * (1 - bounceOut(p)), alpha: Math.min(1, p * 6) }),
  roll: (p, c) => { const k = cubicOut(p); return { tx: -c.w * 2 * (1 - k), r: -240 * (1 - k), alpha: Math.min(1, p * 2.5) }; },
  skate: (p, c) => { const k = backOut(p), v = c.dir.x ? c.dir.x : 1; return { tx: v * c.w * 1.2 * (1 - k), kx: v * 24 * (1 - cubicOut(p)), alpha: Math.min(1, p * 3) }; },
  spread: (p, c) => { const k = cubicOut(p); return { tx: (0.5 - (c.i + 0.5) / c.n) * -c.W * 0.5 * (k - 1), alpha: k }; },
  clarify: (p, c) => { const k = cubicOut(p); return { blur: c.h * 0.22 * (1 - k), alpha: k }; },
  write: (p) => ({ clip: { x: 0, y: 0, w: p, h: 1 } }),
  marker: (p) => ({ clip: { x: 0, y: 0, w: quadInOut(p), h: 1 } }),
  // photos: the frame stays, the picture moves
  photoZoomIn: (p) => ({ picture: { zoom: 1 + 0.3 * p, dx: 0, dy: 0 } }),
  photoZoomOut: (p) => ({ picture: { zoom: 1.3 - 0.3 * p, dx: 0, dy: 0 } }),
  photoPan: (p, c) => ({ picture: { zoom: 1.3, dx: (c.dir.x || 0) * (1 - 2 * p), dy: c.dir.y * (1 - 2 * p) } }),
  kenBurns: (p) => ({ picture: { zoom: 1.08 + 0.22 * p, dx: -0.6 + 1.2 * p, dy: 0.5 - p } }),
  photoRise: (p, c) => { const k = cubicOut(p); return { ty: c.h * 0.25 * (1 - k), alpha: k, picture: { zoom: 1 + 0.25 * (1 - k), dx: 0, dy: 0 } }; },
  photoFlow: (p, c) => { const k = cubicInOut(p); return { alpha: Math.min(1, p * 2), picture: { zoom: 1 + 0.3 * (1 - k), dx: c.dir.x * (1 - k), dy: c.dir.y * (1 - k) } }; },
  photoTumble: (p) => { const k = cubicOut(p); return { ...scaled(0.7 + 0.3 * k), r: -14 * (1 - k), alpha: k, picture: { zoom: 1 + 0.3 * (1 - k), dx: 0, dy: 0 } }; },
  // loops: p runs 0 → 1 once per turn
  wiggle: (p) => ({ r: Math.sin(p * Math.PI * 2) * 6 }),
  flicker: (p) => ({ alpha: noise(Math.floor(p * 12)) > 0.3 ? 1 : 0.35 }),
  rotate: (p) => ({ r: p * 360 }),
  float: (p, c) => ({ ty: Math.sin(p * Math.PI * 2) * Math.max(4, c.h * 0.05) }),
  sway: (p, c) => ({ tx: Math.sin(p * Math.PI * 2) * Math.max(4, c.w * 0.04), r: Math.sin(p * Math.PI * 2) * 2 }),
  breatheLoop: (p) => scaled(1 + 0.05 * (1 - Math.cos(p * Math.PI * 2)) / 2),
};

interface KFrame { a: number; o?: number; tx?: number; ty?: number; px?: number; py?: number; sx?: number; sy?: number; r?: number; kx?: number; ky?: number; b?: number; e?: number[] }
interface KRecipe { src: string; len?: number; ox?: number; oy?: number; f: KFrame[] }
const MOTION_DATA = MOTION as unknown as Record<string, KRecipe>;

/** The motion-data entry for a type and direction. */
function keyRecipe(type: string, dir: AnimationDirection | undefined): KRecipe | undefined {
  const k = KF[type];
  if (!k) return undefined;
  const name = (dir && k.dirs?.[dir]) ?? k.key ?? Object.values(k.dirs ?? {})[0];
  return name ? MOTION_DATA[name] : undefined;
}

const beziers = new Map<string, (p: number) => number>();
function bezier(e: number[]): (p: number) => number {
  const key = e.join();
  let f = beziers.get(key);
  if (!f) beziers.set(key, (f = cubicBezier(e[0]!, e[1]!, e[2]!, e[3]!)));
  return f;
}

/** Keyframes at `p`, as CSS plays them: each stretch has its own curve (default `ease`). */
export function sampleKeyframes(r: { ox?: number; oy?: number; f: KFrame[] }, p: number, w: number, h: number, pxScale: number): Fx {
  const f = r.f;
  let i = 0;
  while (i < f.length - 2 && p >= f[i + 1]!.a) i++;
  const A = f[i]!, B = f[i + 1] ?? A;
  const q = bezier(A.e ?? [0.25, 0.1, 0.25, 1])(B.a > A.a ? clamp01((p - A.a) / (B.a - A.a)) : 1);
  const mix = (a = 0, b = 0) => a + (b - a) * q;
  return {
    tx: mix(A.tx, B.tx) * w + mix(A.px, B.px) * pxScale,
    ty: mix(A.ty, B.ty) * h + mix(A.py, B.py) * pxScale,
    sx: mix(A.sx ?? 1, B.sx ?? 1), sy: mix(A.sy ?? 1, B.sy ?? 1),
    r: mix(A.r, B.r), kx: mix(A.kx, B.kx), ky: mix(A.ky, B.ky),
    alpha: mix(A.o ?? 1, B.o ?? 1),
    ...(A.b || B.b ? { blur: (mix(A.b, B.b) * pxScale) / 4 } : {}),
    ...(r.ox !== undefined ? { ox: r.ox, oy: r.oy } : {}),
  };
}

/** Intensity scales how far a recipe goes (0.5 = as written); opacity and clips stay. */
function strengthen(fx: Fx, intensity: number | undefined): Fx {
  if (intensity === undefined || intensity === 0.5) return fx;
  const k = 0.25 + 1.5 * clamp01(intensity);
  const n: Fx = { ...fx };
  if (fx.tx !== undefined) n.tx = fx.tx * k;
  if (fx.ty !== undefined) n.ty = fx.ty * k;
  if (fx.r !== undefined) n.r = fx.r * k;
  if (fx.kx !== undefined) n.kx = fx.kx * k;
  if (fx.ky !== undefined) n.ky = fx.ky * k;
  if (fx.sx !== undefined) n.sx = 1 + (fx.sx - 1) * k;
  if (fx.sy !== undefined) n.sy = 1 + (fx.sy - 1) * k;
  if (fx.blur !== undefined) n.blur = fx.blur * k;
  if (fx.glow !== undefined) n.glow = fx.glow * k;
  if (fx.picture) n.picture = { ...fx.picture, zoom: 1 + (fx.picture.zoom - 1) * k };
  return n;
}

export const defaultDirection = (type: string): AnimationDirection | undefined => DEFAULT_DIR[type];
const DEFAULT_DIR: Record<string, AnimationDirection> = { pan: 'left', wipe: 'left', drift: 'left', slide: 'left', block: 'left', shift: 'right', skate: 'right', photoPan: 'left', photoFlow: 'left' };

/** The recipe of `a` at `p`. */
function recipeFx(a: Animation, p: number, c: Omit<Ctx, 'dir'>): Fx {
  const dir = a.direction ?? DEFAULT_DIR[a.type];
  const k = a.type === KEYFRAMES_ANIMATION ? a.keyframes : keyRecipe(a.type, dir);
  if (k) {
    const exit = infoOf(a)?.exit;
    return strengthen(sampleKeyframes(k, exit ? 1 - p : p, c.w, c.h, Math.min(c.PW, c.PH) / 1080), a.intensity);
  }
  const f = RECIPES[a.type];
  if (!f) return {};
  return strengthen(f(p, { ...c, dir: from(dir, 'down') }), a.intensity);
}

/** How long one text unit plays, as a share of the whole animation. */
const UNIT_SHARE: Record<string, number> = { letter: 0.4, word: 0.55, line: 0.7 };

const inkOf = (e: Element): Color => {
  if (e.type === 'text') return e.style.color;
  if (e.type === 'shape' && e.fill?.type === 'solid') return e.fill.color;
  return '#7d2ae8';
};

/** One element `p` (0..1) through `a`. */
function animateElement(doc: Doc, e: Element, a: Animation, p: number): Element {
  const whole = !a.by || a.by === 'element' || a.by === 'page';
  if (whole && a.intensity === undefined) {
    const old = classicElement(doc, e, a, p);
    if (old) return old;
  }
  const c = { w: e.w, h: e.h, W: e.w, PW: doc.width, PH: doc.height, i: 0, n: 1, color: inkOf(e), unit: false };
  if (!whole && e.type === 'text' && !e.curve) {
    const by = a.by as 'line' | 'word' | 'letter';
    const share = a.order === 'together' ? 1 : UNIT_SHARE[by]!;
    const live: LiveFx = {
      units: {
        by,
        at: (i, n, w, h) => {
          const q = clamp01((p - rank(a.order, i, n) * (1 - share)) / share);
          if (q >= 1) return null;
          return q <= 0 ? { alpha: 0 } : recipeFx(a, q, { ...c, w, h, i, n, unit: true });
        },
      },
    };
    return { ...e, live };
  }
  return withFx(e, recipeFx(a, p, c));
}

/** Does this state need more than plain drawing? (`units` and `picture` are read where text and pictures draw.) */
export const movesBox = (f: LiveFx): boolean => f.tx !== undefined || f.ty !== undefined || f.sx !== undefined || f.sy !== undefined || f.r !== undefined || f.kx !== undefined || f.ky !== undefined || !!f.clip || !!f.blur || !!f.glow || !!f.block;

/** The part of the picture to show when it moves inside its frame. */
export function zoomCrop<T extends { x: number; y: number; w: number; h: number }>(crop: T, pic: Fx['picture']): T {
  if (!pic || pic.zoom <= 1) return crop;
  const w = crop.w / pic.zoom, h = crop.h / pic.zoom;
  return { ...crop, x: crop.x + (crop.w - w) * (0.5 + pic.dx / 2), y: crop.y + (crop.h - h) * (0.5 + pic.dy / 2), w, h };
}

/** Put a recipe's result on an element; opacity goes straight into the element. */
function withFx<T extends Element>(e: T, fx: Fx): T {
  const { alpha, ...rest } = fx;
  return { ...e, opacity: e.opacity * clamp01(alpha ?? 1), live: rest };
}

// ---- hand-drawn paths ----

const polyCache = new WeakMap<MotionPath, { x: number; y: number; t: number; d: number }[]>();

/** The path as a dense line: smoothed by Catmull-Rom, with distance so far (`d`, 0..1). */
function pathLine(path: MotionPath): { x: number; y: number; t: number; d: number }[] {
  const hit = polyCache.get(path);
  if (hit) return hit;
  const pts = path.points;
  const out: { x: number; y: number; t: number; d: number }[] = [];
  const at = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))]!;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let s = 0; s < 8; s++) {
      const u = s / 8, u2 = u * u, u3 = u2 * u;
      const cr = (k: 0 | 1) => 0.5 * (2 * p1[k] + (p2[k] - p0[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u2 + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * u3);
      out.push({ x: cr(0), y: cr(1), t: p1[2] + (p2[2] - p1[2]) * u, d: 0 });
    }
  }
  const end = pts[pts.length - 1];
  if (end) out.push({ x: end[0], y: end[1], t: end[2], d: 0 });
  let sum = 0;
  for (let i = 1; i < out.length; i++) { sum += Math.hypot(out[i]!.x - out[i - 1]!.x, out[i]!.y - out[i - 1]!.y); out[i]!.d = sum; }
  if (sum > 0) for (const o of out) o.d /= sum;
  polyCache.set(path, out);
  return out;
}

const PACE: Record<NonNullable<MotionPath['style']>, (p: number) => number> = {
  original: (p) => p,
  smooth: cubicInOut,
  slow: sineInOut,
  bounce: bounceOut,
  windup: (p) => (p < 0.25 ? -0.08 * sineInOut(p * 4) : -0.08 + 1.08 * cubicInOut((p - 0.25) / 0.75)),
};

/** Where a hand-drawn path puts the element at `p` (0..1): offset and turn. */
export function pathAt(path: MotionPath, p: number): { dx: number; dy: number; r: number } {
  const line = pathLine(path);
  if (line.length < 2) return { dx: line[0]?.x ?? 0, dy: line[0]?.y ?? 0, r: 0 };
  const style = path.style ?? 'smooth';
  const key = style === 'original' ? 't' : 'd';
  const q = PACE[style](clamp01(p));
  let lo = 0, hi = line.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (line[m]![key] <= q) lo = m; else hi = m; }
  const A = line[lo]!, B = line[hi]!;
  const span = B[key] - A[key];
  const f = span > 0 ? Math.max(style === 'windup' ? -1 : 0, Math.min(1, (q - A[key]) / span)) : 0;
  const dx = A.x + (B.x - A.x) * f, dy = A.y + (B.y - A.y) * f;
  let r = 0;
  if (path.rotation === 'spin') r = 360 * clamp01(q);
  else if (path.rotation === 'follow') {
    const first = line.find((o) => o.d > 0.02) ?? line[1]!;
    r = ((Math.atan2(B.y - A.y, B.x - A.x) - Math.atan2(first.y, first.x)) * 180) / Math.PI;
  }
  return { dx, dy, r };
}

/** The element on a hand-drawn path, `t` seconds after it starts. It stays at the path's end. */
function onPath(e: Element, a: Animation, t: number): Element {
  const path = a.path;
  if (!path || path.points.length < 2) return e;
  const p = clamp01(t / animationDuration(a));
  const { dx, dy, r } = pathAt(path, p);
  const alpha = path.fade ? Math.min(1, p * 5) : 1;
  return withFx(e, { tx: dx, ty: dy, r, alpha });
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

/** `a` on `e` at `t` seconds into the page; `start`..`end` = the time it shows; `delay` = its stagger. */
function play(doc: Doc, e: Element, a: Animation, t: number, start: number, end: number, delay: number): Element {
  const info = infoOf(a);
  if (a.type === CUSTOM_ANIMATION) return t <= start + delay ? (a.path?.fade ? fade(e, 0) : e) : onPath(e, a, t - start - delay);
  const dur = animationDuration(a);
  if (info?.loop) {
    if (t < start + delay) return e;
    return animateElement(doc, e, a, ((t - start - delay) / dur) % 1);
  }
  if (info?.span) return animateElement(doc, e, a, clamp01((t - start) / Math.max(0.001, end - start)));
  const phase = phaseOf(a);
  const room = Math.max(0.001, end - start);
  const d = phase === 'both' ? Math.min(dur, room / 2) : phase === 'out' ? Math.min(dur, room) : dur;
  let p = 1;
  if (phase !== 'out') p = clamp01((t - start - delay) / d);
  if (phase !== 'in') p = Math.min(p, clamp01((end - delay - t) / d));
  return p >= 1 ? e : animateElement(doc, e, a, p);
}

/**
 * The page `t` seconds after it starts. Elements with their own animation
 * start at 0 (or when their `timing` window opens); the page animation applies
 * to the others, staggered by order. Elements outside their `timing` window are
 * left out. After every animation ends the input elements come back unchanged (same objects).
 */
export function animateAt(doc: Doc, page: Page, t: number): Page {
  if (!hasAnimation(page) && !anyIn(page.elements, (e) => !!e.animation) && !timed(page)) return page;
  let changed = false;
  const len = lengthOf(page);
  const pa = page.animation?.by === 'page' ? undefined : page.animation;
  const n = page.elements.length;
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
      const a = e.animation ?? pa;
      if (!a) { out.push(e); return; }
      const start = e.timing?.start ?? 0, end = e.timing?.end ?? len;
      const delay = e.animation ? 0 : pageDelay(pa?.order, order(i), n);
      const now = play(doc, e, a, t, start, end, delay);
      if (now !== e) changed = true;
      out.push(now);
    });
    return out.length === els.length && out.every((e, k) => e === els[k]) ? els : out;
  };
  const elements = list(page.elements, (i) => i);
  const done: Page = changed ? { ...page, elements } : page;
  return page.animation?.by === 'page' ? wholePage(doc, done, page.animation, t, len) : done;
}

/** A page animation that moves everything as one: the background stays. */
function wholePage(doc: Doc, page: Page, a: Animation, t: number, len: number): Page {
  const group: GroupElement = { id: '__page', type: 'group', name: 'Page', x: 0, y: 0, w: doc.width, h: doc.height, rotation: 0, opacity: 1, children: page.elements };
  const moved = play(doc, group, { ...a, by: 'element' }, t, 0, len, 0);
  return moved === group ? page : { ...page, elements: [moved] };
}

// ---- page transitions (video) ----

export const TRANSITIONS: readonly { type: TransitionType; label: string; directional?: boolean; color?: boolean }[] = [
  { type: 'dissolve', label: 'Dissolve' },
  { type: 'fade', label: 'Fade through black' },
  { type: 'slide', label: 'Slide', directional: true },
  { type: 'wipe', label: 'Wipe', directional: true },
  { type: 'zoom', label: 'Zoom' },
  { type: 'match', label: 'Match & Move' },
  { type: 'circle', label: 'Circle wipe', directional: true },
  { type: 'line', label: 'Line wipe', directional: true },
  { type: 'stack', label: 'Stack', directional: true },
  { type: 'chop', label: 'Chop', directional: true },
  { type: 'flow', label: 'Flow', directional: true },
  { type: 'colorwipe', label: 'Color wipe', directional: true, color: true },
  { type: 'iris', label: 'Iris' },
  { type: 'clock', label: 'Clock' },
  { type: 'doors', label: 'Doors' },
  { type: 'checker', label: 'Checkerboard' },
];

/** Canva: 0.1 to 2.5 seconds. */
export const TRANSITION_MIN = 0.1;
export const TRANSITION_MAX = 2.5;
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
 * opacity and a clip (null = whole page), drawn previous first. The newer
 * wipes clip to polygons (flat x,y lists); chop and doors cut a page into strips.
 * Geometry after gl-transitions (MIT): CircleOpen, RectangleIris, ClockWipe,
 * HorizontalOpen, Chessboard, reimplemented as clips.
 */
export interface TransitionLayer {
  dx: number; dy: number; scale: number; alpha: number;
  clip: { x: number; y: number; w: number; h: number } | null;
  /** Clip to these polygons. */
  polys?: number[][];
  /** Clip to a circle. */
  circle?: { x: number; y: number; r: number };
  /** Draw the page once per strip, each clipped and moved by itself. */
  strips?: { poly: number[]; dx: number; dy: number }[];
}
export interface TransitionFrame {
  prev: TransitionLayer;
  next: TransitionLayer;
  black?: number;
  /** A colour between the two pages. */
  band?: { poly: number[]; color: Color };
  /** The old page is drawn over the new one (doors). */
  prevOnTop?: boolean;
}

const rectPoly = (x: number, y: number, w: number, h: number) => [x, y, x + w, y, x + w, y + h, x, y + h];

/** The part of the page on the far side of a line that sweeps across it towards -v as `e` goes 0 → 1. */
function sweep(w: number, h: number, v: readonly [number, number], tilt: number, e: number): number[] {
  const len = Math.hypot(v[0] + tilt * -v[1], v[1] + tilt * v[0]);
  const nx = (v[0] + tilt * -v[1]) / len, ny = (v[1] + tilt * v[0]) / len;
  const px = -ny, py = nx;
  const reach = (Math.abs(nx) * w + Math.abs(ny) * h) / 2;
  const L = w + h;
  const d = reach * (1 - 2 * e);
  const x = w / 2 + nx * d, y = h / 2 + ny * d;
  return [x + px * L, y + py * L, x - px * L, y - py * L, x - px * L + nx * L * 2, y - py * L + ny * L * 2, x + px * L + nx * L * 2, y + py * L + ny * L * 2];
}

export function transitionLayers(tr: Transition, progress: number, w: number, h: number): TransitionFrame {
  const p = clamp01(progress);
  const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // ease in-out
  const full: TransitionLayer = { dx: 0, dy: 0, scale: 1, alpha: 1, clip: null };
  const dir = tr.direction ?? 'right';
  // the vector pointing where the new page comes from
  const v = (dir === 'left' ? [-1, 0] : dir === 'right' ? [1, 0] : dir === 'up' ? [0, -1] : [0, 1]) as [number, number];
  switch (tr.type) {
    case 'dissolve':
    case 'match':
      return { prev: full, next: { ...full, alpha: e } };
    case 'fade':
      // through black: the old page fades out, then the new one fades in
      return p < 0.5 ? { prev: { ...full, alpha: 1 - 2 * p }, next: { ...full, alpha: 0 }, black: 1 } : { prev: { ...full, alpha: 0 }, next: { ...full, alpha: 2 * p - 1 }, black: 1 };
    case 'slide':
      return { prev: { ...full, dx: -v[0] * w * e, dy: -v[1] * h * e }, next: { ...full, dx: v[0] * w * (1 - e), dy: v[1] * h * (1 - e) } };
    case 'wipe': {
      const cw = w * e, ch = h * e;
      const clip = dir === 'right' ? { x: w - cw, y: 0, w: cw, h } : dir === 'left' ? { x: 0, y: 0, w: cw, h } : dir === 'down' ? { x: 0, y: h - ch, w, h: ch } : { x: 0, y: 0, w, h: ch };
      return { prev: full, next: { ...full, clip } };
    }
    case 'zoom':
      return { prev: { ...full, scale: 1 + 0.15 * e, alpha: 1 - e }, next: { ...full, scale: 0.85 + 0.15 * e, alpha: e } };
    case 'circle': {
      // grows from the middle, or from an edge when a direction is set
      const x = tr.direction ? w / 2 + (v[0] * w) / 2 : w / 2, y = tr.direction ? h / 2 + (v[1] * h) / 2 : h / 2;
      const far = Math.max(...[[0, 0], [w, 0], [0, h], [w, h]].map(([a, b]) => Math.hypot(a! - x, b! - y)));
      return { prev: full, next: { ...full, circle: { x, y, r: far * e } } };
    }
    case 'line':
      return { prev: full, next: { ...full, polys: [sweep(w, h, v, 0.35, e)] } };
    case 'stack':
      return { prev: { ...full, scale: 1 - 0.08 * e, alpha: 1 - 0.5 * e }, next: { ...full, dx: v[0] * w * (1 - e), dy: v[1] * h * (1 - e) } };
    case 'flow':
      return { prev: { ...full, dx: -v[0] * w * 0.35 * e, dy: -v[1] * h * 0.35 * e }, next: { ...full, dx: v[0] * w * (1 - e), dy: v[1] * h * (1 - e) } };
    case 'chop': {
      const n = 6, across = v[0] !== 0; // strips across the movement
      const strips = Array.from({ length: n }, (_, i) => {
        const delay = (i / n) * 0.4, q = clamp01((p - delay) / 0.6);
        const k = 1 - (1 - q) ** 3, side = i % 2 ? -1 : 1;
        return across
          ? { poly: rectPoly(0, (h * i) / n, w, h / n + 1), dx: side * v[0] * w * (1 - k), dy: 0 }
          : { poly: rectPoly((w * i) / n, 0, w / n + 1, h), dx: 0, dy: side * v[1] * h * (1 - k) };
      });
      return { prev: full, next: { ...full, strips } };
    }
    case 'colorwipe': {
      const color = tr.color ?? '#7d2ae8';
      const front = cubicInOut(clamp01(p / 0.65)), back = cubicInOut(clamp01((p - 0.35) / 0.65));
      return { prev: full, band: { poly: sweep(w, h, v, 0, front), color }, next: { ...full, polys: [sweep(w, h, v, 0, back)] } };
    }
    case 'iris': {
      const cw = w * e, ch = h * e;
      return { prev: full, next: { ...full, clip: { x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch } } };
    }
    case 'clock': {
      const R = w + h, pts = [w / 2, h / 2];
      const steps = Math.max(2, Math.ceil(e * 72));
      for (let i = 0; i <= steps; i++) { const a = -Math.PI / 2 + (i / steps) * e * Math.PI * 2; pts.push(w / 2 + Math.cos(a) * R, h / 2 + Math.sin(a) * R); }
      return { prev: full, next: { ...full, polys: [pts] } };
    }
    case 'doors':
      return {
        next: full, prevOnTop: true,
        prev: { ...full, strips: [{ poly: rectPoly(0, 0, w / 2, h), dx: (-w / 2) * e, dy: 0 }, { poly: rectPoly(w / 2, 0, w / 2, h), dx: (w / 2) * e, dy: 0 }] },
      };
    case 'checker': {
      const nx = 8, ny = Math.max(2, Math.round((8 * h) / w));
      const polys: number[][] = [];
      for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        // odd squares first, then the rest
        const late = (x + y) % 2;
        const q = clamp01(late ? (p - 0.5) * 2 : p * 2);
        const cw = (w / nx) * q, ch = (h / ny) * q;
        if (q > 0) polys.push(rectPoly(((x + 0.5) * w) / nx - cw / 2, ((y + 0.5) * h) / ny - ch / 2, cw + 0.5, ch + 0.5));
      }
      return { prev: full, next: { ...full, polys } };
    }
  }
}

/** What Match & Move pairs: same name, else same picture, else same text, of one type. */
const matchKey = (e: Element): string | null => {
  if (e.name) return `n:${e.type}:${e.name}`;
  if (e.type === 'image' || e.type === 'video') return `a:${e.asset}`;
  if (e.type === 'text') return `t:${e.text}`;
  return null;
};

/** Elements that appear on both pages (top level). */
export function matchPairs(prev: Page, next: Page): { a: Element; b: Element }[] {
  const pool = new Map<string, Element[]>();
  for (const e of prev.elements) { const k = matchKey(e); if (k) pool.set(k, [...(pool.get(k) ?? []), e]); }
  const out: { a: Element; b: Element }[] = [];
  for (const b of next.elements) {
    const k = matchKey(b);
    const a = k ? pool.get(k)?.shift() : undefined;
    if (a) out.push({ a, b });
  }
  return out;
}

/** `b` on its way from where `a` stands (`e` 0 → 1). */
export function tweenElement(a: Element, b: Element, e: number): Element {
  const left = 1 - e;
  const sx = (a.w * left + b.w * e) / Math.max(1, b.w), sy = (a.h * left + b.h * e) / Math.max(1, b.h);
  const tx = (a.x + a.w / 2 - (b.x + b.w / 2)) * left, ty = (a.y + a.h / 2 - (b.y + b.h / 2)) * left;
  let turn = (a.rotation - b.rotation) % 360;
  if (turn > 180) turn -= 360;
  if (turn < -180) turn += 360;
  return { ...b, opacity: a.opacity * left + b.opacity * e, live: { tx, ty, sx, sy, r: turn * left } };
}

/** Easing of the page transitions, for code that draws them. */
export const transitionEase = (p: number): number => { const q = clamp01(p); return q < 0.5 ? 2 * q * q : 1 - Math.pow(-2 * q + 2, 2) / 2; };
