import { describe, expect, it } from 'vitest';
import { MAX_LIVE, afterClose, cycle, dropIndex, nth, parseSaved, reorder, stripMode, toEvict } from '../src/lib/tabmodel.ts';

describe('design tabs: where the strip goes', () => {
  const env = { mobile: false, wco: false, standalone: false, count: 0 };
  it('installed app with Window Controls Overlay: in the title bar, always (even narrow)', () => {
    expect(stripMode({ ...env, wco: true, standalone: true })).toBe('titlebar');
    expect(stripMode({ ...env, wco: true, standalone: true, mobile: true })).toBe('titlebar');
  });
  it('installed app with the title bar toggled off: a thin bar, always', () => {
    expect(stripMode({ ...env, standalone: true })).toBe('bar');
    expect(stripMode({ ...env, standalone: true, count: 1 })).toBe('bar');
  });
  it('browser tab: only once a second design is open', () => {
    expect(stripMode({ ...env, count: 0 })).toBe('none');
    expect(stripMode({ ...env, count: 1 })).toBe('none');
    expect(stripMode({ ...env, count: 2 })).toBe('bar');
  });
  it('phones: none', () => {
    expect(stripMode({ ...env, mobile: true, count: 5 })).toBe('none');
    expect(stripMode({ ...env, mobile: true, standalone: true, count: 5 })).toBe('none');
  });
});

describe('design tabs: list operations', () => {
  it('reorders', () => {
    expect(reorder(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(reorder(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(reorder(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
    expect(reorder(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
  it('drop slot from the dragged tab centre', () => {
    const c = [50, 150, 250, 350];
    expect(dropIndex(c, 3, 20)).toBe(0);
    expect(dropIndex(c, 3, 160)).toBe(2);
    expect(dropIndex(c, 0, 300)).toBe(2);
    expect(dropIndex(c, 0, 360)).toBe(3);
    expect(dropIndex(c, 1, 150)).toBe(1);
  });
  it('Ctrl+Tab cycles through Home and the designs, wrapping', () => {
    const ids = ['a', 'b', 'c'];
    expect(cycle(ids, null, 1)).toBe('a');
    expect(cycle(ids, 'c', 1)).toBe(null);
    expect(cycle(ids, 'a', -1)).toBe(null);
    expect(cycle(ids, null, -1)).toBe('c');
    expect(cycle([], null, 1)).toBe(null);
  });
  it('⌘1..⌘8 pick a tab, ⌘9 the last', () => {
    expect(nth(['a', 'b', 'c'], 1)).toBe('a');
    expect(nth(['a', 'b', 'c'], 3)).toBe('c');
    expect(nth(['a', 'b', 'c'], 4)).toBe(undefined);
    expect(nth(['a', 'b', 'c'], 9)).toBe('c');
  });
  it('closing the active tab shows its right neighbour, else the left, else Home', () => {
    expect(afterClose(['a', 'b', 'c'], 'b', 'b')).toBe('c');
    expect(afterClose(['a', 'b', 'c'], 'c', 'c')).toBe('b');
    expect(afterClose(['a'], 'a', 'a')).toBe(null);
    expect(afterClose(['a', 'b', 'c'], 'a', 'c')).toBe('c');
    expect(afterClose(['a', 'b'], 'a', null)).toBe(null);
  });
  it(`keeps at most ${MAX_LIVE} editors, suspending the least recently used, never the active one`, () => {
    const used = new Map(Array.from({ length: 10 }, (_, i) => [`t${i}`, i] as [string, number]));
    expect(toEvict(used, 't5')).toEqual(['t0', 't1']);
    expect(toEvict(used, 't0')).toEqual(['t1', 't2']);
    expect(toEvict(new Map([['a', 1]]), 'a')).toEqual([]);
  });
  it('reads saved tabs defensively', () => {
    expect(parseSaved(JSON.stringify([{ id: 'd_1', title: 'One' }, { id: 'd_1', title: 'dup' }, { id: '../x' }, { id: 'd_2' }, 3]))).toEqual([
      { id: 'd_1', title: 'One' },
      { id: 'd_2', title: 'Untitled design' },
    ]);
    expect(parseSaved('nope')).toEqual([]);
    expect(parseSaved(null)).toEqual([]);
  });
});
