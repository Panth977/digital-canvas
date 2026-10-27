/**
 * Tools panel builders: sticky notes, whiteboard (flowchart) shapes and device
 * mockups. Each returns plain elements; `place` puts them on the page.
 */
import { addElements, image, newId, shape, text, type Element, type GroupElement, type PathElement, type ShapeKind } from '@digital-canvas/scene';
import type { EditorState } from './editor.svelte.ts';

type Box = { x: number; y: number; w: number; h: number };

export function group(children: Element[], name: string): GroupElement {
  const x = Math.min(...children.map((c) => c.x)), y = Math.min(...children.map((c) => c.y));
  const w = Math.max(...children.map((c) => c.x + c.w)) - x, h = Math.max(...children.map((c) => c.y + c.h)) - y;
  return { id: newId('e_'), type: 'group', name, x, y, w, h, rotation: 0, opacity: 1, children };
}

/** Add elements to the current page as one undo step and select them. */
export function place(ed: EditorState, els: Element[]): void {
  ed.commit(addElements(ed.doc, ed.pageId, els));
  ed.seal();
  ed.select(els.map((e) => e.id), ed.pageId);
}

const unit = (ed: EditorState, f: number) => Math.round(Math.min(ed.doc.width, ed.doc.height) * f);

// ---- sticky notes ----

export const STICKY_COLORS = [
  { name: 'Yellow', fill: '#fff59d', ink: '#3e3a12' },
  { name: 'Pink', fill: '#f8bbd0', ink: '#4a1c2c' },
  { name: 'Blue', fill: '#b3e5fc', ink: '#0d3349' },
  { name: 'Green', fill: '#c5e1a5', ink: '#1f3a10' },
  { name: 'Purple', fill: '#d1c4e9', ink: '#2a1b4d' },
  { name: 'Orange', fill: '#ffcc80', ink: '#4a2a05' },
];

export function stickyNote(ed: EditorState, color: (typeof STICKY_COLORS)[number], value = 'Write your idea'): Element[] {
  const s = unit(ed, 0.3);
  const x = (ed.doc.width - s) / 2 + (Math.random() - 0.5) * s * 0.3, y = (ed.doc.height - s) / 2 + (Math.random() - 0.5) * s * 0.3;
  const note = { ...shape('rect', { x, y, w: s, h: s }, { type: 'solid', color: color.fill }), radius: s * 0.02, name: 'Sticky note' };
  const fold: PathElement = {
    id: newId('e_'), type: 'path', name: 'Fold', x: x + s * 0.84, y: y + s * 0.84, w: s * 0.16, h: s * 0.16, rotation: 0, opacity: 1,
    viewBox: { x: 0, y: 0, w: 10, h: 10 }, paths: [{ d: 'M10 0V10H0z', fill: { type: 'solid', color: '#00000014' }, stroke: null }],
  };
  const pad = s * 0.1;
  let t = text(value, { x: x + pad, y: y + pad, w: s - 2 * pad, h: 10 }, { fontFamily: 'Inter', fontSize: Math.round(s * 0.09), color: color.ink, lineHeight: 1.3 });
  t = { ...t, h: ed.renderer.textHeight(t) };
  return [group([note, fold, t], `Sticky note (${color.name.toLowerCase()})`)];
}

// ---- whiteboard / flowchart ----

export const FLOW_SHAPES: { id: string; label: string; kind: ShapeKind | 'parallelogram' | 'document'; radius?: number; ratio: number }[] = [
  { id: 'process', label: 'Process', kind: 'rect', radius: 0.12, ratio: 0.55 },
  { id: 'decision', label: 'Decision', kind: 'diamond', ratio: 0.75 },
  { id: 'terminal', label: 'Start / end', kind: 'ellipse', ratio: 0.5 },
  { id: 'data', label: 'Input / output', kind: 'parallelogram', ratio: 0.55 },
  { id: 'document', label: 'Document', kind: 'document', ratio: 0.65 },
  { id: 'note', label: 'Note', kind: 'rect', radius: 0, ratio: 0.55 },
];

export function flowShape(ed: EditorState, id: string, fill = '#ede9fe', ink = '#3b2f78'): Element[] {
  const f = FLOW_SHAPES.find((x) => x.id === id) ?? FLOW_SHAPES[0]!;
  const w = unit(ed, 0.32), h = Math.round(w * f.ratio);
  const box: Box = { x: (ed.doc.width - w) / 2, y: (ed.doc.height - h) / 2, w, h };
  const stroke = { color: ink, width: Math.max(1.5, w * 0.012), dash: 'solid' as const };
  let body: Element;
  if (f.kind === 'parallelogram' || f.kind === 'document') {
    const d = f.kind === 'parallelogram' ? 'M20 0H100L80 100H0z' : 'M0 0H100V85C75 70 50 110 25 95S0 85 0 85z';
    body = { id: newId('e_'), type: 'path', name: f.label, ...box, rotation: 0, opacity: 1, viewBox: { x: 0, y: 0, w: 100, h: 100 }, paths: [{ d, fill: { type: 'solid', color: fill }, stroke }] };
  } else {
    body = { ...shape(f.kind, box, { type: 'solid', color: fill }), stroke, radius: (f.radius ?? 0) * h, name: f.label };
  }
  const inset = f.kind === 'diamond' ? 0.25 : f.kind === 'ellipse' ? 0.15 : 0.1;
  let t = text(f.label, { x: box.x + w * inset, y: 0, w: w * (1 - 2 * inset), h: 10 }, { fontFamily: 'Inter', fontSize: Math.round(w * 0.075), color: ink, align: 'center', bold: true });
  t = { ...t, h: ed.renderer.textHeight(t) };
  t.y = box.y + (f.kind === 'document' ? h * 0.42 : h / 2) - t.h / 2;
  return [group([body, t], f.label)];
}

// ---- mockups ----

export const MOCKUPS: { id: string; label: string; screen: number }[] = [
  { id: 'phone', label: 'Phone', screen: 9 / 19.5 },
  { id: 'tablet', label: 'Tablet', screen: 3 / 4 },
  { id: 'laptop', label: 'Laptop', screen: 16 / 10 },
  { id: 'desktop', label: 'Desktop monitor', screen: 16 / 9 },
  { id: 'browser', label: 'Browser window', screen: 16 / 10 },
  { id: 'frame', label: 'Wall frame', screen: 0 },
];

/**
 * A device drawn in vectors around `asset` (a picture of a page). The screen
 * keeps the device's shape; the picture fills it (cover). `frame` matches the
 * picture's own shape (`ratio`).
 */
export function mockup(ed: EditorState, id: string, asset: string, ratio: number, dark = true): Element[] {
  const S = unit(ed, 0.7);
  const body = dark ? '#1b1c1f' : '#e9eaee', edge = dark ? '#3a3b40' : '#c9cbd2';
  const solid = (color: string) => ({ type: 'solid' as const, color });
  const cx = ed.doc.width / 2, cy = ed.doc.height / 2;
  const els: Element[] = [];
  const screen = (b: Box, r: number) => els.push({ ...image(asset, b), radius: r, name: 'Screen' });
  if (id === 'phone' || id === 'tablet') {
    const ar = id === 'phone' ? 9 / 19.5 : 3 / 4;
    const h = S, w = h * ar, bez = w * (id === 'phone' ? 0.045 : 0.05);
    const x = cx - w / 2, y = cy - h / 2;
    els.push({ ...shape('rect', { x, y, w, h }, solid(body)), radius: w * (id === 'phone' ? 0.16 : 0.07), stroke: { color: edge, width: Math.max(1, w * 0.008) }, name: 'Body' });
    screen({ x: x + bez, y: y + bez, w: w - 2 * bez, h: h - 2 * bez }, w * (id === 'phone' ? 0.12 : 0.04));
    if (id === 'phone') els.push({ ...shape('rect', { x: cx - w * 0.15, y: y + bez + w * 0.03, w: w * 0.3, h: w * 0.085 }, solid('#000000')), radius: w * 0.05, name: 'Camera' });
    else els.push({ ...shape('ellipse', { x: cx - w * 0.012, y: y + bez * 0.35, w: w * 0.024, h: w * 0.024 }, solid('#000000')), name: 'Camera' });
  } else if (id === 'laptop') {
    const w = S * 1.25, sh = (w * 0.86) / (16 / 10), bez = w * 0.025;
    const x = cx - (w * 0.86) / 2, y = cy - (sh + bez * 2 + w * 0.05) / 2;
    els.push({ ...shape('rect', { x, y, w: w * 0.86, h: sh + bez * 2 }, solid(body)), radius: w * 0.02, stroke: { color: edge, width: Math.max(1, w * 0.004) }, name: 'Lid' });
    screen({ x: x + bez, y: y + bez, w: w * 0.86 - 2 * bez, h: sh }, w * 0.004);
    const by = y + sh + bez * 2;
    els.push({ id: newId('e_'), type: 'path', name: 'Base', x: cx - w / 2, y: by, w, h: w * 0.05, rotation: 0, opacity: 1, viewBox: { x: 0, y: 0, w: 100, h: 5 },
      paths: [{ d: 'M0 0H100V2.6C100 4 98.5 5 96 5H4C1.5 5 0 4 0 2.6z', fill: solid(dark ? '#2b2c31' : '#d4d6dd'), stroke: null }, { d: 'M43 0H57V1.2C57 1.6 56.6 1.8 56 1.8H44C43.4 1.8 43 1.6 43 1.2z', fill: solid(dark ? '#141518' : '#b9bcc5'), stroke: null }] } as PathElement);
  } else if (id === 'desktop') {
    const w = S * 1.2, h = w / (16 / 9), bez = w * 0.02;
    const x = cx - w / 2, y = cy - (h + w * 0.18) / 2;
    els.push({ ...shape('rect', { x, y, w, h: h + bez * 2 }, solid(body)), radius: w * 0.012, name: 'Monitor' });
    screen({ x: x + bez, y: y + bez, w: w - 2 * bez, h: h }, 0);
    els.push({ ...shape('rect', { x: cx - w * 0.05, y: y + h + bez * 2, w: w * 0.1, h: w * 0.12 }, solid(dark ? '#2b2c31' : '#c9cbd2')), name: 'Stand' });
    els.push({ ...shape('rect', { x: cx - w * 0.16, y: y + h + bez * 2 + w * 0.12, w: w * 0.32, h: w * 0.02 }, solid(dark ? '#2b2c31' : '#c9cbd2')), radius: w * 0.01, name: 'Foot' });
  } else if (id === 'browser') {
    const w = S * 1.2, bar = w * 0.05, h = w / (16 / 10);
    const x = cx - w / 2, y = cy - (h + bar) / 2;
    els.push({ ...shape('rect', { x, y, w, h: h + bar }, solid(dark ? '#2b2c31' : '#f1f2f5')), radius: w * 0.012, stroke: { color: edge, width: Math.max(1, w * 0.002) }, name: 'Window' });
    ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => els.push({ ...shape('ellipse', { x: x + bar * 0.5 + i * bar * 0.55, y: y + bar * 0.35, w: bar * 0.3, h: bar * 0.3 }, solid(c)), name: 'Button' }));
    els.push({ ...shape('rect', { x: x + w * 0.25, y: y + bar * 0.22, w: w * 0.5, h: bar * 0.56 }, solid(dark ? '#1b1c1f' : '#ffffff')), radius: bar * 0.28, name: 'Address bar' });
    screen({ x, y: y + bar, w, h }, 0);
  } else {
    // a framed print on the wall: frame, mat, picture in the picture's own shape
    const r = ratio || 1;
    const ph = r >= 1 ? S / r : S, pw = r >= 1 ? S : S * r;
    const mat = Math.min(pw, ph) * 0.12, fr = Math.min(pw, ph) * 0.05;
    const x = cx - pw / 2 - mat - fr, y = cy - ph / 2 - mat - fr;
    els.push({ ...shape('rect', { x, y, w: pw + 2 * (mat + fr), h: ph + 2 * (mat + fr) }, solid(dark ? '#2a211b' : '#d9c7a7')), name: 'Frame' });
    els.push({ ...shape('rect', { x: x + fr, y: y + fr, w: pw + 2 * mat, h: ph + 2 * mat }, solid('#fbfaf7')), name: 'Mat' });
    screen({ x: x + fr + mat, y: y + fr + mat, w: pw, h: ph }, 0);
  }
  return [group(els, `${MOCKUPS.find((m) => m.id === id)?.label ?? 'Device'} mockup`)];
}

/** A picture of a page, stored as an asset of the design (for mockups). */
export async function pageSnapshot(ed: EditorState, pageId: string): Promise<{ asset: string; ratio: number } | null> {
  const scale = Math.min(2, 1600 / Math.max(ed.doc.width, ed.doc.height));
  const png = ed.exportPage(pageId, 'png', scale);
  const page = ed.doc.pages.findIndex((p) => p.id === pageId) + 1;
  const asset = await ed.addAsset(png, 'image/png', `Page ${page} of ${ed.doc.title}`);
  return asset ? { asset, ratio: ed.doc.width / ed.doc.height } : null;
}
