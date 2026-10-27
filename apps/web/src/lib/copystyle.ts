/**
 * Canva's "Copy style" (the paint roller): take the look of one element and
 * put it on others. Text gives font, size, colour and effects to text; shapes
 * give fill, border and corners; pictures give adjustments, filter and
 * effect; any element gives its transparency.
 */
import type { Element, ElementPatch, TextElement } from '@digital-canvas/scene';

export interface CopiedStyle {
  from: Element['type'];
  opacity: number;
  text?: Pick<TextElement, 'style' | 'effect' | 'gradient' | 'list'>;
  shape?: { fill: Extract<Element, { type: 'shape' }>['fill']; stroke: Extract<Element, { type: 'shape' }>['stroke']; radius: number };
  picture?: Pick<Extract<Element, { type: 'image' }>, 'adjust' | 'filter' | 'effect' | 'radius'>;
  line?: Extract<Element, { type: 'line' }>['stroke'];
  /** Single colour to give anything else (a graphic, a line) from a text or shape. */
  color?: string;
}

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

export function copyStyle(e: Element): CopiedStyle {
  const s: CopiedStyle = { from: e.type, opacity: e.opacity };
  if (e.type === 'text') {
    s.text = { style: clone(e.style), effect: clone(e.effect), gradient: clone(e.gradient), list: e.list };
    s.color = e.style.color;
  } else if (e.type === 'shape') {
    s.shape = { fill: clone(e.fill), stroke: clone(e.stroke), radius: e.radius };
    if (e.fill?.type === 'solid') s.color = e.fill.color;
  } else if (e.type === 'image' || e.type === 'video') {
    s.picture = { adjust: clone(e.adjust), filter: clone(e.filter), effect: clone(e.effect), radius: e.radius };
  } else if (e.type === 'line') {
    s.line = clone(e.stroke);
    s.color = e.stroke.color;
  }
  return s;
}

/** The patch that gives `target` the copied style (only what fits its kind). */
export function pasteStyle(s: CopiedStyle, target: Element): ElementPatch {
  const out: Record<string, unknown> = { opacity: s.opacity };
  const opt = (k: string, v: unknown) => (out[k] = clone(v));
  if (target.type === 'text') {
    if (s.text) {
      out.style = clone(s.text.style);
      opt('effect', s.text.effect);
      opt('gradient', s.text.gradient);
      opt('list', s.text.list);
      // the copied look replaces mixed character styles; the words stay
      out.runs = undefined;
    } else if (s.color) out.style = { ...target.style, color: s.color };
  } else if (target.type === 'shape') {
    if (s.shape) {
      opt('fill', s.shape.fill);
      opt('stroke', s.shape.stroke);
      if (target.shape === 'rect') out.radius = s.shape.radius;
    } else if (s.color) out.fill = { type: 'solid', color: s.color };
  } else if (target.type === 'image' || target.type === 'video') {
    if (s.picture) {
      opt('adjust', s.picture.adjust);
      opt('filter', s.picture.filter);
      opt('effect', s.picture.effect);
      out.radius = s.picture.radius;
    }
  } else if (target.type === 'line') {
    if (s.line) out.stroke = { ...clone(s.line) };
    else if (s.color) out.stroke = { ...target.stroke, color: s.color };
  } else if (target.type === 'path' && s.color && target.qr === undefined) {
    out.paths = target.paths.map((p) => ({ ...p, fill: p.fill ? { type: 'solid', color: s.color! } : p.fill, stroke: p.stroke ? { ...p.stroke, color: s.color! } : p.stroke }));
  }
  return out as ElementPatch;
}
