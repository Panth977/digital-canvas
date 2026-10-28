import { describe, expect, it } from 'vitest';
import { addPage, createDoc, updatePage, type Doc } from '@digital-canvas/scene';
import {
  GAP, HIDDEN_W, audioRows, dragDuration, dragTiming, durationLabel, layoutScenes, moveAudio, peaks, pxPerSecond, reorderTarget, stepFrame, stripWidth, timeToX, timingOf, trimAudio, xToTime,
} from '../src/lib/timeline.ts';

function reel(durations: number[], hidden: number[] = []): Doc {
  let d = createDoc({ width: 1080, height: 1920 });
  for (let i = 1; i < durations.length; i++) d = addPage(d).doc;
  d.pages.forEach((p, i) => { d = updatePage(d, p.id, { duration: durations[i], ...(hidden.includes(i) ? { hidden: true } : {}) }); });
  return d;
}

describe('video timeline maths', () => {
  it('scene widths are proportional to durations and the video fits at zoom 1', () => {
    const d = reel([2, 4, 6]);
    const pps = pxPerSecond(d, 1200 + 2 * GAP);
    expect(pps).toBeCloseTo(100);
    const s = layoutScenes(d, pps);
    expect(s.map((x) => Math.round(x.w))).toEqual([200, 400, 600]);
    expect(s.map((x) => x.start)).toEqual([0, 2, 6]);
    expect(s[1]!.x).toBeCloseTo(200 + GAP);
    expect(stripWidth(s)).toBeCloseTo(1200 + 2 * GAP);
    expect(pxPerSecond(d, 1200 + 2 * GAP, 2)).toBeCloseTo(200);
  });

  it('hidden scenes are narrow chips that take no time', () => {
    const d = reel([2, 3, 2], [1]);
    const s = layoutScenes(d, 100);
    expect(s[1]!.w).toBe(HIDDEN_W);
    expect(s[1]!.d).toBe(0);
    expect(s[2]!.start).toBe(2);
    expect(timeToX(s, 2.5)).toBeCloseTo(s[2]!.x + 50);
  });

  it('time ↔ x round trips; gaps snap to scene edges', () => {
    const s = layoutScenes(reel([2, 4]), 100);
    for (const t of [0, 0.5, 1.99, 2, 3.3, 5.9]) expect(xToTime(s, timeToX(s, t))).toBeCloseTo(t);
    expect(xToTime(s, 200 + GAP / 2)).toBe(2);
    expect(xToTime(s, -50)).toBe(0);
    expect(xToTime(s, 99999)).toBe(6);
    expect(timeToX(s, 99)).toBeCloseTo(stripWidth(s));
  });

  it('dragging a scene edge changes its duration in 0.1 s steps (≥ 0.1 s)', () => {
    expect(dragDuration(5, 100, 100)).toBe(6);
    expect(dragDuration(5, 34, 100)).toBe(5.3);
    expect(dragDuration(1, -1000, 100)).toBe(0.1);
  });

  it('reorder target from the drop x', () => {
    const s = layoutScenes(reel([2, 2, 2]), 100);
    expect(reorderTarget(s, 0, 50)).toBe(0);
    expect(reorderTarget(s, 0, 350)).toBe(1); // past the middle of scene 2
    expect(reorderTarget(s, 0, 9999)).toBe(2);
    expect(reorderTarget(s, 2, 10)).toBe(0);
    expect(reorderTarget(s, 2, 150)).toBe(1);
  });

  it('element timing: edges, move, whole scene = undefined', () => {
    expect(timingOf({}, 5)).toEqual({ start: 0, end: 5 });
    expect(timingOf({ timing: { start: 1, end: 9 } }, 5)).toEqual({ start: 1, end: 5 });
    expect(dragTiming({ start: 0, end: 5 }, 'start', 1.04, 5)).toEqual({ start: 1 });
    expect(dragTiming({ start: 0, end: 5 }, 'end', -2, 5)).toEqual({ end: 3 });
    expect(dragTiming({ start: 1, end: 2 }, 'start', 5, 5)).toEqual({ start: 1.9, end: 2 });
    expect(dragTiming({ start: 1, end: 2 }, 'move', 10, 5)).toEqual({ start: 4 });
    expect(dragTiming({ start: 1, end: 2 }, 'move', -10, 5)).toEqual({ end: 1 });
    expect(dragTiming({ start: 1, end: 5 }, 'start', -3, 5)).toBeUndefined();
  });

  it('sounds move and trim', () => {
    expect(moveAudio({ start: 1 }, -3)).toEqual({ start: 0 });
    expect(moveAudio({ start: 1 }, 1.26)).toEqual({ start: 2.3 });
    const c = { start: 2, offset: 1, duration: 4 };
    expect(trimAudio(c, 'end', 10, 6)).toEqual({ start: 2, offset: 1, duration: 5 });
    expect(trimAudio(c, 'end', -10, 6)).toEqual({ start: 2, offset: 1, duration: 0.1 });
    expect(trimAudio(c, 'start', 1, 6)).toEqual({ start: 3, offset: 2, duration: 3 });
    expect(trimAudio(c, 'start', -5, 6)).toEqual({ start: 1, offset: 0, duration: 5 });
  });

  it('peaks, frame steps, labels', () => {
    expect(peaks([0, 0.5, -1, 0.25], 2)).toEqual([0.5, 1]);
    expect(peaks([], 3)).toEqual([0, 0, 0]);
    expect(stepFrame(1, 1, 10)).toBeCloseTo(1 + 1 / 30);
    expect(stepFrame(0, -1, 10)).toBe(0);
    expect(durationLabel(5)).toBe('5.0s');
    expect(durationLabel(75)).toBe('1m15s');
  });

  it('overlapping sounds stack on rows', () => {
    const r = audioRows([{ id: 'a', start: 0, duration: 4 }, { id: 'b', start: 2, duration: 2 }, { id: 'c', start: 4, duration: 1 }]);
    expect(r).toEqual({ rows: { a: 0, b: 1, c: 0 }, count: 2 });
    expect(audioRows([]).count).toBe(0);
  });
});
