import { describe, expect, it } from 'vitest';
import { PRESETS } from '@digital-canvas/scene';
import { loadView, popularPresets, previewBox, saveView, searchDesigns, SHORTCUTS } from '../src/lib/homeutil.ts';

describe('home helpers', () => {
  it('searches designs by every word of the title', () => {
    const list = [{ title: 'Cafe menu' }, { title: 'Summer sale poster' }, { title: 'Menu for the bar' }];
    expect(searchDesigns(list, 'menu').map((d) => d.title)).toEqual(['Cafe menu', 'Menu for the bar']);
    expect(searchDesigns(list, 'SALE summer')).toEqual([{ title: 'Summer sale poster' }]);
    expect(searchDesigns(list, '  ')).toBe(list);
  });

  it('popular presets and shortcuts point at real presets', () => {
    const pop = popularPresets(PRESETS);
    expect(pop.length).toBeGreaterThan(8);
    expect(pop[0]!.id).toBe('instagram-post');
    for (const s of SHORTCUTS) if (s.preset) expect(PRESETS.some((p) => p.id === s.preset)).toBe(true);
  });

  it('remembers grid or list', () => {
    const m = new Map<string, string>();
    const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(loadView(st)).toBe('grid');
    saveView('list', st);
    expect(loadView(st)).toBe('list');
  });

  it('preview boxes keep the aspect ratio', () => {
    expect(previewBox({ width: 1920, height: 1080 })).toEqual({ w: 64, h: 36 });
    expect(previewBox({ width: 1080, height: 1920 })).toEqual({ w: 36, h: 64 });
  });
});
