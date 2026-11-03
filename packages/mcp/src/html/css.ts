/**
 * The small CSS engine behind set_page_html: style sheets and inline styles,
 * shorthands, specificity, colours, lengths and gradients. Only what a page
 * layout needs; anything else is reported back as "not supported".
 */
import { looseColor, type Fill } from '@digital-canvas/scene';

export type Decls = Record<string, string>;

export interface Rule {
  selector: string;
  specificity: number;
  order: number;
  decls: Decls;
  important: Decls;
}

const COMMENT = /\/\*[\s\S]*?\*\//g;

/** `a: b; c: d !important` → normal and !important declarations (shorthands expanded). */
export function parseDecls(text: string): { decls: Decls; important: Decls } {
  const decls: Decls = {}, important: Decls = {};
  for (const part of splitTop(text.replace(COMMENT, ''), ';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const prop = part.slice(0, i).trim().toLowerCase();
    let value = part.slice(i + 1).trim();
    if (!prop || !value) continue;
    const imp = /!\s*important\s*$/i.test(value);
    if (imp) value = value.replace(/!\s*important\s*$/i, '').trim();
    Object.assign(imp ? important : decls, expand(prop, value));
  }
  return { decls, important };
}

/** Split on `sep` outside parentheses and quotes. */
export function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = '', cur = '';
  for (const ch of s) {
    if (quote) { if (ch === quote) quote = ''; cur += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Split a value on whitespace outside parentheses. */
export function words(v: string): string[] {
  return splitTop(v.trim().replace(/\s+/g, ' '), ' ').map((x) => x.trim()).filter(Boolean);
}

/** Style sheet text → rules in source order. @media / @supports blocks count as if they matched; other @-rules are skipped. */
export function parseSheet(css: string, start = 0): Rule[] {
  const rules: Rule[] = [];
  let order = start;
  const src = css.replace(COMMENT, '');
  let i = 0;
  const block = (from: number): [string, number] => {
    let depth = 1, j = from;
    while (j < src.length && depth > 0) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
    return [src.slice(from, j - 1), j];
  };
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const head = src.slice(i, open).trim();
    const [body, next] = block(open + 1);
    i = next;
    if (head.startsWith('@')) {
      if (/^@(media|supports|layer|container)\b/i.test(head)) for (const r of parseSheet(body, order)) { rules.push(r); order = r.order + 1; }
      continue;
    }
    const { decls, important } = parseDecls(body);
    for (const sel of splitTop(head, ',')) {
      const selector = sel.trim();
      if (!selector) continue;
      rules.push({ selector, specificity: specificity(selector), order: order++, decls, important });
    }
  }
  return rules;
}

/** Specificity as one number: ids × 10⁴ + classes/attributes/pseudo-classes × 10² + types. */
export function specificity(sel: string): number {
  const s = sel.replace(/"[^"]*"|'[^']*'/g, '').replace(/::?[a-z-]+\(([^)]*)\)/gi, (m, inner) => (/^:(not|is|has)\(/i.test(m) ? ` ${inner} ` : ' .x '));
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const cls = (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
  const types = (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|::?[\w-]+/g, ' ').match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return ids * 10_000 + cls * 100 + types;
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

function fourWay(prefix: string, suffix: string, v: string): Decls {
  const w = words(v);
  const [t, r = t, b = t, l = r] = w;
  const out: Decls = {};
  [t, r, b, l].forEach((x, i) => { if (x !== undefined) out[`${prefix}-${SIDES[i]}${suffix}`] = x; });
  return out;
}

const BORDER_STYLES = new Set(['none', 'hidden', 'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset']);

function borderParts(v: string): { width?: string; style?: string; color?: string } {
  const out: { width?: string; style?: string; color?: string } = {};
  for (const w of words(v)) {
    if (BORDER_STYLES.has(w)) out.style = w;
    else if (/^-?[\d.]/.test(w) || ['thin', 'medium', 'thick'].includes(w)) out.width = w;
    else out.color = w;
  }
  return out;
}

/** Shorthand → longhands (only those the layout reads). */
export function expand(prop: string, v: string): Decls {
  switch (prop) {
    case 'margin': case 'padding': return fourWay(prop, '', v);
    case 'inset': { const f = fourWay('x', '', v); return { top: f['x-top']!, right: f['x-right']!, bottom: f['x-bottom']!, left: f['x-left']! }; }
    case 'border-width': return fourWay('border', '-width', v);
    case 'border': case 'border-top': case 'border-right': case 'border-bottom': case 'border-left': {
      const p = borderParts(v);
      const sides = prop === 'border' ? SIDES : [prop.slice(7) as typeof SIDES[number]];
      const none = p.style === 'none' || p.style === 'hidden' || v.trim() === '0';
      const out: Decls = {};
      for (const s of sides) {
        out[`border-${s}-width`] = none ? '0' : p.width ?? '3px';
        if (p.color) out[`border-${s}-color`] = p.color;
        out[`border-${s}-style`] = none ? 'none' : p.style ?? 'solid';
      }
      return out;
    }
    case 'border-color': return Object.fromEntries(SIDES.map((s) => [`border-${s}-color`, words(v)[0] ?? v]));
    case 'border-style': return Object.fromEntries(SIDES.map((s) => [`border-${s}-style`, words(v)[0] ?? v]));
    case 'gap': case 'grid-gap': { const [r, c = r] = words(v); return { 'row-gap': r!, 'column-gap': c! }; }
    case 'grid-row-gap': return { 'row-gap': v };
    case 'grid-column-gap': return { 'column-gap': v };
    case 'flex': {
      const w = words(v);
      if (w[0] === 'none') return { 'flex-grow': '0', 'flex-shrink': '0', 'flex-basis': 'auto' };
      if (w[0] === 'auto') return { 'flex-grow': '1', 'flex-shrink': '1', 'flex-basis': 'auto' };
      if (w[0] === 'initial') return { 'flex-grow': '0', 'flex-shrink': '1', 'flex-basis': 'auto' };
      const out: Decls = { 'flex-grow': '1', 'flex-shrink': '1', 'flex-basis': '0%' };
      const nums = w.filter((x) => /^[\d.]+$/.test(x));
      const basis = w.find((x) => !/^[\d.]+$/.test(x));
      if (nums[0] !== undefined) out['flex-grow'] = nums[0];
      if (nums[1] !== undefined) out['flex-shrink'] = nums[1];
      if (basis) out['flex-basis'] = basis;
      else if (nums.length === 3) out['flex-basis'] = nums[2]!;
      return out;
    }
    case 'flex-flow': {
      const out: Decls = {};
      for (const w of words(v)) if (w.includes('wrap')) out['flex-wrap'] = w; else out['flex-direction'] = w;
      return out;
    }
    case 'place-items': { const [a, b = a] = words(v); return { 'align-items': a!, 'justify-items': b! }; }
    case 'place-content': { const [a, b = a] = words(v); return { 'align-content': a!, 'justify-content': b! }; }
    case 'place-self': { const [a] = words(v); return { 'align-self': a! }; }
    case 'background': {
      const out: Decls = { 'background-color': 'transparent', 'background-image': 'none' };
      const img = v.match(/(linear-gradient|url)\((?:[^()]|\([^()]*\))*\)/i)?.[0];
      if (img) out['background-image'] = img;
      const rest = img ? v.replace(img, ' ') : v;
      for (const w of words(rest)) if (isColorWord(w)) out['background-color'] = w;
      if (/\bcontain\b/.test(rest)) out['background-size'] = 'contain';
      return out;
    }
    case 'font': {
      // [style] [weight] size[/line-height] family
      const out: Decls = {};
      const m = v.match(/^(.*?)(?:^|\s)(-?[\d.]+(?:px|em|rem|%|pt|vw|vh)|xx-small|x-small|small|medium|large|x-large|xx-large)(?:\s*\/\s*([\d.]+(?:px|em|rem|%)?|normal))?\s+(.+)$/i);
      if (!m) return { 'font-family': v };
      for (const w of words(m[1]!)) {
        if (w === 'italic' || w === 'oblique') out['font-style'] = 'italic';
        else if (/^(bold|bolder|lighter|normal|[1-9]00)$/.test(w)) out['font-weight'] = w;
      }
      out['font-size'] = m[2]!;
      if (m[3]) out['line-height'] = m[3];
      out['font-family'] = m[4]!;
      return out;
    }
    case 'border-radius': return { 'border-radius': words(v.split('/')[0]!)[0] ?? v };
    case 'text-decoration-line': return { 'text-decoration': v };
    case 'overflow-x': case 'overflow-y': return { overflow: v };
    default: return { [prop]: v };
  }
}

// ---------------------------------------------------------------- values

const NAMED_EXTRA: Record<string, string> = {
  silver: '#c0c0c0', maroon: '#800000', olive: '#808000', lime: '#00ff00', aqua: '#00ffff', cyan: '#00ffff', fuchsia: '#ff00ff', magenta: '#ff00ff',
  brown: '#a52a2a', beige: '#f5f5dc', ivory: '#fffff0', cream: '#fffdd0', coral: '#ff7f50', crimson: '#dc143c', khaki: '#f0e68c', lavender: '#e6e6fa',
  salmon: '#fa8072', tomato: '#ff6347', turquoise: '#40e0d0', violet: '#ee82ee', indigo: '#4b0082', tan: '#d2b48c', chocolate: '#d2691e', darkgreen: '#006400',
  darkblue: '#00008b', darkred: '#8b0000', lightgray: '#d3d3d3', lightgrey: '#d3d3d3', darkgray: '#a9a9a9', darkgrey: '#a9a9a9', whitesmoke: '#f5f5f5',
  orangered: '#ff4500', goldenrod: '#daa520', skyblue: '#87ceeb', steelblue: '#4682b4', slategray: '#708090', mintcream: '#f5fffa', linen: '#faf0e6',
  wheat: '#f5deb3', snow: '#fffafa', honeydew: '#f0fff0', seagreen: '#2e8b57', forestgreen: '#228b22', royalblue: '#4169e1', midnightblue: '#191970',
  rebeccapurple: '#663399', hotpink: '#ff69b4', deeppink: '#ff1493', firebrick: '#b22222', sienna: '#a0522d', peru: '#cd853f', orchid: '#da70d6',
  currentcolor: '', inherit: '',
};

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');

function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** Any CSS colour we know → `#rrggbb[aa]`, or null. */
export function cssColor(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (s === 'transparent' || s === 'none') return '#00000000';
  const fn = s.match(/^(rgba?|hsla?)\(([^)]*)\)$/);
  if (fn) {
    const parts = fn[2]!.replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean);
    const alpha = parts[3] !== undefined ? (parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])) : 1;
    let rgb: [number, number, number];
    if (fn[1]!.startsWith('rgb')) rgb = parts.slice(0, 3).map((p) => (p.endsWith('%') ? (parseFloat(p) * 255) / 100 : parseFloat(p))) as [number, number, number];
    else rgb = hsl2rgb(parseFloat(parts[0]!), parseFloat(parts[1]!) / 100, parseFloat(parts[2]!) / 100);
    if (rgb.some((x) => Number.isNaN(x))) return null;
    return `#${rgb.map(hex2).join('')}${alpha < 1 ? hex2(alpha * 255) : ''}`;
  }
  if (NAMED_EXTRA[s]) return NAMED_EXTRA[s]!;
  if (/^#[0-9a-f]{4}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}${s[4]}${s[4]}`;
  if (!s.startsWith('#') && !/^[a-z]+$/.test(s)) return null;
  return looseColor(s);
}

function isColorWord(w: string): boolean {
  return /^(#|rgb|hsl)/i.test(w) || cssColor(w) !== null;
}

export type Len = { px: number } | { pct: number } | 'auto' | null;

export interface LenCtx {
  /** This element's font size (for em). */
  em: number;
  /** The root font size (for rem). */
  rem: number;
  /** Page size (for vw / vh). */
  vw: number;
  vh: number;
}

const UNITS: Record<string, number> = { px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6 };

/** A CSS length → px, % or auto. Numbers without a unit count as px. */
export function cssLen(v: string | undefined, c: LenCtx): Len {
  if (v === undefined) return null;
  const s = v.trim().toLowerCase();
  if (s === 'auto' || s === 'none' || s === 'fit-content' || s === 'max-content' || s === 'min-content') return 'auto';
  if (s === 'thin') return { px: 1 };
  if (s === 'medium') return { px: 3 };
  if (s === 'thick') return { px: 5 };
  const calc = s.match(/^calc\((.*)\)$/);
  if (calc) return calcLen(calc[1]!, c);
  const m = s.match(/^(-?[\d.]+(?:e-?\d+)?)([a-z%]*)$/);
  if (!m) return null;
  const n = parseFloat(m[1]!);
  const u = m[2]!;
  if (u === '%') return { pct: n };
  if (u === '' || UNITS[u]) return { px: n * (UNITS[u] ?? 1) };
  if (u === 'em') return { px: n * c.em };
  if (u === 'rem') return { px: n * c.rem };
  if (u === 'vw') return { px: (n * c.vw) / 100 };
  if (u === 'vh') return { px: (n * c.vh) / 100 };
  if (u === 'vmin') return { px: (n * Math.min(c.vw, c.vh)) / 100 };
  if (u === 'vmax') return { px: (n * Math.max(c.vw, c.vh)) / 100 };
  return null;
}

/** calc() with px-only terms (+ − × ÷); a lone % term is kept as %. */
function calcLen(expr: string, c: LenCtx): Len {
  const terms = expr.replace(/\s+([+-])\s+/g, ' $1 ').split(' ').filter(Boolean);
  let px = 0, pct = 0, sign = 1;
  for (const t of terms) {
    if (t === '+') { sign = 1; continue; }
    if (t === '-') { sign = -1; continue; }
    const mul = t.match(/^(.+)\*(.+)$/), div = t.match(/^(.+)\/(.+)$/);
    let l: Len;
    if (mul) { const a = cssLen(mul[1], c), k = parseFloat(mul[2]!); l = a && a !== 'auto' ? ('px' in a ? { px: a.px * k } : { pct: a.pct * k }) : null; }
    else if (div) { const a = cssLen(div[1], c), k = parseFloat(div[2]!); l = a && a !== 'auto' ? ('px' in a ? { px: a.px / k } : { pct: a.pct / k }) : null; }
    else l = cssLen(t, c);
    if (!l || l === 'auto') return null;
    if ('px' in l) px += sign * l.px; else pct += sign * l.pct;
  }
  if (pct && px) return null;
  return pct ? { pct } : { px };
}

/** A length to px where % is resolved against `of`. */
export function lenPx(v: string | undefined, c: LenCtx, of = 0): number | null {
  const l = cssLen(v, c);
  if (!l || l === 'auto') return null;
  return 'px' in l ? l.px : (l.pct * of) / 100;
}

/** `linear-gradient(...)` → a scene fill (CSS angles, like the rest of the app). */
export function cssGradient(v: string): Fill | null {
  const m = v.match(/^\s*(?:repeating-)?linear-gradient\((.*)\)\s*$/is);
  if (!m) return null;
  const args = splitTop(m[1]!, ',').map((x) => x.trim());
  let angle = 180;
  const first = args[0] ?? '';
  const deg = first.match(/^(-?[\d.]+)(deg|turn|rad)$/);
  if (deg) {
    const n = parseFloat(deg[1]!);
    angle = deg[2] === 'turn' ? n * 360 : deg[2] === 'rad' ? (n * 180) / Math.PI : n;
    args.shift();
  } else if (first.startsWith('to ')) {
    const dir = first.slice(3).trim();
    const map: Record<string, number> = { top: 0, right: 90, bottom: 180, left: 270, 'top right': 45, 'right top': 45, 'bottom right': 135, 'right bottom': 135, 'bottom left': 225, 'left bottom': 225, 'top left': 315, 'left top': 315 };
    angle = map[dir] ?? 180;
    args.shift();
  }
  const stops: { offset: number; color: string }[] = [];
  args.forEach((a, i) => {
    const w = words(a);
    const color = cssColor(w[0]);
    if (!color) return;
    const at = w[1]?.endsWith('%') ? parseFloat(w[1]) / 100 : undefined;
    stops.push({ offset: at ?? (args.length > 1 ? i / (args.length - 1) : 0), color });
  });
  if (stops.length === 1) return { type: 'solid', color: stops[0]!.color };
  if (stops.length < 2) return null;
  return { type: 'linear', angle, stops };
}

/** `url("x")` → x. */
export function cssUrl(v: string | undefined): string | null {
  const m = v?.match(/url\(\s*(['"]?)(.*?)\1\s*\)/i);
  return m ? m[2]! : null;
}

/** The first family of a font-family list, unquoted; generic names map to bundled faces. */
export function firstFamily(v: string): string {
  const f = (splitTop(v, ',')[0] ?? v).trim().replace(/^['"]|['"]$/g, '');
  const generic: Record<string, string> = { 'sans-serif': 'Inter', 'system-ui': 'Inter', 'ui-sans-serif': 'Inter', serif: 'Merriweather', 'ui-serif': 'Merriweather', monospace: 'Roboto Mono', 'ui-monospace': 'Roboto Mono', cursive: 'Pacifico', fantasy: 'Bangers', '-apple-system': 'Inter', blinkmacsystemfont: 'Inter', arial: 'Inter', helvetica: 'Inter' };
  return generic[f.toLowerCase()] ?? f;
}
