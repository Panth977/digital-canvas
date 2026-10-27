import { describe, expect, it } from 'vitest';
import { gifFrames, gifPageDuration } from '../src/lib/giftime.ts';

describe('GIF frame timeline', () => {
  it('a static page is one frame', () => {
    expect(gifFrames([{ duration: 3, animEnd: 0 }], 15)).toEqual([{ page: 0, t: 0, delay: 3000 }]);
  });

  it('animated frames at fps, then one long hold', () => {
    const f = gifFrames([{ duration: 3, animEnd: 1 }], 10);
    expect(f).toHaveLength(11);
    expect(f.slice(0, 10).every((x) => x.delay === 100)).toBe(true);
    expect(f[9]!.t).toBeCloseTo(0.9);
    expect(f[10]).toEqual({ page: 0, t: 1, delay: 2000 });
    const total = f.reduce((s, x) => s + x.delay, 0);
    expect(total).toBe(3000);
  });

  it('pages follow each other', () => {
    const f = gifFrames([{ duration: 2, animEnd: 0 }, { duration: 2, animEnd: 0.5 }], 10);
    expect(f.map((x) => x.page)).toEqual([0, 1, 1, 1, 1, 1, 1]);
  });

  it('page duration: video keeps its own, a still design ~3 s or longer for a long animation', () => {
    expect(gifPageDuration(true, 7, 1)).toBe(7);
    expect(gifPageDuration(false, 5, 0)).toBe(3);
    expect(gifPageDuration(false, 5, 4)).toBe(5);
  });
});
