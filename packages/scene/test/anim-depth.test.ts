import { describe, expect, it } from 'vitest';
import {
  ANIMATIONS, ANIMATION_GROUPS, TRANSITIONS, addElements, animateAt, animationDuration, animationEnd, animationFillsPage, animationLabel, backOut, bounceOut, clipLength, clipSpeed, clipTime,
  createDoc, cubicBezier, elasticOut, expoOut, findMatches, findRegExp, holdTime, image, matchPairs, parseDoc, pathAt, replaceMatches, sampleKeyframes, shape, spliceRuns, springOut,
  splitPage, stretchAudio, text, transitionLayers, tweenElement, updatePage, video, zoomCrop,
  type Animation, type Doc, type Element, type MotionPath, type TextElement, type VideoElement,
} from '../src/index.ts';
import MOTION from '../src/motion-data.json' with { type: 'json' };

const box = { x: 100, y: 100, w: 200, h: 100 };
function docWith(els: Element[], duration?: number): Doc {
  const d = createDoc({ width: 1000, height: 1000 });
  const doc = addElements(d, d.pages[0]!.id, els);
  return duration ? updatePage(doc, doc.pages[0]!.id, { duration }) : doc;
}
const withAnim = (a: Animation, el: Element = shape('rect', box)) => ({ ...el, animation: a }) as Element;

describe('easing', () => {
  const curves = { backOut, bounceOut, elasticOut, expoOut, spring: (p: number) => springOut(p) };
  it('every curve goes 0 → 1', () => {
    for (const [n, f] of Object.entries(curves)) {
      expect(f(0), n).toBeCloseTo(0, 5);
      expect(f(1), n).toBeCloseTo(1, 5);
    }
  });
  it('back and spring overshoot; bounce stays inside', () => {
    const peak = (f: (p: number) => number) => Math.max(...Array.from({ length: 101 }, (_, i) => f(i / 100)));
    expect(peak(backOut)).toBeGreaterThan(1.05);
    expect(peak((p) => springOut(p))).toBeGreaterThan(1.05);
    expect(peak(bounceOut)).toBeLessThanOrEqual(1.0000001);
  });
  it('cubicBezier matches the CSS keywords', () => {
    const lin = cubicBezier(0, 0, 1, 1);
    expect(lin(0.3)).toBeCloseTo(0.3, 4);
    const ease = cubicBezier(0.25, 0.1, 0.25, 1);
    expect(ease(0.5)).toBeCloseTo(0.8024, 2); // the CSS spec's `ease` at 50 %
  });
});

describe('catalogue', () => {
  it('has Canva\'s sets and names', () => {
    expect(ANIMATION_GROUPS.map((g) => g.label)).toEqual(['Basic', 'Exaggerate', 'Photo motion', 'Text', 'Writing', 'Ambient']);
    const labels = (g: string) => ANIMATIONS.filter((a) => (a.groups as readonly string[]).includes(g)).map((a) => a.type);
    for (const t of ['typewriter', 'ascend', 'shift', 'merge', 'block', 'burst', 'bounce', 'roll', 'skate', 'spread', 'clarify', 'tectonic', 'tumble', 'neon', 'scrapbook', 'stomp', 'rise', 'pan', 'fade', 'pop', 'baseline', 'drift']) expect(labels('text'), t).toContain(t);
    for (const t of ['pulse', 'wiggle', 'flicker', 'rotate']) expect(labels('ambient'), t).toContain(t);
    expect(labels('photo').length).toBeGreaterThanOrEqual(6);
    expect(new Set(ANIMATIONS.map((a) => a.type)).size).toBe(ANIMATIONS.length);
    expect(TRANSITIONS.map((t) => t.type)).toEqual(expect.arrayContaining(['dissolve', 'slide', 'match', 'circle', 'line', 'stack', 'chop', 'flow', 'colorwipe']));
  });

  it('keyframes came through intact: 100 % is the element, 0 % is not (entrances)', () => {
    const data = MOTION as unknown as Record<string, { f: { a: number; o?: number; sx?: number }[] }>;
    for (const n of ['bounceIn', 'flipInX', 'zoomIn', 'rollIn', 'm_puffIn', 'm_swashIn']) {
      const f = data[n]!.f;
      expect(f[0]!.a).toBe(0);
      expect(f.at(-1)!.a).toBe(1);
      expect(f[0]!.o, n).toBe(0);
      expect(f.at(-1)!.o, n).toBeUndefined();
    }
    // opacity in between is interpolated like CSS, not held
    expect(data.bounceIn!.f[1]!.o).toBeCloseTo(1 / 3, 2);
  });

  it('samples keyframes: bounceIn overshoots at 20 %', () => {
    const fx = sampleKeyframes((MOTION as never as Record<string, never>).bounceIn, 0.2, 100, 100, 1);
    expect(fx.sx).toBeCloseTo(1.1, 3);
  });

  it('every non-looping recipe changes the element at the start and leaves it alone at the end', () => {
    for (const { type, loop, span, exit, photo } of ANIMATIONS) {
      const el = withAnim({ type }, photo ? image('a', box) : shape('rect', box));
      const d = docWith([el]);
      const p = d.pages[0]!;
      if (loop || span) { expect(animationFillsPage(p), type).toBe(true); continue; }
      if (exit) {
        expect(animateAt(d, p, 0).elements[0], type).toBe(p.elements[0]);
        expect(animateAt(d, p, 4.99).elements[0], type).not.toBe(p.elements[0]);
        continue;
      }
      expect(animateAt(d, p, 0).elements[0], type).not.toBe(p.elements[0]);
      expect(animateAt(d, p, 4)).toBe(p);
    }
  });
});

describe('In / Out / Both', () => {
  it('out plays the entrance backwards at the end of the page', () => {
    const d = docWith([withAnim({ type: 'fade', phase: 'out', duration: 1 })], 4);
    const page = d.pages[0]!;
    expect(animateAt(d, page, 0)).toBe(page);
    expect(animateAt(d, page, 2.9)).toBe(page);
    const mid = animateAt(d, page, 3.5).elements[0]!;
    expect(mid.opacity).toBeGreaterThan(0.5);
    expect(mid.opacity).toBeLessThan(1);
    expect(animateAt(d, page, 4).elements[0]!.opacity).toBe(0);
  });
  it('both does both, and shares a short page', () => {
    const d = docWith([withAnim({ type: 'fade', phase: 'both', duration: 3 })], 2);
    const page = d.pages[0]!;
    expect(animateAt(d, page, 0).elements[0]!.opacity).toBe(0);
    expect(animateAt(d, page, 1)).toBe(page); // never overlaps: 1 s in, 1 s out
    expect(animateAt(d, page, 2).elements[0]!.opacity).toBe(0);
  });
  it('out follows the element\'s timing window', () => {
    const d = docWith([{ ...withAnim({ type: 'fade', phase: 'out', duration: 1 }), timing: { start: 1, end: 3 } }], 5);
    expect(animateAt(d, d.pages[0]!, 2.5).elements[0]!.opacity).toBeLessThan(1);
    expect(animateAt(d, d.pages[0]!, 3.5).elements).toHaveLength(0);
  });
  it('a loop and an exit use the whole page; holdTime stops before the exit', () => {
    const loop = docWith([withAnim({ type: 'wiggle' })], 4).pages[0]!;
    expect(animationEnd(loop)).toBe(4);
    const out = docWith([withAnim({ type: 'fade', phase: 'out', duration: 1.5 })], 4).pages[0]!;
    expect(animationEnd(out)).toBe(4);
    expect(holdTime(out)).toBeCloseTo(2.5);
    expect(holdTime(docWith([withAnim({ type: 'rise' })], 4).pages[0]!)).toBe(4);
  });
});

describe('options', () => {
  it('intensity scales how far it goes', () => {
    const at = (intensity: number) => {
      const d = docWith([withAnim({ type: 'rise', intensity })]);
      return animateAt(d, d.pages[0]!, 0.2).elements[0]!.live!.ty!;
    };
    expect(at(1)).toBeGreaterThan(at(0.5));
    expect(at(0.5)).toBeGreaterThan(at(0));
  });
  it('direction picks the keyframe family', () => {
    const fx = (direction: Animation['direction']) => {
      const d = docWith([withAnim({ type: 'bounceIn', direction })]);
      return animateAt(d, d.pages[0]!, 0.05).elements[0]!.live!;
    };
    expect(fx('left').tx).toBeLessThan(0);
    expect(fx('right').tx).toBeGreaterThan(0);
    expect(fx('up').ty).toBeLessThan(0);
    expect(fx('down').ty).toBeGreaterThan(0);
  });
  it('a page order staggers forward, backward or together', () => {
    const els = [shape('rect', box), shape('rect', box), shape('rect', box)];
    const d0 = docWith(els);
    const at = (order?: Animation['order']) => {
      const d = updatePage(d0, d0.pages[0]!.id, { animation: { type: 'fade', duration: 0.1, order } });
      return animateAt(d, d.pages[0]!, 0.13).elements.map((e) => e.opacity);
    };
    expect(at()[2]).toBe(0);
    expect(at('reverse')[0]).toBe(0);
    expect(at('reverse')[2]).toBeGreaterThan(0);
    expect(at('together')).toEqual([1, 1, 1]);
  });
  it('by page moves everything as one group, the background stays', () => {
    const d0 = docWith([shape('rect', box), shape('rect', box)]);
    const d = updatePage(d0, d0.pages[0]!.id, { animation: { type: 'fade', duration: 1, by: 'page' } });
    const now = animateAt(d, d.pages[0]!, 0.5);
    expect(now.elements).toHaveLength(1);
    expect(now.elements[0]!.type).toBe('group');
    expect(now.elements[0]!.opacity).toBeGreaterThan(0);
    expect(now.elements[0]!.opacity).toBeLessThan(1);
    expect(animateAt(d, d.pages[0]!, 2).elements).toHaveLength(2);
  });
  it('text units: order and at-rest', () => {
    const el = withAnim({ type: 'rise', by: 'word', duration: 1 }, text('one two three', box)) as TextElement;
    const d = docWith([el]);
    const now = animateAt(d, d.pages[0]!, 0.2).elements[0]!;
    const u = now.live!.units!;
    expect(u.by).toBe('word');
    expect(u.at(0, 3, 50, 20)!.alpha).toBeGreaterThan(0);
    expect(u.at(2, 3, 50, 20)!.alpha).toBe(0); // the last hasn't started
    const late = animateAt(d, d.pages[0]!, 0.75).elements[0]!.live!.units!;
    expect(late.at(0, 3, 50, 20)).toBeNull(); // the first is done
    const rev = animateAt(docWith([{ ...el, animation: { ...el.animation!, order: 'reverse' } }]), d.pages[0]!, 0);
    expect(rev).toBeDefined();
  });
  it('random order is the same every time', () => {
    const el = withAnim({ type: 'fade', by: 'letter', order: 'random', duration: 1 }, text('abcdef', box));
    const d = docWith([el]);
    const read = () => { const u = animateAt(d, d.pages[0]!, 0.4).elements[0]!.live!.units!; return [0, 1, 2, 3, 4, 5].map((i) => u.at(i, 6, 10, 10)?.alpha ?? 1); };
    expect(read()).toEqual(read());
  });
  it('curved text animates whole', () => {
    const el = withAnim({ type: 'rise', by: 'letter' }, { ...text('curve', box), curve: 40 } as TextElement);
    const d = docWith([el]);
    const now = animateAt(d, d.pages[0]!, 0.1).elements[0]!;
    expect(now.live?.units).toBeUndefined();
  });
  it('photos: the picture moves inside the frame', () => {
    const d = docWith([withAnim({ type: 'photoZoomIn' }, image('a', box))], 4);
    const pic = (t: number) => animateAt(d, d.pages[0]!, t).elements[0]!.live!.picture!;
    expect(pic(0).zoom).toBeCloseTo(1);
    expect(pic(2).zoom).toBeGreaterThan(pic(1).zoom);
    expect(zoomCrop({ x: 0, y: 0, w: 1, h: 1 }, { zoom: 2, dx: 0, dy: 0 })).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
    expect(zoomCrop({ x: 0, y: 0, w: 1, h: 1 }, { zoom: 2, dx: 1, dy: -1 })).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
  });
  it('old designs keep their frames', () => {
    const d = docWith([withAnim({ type: 'pop' }), withAnim({ type: 'rise' })]);
    const [pop, rise] = animateAt(d, d.pages[0]!, 0.1).elements;
    expect(pop!.live).toBeUndefined();
    expect(rise!.live).toBeUndefined();
    expect(rise!.y).toBeGreaterThan(box.y);
  });
  it('parse keeps the new fields and drops broken ones', () => {
    const d = docWith([withAnim({ type: 'neon', phase: 'both', by: 'letter', order: 'random', intensity: 0.8 }), shape('rect', box), shape('rect', box)]);
    const raw = JSON.parse(JSON.stringify(d));
    raw.pages[0].elements[1].animation = { type: 'neon', phase: 'sideways', by: 'pixel', order: 'x', intensity: 9 };
    raw.pages[0].elements[2].animation = { type: 'custom' };
    const p = parseDoc(raw);
    expect(p.pages[0]!.elements[0]!.animation).toEqual({ type: 'neon', phase: 'both', by: 'letter', order: 'random', intensity: 0.8 });
    expect(p.pages[0]!.elements[1]!.animation).toEqual({ type: 'neon' });
    expect(p.pages[0]!.elements[2]!.animation).toBeUndefined();
  });
});

describe('hand-drawn paths', () => {
  const path: MotionPath = { points: [[0, 0, 0], [100, 0, 0.9], [100, 100, 1]], style: 'original' };
  it('original keeps the drawing\'s timing', () => {
    expect(pathAt(path, 0)).toMatchObject({ dx: 0, dy: 0 });
    expect(pathAt(path, 0.45).dx).toBeCloseTo(50, 0);
    const end = pathAt(path, 1);
    expect(end.dx).toBeCloseTo(100);
    expect(end.dy).toBeCloseTo(100);
  });
  it('by distance, half way is half the length', () => {
    const line: MotionPath = { points: [[0, 0, 0], [100, 0, 0.1], [200, 0, 1]], style: 'slow' };
    expect(pathAt(line, 0.5).dx).toBeCloseTo(100, 0);
  });
  it('rotation follows the path or spins', () => {
    const turn: MotionPath = { ...path, rotation: 'follow', style: 'smooth' };
    expect(pathAt(turn, 1).r).toBeGreaterThan(40);
    expect(pathAt({ ...path, rotation: 'spin' }, 0.5).r).toBeGreaterThan(100);
    expect(pathAt(path, 0.5).r).toBe(0);
  });
  it('the element stays at the end of its path', () => {
    const d = docWith([withAnim({ type: 'custom', duration: 1, path })], 3);
    const e = animateAt(d, d.pages[0]!, 2.5).elements[0]!;
    expect(e.live!.tx).toBeCloseTo(100);
    expect(e.live!.ty).toBeCloseTo(100);
    expect(animationLabel({ type: 'custom' })).toBe('Custom');
    expect(animationDuration({ type: 'custom', duration: 7 })).toBe(7);
  });
});

describe('transitions', () => {
  const W = 1000, H = 500;
  it('each one starts on the old page and ends on the new one', () => {
    for (const { type } of TRANSITIONS) {
      const end = transitionLayers({ type }, 1, W, H);
      expect(end.next.alpha, type).toBe(1);
      expect(end.next.dx, type).toBeCloseTo(0);
      if (end.next.clip) expect(end.next.clip.w, type).toBeCloseTo(W);
      if (end.next.circle) expect(end.next.circle.r, type).toBeGreaterThanOrEqual(Math.hypot(W, H) / 2 - 1);
      for (const s of end.next.strips ?? []) expect(s.dx, type).toBeCloseTo(0);
      const start = transitionLayers({ type }, 0, W, H);
      expect(start.prev.alpha, type).toBe(1);
      if (start.next.circle) expect(start.next.circle.r, type).toBe(0);
      if (start.next.clip) expect(start.next.clip.w, type).toBeCloseTo(0);
    }
  });
  it('direction moves where a wipe starts', () => {
    expect(transitionLayers({ type: 'circle', direction: 'left' }, 0.5, W, H).next.circle!.x).toBe(0);
    expect(transitionLayers({ type: 'circle' }, 0.5, W, H).next.circle!.x).toBe(W / 2);
    const chop = transitionLayers({ type: 'chop', direction: 'up' }, 0.2, W, H).next.strips!;
    expect(chop.every((s) => s.dx === 0)).toBe(true);
  });
  it('colour wipe: the band covers before the new page shows', () => {
    const t = transitionLayers({ type: 'colorwipe', color: '#ff0000' }, 0.3, W, H);
    expect(t.band!.color).toBe('#ff0000');
    expect(t.next.polys).toHaveLength(1);
  });
  it('match & move pairs by name, picture or text, and tweens the box', () => {
    const a = { ...shape('rect', { x: 0, y: 0, w: 100, h: 100 }), name: 'logo' };
    const b = { ...shape('rect', { x: 500, y: 500, w: 200, h: 200 }), name: 'logo' };
    const d = docWith([a, text('same', box), text('only here', box)]);
    const e = docWith([text('same', { ...box, x: 300 }), b]);
    const pairs = matchPairs(d.pages[0]!, e.pages[0]!);
    expect(pairs).toHaveLength(2);
    const m = pairs.find((p) => p.b.name === 'logo')!;
    const mid = tweenElement(m.a, m.b, 0.5);
    expect(mid.live!.sx).toBeCloseTo(0.75);
    expect(mid.live!.tx).toBeCloseTo(-275);
    const end = tweenElement(m.a, m.b, 1);
    expect(end.live!.tx).toBeCloseTo(0);
    expect(end.live!.sx).toBeCloseTo(1);
  });
});

describe('clip speed', () => {
  const v = (more: Partial<VideoElement>) => ({ ...video('v', box), ...more }) as VideoElement;
  it('reads the file faster or slower', () => {
    expect(clipTime(v({ speed: 2 }), 3, 10)).toBeCloseTo(6);
    expect(clipTime(v({ speed: 0.5, trimStart: 1 }), 3, 10)).toBeCloseTo(2.5);
    expect(clipTime(v({ speed: 2 }), 6, 10)).toBeNull();
    expect(clipTime(v({ speed: 2, loop: true }), 6, 10)).toBeCloseTo(2);
    expect(clipTime(v({}), 3, 10)).toBeCloseTo(3);
  });
  it('length and bounds', () => {
    expect(clipLength(v({ speed: 2 }), 10)).toBe(5);
    expect(clipLength(v({ speed: 0.25, trimStart: 2, trimEnd: 4 }), 10)).toBe(8);
    expect(clipSpeed({ speed: 9 })).toBe(2);
    expect(clipSpeed({ speed: 0.01 })).toBe(0.25);
    expect(clipSpeed({})).toBe(1);
  });
  it('split keeps the file position', () => {
    const d = updatePage(docWith([v({ speed: 2 })]), '', {});
    const page = updatePage(d, d.pages[0]!.id, { duration: 4 });
    const r = splitPage(page, page.pages[0]!.id, 1);
    const second = r.doc.pages[1]!.elements[0] as VideoElement;
    expect(second.trimStart).toBeCloseTo(2);
  });
  it('time stretch: same pitch, new length', () => {
    const rate = 48000, n = rate;
    const tone = new Float32Array(n);
    for (let i = 0; i < n; i++) tone[i] = Math.sin((2 * Math.PI * 440 * i) / rate);
    const crossings = (s: Float32Array, from: number, to: number) => { let c = 0; for (let i = from + 1; i < to; i++) if (s[i - 1]! < 0 && s[i]! >= 0) c++; return (c * rate) / (to - from); };
    for (const speed of [0.5, 2]) {
      const [out] = stretchAudio([tone], speed, rate);
      expect(out!.length).toBe(Math.round(n / speed));
      const m = out!.length;
      expect(crossings(out!, Math.floor(m * 0.2), Math.floor(m * 0.8))).toBeGreaterThan(430);
      expect(crossings(out!, Math.floor(m * 0.2), Math.floor(m * 0.8))).toBeLessThan(450);
    }
    expect(stretchAudio([tone], 1)[0]).toBe(tone);
  });
});

describe('find and replace', () => {
  const rich = (): TextElement => ({ ...text('Art start ART', box), runs: [{ text: 'Art ' }, { text: 'start', style: { bold: true } }, { text: ' ART' }] });
  it('whole word and case', () => {
    expect(findRegExp('')).toBeNull();
    const d = docWith([rich()]);
    expect(findMatches(d, 'art')).toHaveLength(3);
    expect(findMatches(d, 'art', { wholeWord: true })).toHaveLength(2);
    expect(findMatches(d, 'Art', { matchCase: true })).toHaveLength(1);
    expect(findMatches(d, 'a.t')).toHaveLength(0); // literal
  });
  it('replaces keeping runs, across pages, in tables and groups', () => {
    const d = docWith([rich()]);
    const r = replaceMatches(d, 'art', 'Xyz');
    expect(r.count).toBe(3);
    const el = r.doc.pages[0]!.elements[0] as TextElement;
    expect(el.text).toBe('Xyz stXyz Xyz');
    expect(el.runs).toEqual([{ text: 'Xyz ' }, { text: 'stXyz', style: { bold: true } }, { text: ' Xyz' }]);
    expect(el.runs!.map((x) => x.text).join('')).toBe(el.text);
  });
  it('replaces one match only', () => {
    const d = docWith([rich()]);
    const m = findMatches(d, 'art')[1]!;
    const r = replaceMatches(d, 'art', '!', {}, m);
    expect((r.doc.pages[0]!.elements[0] as TextElement).text).toBe('Art st! ART');
    expect(r.count).toBe(1);
  });
  it('a replacement can reach across runs', () => {
    expect(spliceRuns([{ text: 'ab' }, { text: 'cd', style: { bold: true } }, { text: 'ef' }], 1, 5, 'X')).toEqual([{ text: 'aX' }, { text: 'f' }]);
  });
  it('nothing found leaves the same doc', () => {
    const d = docWith([rich()]);
    expect(replaceMatches(d, 'zzz', 'y').doc).toBe(d);
  });
});
