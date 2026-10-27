import { encode } from 'uqr';
import { DEFAULT_TEXT_STYLE, newId } from './doc.ts';
import { boxPoint, lineEnds, setLineEnds } from './line.ts';
import type {
  ChartElement, ChartKind, Color, Doc, Element, ImageElement, LineElement, LineMarker, LineRoute, MaskPath, PathElement, ShapeKind, Stroke,
  TableCell, TableElement, TextStyle,
} from './types.ts';

/**
 * M6 elements: factories and pure operations for lines and connectors,
 * frames and grids, tables, charts and QR codes.
 */

type Box = { x: number; y: number; w: number; h: number };

// ---- lines & connectors ----

export function line(a: { x: number; y: number }, b: { x: number; y: number }, opts: { stroke?: Stroke; route?: LineRoute; start?: LineMarker; end?: LineMarker } = {}): LineElement {
  const base: LineElement = {
    id: newId('e_'), type: 'line', x: 0, y: 0, w: 0, h: 0, rotation: 0, opacity: 1,
    start: { x: 0, y: 0, marker: opts.start ?? 'none' }, end: { x: 0, y: 0, marker: opts.end ?? 'none' },
    stroke: opts.stroke ?? { color: '#1f2328', width: 4, dash: 'solid' }, route: opts.route ?? 'straight',
  };
  const p = setLineEnds(base, a, b);
  delete p.flipX;
  delete p.flipY;
  return { ...base, ...p };
}

/**
 * Move connector ends to the elements they are stuck to. Returns the same doc
 * when nothing moved, so it is cheap to run after every change. An end whose
 * element is gone keeps its place and lets go.
 */
export function followConnectors(doc: Doc): Doc {
  let changed = false;
  const pages = doc.pages.map((page) => {
    if (!page.elements.some((e) => e.type === 'line' && (e.start.attach || e.end.attach))) return page;
    const byId = new Map(page.elements.map((e) => [e.id, e]));
    let pageChanged = false;
    const elements = page.elements.map((e) => {
      if (e.type !== 'line' || (!e.start.attach && !e.end.attach)) return e;
      const [a, b] = lineEnds(e);
      const target = (att: LineElement['start']['attach']) => (att ? byId.get(att.elementId) : undefined);
      const ta = target(e.start.attach), tb = target(e.end.attach);
      const na = ta && ta.type !== 'line' ? boxPoint(ta, e.start.attach!.point) : a;
      const nb = tb && tb.type !== 'line' ? boxPoint(tb, e.end.attach!.point) : b;
      const lost = (e.start.attach && !ta) || (e.end.attach && !tb);
      const moved = Math.hypot(na.x - a.x, na.y - a.y) > 0.01 || Math.hypot(nb.x - b.x, nb.y - b.y) > 0.01;
      if (!moved && !lost) return e;
      pageChanged = true;
      return { ...e, ...setLineEnds(e, na, nb, { start: e.start.attach && !ta ? null : undefined, end: e.end.attach && !tb ? null : undefined }) } as LineElement;
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, elements };
  });
  return changed ? { ...doc, pages } : doc;
}

// ---- frames & grids ----

/** Frame shapes. Masks given as paths use a 100×100 box. */
export const FRAMES: { id: string; label: string; mask: ShapeKind | MaskPath; radius?: number; ratio?: number }[] = [
  { id: 'square', label: 'Square', mask: 'rect' },
  { id: 'rounded', label: 'Rounded', mask: 'rect', radius: 0.12 },
  { id: 'circle', label: 'Circle', mask: 'ellipse' },
  { id: 'portrait', label: 'Portrait', mask: 'rect', ratio: 0.75 },
  { id: 'arch', label: 'Arch', mask: { d: 'M0 100V50a50 50 0 0 1 100 0v50z', viewBox: { x: 0, y: 0, w: 100, h: 100 } }, ratio: 0.75 },
  { id: 'star', label: 'Star', mask: 'star' },
  { id: 'heart', label: 'Heart', mask: { d: 'M50 92C18 70 2 52 2 31 2 15 14 4 28 4c10 0 18 6 22 14C54 10 62 4 72 4c14 0 26 11 26 27 0 21-16 39-48 61z', viewBox: { x: 0, y: 0, w: 100, h: 100 } } },
  { id: 'blob', label: 'Blob', mask: { d: 'M52 3c19 0 37 10 43 28s-1 38-14 52-35 18-52 11S-1 69 2 47 33 3 52 3z', viewBox: { x: 0, y: 0, w: 100, h: 100 } } },
  { id: 'hexagon', label: 'Hexagon', mask: 'hexagon' },
  { id: 'diamond', label: 'Diamond', mask: 'diamond' },
  { id: 'triangle', label: 'Triangle', mask: 'triangle' },
  { id: 'scallop', label: 'Scallop', mask: { d: scallop(), viewBox: { x: 0, y: 0, w: 100, h: 100 } } },
  { id: 'polaroid', label: 'Polaroid', mask: 'rect', ratio: 0.84 },
];

/** A round frame with 12 bumps. */
function scallop(): string {
  const n = 12, R = 44, r = 9;
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = 50 + R * Math.cos(a), y = 50 + R * Math.sin(a);
    d += `M${(x + r).toFixed(2)} ${y.toFixed(2)}a${r} ${r} 0 1 0 ${-2 * r} 0a${r} ${r} 0 1 0 ${2 * r} 0z`;
  }
  return `${d}M50 9a41 41 0 1 0 0.01 0z`;
}

/** An empty frame (or one holding `asset`). */
export function frame(mask: ShapeKind | MaskPath, box: Box, asset = '', radius = 0): ImageElement {
  return { id: newId('e_'), type: 'image', asset, ...box, rotation: 0, opacity: 1, radius, mask };
}

/** Is this image a frame (a photo inside a shape)? */
export const isFrame = (e: Element): e is ImageElement => e.type === 'image' && !!e.mask;

/** Photo grid layouts: cells as fractions of the area (x, y, w, h). */
export const GRIDS: { id: string; label: string; cells: [number, number, number, number][] }[] = [
  { id: '2v', label: '2 side by side', cells: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]] },
  { id: '2h', label: '2 stacked', cells: [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]] },
  { id: '3c', label: '3 columns', cells: [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]] },
  { id: '3l', label: '1 + 2', cells: [[0, 0, 0.6, 1], [0.6, 0, 0.4, 0.5], [0.6, 0.5, 0.4, 0.5]] },
  { id: '3t', label: '1 over 2', cells: [[0, 0, 1, 0.6], [0, 0.6, 0.5, 0.4], [0.5, 0.6, 0.5, 0.4]] },
  { id: '4g', label: '2 × 2', cells: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]] },
  { id: '4l', label: '1 + 3', cells: [[0, 0, 2 / 3, 1], [2 / 3, 0, 1 / 3, 1 / 3], [2 / 3, 1 / 3, 1 / 3, 1 / 3], [2 / 3, 2 / 3, 1 / 3, 1 / 3]] },
  { id: '4r', label: '4 rows', cells: [[0, 0, 1, 0.25], [0, 0.25, 1, 0.25], [0, 0.5, 1, 0.25], [0, 0.75, 1, 0.25]] },
  { id: '5m', label: '2 + 3', cells: [[0, 0, 0.5, 0.55], [0.5, 0, 0.5, 0.55], [0, 0.55, 1 / 3, 0.45], [1 / 3, 0.55, 1 / 3, 0.45], [2 / 3, 0.55, 1 / 3, 0.45]] },
  { id: '6g', label: '3 × 2', cells: [0, 1, 2, 3, 4, 5].map((i) => [(i % 3) / 3, Math.floor(i / 3) / 2, 1 / 3, 0.5]) as [number, number, number, number][] },
  { id: '6m', label: 'Feature + 5', cells: [[0, 0, 2 / 3, 2 / 3], [2 / 3, 0, 1 / 3, 1 / 3], [2 / 3, 1 / 3, 1 / 3, 1 / 3], [0, 2 / 3, 1 / 3, 1 / 3], [1 / 3, 2 / 3, 1 / 3, 1 / 3], [2 / 3, 2 / 3, 1 / 3, 1 / 3]] },
  { id: '9g', label: '3 × 3', cells: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => [(i % 3) / 3, Math.floor(i / 3) / 3, 1 / 3, 1 / 3]) as [number, number, number, number][] },
];

/** Frames for a grid layout filling `area`, `gap` px apart. */
export function grid(id: string, area: Box, gap = 8): ImageElement[] {
  const g = GRIDS.find((x) => x.id === id) ?? GRIDS[0]!;
  return g.cells.map(([fx, fy, fw, fh]) => {
    const x0 = area.x + fx * area.w + (fx > 0 ? gap / 2 : 0);
    const y0 = area.y + fy * area.h + (fy > 0 ? gap / 2 : 0);
    const x1 = area.x + (fx + fw) * area.w - (fx + fw < 0.999 ? gap / 2 : 0);
    const y1 = area.y + (fy + fh) * area.h - (fy + fh < 0.999 ? gap / 2 : 0);
    return { ...frame('rect', { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }), name: 'Grid cell' };
  });
}

// ---- tables ----

export function table(rows: number, cols: number, box: Box, style: Partial<TextStyle> = {}): TableElement {
  const st: TextStyle = { ...DEFAULT_TEXT_STYLE, fontSize: 18, ...style };
  const cells: TableCell[][] = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, () => (r === 0 ? { text: '', fill: '#eef0f4', style: { bold: true } } : { text: '' })));
  return {
    id: newId('e_'), type: 'table', ...box, rotation: 0, opacity: 1,
    cols: Array(cols).fill(1 / cols), rows: Array(rows).fill(1 / rows), cells, style: st,
    border: { color: '#c9ced6', width: 1.5, dash: 'solid' }, padding: Math.round(st.fontSize * 0.5),
  };
}

/** Each cell's box in page coordinates (before rotation). */
export function tableCellRect(el: TableElement, r: number, c: number): Box {
  let x = el.x, y = el.y;
  for (let i = 0; i < c; i++) x += el.cols[i]! * el.w;
  for (let i = 0; i < r; i++) y += el.rows[i]! * el.h;
  return { x, y, w: el.cols[c]! * el.w, h: el.rows[r]! * el.h };
}

/** Which cell holds a point given in the table's own (unrotated) frame. */
export function tableCellAt(el: TableElement, p: { x: number; y: number }): { r: number; c: number } | null {
  if (p.x < el.x || p.y < el.y || p.x > el.x + el.w || p.y > el.y + el.h) return null;
  let r = 0, c = 0, acc = el.y;
  for (; r < el.rows.length - 1; r++) { acc += el.rows[r]! * el.h; if (p.y < acc) break; }
  acc = el.x;
  for (; c < el.cols.length - 1; c++) { acc += el.cols[c]! * el.w; if (p.x < acc) break; }
  return { r, c };
}

const norm = (xs: number[]) => {
  const s = xs.reduce((a, b) => a + b, 0) || 1;
  return xs.map((x) => x / s);
};

/** Insert a row after `at` (-1 = at the top); the table grows by one row's height. */
export function tableAddRow(el: TableElement, at: number): Partial<TableElement> {
  const i = Math.max(0, Math.min(el.rows.length, at + 1));
  const rh = (el.rows[Math.max(0, Math.min(el.rows.length - 1, at))] ?? 1 / el.rows.length) * el.h;
  const h = el.h + rh;
  const px = el.rows.map((f) => f * el.h);
  px.splice(i, 0, rh);
  const cells = el.cells.map((row) => row.map((c) => ({ ...c })));
  cells.splice(i, 0, el.cols.map(() => ({ text: '' })));
  return { h, rows: px.map((v) => v / h), cells };
}

export function tableRemoveRow(el: TableElement, at: number): Partial<TableElement> {
  if (el.rows.length <= 1) return {};
  const px = el.rows.map((f) => f * el.h);
  const [gone] = px.splice(at, 1);
  const h = el.h - gone!;
  return { h, rows: px.map((v) => v / h), cells: el.cells.filter((_, r) => r !== at) };
}

/** Insert a column after `at`; the other columns narrow to make room (the table keeps its width). */
export function tableAddCol(el: TableElement, at: number): Partial<TableElement> {
  const i = Math.max(0, Math.min(el.cols.length, at + 1));
  const cols = [...el.cols];
  cols.splice(i, 0, 1 / el.cols.length);
  return { cols: norm(cols), cells: el.cells.map((row, r) => { const n = [...row]; n.splice(i, 0, r === 0 && row[0]?.fill ? { text: '', fill: row[0].fill, style: row[0].style } : { text: '' }); return n; }) };
}

export function tableRemoveCol(el: TableElement, at: number): Partial<TableElement> {
  if (el.cols.length <= 1) return {};
  return { cols: norm(el.cols.filter((_, i) => i !== at)), cells: el.cells.map((row) => row.filter((_, c) => c !== at)) };
}

/** Set column `c` to `px` wide; the next column (or the previous for the last one) gives or takes the difference. */
export function tableColWidth(el: TableElement, c: number, px: number): Partial<TableElement> {
  if (el.cols.length < 2) return { w: px };
  const n = c < el.cols.length - 1 ? c + 1 : c - 1;
  const cur = el.cols[c]! * el.w, other = el.cols[n]! * el.w;
  const min = 12;
  const next = Math.max(min, Math.min(cur + other - min, px));
  const cols = [...el.cols];
  cols[c] = next / el.w;
  cols[n] = (cur + other - next) / el.w;
  return { cols };
}

export function tableSetCell(el: TableElement, r: number, c: number, patch: Partial<TableCell>): Partial<TableElement> {
  return { cells: el.cells.map((row, i) => (i !== r ? row : row.map((cell, j) => (j === c ? { ...cell, ...patch } : cell)))) };
}

/** Grow rows that are too short for their text: `need[r]` = px the row needs. Rows never shrink. */
export function tableFitRows(el: TableElement, need: number[]): Partial<TableElement> | null {
  const px = el.rows.map((f, r) => Math.max(f * el.h, need[r] ?? 0));
  const h = px.reduce((a, b) => a + b, 0);
  if (Math.abs(h - el.h) < 0.5) return null;
  return { h, rows: px.map((v) => v / h) };
}

// ---- charts ----

export const CHART_COLORS: Color[] = ['#7c5cff', '#0fb5c0', '#ff8a3d', '#f43f5e', '#22c55e', '#eab308', '#3b82f6', '#a855f7'];

export const CHARTS: { kind: ChartKind; label: string }[] = [
  { kind: 'column', label: 'Column' },
  { kind: 'bar', label: 'Bar' },
  { kind: 'line', label: 'Line' },
  { kind: 'area', label: 'Area' },
  { kind: 'pie', label: 'Pie' },
  { kind: 'donut', label: 'Donut' },
];

export function chart(kind: ChartKind, box: Box): ChartElement {
  const pie = kind === 'pie' || kind === 'donut';
  return {
    id: newId('e_'), type: 'chart', chart: kind, ...box, rotation: 0, opacity: 1,
    labels: pie ? ['Rent', 'Food', 'Travel', 'Fun'] : ['Jan', 'Feb', 'Mar', 'Apr', 'May'],
    series: pie ? [{ name: 'Budget', values: [40, 25, 20, 15] }] : [{ name: '2025', values: [12, 19, 15, 22, 28] }, { name: '2026', values: [16, 22, 18, 26, 34] }],
    colors: [...CHART_COLORS],
    style: { fontFamily: 'Inter', fontSize: Math.max(10, Math.round(Math.min(box.w, box.h) / 22)), color: '#454b56' },
    legend: true, grid: true,
  };
}

// ---- QR codes ----

/** A QR code as a vector graphic: dark modules on a light square with a quiet zone. */
export function qrCode(text: string, box: Box, dark: Color = '#000000', light: Color | null = '#ffffff'): PathElement {
  const qr = encode(text || ' ', { ecc: 'M', border: 0 });
  const quiet = 2, n = qr.size, size = n + quiet * 2;
  let d = '';
  for (let y = 0; y < n; y++) {
    // runs of dark modules on a row become one rectangle
    for (let x = 0; x < n; x++) {
      if (!qr.data[y]![x]) continue;
      let e = x;
      while (e + 1 < n && qr.data[y]![e + 1]) e++;
      d += `M${x + quiet} ${y + quiet}h${e - x + 1}v1h${-(e - x + 1)}z`;
      x = e;
    }
  }
  const s = Math.min(box.w, box.h);
  return {
    id: newId('e_'), type: 'path', x: box.x, y: box.y, w: s, h: s, rotation: 0, opacity: 1,
    viewBox: { x: 0, y: 0, w: size, h: size }, qr: text, name: 'QR code',
    paths: [
      ...(light ? [{ d: `M0 0h${size}v${size}h${-size}z`, fill: { type: 'solid' as const, color: light }, stroke: null }] : []),
      { d, fill: { type: 'solid', color: dark }, stroke: null },
    ],
  };
}

/** Regenerate a QR code element for new text, keeping its box and colours. */
export function qrUpdate(el: PathElement, text: string): Partial<PathElement> {
  const dark = el.paths.at(-1)?.fill, light = el.paths.length > 1 ? el.paths[0]!.fill : null;
  const next = qrCode(text, el, dark?.type === 'solid' ? dark.color : '#000000', light?.type === 'solid' ? light.color : null);
  return { viewBox: next.viewBox, paths: next.paths, qr: text, w: el.w, h: el.h };
}

// ---- freehand drawing ----

export type Brush = 'pen' | 'marker' | 'highlighter';

/**
 * A freehand stroke as a path element. Points are smoothed (moving average,
 * then a Catmull-Rom spline through them as cubic Béziers).
 */
export function freehand(points: { x: number; y: number }[], opts: { color: Color; size: number; brush: Brush }): PathElement | null {
  if (!points.length) return null;
  // light smoothing of the raw pointer samples
  const pts = points.map((p, i) => {
    if (i === 0 || i === points.length - 1) return p;
    const a = points[i - 1]!, b = points[i + 1]!;
    return { x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 };
  }).filter((p, i, arr) => i === 0 || i === arr.length - 1 || Math.hypot(p.x - arr[i - 1]!.x, p.y - arr[i - 1]!.y) > 0.75);
  const f = (v: number) => Math.round(v * 100) / 100;
  let d = `M${f(pts[0]!.x)} ${f(pts[0]!.y)}`;
  if (pts.length === 1) d += `l0.01 0`; // a dot
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += `C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  const pad = opts.size / 2 + 1;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
  const w = Math.max(...xs) + pad - x, h = Math.max(...ys) + pad - y;
  return {
    id: newId('e_'), type: 'path', x, y, w, h, rotation: 0, opacity: opts.brush === 'highlighter' ? 0.4 : 1,
    viewBox: { x, y, w, h }, name: opts.brush === 'highlighter' ? 'Highlight' : 'Drawing',
    paths: [{ d, fill: null, stroke: { color: opts.color, width: opts.size } }],
  };
}
