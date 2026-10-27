/** Little SVG previews of built-in elements (shapes, lines, frames, grids, charts), drawn by the same code as the canvas. */
import { CHARTS, chart, decompose, FRAMES, GRIDS, line, type ShapeKind } from '@digital-canvas/scene';
import type { LINES } from '../../lib/editor.svelte.ts';

export const SHAPE_SVG: Record<ShapeKind, string> = {
  rect: '<rect x="4" y="4" width="40" height="40" rx="3"/>',
  ellipse: '<circle cx="24" cy="24" r="20"/>',
  triangle: '<path d="M24 4L44 44H4z"/>',
  diamond: '<path d="M24 3L45 24 24 45 3 24z"/>',
  pentagon: '<path d="M24 4l19 14-7 23H12L5 18z"/>',
  hexagon: '<path d="M14 6h20l10 18-10 18H14L4 24z"/>',
  star: '<path d="M24 4l5.9 12.9 14.1 1.6-10.5 9.6 2.9 13.9L24 35l-12.4 7 2.9-13.9L4 18.5l14.1-1.6z"/>',
  arrow: '<path d="M4 17h24V8l16 16-16 16v-9H4z"/>',
};

export function linePreview(p: (typeof LINES)[number]): string {
  const bent = p.route !== 'straight';
  const el = line({ x: 6, y: bent ? 12 : 24 }, { x: 42, y: bent ? 36 : 24 }, { route: p.route, start: p.start, end: p.end, stroke: { color: '#3d4350', width: 2.5, dash: p.dash ?? 'solid' } });
  return decompose(el).paths.map((x) => `<path d="${x.d}" fill="${x.fill?.type === 'solid' ? x.fill.color : 'none'}" stroke="${x.stroke ? x.stroke.color : 'none'}" stroke-width="${x.stroke?.width ?? 0}" stroke-linecap="${x.cap ?? 'butt'}" stroke-linejoin="round"${x.stroke?.dash === 'dashed' ? ' stroke-dasharray="7 5"' : x.stroke?.dash === 'dotted' ? ' stroke-dasharray="0.01 5"' : ''}/>`).join('');
}

export function framePreview(f: (typeof FRAMES)[number]): string {
  const w = 40 * (f.ratio ?? 1), x = (48 - w) / 2;
  if (f.id === 'polaroid') return `<rect x="${x}" y="4" width="${w}" height="40" fill="#fff" stroke="#c5c9d2"/><rect x="${x + 3}" y="7" width="${w - 6}" height="30" />`;
  if (typeof f.mask === 'string') {
    if (f.mask === 'rect') return `<rect x="${x}" y="4" width="${w}" height="40" rx="${(f.radius ?? 0) * 40}"/>`;
    return `<g transform="translate(${x - 4} 0) scale(${w / 40} 1)">${SHAPE_SVG[f.mask]}</g>`;
  }
  return `<svg x="${x}" y="4" width="${w}" height="40" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${f.mask.d}"/></svg>`;
}

export const gridPreview = (g: (typeof GRIDS)[number]) =>
  g.cells.map(([x, y, w, h]) => `<rect x="${4 + x * 40 + 1}" y="${4 + y * 40 + 1}" width="${w * 40 - 2}" height="${h * 40 - 2}" rx="1.5"/>`).join('');

export function chartPreview(kind: (typeof CHARTS)[number]['kind']): string {
  const el = { ...chart(kind, { x: 0, y: 0, w: 48, h: 48 }), legend: false, grid: false, style: { fontFamily: 'Inter', fontSize: 1, color: '#000' } };
  return decompose(el).paths.map((x) => `<path d="${x.d}" fill="${x.fill?.type === 'solid' ? x.fill.color : 'none'}" stroke="${x.stroke ? x.stroke.color : 'none'}" stroke-width="${Math.min(x.stroke?.width ?? 0, 1.5)}"/>`).join('');
}

/** A table preview: `rows` × `cols` cells with a header row. */
export function tablePreview(rows: number, cols: number): string {
  const w = 40 / cols, h = 40 / rows;
  let s = `<rect x="4" y="4" width="40" height="${h}" fill="#8b3dff" opacity=".85"/>`;
  for (let r = 0; r <= rows; r++) s += `<line x1="4" x2="44" y1="${4 + r * h}" y2="${4 + r * h}"/>`;
  for (let c = 0; c <= cols; c++) s += `<line y1="4" y2="44" x1="${4 + c * w}" x2="${4 + c * w}"/>`;
  return s;
}
