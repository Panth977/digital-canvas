import { describe, expect, it } from 'vitest';
import {
  addElements, animateAt, animationEnd, animationLabel, ANIMATIONS, createDoc, parseDoc, shape, text, typeText, updatePage, PAGE_STAGGER,
  type Doc, type Element,
} from '../src/index.ts';

function docWith(els: Element[]): Doc {
  const d = createDoc({ width: 1000, height: 1000 });
  return addElements(d, d.pages[0]!.id, els);
}

describe('animations', () => {
  const box = { x: 100, y: 100, w: 200, h: 100 };

  it('every type starts changed and ends exactly as designed', () => {
    for (const { type } of ANIMATIONS) {
      const el = { ...(type === 'typewriter' ? text('Hello', box) : shape('rect', box)), animation: { type } } as Element;
      const d = docWith([el]);
      const page = d.pages[0]!;
      const start = animateAt(d, page, 0).elements[0]!;
      expect(start, type).not.toEqual(page.elements[0]);
      const done = animateAt(d, page, 5);
      expect(done).toBe(page);
      expect(done.elements[0]).toEqual(page.elements[0]);
    }
  });

  it('fade, rise and pan at t = 0', () => {
    const d = docWith([
      { ...shape('rect', box), animation: { type: 'fade' } },
      { ...shape('rect', box), animation: { type: 'rise' } },
      { ...shape('rect', box), animation: { type: 'pan', direction: 'right' } },
      { ...shape('rect', box), animation: { type: 'pop' } },
    ]);
    const [f, r, p, pop] = animateAt(d, d.pages[0]!, 0).elements;
    expect(f!.opacity).toBe(0);
    expect(r!.y).toBeGreaterThan(box.y);
    expect(p!.x).toBeGreaterThan(box.x);
    expect(pop!.w).toBeLessThan(1);
    // halfway: visible, not yet in place
    const half = animateAt(d, d.pages[0]!, 0.4).elements[1]!;
    expect(half.opacity).toBeGreaterThan(0);
    expect(half.y).toBeGreaterThan(box.y);
  });

  it('typewriter shows the text a character at a time, runs included', () => {
    const el = { ...text('Hello world', box), animation: { type: 'typewriter' as const, duration: 1.1 } };
    const d = docWith([el]);
    expect((animateAt(d, d.pages[0]!, 0).elements[0] as { text: string }).text).toBe('');
    expect((animateAt(d, d.pages[0]!, 0.5).elements[0] as { text: string }).text).toBe('Hello');
    const rich = typeText({ ...el, runs: [{ text: 'Hello ' }, { text: 'world', style: { bold: true } }] }, 8);
    expect(rich.text).toBe('Hello wo');
    expect(rich.runs).toEqual([{ text: 'Hello ' }, { text: 'wo', style: { bold: true } }]);
  });

  it('a page animation staggers the elements without their own', () => {
    let d = docWith([shape('rect', box), shape('rect', box), { ...shape('rect', box), animation: { type: 'pop' } }]);
    d = updatePage(d, d.pages[0]!.id, { animation: { type: 'fade', duration: 1 } });
    const page = d.pages[0]!;
    const at = (t: number) => animateAt(d, page, t).elements.map((e) => e.opacity);
    expect(at(0)[0]).toBe(0);
    expect(at(PAGE_STAGGER)[0]).toBeGreaterThan(0);
    expect(at(PAGE_STAGGER)[1]).toBe(0); // the second starts one stagger later
    expect(animationEnd(page)).toBeCloseTo(1 + PAGE_STAGGER);
    expect(animateAt(d, page, 2)).toBe(page);
  });

  it('labels and parsing: bad animations are dropped, good ones kept', () => {
    expect(animationLabel(undefined)).toBe('None');
    expect(animationLabel({ type: 'pan' })).toBe('Pan');
    const d = docWith([{ ...shape('rect', box), animation: { type: 'rise', duration: 2 } }, shape('rect', box)]);
    const raw = JSON.parse(JSON.stringify(d));
    raw.pages[0].elements[1].animation = { type: 'explode' };
    raw.pages[0].animation = { type: 'pan', direction: 'sideways', duration: -1 };
    const p = parseDoc(raw);
    expect(p.pages[0]!.elements[0]!.animation).toEqual({ type: 'rise', duration: 2 });
    expect(p.pages[0]!.elements[1]!.animation).toBeUndefined();
    expect(p.pages[0]!.animation).toEqual({ type: 'pan' });
  });
});
