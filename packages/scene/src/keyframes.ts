/**
 * CSS @keyframes → motion recipes (MotionRecipe), pure. Used for the built-in
 * catalogue (tools/catalogs/motion.ts writes motion-data.json with it), for
 * animation plugins, and for `animation` / `@keyframes` in set_page_html.
 * Transforms become our 2D fields; 3D turns become their flat projection.
 */
import type { MotionFrame, MotionRecipe } from './types.ts';

type KF = MotionFrame;
type Recipe = MotionRecipe & { src?: string };
const num = (s: string | undefined) => parseFloat(s ?? '0') || 0;
const deg = (s: string) => (s.endsWith('rad') ? (num(s) * 180) / Math.PI : s.endsWith('turn') ? num(s) * 360 : num(s));
const R = (n: number) => Math.round(n * 10000) / 10000;

/** One CSS transform list → our fields (order is lost, which these catalogues don't rely on). */
function transform(v: string): Partial<KF> {
  const k: Partial<KF> = {};
  const move = (x: string | undefined, y: string | undefined) => {
    if (x !== undefined) { if (x.endsWith('%')) k.tx = (k.tx ?? 0) + num(x) / 100; else k.px = (k.px ?? 0) + num(x); }
    if (y !== undefined) { if (y.endsWith('%')) k.ty = (k.ty ?? 0) + num(y) / 100; else k.py = (k.py ?? 0) + num(y); }
  };
  const flatX = (a: number) => { k.sy = (k.sy ?? 1) * Math.cos((a * Math.PI) / 180); };
  const flatY = (a: number) => { k.sx = (k.sx ?? 1) * Math.cos((a * Math.PI) / 180); };
  for (const m of v.matchAll(/([a-zA-Z0-9]+)\(([^)]*)\)/g)) {
    const a = m[2]!.split(',').map((s) => s.trim());
    switch (m[1]) {
      case 'translate': case 'translate3d': move(a[0], a[1]); break;
      case 'translateX': move(a[0], undefined); break;
      case 'translateY': move(undefined, a[0]); break;
      case 'scale': case 'scale3d': k.sx = (k.sx ?? 1) * num(a[0]); k.sy = (k.sy ?? 1) * num(a[1] ?? a[0]); break;
      case 'scaleX': k.sx = (k.sx ?? 1) * num(a[0]); break;
      case 'scaleY': k.sy = (k.sy ?? 1) * num(a[0]); break;
      case 'rotate': case 'rotateZ': k.r = (k.r ?? 0) + deg(a[0]!); break;
      case 'rotate3d': {
        const [x, y, z, an] = [num(a[0]), num(a[1]), num(a[2]), deg(a[3]!)];
        if (Math.abs(z) >= Math.max(Math.abs(x), Math.abs(y))) k.r = (k.r ?? 0) + an * Math.sign(z || 1);
        else if (Math.abs(x) >= Math.abs(y)) flatX(an); else flatY(an);
        break;
      }
      case 'rotateX': flatX(deg(a[0]!)); break;
      case 'rotateY': flatY(deg(a[0]!)); break;
      case 'skew': k.kx = deg(a[0]!); if (a[1]) k.ky = deg(a[1]); break;
      case 'skewX': k.kx = deg(a[0]!); break;
      case 'skewY': k.ky = deg(a[0]!); break;
      default: break; // perspective(), translateZ(): flat drawing has neither
    }
  }
  return k;
}

function origin(v: string): [number, number] {
  const w = v.trim().split(/\s+/);
  const one = (s: string | undefined, horizontal: boolean): number | null => {
    if (s === undefined) return null;
    if (s === 'center') return 0.5;
    if (horizontal && s === 'left') return 0;
    if (horizontal && s === 'right') return 1;
    if (!horizontal && s === 'top') return 0;
    if (!horizontal && s === 'bottom') return 1;
    return s.endsWith('%') ? num(s) / 100 : null;
  };
  if (w[0] === 'top' || w[0] === 'bottom') return [one(w[1], true) ?? 0.5, one(w[0], false) ?? 0.5];
  return [one(w[0], true) ?? 0.5, one(w[1], false) ?? 0.5];
}

export function parseKeyframeBody(body: string): { frames: KF[]; ox?: number; oy?: number } {
  const byAt = new Map<number, KF>();
  let ox: number | undefined, oy: number | undefined;
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const stops = m[1]!.split(',').map((s) => { const t = s.trim(); return t === 'from' ? 0 : t === 'to' ? 1 : num(t) / 100; });
    const d: Partial<KF> = {};
    for (const line of m[2]!.split(';')) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const key = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
      if (key.startsWith('-webkit-')) continue;
      if (key === 'opacity') d.o = num(v);
      else if (key === 'transform') Object.assign(d, transform(v), { _t: 1 });
      else if (key === 'filter') { const b = /blur\(([\d.]+)px\)/.exec(v); if (b) d.b = num(b[1]); }
      else if (key === 'transform-origin' && ox === undefined) [ox, oy] = origin(v);
      else if (key === 'animation-timing-function') {
        const b = /cubic-bezier\(([^)]*)\)/.exec(v);
        if (b) d.e = b[1]!.split(',').map(num);
        else if (v === 'ease-in') d.e = [0.42, 0, 1, 1];
        else if (v === 'ease-out') d.e = [0, 0, 0.58, 1];
        else if (v === 'ease-in-out') d.e = [0.42, 0, 0.58, 1];
        else if (v === 'linear') d.e = [0, 0, 1, 1];
      }
    }
    for (const a of stops) byAt.set(a, { ...byAt.get(a), ...d, a } as KF);
  }
  const frames = [...byAt.values()].sort((x, y) => x.a - y.a);
  if (!frames.length || frames[0]!.a > 0) frames.unshift({ a: 0 });
  if (frames.at(-1)!.a < 1) frames.push({ a: 1 });
  // A property a keyframe leaves out is interpolated between the keyframes that
  // state it, and the first and last default to the element itself (CSS).
  type Marked = KF & { _t?: number };
  const between = <T,>(has: (f: Marked) => boolean, value: (f: Marked | null) => T, mix: (a: T, b: T, k: number) => T, set: (f: Marked, v: T) => void) => {
    frames.forEach((f, i) => {
      if (has(f as Marked)) return;
      let l = i - 1, r = i + 1;
      while (l >= 0 && !has(frames[l] as Marked)) l--;
      while (r < frames.length && !has(frames[r] as Marked)) r++;
      const A = l >= 0 ? (frames[l] as Marked) : null, B = r < frames.length ? (frames[r] as Marked) : null;
      const a0 = A ? A.a : 0, a1 = B ? B.a : 1;
      set(f as Marked, mix(value(A), value(B), a1 > a0 ? (f.a - a0) / (a1 - a0) : 0));
    });
  };
  const known = new Map(frames.map((f) => [f, (f as Marked)._t !== undefined]));
  const oKnown = new Map(frames.map((f) => [f, f.o !== undefined]));
  const bKnown = new Map(frames.map((f) => [f, f.b !== undefined]));
  const FIELDS = ['tx', 'ty', 'px', 'py', 'sx', 'sy', 'r', 'kx', 'ky'] as const;
  const dflt = (k: (typeof FIELDS)[number]) => (k === 'sx' || k === 'sy' ? 1 : 0);
  const filled = new Map<KF, Partial<KF>>();
  between<Partial<KF>>((f) => !!known.get(f), (f) => (f ? pick(f) : {}),
    (a, b, k) => Object.fromEntries(FIELDS.map((n) => [n, (a[n] ?? dflt(n)) + ((b[n] ?? dflt(n)) - (a[n] ?? dflt(n))) * k])), (f, v) => { filled.set(f, v); });
  const oOut = new Map<KF, number>(), bOut = new Map<KF, number>();
  between<number>((f) => !!oKnown.get(f), (f) => f?.o ?? 1, (a, b, k) => a + (b - a) * k, (f, v) => { oOut.set(f, v); });
  between<number>((f) => !!bKnown.get(f), (f) => f?.b ?? 0, (a, b, k) => a + (b - a) * k, (f, v) => { bOut.set(f, v); });
  const out = frames.map((f) => {
    const base: KF = { a: R(f.a), ...(filled.get(f) ?? pick(f)), o: f.o ?? oOut.get(f), b: f.b ?? bOut.get(f) };
    if (f.e) base.e = f.e;
    return clean(base);
  });
  return { frames: out, ...(ox !== undefined ? { ox: R(ox), oy: R(oy ?? 0.5) } : {}) };
}
const pick = (f: Partial<KF>): Partial<KF> => ({ tx: f.tx, ty: f.ty, px: f.px, py: f.py, sx: f.sx, sy: f.sy, r: f.r, kx: f.kx, ky: f.ky });
function clean(k: KF): KF {
  const o: Record<string, unknown> = { a: k.a };
  for (const [key, v] of Object.entries(k)) {
    if (key === 'a' || v === undefined) continue;
    if (key === 'e') { o.e = v; continue; }
    const n = R(v as number);
    if (((key === 'sx' || key === 'sy' || key === 'o') && n === 1) || (key !== 'sx' && key !== 'sy' && key !== 'o' && n === 0)) continue;
    o[key] = n;
  }
  return o as unknown as KF;
}

/** Every @keyframes block in a style sheet, by name (`src` is kept as given). */
export function readKeyframes(css: string, src: string | undefined, into: Record<string, Recipe>): void {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of text.matchAll(/@keyframes\s+([a-zA-Z0-9_-]+)\s*\{/g)) {
    // find the block's closing brace
    let depth = 1, i = m.index + m[0].length;
    const start = i;
    while (depth && i < text.length) { if (text[i] === '{') depth++; else if (text[i] === '}') depth--; i++; }
    const name = m[1]!;
    const { frames, ox, oy } = parseKeyframeBody(text.slice(start, i - 1));
    const rule = new RegExp(`\\.(?:animate__)?${name}\\s*\\{([^}]*)\\}`).exec(text)?.[1] ?? '';
    const len = /animation-duration:\s*calc\(1s \* ([\d.]+)\)/.exec(rule)?.[1];
    const ruleOrigin = /(?<!-webkit-)transform-origin:\s*([^;]+);/.exec(rule)?.[1];
    const [rx, ry] = ruleOrigin ? origin(ruleOrigin) : [undefined, undefined];
    const x = ox ?? rx, y = oy ?? ry;
    if (into[name]) throw new Error(`two catalogues define ${name}`);
    into[name] = { ...(src ? { src } : {}), ...(len ? { len: num(len) } : {}), ...(x !== undefined && (x !== 0.5 || y !== 0.5) ? { ox: x, oy: y } : {}), f: frames };
  }
}


/** CSS text with @keyframes → recipes by name (later duplicates win). */
export function keyframesFromCss(css: string): Record<string, MotionRecipe> {
  const out: Record<string, Recipe> = {};
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // one block at a time so a repeated name replaces the earlier one
  for (const m of text.matchAll(/@keyframes\s+([a-zA-Z0-9_-]+)\s*\{/g)) {
    let depth = 1, i = m.index + m[0].length;
    while (depth && i < text.length) { if (text[i] === '{') depth++; else if (text[i] === '}') depth--; i++; }
    const one: Record<string, Recipe> = {};
    readKeyframes(text.slice(m.index, i), undefined, one);
    for (const [k, v] of Object.entries(one)) out[k] = { ...v, name: k };
  }
  return out;
}
