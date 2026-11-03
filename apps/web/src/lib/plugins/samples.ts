/** Small docs the plugin creators preview on (pure scene code). */
import {
  addElements, createDoc, shape, text, updatePage,
  type Animation, type Doc, type Element,
} from '@digital-canvas/scene';

/** A purple box (or "Abc") on a white 100×100 page, moving with `a`; the page lasts `len` seconds. */
export function sampleAnimDoc(a: Animation, textual: boolean, len = 3): Doc {
  const d = createDoc({ width: 100, height: 100 });
  const id = d.pages[0]!.id;
  const el: Element = textual
    ? { ...text('Abc', { x: 12, y: 30, w: 76, h: 36 }, { fontSize: 28, align: 'center', color: '#7d2ae8' }), animation: a }
    : { ...shape('rect', { x: 32, y: 32, w: 36, h: 36 }, { type: 'solid', color: '#7d2ae8' }), animation: a };
  return updatePage(addElements(d, id, [el]), id, { duration: len, background: { type: 'solid', color: '#ffffff' } });
}

/** The element alone on a page of its own size (no rotation), or a colourful sample when there is none. */
export function sampleEffectDoc(el: Element | null, patch: Record<string, unknown> = {}): Doc {
  if (el) {
    const w = Math.max(1, el.w), h = Math.max(1, el.h);
    const d = createDoc({ width: w, height: h });
    const id = d.pages[0]!.id;
    const one = { ...el, ...patch, x: 0, y: 0, rotation: 0, animation: undefined, shader: undefined } as Element;
    return updatePage(addElements(d, id, [one]), id, { background: { type: 'solid', color: '#00000000' } });
  }
  const d = createDoc({ width: 300, height: 200 });
  const id = d.pages[0]!.id;
  const els: Element[] = [
    shape('rect', { x: 0, y: 0, w: 300, h: 200 }, { type: 'linear', angle: 135, stops: [{ offset: 0, color: '#ff9a3c' }, { offset: 0.5, color: '#ff4f8b' }, { offset: 1, color: '#5b3bf5' }] }),
    shape('ellipse', { x: 26, y: 40, w: 90, h: 90 }, { type: 'solid', color: '#ffd84d' }),
    shape('rect', { x: 150, y: 110, w: 120, h: 60 }, { type: 'solid', color: '#1fc7a8' }),
    text('Aa', { x: 150, y: 24, w: 120, h: 70 }, { fontSize: 56, align: 'center', color: '#ffffff', bold: true }),
  ];
  return updatePage(addElements(d, id, els), id, { background: { type: 'solid', color: '#ffffff' } });
}
