/**
 * Penpot shapes → Digital Canvas scene elements. Pure: no files, no network.
 *
 * Penpot's export already resolves flex/grid layout and component copies, so
 * every shape carries its final position. The tree is flattened into page
 * coordinates relative to the board; elements stay editable (text stays text,
 * vectors stay vectors). Penpot boards clip their children and our scene has
 * no general clip, so clipping is done by geometry: boxes and pictures are cut
 * to the clip, and anything entirely outside it is left out.
 */
import { parsePathBounds } from './pathbounds.ts';
import type {
  Color, Element, Fill, GradientStop, ImageElement, LineElement, LineMarker, PathElement, ShapeElement, Stroke, TextElement, TextRun, TextStyle,
} from '@digital-canvas/scene';

export interface PShape { [k: string]: any }
export const ROOT = '00000000-0000-0000-0000-000000000000';

export interface ConvertContext {
  shapes: Map<string, PShape>;
  /** Scene asset id of a Penpot media id; registers it on first use. Null when the file doesn't have it. */
  image(mediaId: string): string | null;
  /** Scene family of a Penpot font, or null when no free equivalent is known. */
  font(fontId: string | undefined, family: string | undefined): string | null;
  lossy(what: string): void;
  valign: Map<string, 'center' | 'bottom'>;
  nextId(): string;
}

interface Clip { x: number; y: number; w: number; h: number; radius: number }
interface Env { ox: number; oy: number; opacity: number; clip: Clip | null; mask?: { d: string } }

const round = (n: number) => Math.round(n * 100) / 100;

export function hexAlpha(hex: string | undefined, opacity = 1): Color {
  const h = (hex ?? '#000000').toLowerCase();
  const a = Math.max(0, Math.min(1, opacity));
  const base = h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h.slice(0, 7);
  return a >= 0.999 ? base : `${base}${Math.round(a * 255).toString(16).padStart(2, '0')}`;
}

/** Penpot's start/end points (fractions of the box) → a CSS-angle gradient with the stops moved to match. */
export function linearFill(g: PShape, w: number, h: number, opacity: number): Fill {
  const dx = (g.endX - g.startX) * w, dy = (g.endY - g.startY) * h;
  const rad = Math.atan2(dx, -dy);
  const angle = round(((rad * 180) / Math.PI + 360) % 360);
  const sin = Math.sin(rad), cos = Math.cos(rad);
  const cssLen = Math.abs(w * sin) + Math.abs(h * cos) || 1;
  const len = Math.hypot(dx, dy) || 1;
  // where the Penpot start point falls on CSS's gradient line through the box centre
  const proj = (g.startX - 0.5) * w * sin - (g.startY - 0.5) * h * cos;
  const at = (t: number) => (proj + t * len + cssLen / 2) / cssLen;
  const stops: GradientStop[] = [...g.stops].sort((a: PShape, b: PShape) => a.offset - b.offset)
    .map((s: PShape) => ({ offset: round(Math.max(0, Math.min(1, at(s.offset)))), color: hexAlpha(s.color, (s.opacity ?? 1) * opacity) }));
  return { type: 'linear', angle, stops };
}

function fillOf(f: PShape, w: number, h: number, opacity: number, ctx: ConvertContext): Fill | null {
  const o = (f.fillOpacity ?? 1) * opacity;
  const g = f.fillColorGradient;
  if (g) {
    if (g.type === 'linear') return linearFill(g, w, h, o);
    ctx.lossy('radial gradient as flat colour');
    const s = g.stops[0];
    return { type: 'solid', color: hexAlpha(s?.color, (s?.opacity ?? 1) * o) };
  }
  if (f.fillColor) return { type: 'solid', color: hexAlpha(f.fillColor, o) };
  return null;
}

function strokeOf(s: PShape, opacity: number): Stroke | null {
  if (!s.strokeWidth || s.strokeStyle === 'none') return null;
  const dash = s.strokeStyle === 'dashed' || s.strokeStyle === 'mixed' ? 'dashed' : s.strokeStyle === 'dotted' ? 'dotted' : 'solid';
  const c = s.strokeColorGradient?.stops?.[0]?.color ?? s.strokeColor;
  return { color: hexAlpha(c, (s.strokeOpacity ?? 1) * opacity), width: s.strokeWidth, ...(dash === 'solid' ? {} : { dash }) };
}

const boxOf = (s: PShape) => {
  const r = s.selrect ?? s;
  return { x: r.x as number, y: r.y as number, w: r.width as number, h: r.height as number };
};
const pointsBox = (s: PShape) => {
  const xs = (s.points as PShape[]).map((p) => p.x), ys = (s.points as PShape[]).map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};
const radii = (s: PShape): [number, number, number, number] => {
  if (s.r1 !== undefined && s.r1 !== null) return [s.r1 ?? 0, s.r2 ?? 0, s.r3 ?? 0, s.r4 ?? 0];
  const r = s.rx ?? 0;
  return [r, r, r, r];
};

/** The shape's outline as an SVG path string in file coordinates (paths and bools already are; rects get one). */
function roundedRect(x: number, y: number, w: number, h: number, [a, b, c, d]: readonly [number, number, number, number]): string {
  return `M${x + a},${y}L${x + w - b},${y}${b ? `A${b},${b} 0 0 1 ${x + w},${y + b}` : ''}L${x + w},${y + h - c}${c ? `A${c},${c} 0 0 1 ${x + w - c},${y + h}` : ''}L${x + d},${y + h}${d ? `A${d},${d} 0 0 1 ${x},${y + h - d}` : ''}L${x},${y + a}${a ? `A${a},${a} 0 0 1 ${x + a},${y}` : ''}Z`;
}
const ellipsePath = (x: number, y: number, w: number, h: number) => `M${x},${y + h / 2}A${w / 2},${h / 2} 0 1 1 ${x + w},${y + h / 2}A${w / 2},${h / 2} 0 1 1 ${x},${y + h / 2}Z`;

/** Penpot writes path content as a string in current exports and as a command list in older ones. */
export function pathString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const out: string[] = [];
  for (const c of content as PShape[]) {
    const p = c.params ?? {};
    if (c.command === 'move-to') out.push(`M${p.x},${p.y}`);
    else if (c.command === 'line-to') out.push(`L${p.x},${p.y}`);
    else if (c.command === 'curve-to') out.push(`C${p.c1x},${p.c1y} ${p.c2x},${p.c2y} ${p.x},${p.y}`);
    else if (c.command === 'close-path') out.push('Z');
  }
  return out.join('');
}

// ---------------------------------------------------------------- walking

export function convertBoard(board: PShape, ctx: ConvertContext): { background: Fill; elements: Element[] } {
  const env: Env = { ox: board.x, oy: board.y, opacity: 1, clip: { x: board.x, y: board.y, w: board.width, h: board.height, radius: 0 } };
  const elements: Element[] = [];
  const solid = (board.fills ?? []).filter((f: PShape) => !f.fillImage);
  let background: Fill = { type: 'solid', color: '#ffffff' };
  if (solid.length && !board.hideFillOnExport) {
    const f = fillOf(solid[solid.length - 1], board.width, board.height, 1, ctx);
    if (f && !(f.type === 'solid' && f.color.length > 7)) background = f;
    else if (f) elements.push(...paintBox(board, ctx, { ...env, clip: null }, 'rect'));
  }
  if ((board.fills ?? []).some((f: PShape) => f.fillImage)) elements.push(...paintImages(board, ctx, env));
  for (const id of board.shapes ?? []) elements.push(...convertShape(ctx.shapes.get(id), ctx, env));
  return { background, elements };
}

function convertShape(s: PShape | undefined, ctx: ConvertContext, env: Env): Element[] {
  if (!s || s.hidden) return [];
  const opacity = env.opacity * (s.opacity ?? 1);
  if (s.blendMode && s.blendMode !== 'normal') ctx.lossy(`blend mode ${s.blendMode}`);
  if (s.blur && !s.blur.hidden) ctx.lossy('layer blur');
  const here: Env = { ...env, opacity };
  switch (s.type) {
    case 'group': return s.maskedGroup ? maskedGroup(s, ctx, here) : (s.shapes ?? []).flatMap((id: string) => convertShape(ctx.shapes.get(id), ctx, here));
    case 'frame': return frame(s, ctx, here);
    case 'rect': return [...paintBox(s, ctx, here, 'rect'), ...paintImages(s, ctx, here)];
    case 'circle': return [...paintBox(s, ctx, here, 'ellipse'), ...paintImages(s, ctx, here)];
    case 'image': return image(s, ctx, here);
    case 'path': case 'bool': return vector(s, ctx, here);
    case 'text': return textOf(s, ctx, here);
    case 'svg-raw': ctx.lossy('svg-raw shape skipped'); return [];
    default: ctx.lossy(`shape type ${s.type} skipped`); return [];
  }
}

function frame(s: PShape, ctx: ConvertContext, env: Env): Element[] {
  const out = s.hideFillOnExport ? [] : [...paintBox(s, ctx, env, 'rect'), ...paintImages(s, ctx, env)];
  let clip = env.clip;
  if (!s.showContent) {
    if (!s.rotation) {
      const [r] = radii(s);
      const next = intersect({ x: s.x, y: s.y, w: s.width, h: s.height, radius: r }, clip);
      if (!next) return out;
      clip = next;
    } else ctx.lossy('rotated clip ignored');
  }
  const inner: Env = { ...env, clip };
  for (const id of s.shapes ?? []) out.push(...convertShape(ctx.shapes.get(id), ctx, inner));
  return out;
}

function maskedGroup(s: PShape, ctx: ConvertContext, env: Env): Element[] {
  const [maskId, ...rest] = s.shapes as string[];
  const m = ctx.shapes.get(maskId!);
  if (!m) return rest.flatMap((id) => convertShape(ctx.shapes.get(id), ctx, env));
  let inner: Env = env;
  if ((m.type === 'rect' || m.type === 'frame') && !m.rotation) {
    const [r] = radii(m);
    const clip = intersect({ ...boxOf(m), radius: r }, env.clip);
    if (!clip) return [];
    inner = { ...env, clip };
  } else {
    const d = m.type === 'circle' ? ellipsePath(m.x, m.y, m.width, m.height) : pathString(m.content);
    if (d) inner = { ...env, mask: { d } };
    else ctx.lossy('mask ignored');
  }
  return rest.flatMap((id) => convertShape(ctx.shapes.get(id), ctx, inner));
}

function intersect(a: Clip, b: Clip | null): Clip | null {
  if (!b) return a;
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w), bot = Math.min(a.y + a.h, b.y + b.h);
  if (r <= x || bot <= y) return null;
  // the rounded corners of whichever clip is smaller
  return { x, y, w: r - x, h: bot - y, radius: a.w * a.h <= b.w * b.h ? a.radius : b.radius };
}

const outside = (b: { x: number; y: number; w: number; h: number }, c: Clip | null) => !!c && (b.x + b.w <= c.x || b.y + b.h <= c.y || b.x >= c.x + c.w || b.y >= c.y + c.h);

const base = (ctx: ConvertContext, s: PShape, env: Env) => ({
  id: ctx.nextId(), name: String(s.name ?? '').slice(0, 60), rotation: round(s.rotation ?? 0), opacity: round(env.opacity),
  ...(s.flipX ? { flipX: true } : {}), ...(s.flipY ? { flipY: true } : {}),
});

function shadowsNote(s: PShape, ctx: ConvertContext): void {
  if ((s.shadow ?? []).some((x: PShape) => !x.hidden)) ctx.lossy('shape shadow');
}

/** Solid and gradient fills and strokes of a box, bottom layer first. */
function paintBox(s: PShape, ctx: ConvertContext, env: Env, kind: 'rect' | 'ellipse'): Element[] {
  shadowsNote(s, ctx);
  let b = boxOf(s);
  if (outside(pointsBox(s), env.clip)) return [];
  const rad = radii(s);
  const equal = rad.every((r) => Math.abs(r - rad[0]) < 0.01);
  const cut = !s.rotation && env.clip && kind === 'rect';
  if (cut) {
    const c = intersect({ ...b, radius: 0 }, env.clip);
    if (!c) return [];
    b = c;
  }
  const out: Element[] = [];
  const fills = [...(s.fills ?? [])].filter((f: PShape) => !f.fillImage).reverse();
  const add = (fill: Fill | null, stroke: Stroke | null, box = b, radius = rad) => {
    if (kind === 'rect' && !radius.every((r) => Math.abs(r - radius[0]) < 0.01)) {
      const part = { d: roundedRect(box.x, box.y, box.w, box.h, radius), fill, stroke };
      out.push({ ...base(ctx, s, env), type: 'path', x: box.x - env.ox, y: box.y - env.oy, w: box.w, h: box.h, viewBox: box, paths: [part] } as PathElement);
      return;
    }
    out.push({ ...base(ctx, s, env), type: 'shape', shape: kind, x: box.x - env.ox, y: box.y - env.oy, w: box.w, h: box.h, fill, stroke, radius: kind === 'rect' ? radius[0] : 0 } as ShapeElement);
  };
  for (const f of fills) {
    const fill = fillOf(f, b.w, b.h, 1, ctx);
    if (fill) add(fill, null);
  }
  for (const st of [...(s.strokes ?? [])].reverse()) {
    const stroke = strokeOf(st, 1);
    if (!stroke) continue;
    // ours are centred on the outline; Penpot's inner/outer ones are moved to match
    const shift = st.strokeAlignment === 'center' ? 0 : (st.strokeAlignment === 'outer' ? 1 : -1) * (stroke.width / 2);
    const box = { x: b.x - shift, y: b.y - shift, w: Math.max(0, b.w + shift * 2), h: Math.max(0, b.h + shift * 2) };
    add(null, stroke, box, rad.map((r) => Math.max(0, r + shift)) as typeof rad);
  }
  void equal;
  return out;
}

/** Image fills of any shape. */
function paintImages(s: PShape, ctx: ConvertContext, env: Env): Element[] {
  const out: Element[] = [];
  for (const f of [...(s.fills ?? [])].reverse()) {
    if (!f.fillImage) continue;
    const asset = ctx.image(f.fillImage.id);
    if (!asset) { ctx.lossy('image fill missing'); continue; }
    const mask = s.type === 'circle' ? ellipsePath(s.x, s.y, s.width, s.height) : s.type === 'path' || s.type === 'bool' ? pathString(s.content) : undefined;
    const box = s.type === 'path' || s.type === 'bool' ? pointsBox(s) : boxOf(s);
    out.push(...imageElement(s, ctx, env, asset, box, f.fillImage.width, f.fillImage.height, f.fillImage.keepAspectRatio !== false, (f.fillOpacity ?? 1), mask));
  }
  return out;
}

function image(s: PShape, ctx: ConvertContext, env: Env): Element[] {
  shadowsNote(s, ctx);
  const m = s.metadata ?? {};
  const asset = ctx.image(m.id);
  if (!asset) { ctx.lossy('image missing'); return []; }
  return imageElement(s, ctx, env, asset, boxOf(s), m.width, m.height, s.keepAspectRatio !== false, 1);
}

function imageElement(s: PShape, ctx: ConvertContext, env: Env, asset: string, box: { x: number; y: number; w: number; h: number }, iw: number, ih: number, keep: boolean, opacity: number, maskD?: string): Element[] {
  if (outside(pointsBox(s), env.clip)) return [];
  const [r] = radii(s);
  // what part of the picture fills the box (Penpot centres a cover-fit)
  let crop = { x: 0, y: 0, w: 1, h: 1 };
  if (keep && iw && ih) {
    const scale = Math.max(box.w / iw, box.h / ih);
    const cw = box.w / scale / iw, ch = box.h / scale / ih;
    crop = { x: (1 - cw) / 2, y: (1 - ch) / 2, w: cw, h: ch };
  }
  let b = box;
  let radius = r;
  const mask = maskD ?? env.mask?.d;
  if (env.clip && !s.rotation) {
    const c = intersect({ ...box, radius: r }, env.clip);
    if (!c) return [];
    if (c.w < box.w - 0.01 || c.h < box.h - 0.01) {
      crop = { x: crop.x + ((c.x - box.x) / box.w) * crop.w, y: crop.y + ((c.y - box.y) / box.h) * crop.h, w: crop.w * (c.w / box.w), h: crop.h * (c.h / box.h) };
      b = c;
    }
    radius = Math.max(r, env.clip.radius && touchesCorner(b, env.clip) ? env.clip.radius : 0);
  }
  const el: ImageElement = {
    ...base(ctx, s, env), type: 'image', asset, x: b.x - env.ox, y: b.y - env.oy, w: b.w, h: b.h, opacity: round(env.opacity * opacity), radius,
    crop: { x: crop.x, y: crop.y, w: crop.w, h: crop.h },
    ...(mask ? { mask: { d: mask, viewBox: b } } : {}),
  };
  return [el];
}

const touchesCorner = (b: { x: number; y: number; w: number; h: number }, c: Clip) => Math.abs(b.w - c.w) < 1 && Math.abs(b.h - c.h) < 1;

const MARKERS: Record<string, LineMarker> = { 'line-arrow': 'arrow', 'triangle-arrow': 'triangle', 'square-marker': 'square', 'circle-marker': 'circle', 'diamond-marker': 'square' };

function vector(s: PShape, ctx: ConvertContext, env: Env): Element[] {
  shadowsNote(s, ctx);
  const d = pathString(s.content);
  if (!d) return [];
  const bounds = parsePathBounds(d) ?? pointsBox(s);
  if (outside(bounds, env.clip)) return [];
  const w = Math.max(bounds.w, 0.5), h = Math.max(bounds.h, 0.5);
  const box = { x: bounds.x, y: bounds.y, w, h };
  const strokes = (s.strokes ?? []).map((st: PShape) => ({ st, stroke: strokeOf(st, 1) })).filter((x: PShape) => x.stroke) as { st: PShape; stroke: Stroke }[];
  const fills = [...(s.fills ?? [])].filter((f: PShape) => !f.fillImage).reverse();
  const out: Element[] = [];
  // a two-point stroke with arrow heads is a real line element
  const two = /^M\s*(-?[\d.e-]+)[ ,]+(-?[\d.e-]+)\s*L\s*(-?[\d.e-]+)[ ,]+(-?[\d.e-]+)\s*$/i.exec(d.trim());
  const first = strokes[0];
  if (two && first && !fills.length) {
    const [x1, y1, x2, y2] = two.slice(1).map(Number) as [number, number, number, number];
    const c0 = first.st.strokeCapStart ?? s.strokeCapStart, c1 = first.st.strokeCapEnd ?? s.strokeCapEnd;
    const marker = (c: string | undefined): LineMarker => (c && MARKERS[c]) || 'none';
    if (marker(c0) !== 'none' || marker(c1) !== 'none') {
      const line: LineElement = {
        ...base(ctx, { ...s, rotation: 0, flipX: false, flipY: false }, env), type: 'line', x: Math.min(x1, x2) - env.ox, y: Math.min(y1, y2) - env.oy, w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
        start: { x: x1 - Math.min(x1, x2), y: y1 - Math.min(y1, y2), marker: marker(c0) },
        end: { x: x2 - Math.min(x1, x2), y: y2 - Math.min(y1, y2), marker: marker(c1) },
        stroke: first.stroke, route: 'straight',
      };
      return [line];
    }
  }
  if (first && (first.st.strokeCapEnd || s.strokeCapEnd) && /marker|arrow/.test(`${first.st.strokeCapEnd ?? s.strokeCapEnd}${first.st.strokeCapStart ?? s.strokeCapStart}`)) ctx.lossy('marker on a curved path');
  const evenOdd = s.type === 'bool' || s.svgAttrs?.fillRule === 'evenodd' || s.svgAttrs?.fillRule === 'evenOdd' || /Z.*M/is.test(d);
  const parts: PathElement['paths'] = [];
  for (const f of fills) {
    const fill = fillOf(f, w, h, 1, ctx);
    if (fill) parts.push({ d, fill, stroke: null, ...(evenOdd ? { evenOdd: true } : {}) });
  }
  for (const { stroke } of [...strokes].reverse()) parts.push({ d, fill: null, stroke });
  if (parts.length) out.push({ ...base(ctx, { ...s, rotation: 0, flipX: false, flipY: false }, env), type: 'path', x: box.x - env.ox, y: box.y - env.oy, w, h, viewBox: box, paths: parts } as PathElement);
  out.push(...paintImages(s, ctx, env));
  return out;
}

// ---------------------------------------------------------------- text

interface Leaf { text: string; style: Partial<TextStyle>; gradient?: PShape; paragraph: number }

function caseOf(text: string, t: string | undefined): string {
  if (t === 'lowercase') return text.toLowerCase();
  if (t === 'capitalize') return text.replace(/(^|\s)(\S)/g, (_, a: string, b: string) => a + b.toUpperCase());
  return text;
}

function leafStyle(n: PShape, ctx: ConvertContext): { style: TextStyle; gradient?: PShape } {
  const family = ctx.font(n.fontId, n.fontFamily);
  if (!family) ctx.lossy(`font ${n.fontFamily}`);
  const size = Number(n.fontSize ?? 14);
  const weight = n.fontWeight === 'bold' ? 700 : Number(n.fontWeight ?? 400);
  const deco = String(n.textDecoration ?? 'none');
  const f = (n.fills ?? [])[0] as PShape | undefined;
  const color = f?.fillColorGradient ? hexAlpha(f.fillColorGradient.stops[0]?.color) : hexAlpha(f?.fillColor ?? '#000000', f?.fillOpacity ?? 1);
  const lh = Number(n.lineHeight);
  return {
    style: {
      fontFamily: family ?? 'Inter', fontSize: size, bold: weight >= 600, italic: n.fontStyle === 'italic' || /italic/i.test(String(n.fontVariantId ?? '')),
      underline: deco === 'underline', strike: deco === 'line-through', color, align: (n.textAlign ?? 'left') as TextStyle['align'],
      lineHeight: Number.isFinite(lh) && lh > 0 ? lh : 1.2, letterSpacing: Number(n.letterSpacing ?? 0) || 0, uppercase: n.textTransform === 'uppercase',
    },
    ...(f?.fillColorGradient?.type === 'linear' ? { gradient: f.fillColorGradient } : {}),
  };
}

function textOf(s: PShape, ctx: ConvertContext, env: Env): Element[] {
  const b = boxOf(s);
  if (outside(pointsBox(s), env.clip)) return [];
  const root = s.content as PShape | undefined;
  const paragraphs: PShape[] = (root?.children ?? []).flatMap((set: PShape) => set.children ?? []);
  if (!paragraphs.length) return [];
  const leaves: Leaf[] = [];
  paragraphs.forEach((p, i) => {
    for (const n of p.children ?? []) {
      const { style, gradient } = leafStyle({ ...p, ...n }, ctx);
      const text = caseOf(String(n.text ?? ''), n.textTransform ?? p.textTransform);
      if (text) leaves.push({ text, style: { ...style, align: (p.textAlign ?? n.textAlign ?? 'left') as TextStyle['align'] }, ...(gradient ? { gradient } : {}), paragraph: i });
    }
    if (i < paragraphs.length - 1) leaves.push({ text: '\n', style: leaves[leaves.length - 1]?.style ?? {}, paragraph: i });
  });
  const text = leaves.map((l) => l.text).join('');
  if (!text.trim()) return [];
  // the style most of the text uses is the element's; the rest become runs
  const weight = new Map<string, { n: number; style: TextStyle }>();
  for (const l of leaves) {
    if (l.text === '\n') continue;
    const k = JSON.stringify(l.style);
    const w = weight.get(k) ?? { n: 0, style: l.style as TextStyle };
    w.n += l.text.length;
    weight.set(k, w);
  }
  const main = [...weight.values()].sort((a, b) => b.n - a.n)[0]!.style;
  let runs: TextRun[] | undefined;
  if (weight.size > 1) {
    runs = [];
    for (const l of leaves) {
      const diff: Partial<TextStyle> = {};
      for (const k of Object.keys(l.style) as (keyof TextStyle)[]) if (k !== 'align' && l.style[k] !== main[k]) (diff as Record<string, unknown>)[k] = l.style[k];
      const last = runs[runs.length - 1];
      const same = JSON.stringify(diff) === JSON.stringify(last?.style ?? {});
      if (last && same) last.text += l.text;
      else runs.push(Object.keys(diff).length ? { text: l.text, style: diff } : { text: l.text });
    }
  }
  if (new Set(leaves.filter((l) => l.text !== '\n').map((l) => l.style.align)).size > 1) ctx.lossy('mixed paragraph alignment');

  // Text that didn't wrap in Penpot must not wrap here: rounding can differ by a pixel.
  const pd = (s.positionData ?? []) as PShape[];
  const lines = new Set(pd.map((p) => Math.round(p.y))).size;
  let x = b.x, w = b.w;
  if (lines && lines <= paragraphs.length) {
    const extra = Math.max(4, b.w * 0.04);
    w = b.w + extra;
    if (main.align === 'center') x -= extra / 2;
    else if (main.align === 'right') x -= extra;
  }
  const id = ctx.nextId();
  const va = root?.verticalAlign;
  if (va === 'center' || va === 'bottom') ctx.valign.set(id, va);
  const g = leaves.find((l) => l.gradient)?.gradient;
  const el: TextElement = {
    ...base(ctx, s, env), id, type: 'text', x: x - env.ox, y: b.y - env.oy, w, h: Math.max(b.h, 1), text, style: main,
    ...(runs ? { runs } : {}),
    ...(g && weight.size === 1 ? { gradient: linearFill(g, b.w, b.h, 1) as Extract<Fill, { type: 'linear' }> } : {}),
  };
  return [el];
}
