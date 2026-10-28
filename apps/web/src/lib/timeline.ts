/**
 * Pure maths of Canva's video timeline (VideoTimeline.svelte): where scenes sit
 * on the filmstrip, time ↔ x, dragging a scene's edge (duration), dragging to
 * reorder, element timing bars, sound clips (move / trim), waveform peaks and
 * frame steps. No DOM, unit tested in apps/web/test/timeline.test.ts.
 */
import { pageDuration, type AudioClip, type Doc, type Element } from '@digital-canvas/scene';

/** Shortest scene / timing window / sound, seconds (Canva: 0.1 s). */
export const MIN_LEN = 0.1;
export const MAX_SCENE = 3600;
/** A hidden scene shows as a narrow chip: it takes no time. */
export const HIDDEN_W = 28;
/** Gap between scenes on the strip, px. */
export const GAP = 4;
export const FPS = 30;
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 12;

const round = (n: number, step = 0.1) => Math.round(n / step) * step;
const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface Slot {
  id: string;
  /** Index in doc.pages. */
  i: number;
  hidden: boolean;
  /** Seconds on the timeline (hidden scenes: where they would sit; they take no time). */
  start: number;
  /** Seconds (0 for hidden scenes). */
  d: number;
  /** px from the strip's left edge. */
  x: number;
  w: number;
}

/**
 * Pixels per second: at zoom 1 the whole video fits `width` (minus the gaps
 * and hidden chips); zooming in stretches it (the strip then scrolls).
 */
export function pxPerSecond(doc: Doc, width: number, zoom = 1): number {
  const total = doc.pages.filter((p) => !p.hidden).reduce((t, p) => t + pageDuration(p), 0);
  const fixed = doc.pages.filter((p) => p.hidden).length * HIDDEN_W + Math.max(0, doc.pages.length - 1) * GAP;
  return Math.max(4, ((Math.max(60, width - fixed)) / Math.max(0.1, total)) * clamp(zoom, ZOOM_MIN, ZOOM_MAX));
}

/** Scenes on the strip: widths proportional to their durations. */
export function layoutScenes(doc: Doc, pps: number): Slot[] {
  let x = 0, t = 0;
  return doc.pages.map((p, i) => {
    const hidden = !!p.hidden;
    const d = hidden ? 0 : pageDuration(p);
    const w = hidden ? HIDDEN_W : d * pps;
    const s: Slot = { id: p.id, i, hidden, start: t, d, x, w };
    x += w + GAP;
    t += d;
    return s;
  });
}

export const stripWidth = (slots: Slot[]): number => (slots.length ? slots[slots.length - 1]!.x + slots[slots.length - 1]!.w : 0);

/** x on the strip of time `t` (the playhead). */
export function timeToX(slots: Slot[], t: number): number {
  const vis = slots.filter((s) => !s.hidden);
  if (!vis.length) return 0;
  for (const s of vis) if (t < s.start + s.d) return s.x + Math.max(0, t - s.start) / s.d * s.w;
  const last = vis[vis.length - 1]!;
  return last.x + last.w;
}

/** Time at x on the strip (gaps and hidden chips snap to the nearest scene edge). */
export function xToTime(slots: Slot[], x: number): number {
  const vis = slots.filter((s) => !s.hidden);
  if (!vis.length) return 0;
  for (const s of vis) {
    if (x < s.x) return s.start;
    if (x <= s.x + s.w) return s.start + ((x - s.x) / s.w) * s.d;
  }
  const last = vis[vis.length - 1]!;
  return last.start + last.d;
}

/** A scene's new duration while its right edge is dragged `dx` px (0.1 s steps). */
export function dragDuration(d0: number, dx: number, pps: number): number {
  return r2(clamp(round(d0 + dx / pps), MIN_LEN, MAX_SCENE));
}

/** Where a scene dragged to strip x lands: its new index in doc.pages. */
export function reorderTarget(slots: Slot[], from: number, x: number): number {
  let to = 0;
  for (const s of slots) if (x > s.x + s.w / 2) to = s.i + 1;
  // index once the scene is taken out of its old place
  return clamp(to > from ? to - 1 : to, 0, slots.length - 1);
}

// ---- element timing (captions etc.: when an element shows within its scene) ----

export interface Window { start: number; end: number }

/** The element's window in its scene (whole scene when it has none). */
export function timingOf(el: Pick<Element, 'timing'>, sceneLen: number): Window {
  const s = clamp(el.timing?.start ?? 0, 0, sceneLen);
  const e = clamp(el.timing?.end ?? sceneLen, s, sceneLen);
  return { start: s, end: e };
}

/**
 * Drag an edge (or the whole bar) of a timing window by `dt` seconds. Returns
 * the element's new `timing` (undefined = the whole scene).
 */
export function dragTiming(w0: Window, part: 'start' | 'end' | 'move', dt: number, sceneLen: number): Element['timing'] {
  let { start, end } = w0;
  if (part === 'start') start = clamp(round(start + dt), 0, end - MIN_LEN);
  else if (part === 'end') end = clamp(round(end + dt), start + MIN_LEN, sceneLen);
  else {
    const len = end - start;
    start = clamp(round(start + dt), 0, Math.max(0, sceneLen - len));
    end = start + len;
  }
  start = r2(start);
  end = r2(end);
  const out: { start?: number; end?: number } = {};
  if (start > 0) out.start = start;
  if (end < sceneLen - 1e-6) out.end = end;
  return out.start === undefined && out.end === undefined ? undefined : out;
}

// ---- sounds ----

/** Move a sound along the timeline (never before 0). */
export function moveAudio(c: Pick<AudioClip, 'start'>, dt: number): Pick<AudioClip, 'start'> {
  return { start: r2(Math.max(0, round(c.start + dt))) };
}

/**
 * Trim a sound's left or right edge by `dt` seconds. The left edge moves the
 * start and the offset into the file together, so the sound stays in place
 * under the cursor. `fileLen` = the file's length (Infinity when unknown).
 */
export function trimAudio(c: Pick<AudioClip, 'start' | 'offset' | 'duration'>, edge: 'start' | 'end', dt: number, fileLen = Infinity): Pick<AudioClip, 'start' | 'offset' | 'duration'> {
  if (edge === 'end') {
    const max = Math.max(MIN_LEN, fileLen - c.offset);
    return { start: c.start, offset: c.offset, duration: r2(clamp(round(c.duration + dt), MIN_LEN, max)) };
  }
  // left edge: not before the file start nor the timeline start, keep MIN_LEN
  const lo = Math.max(-c.offset, -c.start), hi = c.duration - MIN_LEN;
  const k = clamp(round(dt), lo, hi);
  return { start: r2(c.start + k), offset: r2(c.offset + k), duration: r2(c.duration - k) };
}

/** `n` loudness bars (0..1) from mono samples: the peak of each slice, scaled to the loudest. */
export function peaks(samples: ArrayLike<number>, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  if (!samples.length || n <= 0) return out;
  const per = samples.length / n;
  let top = 0;
  for (let b = 0; b < n; b++) {
    let m = 0;
    const a = Math.floor(b * per), z = Math.min(samples.length, Math.floor((b + 1) * per));
    for (let i = a; i < z; i++) { const v = Math.abs(samples[i]!); if (v > m) m = v; }
    out[b] = m;
    if (m > top) top = m;
  }
  return top > 0 ? out.map((v) => v / top) : out;
}

/** Previous / next frame from `t` (←/→ when paused). */
export function stepFrame(t: number, dir: -1 | 1, total: number, fps = FPS): number {
  const f = Math.round(t * fps) + dir;
  return clamp(f / fps, 0, total);
}

/** Label of a scene's length on the strip, Canva style: "5.0s". */
export const durationLabel = (d: number): string => (d >= 60 ? `${Math.floor(d / 60)}m${Math.round(d % 60)}s` : `${d.toFixed(1)}s`);

/** Overlapping sounds go on separate rows of the audio lane (greedy, in start order): clip id → row. */
export function audioRows(clips: readonly Pick<AudioClip, 'id' | 'start' | 'duration'>[]): { rows: Record<string, number>; count: number } {
  const ends: number[] = [];
  const rows: Record<string, number> = {};
  for (const c of [...clips].sort((a, b) => a.start - b.start)) {
    let r = ends.findIndex((e) => e <= c.start + 1e-6);
    if (r < 0) r = ends.push(0) - 1;
    ends[r] = c.start + c.duration;
    rows[c.id] = r;
  }
  return { rows, count: ends.length };
}
