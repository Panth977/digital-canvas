import { describe, expect, it } from 'vitest';
import { Stopwatch, clock, nextPage } from '../src/lib/present.ts';
import { pathFromSamples } from '../src/lib/motionpath.ts';
import { gifFrames, gifPageDuration } from '../src/lib/giftime.ts';

describe('presenter timers', () => {
  it('clock', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(65.9)).toBe('1:05');
    expect(clock(3725)).toBe('1:02:05');
    expect(clock(-3)).toBe('0:00');
  });
  it('stopwatch pauses, resumes and resets on wall time', () => {
    let t = 1000;
    const w = new Stopwatch(() => t);
    t += 2000;
    expect(w.seconds).toBeCloseTo(2);
    w.pause();
    t += 5000;
    expect(w.seconds).toBeCloseTo(2);
    expect(w.running).toBe(false);
    w.resume();
    t += 1000;
    expect(w.seconds).toBeCloseTo(3);
    w.reset();
    expect(w.seconds).toBe(0);
  });
  it('autoplay stops at the end, or loops', () => {
    expect(nextPage(0, 3, false)).toBe(1);
    expect(nextPage(2, 3, false)).toBeNull();
    expect(nextPage(2, 3, true)).toBe(0);
    expect(nextPage(0, 1, true)).toBeNull();
  });
});

describe('drawing a motion path', () => {
  const line = (n: number) => Array.from({ length: n }, (_, i) => ({ x: 100 + i * 2, y: 50, t: 10 + i / 100 }));
  it('offsets from the start, time 0..1, seconds as drawn', () => {
    const r = pathFromSamples(line(101))!;
    expect(r.points[0]).toEqual([0, 0, 0]);
    expect(r.points.at(-1)).toEqual([200, 0, 1]);
    expect(r.seconds).toBeCloseTo(1);
  });
  it('a long drawing is thinned, its end kept', () => {
    const r = pathFromSamples(line(2000))!;
    expect(r.points.length).toBeLessThanOrEqual(65);
    expect(r.points.at(-1)![0]).toBeCloseTo(3998);
  });
  it('a click is not a path', () => {
    expect(pathFromSamples([{ x: 1, y: 1, t: 0 }, { x: 2, y: 2, t: 0.1 }])).toBeNull();
    expect(pathFromSamples([])).toBeNull();
  });
});

describe('GIF timing with exits and loops', () => {
  it('a page that fills its time gets no hold after it', () => {
    expect(gifPageDuration(false, 5, 5, true)).toBe(5);
    expect(gifPageDuration(false, 5, 1)).toBe(3);
    const f = gifFrames([{ duration: 2, animEnd: 2 }], 10);
    expect(f).toHaveLength(20);
    expect(f.at(-1)!.t).toBeCloseTo(1.9);
  });
});
