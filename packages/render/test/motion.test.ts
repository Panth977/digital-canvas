import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CanvasKit, Surface } from 'canvaskit-wasm';
import { ANIMATIONS, TRANSITIONS, addElements, addPage, animateAt, createDoc, shape, text, updatePage, type Animation, type Doc, type Element } from '@digital-canvas/scene';
import { FontLibrary, Renderer, drawFrameAt } from '../src/index.ts';

const require = createRequire(import.meta.url);
const fontDir = new URL('../../../apps/web/public/fonts/', import.meta.url);
let ck: CanvasKit;
let renderer: Renderer;
let surface: Surface;
const W = 400, H = 240;

beforeAll(async () => {
  const init = require('canvaskit-wasm/bin/full/canvaskit.js');
  ck = await init();
  const fonts = new FontLibrary(ck);
  await fonts.loadBundled(fontDir.href, async (url) => readFileSync(new URL(url)).buffer as ArrayBuffer);
  renderer = new Renderer(ck, fonts);
  surface = ck.MakeSurface(W, H)!;
});

function grab(draw: (c: ReturnType<Surface['getCanvas']>) => void): Uint8Array {
  const c = surface.getCanvas();
  c.clear(ck.WHITE);
  draw(c);
  surface.flush();
  const img = surface.makeImageSnapshot();
  const px = img.readPixels(0, 0, { width: W, height: H, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array;
  img.delete();
  return px.slice();
}
const diff = (a: Uint8Array, b: Uint8Array) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!) > 24) n++; return n; };

function doc(el: Element, duration = 3): Doc {
  const d = createDoc({ width: W, height: H });
  return updatePage(addElements(d, d.pages[0]!.id, [el]), d.pages[0]!.id, { duration, background: { type: 'solid', color: '#ffffff' } });
}
const at = (d: Doc, t: number) => grab((c) => drawFrameAt(renderer, c, d, t));
const headline = (a: Animation): Element => ({ ...text('Motion words', { x: 40, y: 80, w: 320, h: 70 }), style: { ...text('x', { x: 0, y: 0, w: 1, h: 1 }).style, fontSize: 48, color: '#112244' }, animation: a }) as Element;
const square = (a: Animation): Element => ({ ...shape('rect', { x: 150, y: 70, w: 100, h: 100 }, { type: 'solid', color: '#cc2244' }), animation: a }) as Element;

describe('animations in real pixels', () => {
  it('every entrance is drawn differently from the design part-way, and lands on it exactly', () => {
    for (const { type, loop, span, exit, photo } of ANIMATIONS) {
      if (photo || exit) continue;
      const d = doc(square({ type, duration: 0.8 }));
      const still = grab((c) => renderer.drawPage(c, d, d.pages[0]!));
      expect(Math.max(...[0.1, 0.2, 0.28, 0.4, 0.55].map((t) => diff(at(d, t), still))), `${type} part-way`).toBeGreaterThan(10);
      if (!loop && !span) expect(diff(at(d, 2), still), `${type} at rest`).toBe(0);
    }
  });

  it('every text recipe works by letter, word and line, and lands exactly', () => {
    const textual = ANIMATIONS.filter((a) => a.groups.includes('text') || a.groups.includes('writing'));
    for (const a of textual) {
      for (const by of ['letter', 'word', 'line'] as const) {
        const d = doc(headline({ type: a.type, by, duration: 1 }));
        const still = grab((c) => renderer.drawPage(c, d, d.pages[0]!));
        expect(Math.max(...[0, 0.1, 0.35, 0.5].map((t) => diff(at(d, t), still))), `${a.type} ${by}`).toBeGreaterThan(5);
        expect(diff(at(d, 2), still), `${a.type} ${by} at rest`).toBe(0);
      }
    }
  });

  it('wipe is a real wipe: half the box, hard edge', () => {
    const d = doc(square({ type: 'wipe', duration: 1, direction: 'left' }));
    const px = at(d, 0.5);
    const red = (x: number, y: number) => px[(y * W + x) * 4]! > 180 && px[(y * W + x) * 4 + 1]! < 80;
    expect(red(160, 120)).toBe(true);
    expect(red(240, 120)).toBe(false);
  });

  it('a rotated element keeps its rotation while it animates', () => {
    const el = { ...square({ type: 'bounceIn', duration: 1 }), rotation: 45 };
    const d = doc(el);
    const still = grab((c) => renderer.drawPage(c, d, d.pages[0]!));
    expect(diff(at(d, 2), still)).toBe(0);
    expect(diff(at(d, 0.99), still)).toBeLessThan(800);
  });

  it('a Fx page draws the same through drawPage and drawFrameAt', () => {
    const d = doc(square({ type: 'tada' }));
    const a = at(d, 0.5);
    const b = grab((c) => renderer.drawPage(c, d, animateAt(d, d.pages[0]!, 0.5)));
    expect(diff(a, b)).toBe(0);
  });
});

describe('transitions in real pixels', () => {
  function twoPages(tr: Parameters<typeof updatePage>[2]['transition']): Doc {
    let d = createDoc({ width: W, height: H });
    const first = d.pages[0]!.id;
    d = updatePage(d, first, { duration: 2, background: { type: 'solid', color: '#ff0000' } });
    const r = addPage(d);
    return updatePage(r.doc, r.pageId, { duration: 2, background: { type: 'solid', color: '#0000ff' }, transition: tr });
  }
  it('every transition starts on the old page, shows both, ends on the new', () => {
    for (const { type } of TRANSITIONS) {
      const d = twoPages({ type, duration: 1 });
      const old = at(d, 1.9), now = at(d, 3.5);
      const mid = at(d, 2.5);
      expect(diff(at(d, 2), old), `${type} start`).toBeLessThan(W * H * 0.02);
      expect(diff(mid, old), `${type} moved`).toBeGreaterThan(50);
      if (type !== 'fade') expect(diff(mid, now), `${type} not there yet`).toBeGreaterThan(50);
      expect(diff(at(d, 2.99), now), `${type} end`).toBeLessThan(W * H * 0.02);
    }
  });

  it('match & move carries the element across', () => {
    let d = createDoc({ width: W, height: H });
    const box = (x: number) => ({ ...shape('rect', { x, y: 70, w: 100, h: 100 }, { type: 'solid', color: '#00aa00' }), name: 'mover' });
    const first = d.pages[0]!.id;
    d = updatePage(addElements(d, first, [box(20)]), first, { duration: 2 });
    const r = addPage(d);
    d = updatePage(addElements(r.doc, r.pageId, [box(280)]), r.pageId, { duration: 2, transition: { type: 'match', duration: 1 } });
    const px = at(d, 2.5);
    const green = (x: number) => px[(120 * W + x) * 4 + 1]! > 120 && px[(120 * W + x) * 4]! < 80;
    expect(green(200)).toBe(true); // half way
    expect(green(50)).toBe(false);
    expect(green(350)).toBe(false);
  });
});
