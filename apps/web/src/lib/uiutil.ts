/** Small pure helpers behind the editor chrome (tooltips, font sizes, colours). */

/**
 * Split "Bold (⌘B)" into the label and the shortcut chip Canva shows on the
 * right of its tooltips. Only a trailing parenthesis that looks like keys counts.
 */
export function splitTip(text: string): { label: string; keys: string } {
  const m = /^(.*?)\s*\(([⌘⇧⌥⌃][^()]{0,8}|[A-Z]|Esc|Delete|⌫)\)$/.exec(text.trim());
  return m ? { label: m[1]!, keys: m[2]! } : { label: text, keys: '' };
}

/** Canva's font size dropdown. */
export const FONT_SIZES = [6, 8, 10, 12, 14, 16, 18, 21, 24, 28, 32, 36, 42, 48, 56, 64, 72, 80, 88, 96, 104, 120, 144];

/** Parse what was typed in the size box; null when it isn't a size. */
export function parseSize(s: string): number | null {
  const v = Number(s.replace(',', '.').trim());
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.max(1, Math.min(800, Math.round(v * 10) / 10));
}

// ---- colours ----

export interface HSV { h: number; s: number; v: number }

export function normHex(s: string): string | null {
  let v = s.trim().toLowerCase();
  if (!v.startsWith('#')) v = `#${v}`;
  if (/^#[0-9a-f]{3}$/.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return /^#[0-9a-f]{6}$/.test(v) ? v : /^#[0-9a-f]{8}$/.test(v) ? v.slice(0, 7) : null;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt((normHex(hex) ?? '#000000').slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function hexToHsv(hex: string): HSV {
  const [r, g, b] = hexToRgb(hex).map((x) => x / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToHex({ h, s, v }: HSV): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return rgbToHex(f(5) * 255, f(3) * 255, f(1) * 255);
}

/** Colour names people search for (CSS names plus a few Canva-ish ones). */
export const COLOR_NAMES: Record<string, string> = {
  black: '#000000', white: '#ffffff', grey: '#808080', gray: '#808080', silver: '#c0c0c0', charcoal: '#36454f',
  red: '#ff0000', crimson: '#dc143c', maroon: '#800000', coral: '#ff7f50', salmon: '#fa8072', tomato: '#ff6347',
  orange: '#ffa500', amber: '#ffbf00', gold: '#ffd700', yellow: '#ffff00', mustard: '#ffdb58', beige: '#f5f5dc', cream: '#fffdd0',
  lime: '#00ff00', green: '#008000', olive: '#808000', mint: '#98ff98', emerald: '#50c878', teal: '#008080', turquoise: '#40e0d0',
  cyan: '#00ffff', aqua: '#00ffff', sky: '#87ceeb', blue: '#0000ff', navy: '#000080', royal: '#4169e1', cobalt: '#0047ab', indigo: '#4b0082',
  purple: '#800080', violet: '#8f00ff', lavender: '#e6e6fa', lilac: '#c8a2c8', magenta: '#ff00ff', fuchsia: '#ff00ff', pink: '#ffc0cb', rose: '#ff007f',
  brown: '#a52a2a', chocolate: '#d2691e', tan: '#d2b48c', khaki: '#c3b091', peach: '#ffe5b4', ivory: '#fffff0', plum: '#dda0dd', burgundy: '#800020',
};

/** Rough hue name of a colour, so "blue" also finds #38b6ff. */
export function hueName(hex: string): string[] {
  const { h, s, v } = hexToHsv(hex);
  if (v < 0.15) return ['black'];
  if (s < 0.12) return v > 0.9 ? ['white'] : ['grey', 'gray'];
  const names: [number, string[]][] = [[15, ['red']], [45, ['orange', 'brown']], [70, ['yellow', 'gold']], [165, ['green']], [195, ['teal', 'cyan', 'turquoise']], [255, ['blue']], [290, ['purple', 'violet']], [335, ['pink', 'magenta']], [360, ['red', 'pink']]];
  return names.find(([max]) => h < max)![1];
}

/** Does colour `hex` match a search ("blue", "#38b", "38b6ff")? */
export function colorMatches(hex: string, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^#/, '');
  if (!q) return true;
  if (/^[0-9a-f]+$/.test(q) && hex.toLowerCase().replace('#', '').startsWith(q)) return true;
  if (hueName(hex).some((n) => n.startsWith(q) || q.startsWith(n))) return true;
  const named = COLOR_NAMES[q];
  return !!named && named === hex.toLowerCase();
}

/** What the search box adds as a colour of its own: a hex or a colour name. */
export function colorFromQuery(query: string): string | null {
  const q = query.trim().toLowerCase();
  return normHex(q) ?? COLOR_NAMES[q] ?? null;
}

/**
 * The main colours of an image (RGBA pixels): quantised into buckets, most
 * common first, near-duplicates dropped. Canva's "Photo colours".
 */
export function paletteOf(rgba: Uint8ClampedArray | Uint8Array, max = 6): string[] {
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3]! < 128) continue;
    const r = rgba[i]!, g = rgba[i + 1]!, b = rgba[i + 2]!;
    const k = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const c = counts.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    c.n++; c.r += r; c.g += g; c.b += b;
    counts.set(k, c);
  }
  const out: [number, number, number][] = [];
  for (const c of [...counts.values()].sort((a, b) => b.n - a.n)) {
    const rgb: [number, number, number] = [c.r / c.n, c.g / c.n, c.b / c.n];
    if (out.some((o) => Math.hypot(o[0] - rgb[0], o[1] - rgb[1], o[2] - rgb[2]) < 48)) continue;
    out.push(rgb);
    if (out.length >= max) break;
  }
  return out.map(([r, g, b]) => rgbToHex(r, g, b));
}

/** Canva's default gradients (two stops, angle in degrees). */
export const DEFAULT_GRADIENTS: { from: string; to: string; angle: number }[] = [
  { from: '#000000', to: '#737373', angle: 90 }, { from: '#000000', to: '#c89116', angle: 90 }, { from: '#3533cd', to: '#000000', angle: 90 },
  { from: '#a6a6a6', to: '#ffffff', angle: 90 }, { from: '#fff7ad', to: '#ffa9f9', angle: 90 }, { from: '#cdffd8', to: '#94b9ff', angle: 90 },
  { from: '#ff3131', to: '#ff914d', angle: 90 }, { from: '#ff5757', to: '#8c52ff', angle: 90 }, { from: '#5170ff', to: '#ff66c4', angle: 90 },
  { from: '#004aad', to: '#cb6ce6', angle: 90 }, { from: '#8c52ff', to: '#5ce1e6', angle: 90 }, { from: '#5de0e6', to: '#004aad', angle: 90 },
  { from: '#8c52ff', to: '#00bf63', angle: 90 }, { from: '#0097b2', to: '#7ed957', angle: 90 }, { from: '#c9ffbf', to: '#ffafbd', angle: 90 },
  { from: '#ffde59', to: '#ff914d', angle: 90 }, { from: '#ff66c4', to: '#ffde59', angle: 90 }, { from: '#8c52ff', to: '#ff914d', angle: 90 },
];
