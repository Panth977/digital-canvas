import type { Color, PathPart } from './types.ts';

/**
 * A small SVG reader for icons (e.g. from Iconify): turns `<path>`, `<rect>`,
 * `<circle>`, `<ellipse>`, `<line>`, `<polyline>` and `<polygon>` into path
 * parts, with fill and stroke inherited from enclosing `<g>`s. Pure (no DOM).
 * Not handled: transforms, gradients, masks, clip paths, `<use>`, CSS.
 */

const NAMED: Record<string, Color> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', gray: '#808080', grey: '#808080',
  yellow: '#ffff00', orange: '#ffa500', purple: '#800080',
};

/** An SVG paint value as a hex colour; `currentColor` becomes `current`. null = none. */
function paint(v: string | undefined, current: Color, opacity: number): Color | null | undefined {
  if (v === undefined) return undefined;
  v = v.trim().toLowerCase();
  if (v === 'none' || v === 'transparent') return null;
  let hex: string | undefined;
  if (v === 'currentcolor') hex = current;
  else if (v.startsWith('#')) {
    let h = v.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    hex = `#${h.slice(0, 6)}`;
    if (h.length === 8) opacity *= parseInt(h.slice(6, 8), 16) / 255;
  } else if (v.startsWith('rgb')) {
    const n = v.match(/[\d.]+%?/g) ?? [];
    const ch = (s: string | undefined) => Math.round(Math.max(0, Math.min(255, s?.endsWith('%') ? parseFloat(s) * 2.55 : Number(s ?? 0))));
    hex = `#${[n[0], n[1], n[2]].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
    if (n[3] !== undefined) opacity *= n[3].endsWith('%') ? parseFloat(n[3]) / 100 : Number(n[3]);
  } else hex = NAMED[v] ?? current;
  if (opacity < 0.999) hex = `${hex.slice(0, 7)}${Math.round(Math.max(0, opacity) * 255).toString(16).padStart(2, '0')}`;
  return hex;
}

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]!] = m[2] ?? m[3] ?? '';
  // inline style="fill:…;stroke:…" wins over attributes
  for (const decl of (out.style ?? '').split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
  }
  return out;
}

const num = (v: string | undefined, d = 0) => {
  const n = parseFloat(v ?? '');
  return Number.isFinite(n) ? n : d;
};

function shapeD(tag: string, a: Record<string, string>): string | null {
  switch (tag) {
    case 'path':
      return a.d?.trim() || null;
    case 'rect': {
      const x = num(a.x), y = num(a.y), w = num(a.width), h = num(a.height);
      if (w <= 0 || h <= 0) return null;
      let rx = num(a.rx, NaN), ry = num(a.ry, NaN);
      if (Number.isNaN(rx)) rx = Number.isNaN(ry) ? 0 : ry;
      if (Number.isNaN(ry)) ry = rx;
      rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
      if (!rx || !ry) return `M${x} ${y}h${w}v${h}h${-w}z`;
      return `M${x + rx} ${y}h${w - 2 * rx}a${rx} ${ry} 0 0 1 ${rx} ${ry}v${h - 2 * ry}a${rx} ${ry} 0 0 1 ${-rx} ${ry}h${-(w - 2 * rx)}a${rx} ${ry} 0 0 1 ${-rx} ${-ry}v${-(h - 2 * ry)}a${rx} ${ry} 0 0 1 ${rx} ${-ry}z`;
    }
    case 'circle':
    case 'ellipse': {
      const cx = num(a.cx), cy = num(a.cy);
      const rx = tag === 'circle' ? num(a.r) : num(a.rx), ry = tag === 'circle' ? num(a.r) : num(a.ry);
      if (rx <= 0 || ry <= 0) return null;
      return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0z`;
    }
    case 'line':
      return `M${num(a.x1)} ${num(a.y1)}L${num(a.x2)} ${num(a.y2)}`;
    case 'polyline':
    case 'polygon': {
      const n = (a.points ?? '').trim().split(/[\s,]+/).map(Number).filter((v) => Number.isFinite(v));
      if (n.length < 4) return null;
      let d = `M${n[0]} ${n[1]}`;
      for (let i = 2; i + 1 < n.length; i += 2) d += `L${n[i]} ${n[i + 1]}`;
      return tag === 'polygon' ? `${d}z` : d;
    }
  }
  return null;
}

interface Inherit { fill?: string; stroke?: string; strokeWidth?: string; fillRule?: string; opacity: number; fillOpacity: number; strokeOpacity: number }

/** Parse an SVG document into a viewBox and path parts. `current` replaces `currentColor`. */
export function parseSvg(svg: string, current: Color = '#1f2328'): { viewBox: { x: number; y: number; w: number; h: number }; paths: PathPart[] } | null {
  const root = svg.match(/<svg\b([^>]*)>/i);
  if (!root) return null;
  const ra = attrs(root[1]!);
  const vb = (ra.viewBox ?? ra.viewbox ?? '').trim().split(/[\s,]+/).map(Number);
  const viewBox = vb.length === 4 && vb.every((v) => Number.isFinite(v)) && vb[2]! > 0 && vb[3]! > 0
    ? { x: vb[0]!, y: vb[1]!, w: vb[2]!, h: vb[3]! }
    : { x: 0, y: 0, w: num(ra.width, 24), h: num(ra.height, 24) };
  const paths: PathPart[] = [];
  const top: Inherit = { fill: ra.fill, stroke: ra.stroke, strokeWidth: ra['stroke-width'], fillRule: ra['fill-rule'], opacity: 1, fillOpacity: 1, strokeOpacity: 1 };
  const stack: Inherit[] = [top];
  let skip = 0; // inside <defs>, <mask>, <clipPath>…
  const SKIP = new Set(['defs', 'mask', 'clippath', 'symbol', 'pattern', 'style', 'title', 'desc', 'lineargradient', 'radialgradient', 'filter', 'metadata']);
  const body = svg.slice(root.index! + root[0].length);
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g)) {
    const closing = !!m[1], tag = m[2]!.toLowerCase(), self = !!m[4];
    if (tag === 'svg' && closing) break;
    if (SKIP.has(tag)) {
      if (!self) skip += closing ? -1 : 1;
      continue;
    }
    if (skip > 0) continue;
    if (closing) {
      if (tag === 'g' || tag === 'a') stack.pop();
      continue;
    }
    const a = attrs(m[3]!);
    const parent = stack[stack.length - 1]!;
    const here: Inherit = {
      fill: a.fill ?? parent.fill, stroke: a.stroke ?? parent.stroke, strokeWidth: a['stroke-width'] ?? parent.strokeWidth,
      fillRule: a['fill-rule'] ?? parent.fillRule, opacity: parent.opacity * num(a.opacity, 1),
      fillOpacity: parent.fillOpacity * num(a['fill-opacity'], 1), strokeOpacity: parent.strokeOpacity * num(a['stroke-opacity'], 1),
    };
    if (tag === 'g' || tag === 'a') {
      if (!self) stack.push(here);
      continue;
    }
    const d = shapeD(tag, a);
    if (!d) continue;
    // SVG defaults: fill black, no stroke (lines and polylines have nothing to fill)
    const fillHex = paint(here.fill ?? (tag === 'line' ? 'none' : '#000000'), current, here.opacity * here.fillOpacity);
    const strokeHex = paint(here.stroke ?? 'none', current, here.opacity * here.strokeOpacity);
    const part: PathPart = {
      d,
      fill: fillHex ? { type: 'solid', color: fillHex } : null,
      stroke: strokeHex ? { color: strokeHex, width: num(here.strokeWidth, 1) } : null,
    };
    if (here.fillRule === 'evenodd') part.evenOdd = true;
    if (part.fill || part.stroke) paths.push(part);
  }
  return paths.length ? { viewBox, paths } : null;
}
