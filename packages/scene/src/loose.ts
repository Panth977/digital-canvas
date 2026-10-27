/**
 * "Loose" documents: the compact JSON people, scripts and AI models write by
 * hand — only what matters (positions, colours, words), no ids or defaults.
 * `completeDoc` fills in everything else and returns a document that passes
 * `parseDoc`. Unknown elements are dropped (and reported), never fatal.
 *
 *   { "pages": [ { "background": "#fdf6ec",
 *       "elements": [
 *         { "type": "shape", "shape": "rect", "x": 0, "y": 0, "w": 1080, "h": 300, "fill": "#1d3c78", "radius": 24 },
 *         { "type": "text", "text": "Summer Sale", "x": 80, "y": 80, "w": 920, "fontSize": 120, "fontFamily": "Anton", "color": "#ffffff", "align": "center" },
 *         { "type": "icon", "icon": "mdi:sun", "x": 480, "y": 400, "w": 120, "h": 120, "color": "#e0a526" } ] } ] }
 */
import { chart, CHART_COLORS, line, table } from './elements.ts';
import { createDoc, DEFAULT_TEXT_STYLE, newId } from './doc.ts';
import { parseDoc } from './parse.ts';
import type {
  ChartKind, Color, Doc, Element, Fill, GradientStop, LineMarker, LineRoute, Page, PathPart, ShapeKind, Stroke, TextAlign, TextElement, TextStyle,
} from './types.ts';

/** An icon to fetch (Iconify name) and put at this box; the caller resolves it. */
export interface PendingIcon {
  page: number;
  /** Index among the page's elements where the icon belongs (so it keeps its stacking). */
  index: number;
  icon: string;
  color: Color;
  box: { x: number; y: number; w: number; h: number; rotation: number; opacity: number };
}

export interface CompleteResult {
  doc: Doc;
  icons: PendingIcon[];
  /** What was dropped or fixed, for the user. */
  warnings: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const SHAPES: ShapeKind[] = ['rect', 'ellipse', 'triangle', 'diamond', 'pentagon', 'hexagon', 'star', 'arrow'];
const SHAPE_ALIASES: Record<string, ShapeKind> = { rectangle: 'rect', square: 'rect', circle: 'ellipse', oval: 'ellipse' };
const CHARTS: ChartKind[] = ['column', 'bar', 'line', 'area', 'pie', 'donut'];
const MARKERS: LineMarker[] = ['none', 'arrow', 'triangle', 'circle', 'square', 'bar'];
const ALIGNS: TextAlign[] = ['left', 'center', 'right', 'justify'];
const NAMED: Record<string, string> = {
  white: '#ffffff', black: '#000000', red: '#e53935', green: '#43a047', blue: '#1e88e5', yellow: '#fdd835', orange: '#fb8c00', purple: '#8e24aa',
  pink: '#ec407a', gray: '#9e9e9e', grey: '#9e9e9e', navy: '#1a237e', teal: '#00897b', gold: '#d4af37', transparent: '#00000000',
};

/** `#rgb`, `#rrggbb`, `#rrggbbaa`, a few names → `#rrggbb[aa]`; else null. */
export function looseColor(v: unknown): Color | null {
  if (typeof v !== 'string') return null;
  let s = v.trim().toLowerCase();
  if (NAMED[s]) return NAMED[s]!;
  if (!s.startsWith('#')) s = `#${s}`;
  if (/^#[0-9a-f]{3}$/.test(s)) s = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return /^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(s) ? s : null;
}

/** `"#fff"`, `{ color }`, `{ type: 'linear', angle, stops | colors }`, `["#a", "#b"]` → Fill. */
export function looseFill(v: unknown): Fill | null {
  const c = looseColor(v);
  if (c) return { type: 'solid', color: c };
  if (Array.isArray(v)) return looseFill({ type: 'linear', colors: v });
  if (!isObj(v)) return null;
  if (v.type === 'linear' || v.type === 'gradient' || Array.isArray(v.stops) || Array.isArray(v.colors)) {
    let stops: GradientStop[] = [];
    if (Array.isArray(v.stops)) {
      stops = v.stops.flatMap((s, i, all) => {
        const col = looseColor(isObj(s) ? s.color : s);
        return col ? [{ offset: Math.max(0, Math.min(1, num(isObj(s) ? s.offset : undefined, all.length > 1 ? i / (all.length - 1) : 0))), color: col }] : [];
      });
    } else if (Array.isArray(v.colors)) {
      const cols = v.colors.map(looseColor).filter((x): x is string => !!x);
      stops = cols.map((color, i) => ({ offset: cols.length > 1 ? i / (cols.length - 1) : 0, color }));
    }
    if (stops.length === 1) return { type: 'solid', color: stops[0]!.color };
    if (stops.length >= 2) return { type: 'linear', angle: num(v.angle, 90), stops };
    return null;
  }
  const col = looseColor(v.color);
  return col ? { type: 'solid', color: col } : null;
}

function looseStroke(v: unknown, width?: unknown): Stroke | null {
  if (v === null || v === undefined || v === false) return null;
  const col = looseColor(v) ?? (isObj(v) ? looseColor(v.color) : null);
  if (!col) return null;
  const w = Math.max(0.5, num(isObj(v) ? v.width : width, 2));
  const dash = isObj(v) && (v.dash === 'dashed' || v.dash === 'dotted') ? v.dash : 'solid';
  return { color: col, width: w, dash };
}

/** Rough text height before the renderer measures it (the editor refits on load). */
export function estimateTextHeight(text: string, w: number, s: Pick<TextStyle, 'fontSize' | 'lineHeight' | 'letterSpacing'>): number {
  const perLine = Math.max(1, Math.floor(w / (s.fontSize * 0.55 + s.letterSpacing)));
  const lines = text.split('\n').reduce((n, para) => n + Math.max(1, Math.ceil(para.length / perLine)), 0);
  return Math.ceil(lines * s.fontSize * s.lineHeight + 2);
}

function textStyle(e: Obj): TextStyle {
  const st: Obj = { ...(isObj(e.style) ? e.style : {}), ...e };
  const weight = num(st.fontWeight, 0);
  return {
    ...DEFAULT_TEXT_STYLE,
    fontFamily: typeof st.fontFamily === 'string' && st.fontFamily.trim() ? st.fontFamily.trim() : typeof st.font === 'string' && st.font.trim() ? st.font.trim() : DEFAULT_TEXT_STYLE.fontFamily,
    fontSize: Math.max(4, Math.min(1000, num(st.fontSize ?? st.size, DEFAULT_TEXT_STYLE.fontSize))),
    bold: st.bold === true || weight >= 600,
    italic: st.italic === true,
    underline: st.underline === true,
    strike: st.strike === true,
    color: looseColor(st.color) ?? DEFAULT_TEXT_STYLE.color,
    align: ALIGNS.includes(st.align as TextAlign) ? (st.align as TextAlign) : 'left',
    lineHeight: Math.max(0.5, Math.min(4, num(st.lineHeight, DEFAULT_TEXT_STYLE.lineHeight))),
    letterSpacing: num(st.letterSpacing, 0),
    uppercase: st.uppercase === true,
  };
}

interface Ctx { width: number; height: number; page: number; icons: PendingIcon[]; warnings: string[] }

function box(e: Obj, ctx: Ctx, dw: number, dh: number) {
  const w = Math.max(1, num(e.w ?? e.width, dw));
  const h = Math.max(1, num(e.h ?? e.height, dh));
  return {
    x: num(e.x, (ctx.width - w) / 2), y: num(e.y, (ctx.height - h) / 2), w, h,
    rotation: num(e.rotation, 0), opacity: Math.max(0, Math.min(1, num(e.opacity, 1))),
  };
}

function element(e: unknown, ctx: Ctx, index: number): Element | null {
  if (!isObj(e)) return null;
  const type = String(e.type ?? '').toLowerCase();
  const name = typeof e.name === 'string' ? { name: e.name } : {};
  const lineLike = type === 'line' || (type === 'arrow' && ('x1' in e || 'x2' in e || 'start' in e || 'end' in e));
  if (!lineLike && (type === 'shape' || SHAPES.includes(type as ShapeKind) || SHAPE_ALIASES[type])) {
    const raw = String(e.shape ?? type).toLowerCase();
    const kind = SHAPES.includes(raw as ShapeKind) ? (raw as ShapeKind) : SHAPE_ALIASES[raw] ?? 'rect';
    const fill = 'fill' in e ? looseFill(e.fill) : looseFill(e.color) ?? { type: 'solid', color: '#8b5cf6' };
    return { id: newId('e_'), type: 'shape', shape: kind, ...box(e, ctx, 200, 200), fill, stroke: looseStroke(e.stroke, e.strokeWidth), radius: Math.max(0, num(e.radius, 0)), ...name };
  }
  if (type === 'text') {
    const value = typeof e.text === 'string' ? e.text : Array.isArray(e.text) ? e.text.join('\n') : '';
    if (!value) return null;
    const style = textStyle(e);
    const w = Math.max(10, num(e.w ?? e.width, Math.min(ctx.width * 0.8, value.length * style.fontSize * 0.6 + 8)));
    const b = box({ ...e, w }, ctx, w, estimateTextHeight(value, w, style));
    if (e.h === undefined && e.height === undefined) b.h = estimateTextHeight(value, w, style);
    const el: TextElement = { id: newId('e_'), type: 'text', text: value, ...b, style, ...name };
    if (e.list === 'bullet' || e.list === 'number') el.list = e.list;
    if (typeof e.curve === 'number' && e.curve) el.curve = Math.max(-100, Math.min(100, e.curve));
    const g = looseFill(e.gradient);
    if (g?.type === 'linear') el.gradient = g;
    if (isObj(e.effect) && typeof e.effect.type === 'string') el.effect = e.effect as unknown as TextElement['effect'];
    return el;
  }
  if (lineLike) {
    const x1 = num(e.x1 ?? (isObj(e.start) ? e.start.x : undefined), num(e.x, 0));
    const y1 = num(e.y1 ?? (isObj(e.start) ? e.start.y : undefined), num(e.y, 0));
    const x2 = num(e.x2 ?? (isObj(e.end) ? e.end.x : undefined), x1 + num(e.w, 200));
    const y2 = num(e.y2 ?? (isObj(e.end) ? e.end.y : undefined), y1 + num(e.h, 0));
    const marker = (v: unknown, d: LineMarker): LineMarker => (MARKERS.includes(v as LineMarker) ? (v as LineMarker) : d);
    const route: LineRoute = e.route === 'elbow' || e.route === 'curved' ? e.route : 'straight';
    const stroke = looseStroke(e.stroke ?? e.color ?? '#1f2328', e.strokeWidth ?? e.width) ?? { color: '#1f2328', width: 3, dash: 'solid' as const };
    return { ...line({ x: x1, y: y1 }, { x: x2, y: y2 }, { stroke, route, start: marker(e.startMarker, 'none'), end: marker(e.endMarker, type === 'arrow' ? 'arrow' : 'none') }), opacity: Math.max(0, Math.min(1, num(e.opacity, 1))), ...name };
  }
  if (type === 'path' || type === 'svg') {
    const vb = isObj(e.viewBox) ? { x: num(e.viewBox.x, 0), y: num(e.viewBox.y, 0), w: Math.max(1e-3, num(e.viewBox.w, 100)), h: Math.max(1e-3, num(e.viewBox.h, 100)) } : { x: 0, y: 0, w: 100, h: 100 };
    const src = Array.isArray(e.paths) ? e.paths : typeof e.d === 'string' ? [{ d: e.d, fill: e.fill ?? e.color, stroke: e.stroke }] : [];
    const paths: PathPart[] = src.filter(isObj).filter((p) => typeof p.d === 'string' && p.d.trim()).map((p) => ({
      d: String(p.d), fill: 'fill' in p ? looseFill(p.fill) : null, stroke: looseStroke(p.stroke, p.strokeWidth), ...(p.evenOdd ? { evenOdd: true } : {}),
    }));
    if (!paths.length) return null;
    return { id: newId('e_'), type: 'path', ...box(e, ctx, vb.w, vb.h), viewBox: vb, paths, ...name };
  }
  if (type === 'icon') {
    const icon = typeof e.icon === 'string' ? e.icon.trim() : typeof e.name === 'string' ? e.name.trim() : '';
    if (/^[a-z0-9-]+:[a-z0-9-]+$/i.test(icon)) ctx.icons.push({ page: ctx.page, index, icon, color: looseColor(e.color) ?? '#1f2328', box: box(e, ctx, 120, 120) });
    else ctx.warnings.push(`icon "${icon}" is not an Iconify name`);
    return null;
  }
  if (type === 'chart') {
    const kind = CHARTS.includes(e.chart as ChartKind) ? (e.chart as ChartKind) : CHARTS.includes(e.kind as ChartKind) ? (e.kind as ChartKind) : 'column';
    const b = box(e, ctx, ctx.width * 0.6, ctx.width * 0.42);
    const el = { ...chart(kind, b), rotation: b.rotation, opacity: b.opacity, ...name };
    if (Array.isArray(e.labels) && e.labels.length) el.labels = e.labels.map(String);
    if (Array.isArray(e.series) && e.series.length) {
      el.series = e.series.filter(isObj).map((s, i) => ({ name: String(s.name ?? `Series ${i + 1}`), values: (Array.isArray(s.values) ? s.values : []).map((v) => num(v, 0)) }));
    } else if (Array.isArray(e.values)) el.series = [{ name: 'Values', values: e.values.map((v) => num(v, 0)) }];
    const n = el.labels.length;
    el.series = el.series.map((s) => ({ ...s, values: Array.from({ length: n }, (_, i) => s.values[i] ?? 0) }));
    if (Array.isArray(e.colors)) {
      const cols = e.colors.map(looseColor).filter((c): c is string => !!c);
      if (cols.length) el.colors = cols;
    } else el.colors = [...CHART_COLORS];
    if (isObj(e.style)) el.style = { ...el.style, ...(typeof e.style.fontFamily === 'string' ? { fontFamily: e.style.fontFamily } : {}), ...(looseColor(e.style.color) ? { color: looseColor(e.style.color)! } : {}), fontSize: num(e.style.fontSize, el.style.fontSize) };
    if (typeof e.legend === 'boolean') el.legend = e.legend;
    if (typeof e.grid === 'boolean') el.grid = e.grid;
    if (e.values === true) el.values = true;
    return el;
  }
  if (type === 'table') {
    const rows = (Array.isArray(e.rows) ? e.rows : Array.isArray(e.cells) ? e.cells : []).filter(Array.isArray) as unknown[][];
    if (!rows.length) return null;
    const cols = Math.max(...rows.map((r) => r.length));
    const st = textStyle(isObj(e.style) ? { ...e.style } : { fontSize: e.fontSize, color: e.color, fontFamily: e.fontFamily });
    const b = box(e, ctx, ctx.width * 0.7, rows.length * st.fontSize * 2.2);
    const el = { ...table(rows.length, cols, b, st), rotation: b.rotation, opacity: b.opacity, ...name };
    const head = looseColor(e.headerFill);
    el.cells = el.cells.map((row, r) => row.map((cell, c) => {
      const v = rows[r]?.[c];
      const txt = isObj(v) ? String(v.text ?? '') : v === undefined || v === null ? '' : String(v);
      const fill = isObj(v) ? looseColor(v.fill) : r === 0 && head ? head : null;
      return { ...cell, text: txt, ...(fill ? { fill } : {}), ...(r === 0 && e.header === false ? { fill: undefined, style: undefined } : {}) };
    }));
    if ('border' in e) el.border = looseStroke(e.border);
    return el;
  }
  if (type === 'group' && Array.isArray(e.children)) {
    const children = e.children.map((c, i) => element(c, ctx, i)).filter((c): c is Element => !!c);
    if (!children.length) return null;
    const xs = children.map((c) => c.x), ys = children.map((c) => c.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    const w = Math.max(...children.map((c) => c.x + c.w)) - x, h = Math.max(...children.map((c) => c.y + c.h)) - y;
    return { id: newId('e_'), type: 'group', x, y, w, h, rotation: 0, opacity: Math.max(0, Math.min(1, num(e.opacity, 1))), children, ...name };
  }
  ctx.warnings.push(`left out an element of type "${type || '?'}"`);
  return null;
}

/** A loose page → a Page of a `width`×`height` document. */
export function completePage(input: unknown, size: { width: number; height: number }, pageIndex = 0, icons: PendingIcon[] = [], warnings: string[] = []): Page {
  const p = isObj(input) ? input : {};
  const ctx: Ctx = { ...size, page: pageIndex, icons, warnings };
  const list = Array.isArray(p.elements) ? p.elements : [];
  const elements: Element[] = [];
  list.forEach((e) => {
    const el = element(e, ctx, elements.length);
    if (el) elements.push(el);
  });
  const page: Page = { id: newId('p_'), background: looseFill(p.background) ?? { type: 'solid', color: '#ffffff' }, elements };
  if (typeof p.name === 'string') page.name = p.name;
  if (typeof p.notes === 'string') page.notes = p.notes;
  return page;
}

/**
 * A loose document (or a single loose page, or a list of pages) → a valid Doc.
 * `size` is used when the input has no width/height (e.g. the page being designed).
 */
export function completeDoc(input: unknown, size?: { width: number; height: number }, title?: string): CompleteResult {
  const obj: Obj = Array.isArray(input) ? { pages: input } : isObj(input) ? input : {};
  const pagesIn: unknown[] = Array.isArray(obj.pages) ? obj.pages : Array.isArray(obj.elements) ? [obj] : isObj(obj.page) ? [obj.page] : [];
  const width = num(obj.width, size?.width ?? 1080), height = num(obj.height, size?.height ?? 1080);
  const base = createDoc({ width, height, title: typeof obj.title === 'string' ? obj.title : title });
  const icons: PendingIcon[] = [], warnings: string[] = [];
  const pages = pagesIn.map((p, i) => completePage(p, { width: base.width, height: base.height }, i, icons, warnings));
  if (!pages.length) throw new Error('the design has no pages');
  return { doc: parseDoc({ ...base, pages }), icons, warnings };
}

/**
 * The JSON inside a model's reply: a ```json fence, or the outermost {…} / […].
 * Throws when there is none or it doesn't parse.
 */
export function extractJson(reply: string): unknown {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(reply);
  const body = fence ? fence[1]! : reply;
  const starts = [body.indexOf('{'), body.indexOf('[')].filter((i) => i >= 0);
  if (!starts.length) throw new Error('the reply has no JSON in it');
  const start = Math.min(...starts);
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
  if (end <= start) throw new Error('the reply has no JSON in it');
  return JSON.parse(body.slice(start, end + 1));
}

/** A model's reply → a valid design of the given page size (see the AI panel). */
export function designFromReply(reply: string, size: { width: number; height: number }): CompleteResult {
  const data = extractJson(reply);
  // a model may answer with the whole doc but the wrong size: keep the page size asked for
  const obj = (isObj(data) ? { ...data, width: size.width, height: size.height } : data) as unknown;
  return completeDoc(obj, size);
}
