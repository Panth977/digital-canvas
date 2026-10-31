import type { MotionPath } from '@digital-canvas/scene';

/** Canva's "Create an animation": the element whose path is being drawn on the stage. */
class MotionDraw {
  id = $state<string | null>(null);
  start(id: string): void { this.id = id; }
  stop(): void { this.id = null; }
}
export const motionDraw = new MotionDraw();

const MAX_POINTS = 64;
/** Shorter than this is a click, not a path (page units). */
export const MIN_PATH = 8;

/** Pointer samples → a path: offsets from the start, time 0..1, thinned to at most 64 points. */
export function pathFromSamples(samples: readonly { x: number; y: number; t: number }[], minStep = 3): { points: MotionPath['points']; seconds: number } | null {
  const first = samples[0], last = samples[samples.length - 1];
  if (!first || !last || samples.length < 2) return null;
  const seconds = last.t - first.t;
  const kept = [first];
  for (const s of samples.slice(1)) {
    const k = kept[kept.length - 1]!;
    if (Math.hypot(s.x - k.x, s.y - k.y) >= minStep) kept.push(s);
  }
  if (kept[kept.length - 1] !== last) kept.push(last);
  const step = Math.max(1, (kept.length - 1) / (MAX_POINTS - 1));
  const thin: typeof kept = [];
  for (let i = 0; i < kept.length - 0.5; i += step) thin.push(kept[Math.round(i)]!);
  if (thin[thin.length - 1] !== last) thin.push(last);
  const r = (n: number) => Math.round(n * 10) / 10;
  const span = Math.max(1e-6, seconds);
  const points: MotionPath['points'] = thin.map((s) => [r(s.x - first.x), r(s.y - first.y), Math.round(((s.t - first.t) / span) * 1000) / 1000]);
  const far = Math.max(...points.map((q) => Math.hypot(q[0], q[1])));
  return far < MIN_PATH ? null : { points, seconds };
}
