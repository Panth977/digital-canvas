import { DEFAULT_TEXT_STYLE } from './doc.ts';
import { CHART_COLORS, tableCellRect } from './elements.ts';
import { lineRoute } from './line.ts';
import type { ChartElement, Color, Fill, LineElement, LineEnd, Stroke, TableElement, TextAlign, TextElement, TextStyle } from './types.ts';

/**
 * Lines, tables and charts are drawn from simple pieces: vector paths (page
 * coordinates, before the element's rotation) and text boxes. The renderer,
 * SVG export and vector PDF export all draw these same pieces.
 */

export interface Prim {
  d: string;
  fill: Fill | null;
  stroke: Stroke | null;
  cap?: 'butt' | 'round' | 'square';
}

export interface PrimText {
  /** A text box laid out like any text element. */
  el: TextElement;
  valign: 'top' | 'middle' | 'bottom';
}

export interface Decomposed {
  paths: Prim[];
  texts: PrimText[];
}

/** Dash pattern for a stroke, in px (null = solid). Dots need a round cap. */
export function dashArray(s: Stroke, cap: Prim['cap'] = 'butt'): number[] | null {
  const w = Math.max(0.5, s.width);
  if (s.dash === 'dashed') return [w * 3, w * 2];
  if (s.dash === 'dotted') return cap === 'round' ? [0.001, w * 2] : [w, w];
  return null;
}

const f = (v: number) => Math.round(v * 100) / 100;
const solid = (color: Color): Fill => ({ type: 'solid', color });

// ---- lines ----

/** Marker size for a stroke width. */
const markerSize = (w: number) => Math.max(8, w * 3.2);

function marker(kind: LineEnd['marker'], p: { x: number; y: number }, ang: number, stroke: Stroke): Prim | null {
  const s = markerSize(stroke.width);
  const cos = Math.cos(ang), sin = Math.sin(ang);
  // local frame: +u along the line's direction at this end (pointing out), +v across
  const at = (u: number, v: number) => `${f(p.x + u * cos - v * sin)} ${f(p.y + u * sin + v * cos)}`;
  const fill = solid(stroke.color);
  switch (kind) {
    case 'arrow':
      return { d: `M${at(-s, -s * 0.6)}L${at(0, 0)}L${at(-s, s * 0.6)}`, fill: null, stroke: { color: stroke.color, width: stroke.width }, cap: 'round' };
    case 'triangle':
      return { d: `M${at(stroke.width * 0.5, 0)}L${at(-s, -s * 0.6)}L${at(-s, s * 0.6)}Z`, fill, stroke: null };
    case 'circle': {
      const r = s * 0.42;
      return { d: `M${at(r, 0)}A${f(r)} ${f(r)} 0 1 0 ${at(-r, 0)}A${f(r)} ${f(r)} 0 1 0 ${at(r, 0)}Z`, fill, stroke: null };
    }
    case 'square': {
      const h = s * 0.4;
      return { d: `M${at(h, -h)}L${at(h, h)}L${at(-h, h)}L${at(-h, -h)}Z`, fill, stroke: null };
    }
    case 'bar':
      return { d: `M${at(0, -s * 0.6)}L${at(0, s * 0.6)}`, fill: null, stroke: { color: stroke.color, width: stroke.width }, cap: 'butt' };
    default:
      return null;
  }
}

export function decomposeLine(el: LineElement): Decomposed {
  const r = lineRoute(el);
  const pts = r.pts.map((p) => ({ ...p }));
  const n = pts.length;
  // direction at each end, pointing away from the line
  const away = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.atan2(a.y - b.y, a.x - b.x);
  const prevOfEnd = r.kind === 'cubic' ? (Math.hypot(pts[3]!.x - pts[2]!.x, pts[3]!.y - pts[2]!.y) > 0.01 ? pts[2]! : pts[0]!) : pts[n - 2] ?? pts[0]!;
  const nextOfStart = r.kind === 'cubic' ? (Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y) > 0.01 ? pts[1]! : pts[3]!) : pts[1] ?? pts[0]!;
  const aStart = away(pts[0]!, nextOfStart), aEnd = away(pts[n - 1]!, prevOfEnd);
  const tipStart = { ...pts[0]! }, tipEnd = { ...pts[n - 1]! };
  // filled triangles carry the line's end: stop the stroke inside them so it doesn't poke out
  const trim = (i: number, ang: number) => {
    const s = markerSize(el.stroke.width) * 0.8;
    pts[i] = { x: pts[i]!.x - Math.cos(ang) * s, y: pts[i]!.y - Math.sin(ang) * s };
  };
  if (el.start.marker === 'triangle') trim(0, aStart);
  if (el.end.marker === 'triangle') trim(n - 1, aEnd);
  const d = r.kind === 'cubic'
    ? `M${f(pts[0]!.x)} ${f(pts[0]!.y)}C${f(pts[1]!.x)} ${f(pts[1]!.y)} ${f(pts[2]!.x)} ${f(pts[2]!.y)} ${f(pts[3]!.x)} ${f(pts[3]!.y)}`
    : pts.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(p.y)}`).join('');
  const paths: Prim[] = [{ d, fill: null, stroke: el.stroke, cap: el.stroke.dash === 'dotted' ? 'round' : 'butt' }];
  const m1 = marker(el.start.marker, tipStart, aStart, el.stroke), m2 = marker(el.end.marker, tipEnd, aEnd, el.stroke);
  if (m1) paths.push(m1);
  if (m2) paths.push(m2);
  return { paths, texts: [] };
}

// ---- tables ----

/** The text box of one table cell (inside its padding), as a text element. */
export function tableCellText(el: TableElement, r: number, c: number): TextElement {
  const cell = el.cells[r]![c]!;
  const rect = tableCellRect(el, r, c);
  const p = Math.min(el.padding, rect.w / 3, rect.h / 3);
  return {
    id: `${el.id}#${r},${c}`, type: 'text', text: cell.text, x: rect.x + p, y: rect.y + p, w: Math.max(1, rect.w - 2 * p), h: Math.max(1, rect.h - 2 * p),
    rotation: 0, opacity: 1, style: { ...el.style, ...cell.style },
  };
}

export function decomposeTable(el: TableElement): Decomposed {
  const paths: Prim[] = [];
  const texts: PrimText[] = [];
  el.cells.forEach((row, r) => row.forEach((cell, c) => {
    const b = tableCellRect(el, r, c);
    if (cell.fill) paths.push({ d: `M${f(b.x)} ${f(b.y)}h${f(b.w)}v${f(b.h)}h${f(-b.w)}Z`, fill: solid(cell.fill), stroke: null });
    if (cell.text) texts.push({ el: tableCellText(el, r, c), valign: 'middle' });
  }));
  if (el.border && el.border.width > 0) {
    let d = `M${f(el.x)} ${f(el.y)}h${f(el.w)}v${f(el.h)}h${f(-el.w)}Z`;
    let y = el.y;
    for (let r = 0; r < el.rows.length - 1; r++) { y += el.rows[r]! * el.h; d += `M${f(el.x)} ${f(y)}h${f(el.w)}`; }
    let x = el.x;
    for (let c = 0; c < el.cols.length - 1; c++) { x += el.cols[c]! * el.w; d += `M${f(x)} ${f(el.y)}v${f(el.h)}`; }
    paths.push({ d, fill: null, stroke: el.border, cap: 'square' });
  }
  return { paths, texts };
}

// ---- charts ----

function niceStep(range: number, n = 5): number {
  if (!(range > 0)) return 1;
  const raw = range / n, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

/** A number as a short label (12, 1.5, 2.5k, 3M). */
export function formatValue(v: number): string {
  const a = Math.abs(v);
  const t = (x: number) => String(Math.round(x * 100) / 100);
  if (a >= 1e6) return `${t(v / 1e6)}M`;
  if (a >= 1e4) return `${t(v / 1e3)}k`;
  return t(v);
}

const rect = (x: number, y: number, w: number, h: number) => `M${f(x)} ${f(y)}h${f(w)}v${f(h)}h${f(-w)}Z`;

export function decomposeChart(el: ChartElement): Decomposed {
  const paths: Prim[] = [];
  const texts: PrimText[] = [];
  const fs = el.style.fontSize;
  const colors = el.colors.length ? el.colors : CHART_COLORS;
  const colorOf = (i: number) => colors[i % colors.length]!;
  const style = (p: Partial<TextStyle> = {}): TextStyle => ({ ...DEFAULT_TEXT_STYLE, fontFamily: el.style.fontFamily, fontSize: fs, color: el.style.color, lineHeight: 1.2, ...p });
  let n = 0;
  const label = (text: string, x: number, y: number, w: number, h: number, align: TextAlign, valign: PrimText['valign'] = 'middle', p: Partial<TextStyle> = {}) => {
    texts.push({ el: { id: `${el.id}#t${n++}`, type: 'text', text, x, y, w: Math.max(1, w), h: Math.max(1, h), rotation: 0, opacity: 1, style: style({ align, ...p }) }, valign });
  };
  const pad = fs * 0.6;
  const charW = fs * 0.66; // rough average glyph width, for reserving label space
  let x0 = el.x + pad, y0 = el.y + pad, x1 = el.x + el.w - pad, y1 = el.y + el.h - pad;
  const pie = el.chart === 'pie' || el.chart === 'donut';

  // legend: a row on top (one entry per series; per label for pies, in a column on the right)
  if (el.legend) {
    const names = pie ? el.labels : el.series.map((s) => s.name);
    const sw = fs * 0.75;
    if (pie) {
      const lw = Math.min(el.w * 0.4, sw + fs * 0.5 + Math.max(...names.map((t) => t.length), 1) * charW);
      const top = (y0 + y1) / 2 - (names.length * fs * 1.5) / 2;
      names.forEach((name, i) => {
        const y = top + i * fs * 1.5;
        paths.push({ d: rect(x1 - lw, y + (fs * 1.5 - sw) / 2, sw, sw), fill: solid(colorOf(i)), stroke: null });
        label(name, x1 - lw + sw + fs * 0.4, y, lw - sw - fs * 0.4, fs * 1.5, 'left');
      });
      x1 -= lw + pad;
    } else {
      let x = x0;
      for (const [i, s] of el.series.entries()) {
        const tw = s.name.length * charW + fs * 0.4;
        paths.push({ d: rect(x, y0 + (fs * 1.5 - sw) / 2, sw, sw), fill: solid(colorOf(i)), stroke: null });
        label(s.name, x + sw + fs * 0.35, y0, tw + fs, fs * 1.5, 'left');
        x += sw + fs * 0.35 + tw + fs;
      }
      y0 += fs * 2;
    }
  }

  if (pie) {
    const vals = (el.series[0]?.values ?? []).map((v) => Math.max(0, v || 0));
    const total = vals.reduce((a, b) => a + b, 0);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, R = Math.max(1, Math.min(x1 - x0, y1 - y0) / 2);
    const r = el.chart === 'donut' ? R * 0.58 : 0;
    let a = -Math.PI / 2;
    const pt = (rad: number, ang: number) => `${f(cx + rad * Math.cos(ang))} ${f(cy + rad * Math.sin(ang))}`;
    vals.forEach((v, i) => {
      if (!total || !v) return;
      const sweep = (v / total) * Math.PI * 2;
      const b = a + sweep;
      // arcs of at most half a turn, so a 100% slice still draws
      const arc = (rad: number, from: number, to: number, dir: 0 | 1) => {
        const steps = Math.abs(to - from) > Math.PI ? 2 : 1;
        let s = '';
        for (let k = 1; k <= steps; k++) s += `A${f(rad)} ${f(rad)} 0 0 ${dir} ${pt(rad, from + ((to - from) * k) / steps)}`;
        return s;
      };
      const d = r > 0
        ? `M${pt(R, a)}${arc(R, a, b, 1)}L${pt(r, b)}${arc(r, b, a, 0)}Z`
        : `M${f(cx)} ${f(cy)}L${pt(R, a)}${arc(R, a, b, 1)}Z`;
      paths.push({ d, fill: solid(colorOf(i)), stroke: { color: '#ffffff', width: Math.max(1, R / 80) } });
      if (el.values) {
        const mid = (a + b) / 2, lr = r > 0 ? (R + r) / 2 : R * 0.62;
        label(`${Math.round((v / total) * 100)}%`, cx + lr * Math.cos(mid) - fs * 2, cy + lr * Math.sin(mid) - fs * 0.75, fs * 4, fs * 1.5, 'center', 'middle', { color: '#ffffff', bold: true });
      }
      a = b;
    });
    return { paths, texts };
  }

  // axes charts: value range with "nice" gridlines
  const all = el.series.flatMap((s) => s.values.slice(0, el.labels.length)).filter((v) => Number.isFinite(v));
  let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  if (hi === lo) hi = lo + 1;
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step + 1e-9) * step;
  hi = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  const horizontal = el.chart === 'bar';
  const n0 = Math.max(1, el.labels.length);
  const gridStroke: Stroke = { color: '#e3e6eb', width: Math.max(1, fs / 14) };
  const axisStroke: Stroke = { color: '#9aa1ad', width: Math.max(1, fs / 12) };

  if (!horizontal) {
    const yw = Math.max(...ticks.map((t) => formatValue(t).length)) * charW + pad;
    x0 += yw;
    y1 -= fs * 1.8;
    const yOf = (v: number) => y1 - ((v - lo) / (hi - lo)) * (y1 - y0);
    let g = '';
    for (const t of ticks) {
      const y = yOf(t);
      if (el.grid) g += `M${f(x0)} ${f(y)}H${f(x1)}`;
      label(formatValue(t), x0 - yw, y - fs * 0.75, yw - pad * 0.6, fs * 1.5, 'right');
    }
    if (g) paths.push({ d: g, fill: null, stroke: gridStroke, cap: 'butt' });
    const gw = (x1 - x0) / n0;
    el.labels.forEach((t, i) => label(t, x0 + i * gw, y1 + fs * 0.3, gw, fs * 1.4, 'center', 'top'));
    if (el.chart === 'column') {
      const ns = Math.max(1, el.series.length), bw = (gw * 0.72) / ns;
      el.series.forEach((s, si) => {
        let d = '';
        el.labels.forEach((_, i) => {
          const v = s.values[i] ?? 0;
          const x = x0 + i * gw + gw * 0.14 + si * bw, ya = yOf(Math.max(0, v)), yb = yOf(Math.min(0, v));
          if (yb - ya > 0.01) d += rect(x, ya, bw * 0.92, yb - ya);
          if (el.values) label(formatValue(v), x - bw, ya - fs * 1.4, bw * 2.92, fs * 1.3, 'center', 'bottom', { fontSize: fs * 0.85 });
        });
        if (d) paths.push({ d, fill: solid(colorOf(si)), stroke: null });
      });
    } else {
      // line and area: points at the middle of each label's slot
      const lw = Math.max(2, fs * 0.16);
      el.series.forEach((s, si) => {
        const pts = el.labels.map((_, i) => ({ x: x0 + (i + 0.5) * gw, y: yOf(s.values[i] ?? 0) }));
        if (!pts.length) return;
        const line = pts.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(p.y)}`).join('');
        if (el.chart === 'area') paths.push({ d: `${line}L${f(pts.at(-1)!.x)} ${f(yOf(Math.max(lo, 0)))}L${f(pts[0]!.x)} ${f(yOf(Math.max(lo, 0)))}Z`, fill: solid(`${colorOf(si).slice(0, 7)}55`), stroke: null });
        paths.push({ d: line, fill: null, stroke: { color: colorOf(si), width: lw }, cap: 'round' });
        if (el.chart === 'line') {
          const r = lw * 1.4;
          paths.push({ d: pts.map((p) => `M${f(p.x + r)} ${f(p.y)}A${f(r)} ${f(r)} 0 1 0 ${f(p.x - r)} ${f(p.y)}A${f(r)} ${f(r)} 0 1 0 ${f(p.x + r)} ${f(p.y)}Z`).join(''), fill: solid(colorOf(si)), stroke: null });
        }
        if (el.values) pts.forEach((p, i) => label(formatValue(s.values[i] ?? 0), p.x - gw / 2, p.y - fs * 1.6, gw, fs * 1.3, 'center', 'bottom', { fontSize: fs * 0.85 }));
      });
    }
    paths.push({ d: `M${f(x0)} ${f(yOf(Math.max(lo, Math.min(hi, 0))))}H${f(x1)}`, fill: null, stroke: axisStroke, cap: 'butt' });
  } else {
    const lw = Math.min(el.w * 0.35, Math.max(...el.labels.map((t) => t.length), 1) * charW + pad * 1.6);
    x0 += lw;
    y1 -= fs * 1.8;
    const xOf = (v: number) => x0 + ((v - lo) / (hi - lo)) * (x1 - x0);
    let g = '';
    for (const t of ticks) {
      const x = xOf(t);
      if (el.grid) g += `M${f(x)} ${f(y0)}V${f(y1)}`;
      label(formatValue(t), x - fs * 3, y1 + fs * 0.3, fs * 6, fs * 1.4, 'center', 'top');
    }
    if (g) paths.push({ d: g, fill: null, stroke: gridStroke, cap: 'butt' });
    const gh = (y1 - y0) / n0;
    el.labels.forEach((t, i) => label(t, x0 - lw, y0 + i * gh, lw - pad * 0.6, gh, 'right'));
    const ns = Math.max(1, el.series.length), bh = (gh * 0.72) / ns;
    el.series.forEach((s, si) => {
      let d = '';
      el.labels.forEach((_, i) => {
        const v = s.values[i] ?? 0;
        const y = y0 + i * gh + gh * 0.14 + si * bh, xa = xOf(Math.min(0, v)), xb = xOf(Math.max(0, v));
        if (xb - xa > 0.01) d += rect(xa, y, xb - xa, bh * 0.92);
        if (el.values) label(formatValue(v), xb + fs * 0.3, y, fs * 5, bh * 0.92, 'left', 'middle', { fontSize: fs * 0.85 });
      });
      if (d) paths.push({ d, fill: solid(colorOf(si)), stroke: null });
    });
    paths.push({ d: `M${f(xOf(Math.max(lo, Math.min(hi, 0))))} ${f(y0)}V${f(y1)}`, fill: null, stroke: axisStroke, cap: 'butt' });
  }
  return { paths, texts };
}

/** Pieces of a line, table or chart. */
export function decompose(el: LineElement | TableElement | ChartElement): Decomposed {
  return el.type === 'line' ? decomposeLine(el) : el.type === 'table' ? decomposeTable(el) : decomposeChart(el);
}
