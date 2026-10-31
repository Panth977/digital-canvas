/**
 * Easing curves, pure. The named shapes are Robert Penner's easing equations
 * (BSD-3-Clause); `springOut` is the under-damped harmonic oscillator, the same
 * maths as Motion's spring (MIT); `cubicBezier` solves the CSS timing function.
 * All take and return progress, 0 → 1 (overshooting curves leave that range).
 */
export type Ease = (p: number) => number;

export const linear: Ease = (p) => p;
export const sineIn: Ease = (p) => 1 - Math.cos((p * Math.PI) / 2);
export const sineOut: Ease = (p) => Math.sin((p * Math.PI) / 2);
export const sineInOut: Ease = (p) => -(Math.cos(Math.PI * p) - 1) / 2;
export const quadOut: Ease = (p) => 1 - (1 - p) ** 2;
export const quadInOut: Ease = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
export const cubicIn: Ease = (p) => p ** 3;
export const cubicOut: Ease = (p) => 1 - (1 - p) ** 3;
export const cubicInOut: Ease = (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2);
export const quartOut: Ease = (p) => 1 - (1 - p) ** 4;
export const expoOut: Ease = (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p));
export const expoIn: Ease = (p) => (p <= 0 ? 0 : 2 ** (10 * p - 10));
const BACK = 1.70158;
export const backIn: Ease = (p) => (BACK + 1) * p ** 3 - BACK * p ** 2;
export const backOut: Ease = (p) => 1 + (BACK + 1) * (p - 1) ** 3 + BACK * (p - 1) ** 2;
export const elasticOut: Ease = (p) => (p <= 0 ? 0 : p >= 1 ? 1 : 2 ** (-10 * p) * Math.sin(((p * 10 - 0.75) * (2 * Math.PI)) / 3) + 1);
export const bounceOut: Ease = (p) => {
  const n = 7.5625, d = 2.75;
  if (p < 1 / d) return n * p * p;
  if (p < 2 / d) { const q = p - 1.5 / d; return n * q * q + 0.75; }
  if (p < 2.5 / d) { const q = p - 2.25 / d; return n * q * q + 0.9375; }
  const q = p - 2.625 / d;
  return n * q * q + 0.984375;
};

/** A spring settling on 1; `zeta` < 1 overshoots. `p` = 1 is `turns` oscillations in, and lands exactly on 1. */
export function springOut(p: number, zeta = 0.45, turns = 2.5): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const w = 2 * Math.PI * turns;
  const wd = w * Math.sqrt(1 - zeta * zeta);
  const v = 1 - Math.exp(-zeta * w * p) * (Math.cos(wd * p) + ((zeta * w) / wd) * Math.sin(wd * p));
  // fade the leftover at p = 1 so the curve is exact there
  const end = 1 - Math.exp(-zeta * w) * (Math.cos(wd) + ((zeta * w) / wd) * Math.sin(wd));
  return v + (1 - end) * p;
}

/** CSS cubic-bezier(x1, y1, x2, y2) as a function of progress. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const bez = (a: number, b: number, t: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
  const slope = (a: number, b: number, t: number) => 3 * (1 - t) ** 2 * a + 6 * (1 - t) * t * (b - a) + 3 * t * t * (1 - b);
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = bez(x1, x2, t) - x;
      if (Math.abs(err) < 1e-6) break;
      const d = slope(x1, x2, t);
      if (Math.abs(d) < 1e-6) break;
      t = Math.max(0, Math.min(1, t - err / d));
    }
    return bez(y1, y2, t);
  };
}
