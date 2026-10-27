/**
 * Keyless integrations for the Apps panel: Wikimedia Commons, OpenStreetMap
 * maps (Nominatim search + tiles), DiceBear avatars, Iconify icon sets and
 * Noto emoji; plus pure generators (patterns, gradients, colour palettes).
 */
import { newId, walk as walkEls, type Element as SceneElement, type Fill, type Page as ScenePage, type PathElement } from '@digital-canvas/scene';

// ---- Iconify (any set) and Noto emoji ----

export async function searchIconSet(query: string, prefix = '', limit = 96): Promise<string[]> {
  const p = new URLSearchParams({ query, limit: String(limit) });
  if (prefix) p.set('prefix', prefix);
  const r = await fetch(`https://api.iconify.design/search?${p}`);
  if (!r.ok) throw new Error(`icon search: HTTP ${r.status}`);
  return ((await r.json()) as { icons?: string[] }).icons ?? [];
}

export const ICON_SETS: { prefix: string; label: string; licence: string }[] = [
  { prefix: '', label: 'All', licence: 'each set’s own licence' },
  { prefix: 'fluent-emoji-flat', label: 'Fluent Emoji', licence: 'MIT' },
  { prefix: 'noto', label: 'Noto Emoji', licence: 'Apache 2.0' },
  { prefix: 'ph', label: 'Phosphor', licence: 'MIT' },
  { prefix: 'mdi', label: 'Material', licence: 'Apache 2.0' },
  { prefix: 'tabler', label: 'Tabler', licence: 'MIT' },
  { prefix: 'lucide', label: 'Lucide', licence: 'ISC' },
  { prefix: 'twemoji', label: 'Twemoji', licence: 'CC BY 4.0' },
];

// ---- Wikimedia Commons ----

export interface CommonsImage {
  id: string;
  title: string;
  thumb: string;
  /** A large rendition we may download (upload.wikimedia.org allows CORS). */
  url: string;
  mime: string;
  author: string;
  licence: string;
  page: string;
}

const strip = (html: string) => html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

export async function searchCommons(query: string, limit = 24): Promise<CommonsImage[]> {
  const p = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', generator: 'search', gsrnamespace: '6', gsrsearch: `${query} filetype:bitmap`, gsrlimit: String(limit),
    prop: 'imageinfo', iiprop: 'url|mime|extmetadata', iiurlwidth: '1200',
  });
  const r = await fetch(`https://commons.wikimedia.org/w/api.php?${p}`);
  if (!r.ok) throw new Error(`Wikimedia: HTTP ${r.status}`);
  const data = (await r.json()) as { query?: { pages?: Record<string, { pageid: number; title: string; index?: number; imageinfo?: { thumburl?: string; url: string; mime: string; descriptionurl: string; extmetadata?: Record<string, { value: string }> }[] }> } };
  return Object.values(data.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).flatMap((pg) => {
    const ii = pg.imageinfo?.[0];
    if (!ii || !/^image\/(png|jpeg|webp|gif)$/.test(ii.mime)) return [];
    const m = ii.extmetadata ?? {};
    return [{
      id: String(pg.pageid), title: pg.title.replace(/^File:/, '').replace(/\.[^.]+$/, ''),
      thumb: ii.thumburl ?? ii.url, url: ii.thumburl ?? ii.url, mime: ii.mime,
      author: strip(m.Artist?.value ?? 'unknown'), licence: strip(m.LicenseShortName?.value ?? ''), page: ii.descriptionurl,
    }];
  });
}

export const commonsCredit = (c: CommonsImage) => `"${c.title}" by ${c.author} (${c.licence || 'see page'}) ${c.page}`;

export async function download(url: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download: HTTP ${r.status}`);
  const mime = (r.headers.get('content-type') ?? '').split(';')[0]!.trim();
  return { bytes: new Uint8Array(await r.arrayBuffer()), mime };
}

// ---- OpenStreetMap: Nominatim search + a static map from tiles ----

export interface Place { name: string; lat: number; lon: number; type: string }

/** Nominatim (usage policy: ≤ 1 request/s, on demand only — we search on submit). */
export async function searchPlaces(query: string): Promise<Place[]> {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q: query, format: 'jsonv2', limit: '6' })}`, { headers: { 'Accept-Language': navigator.language || 'en' } });
  if (!r.ok) throw new Error(`place search: HTTP ${r.status}`);
  return ((await r.json()) as { display_name: string; lat: string; lon: string; type: string }[]).map((p) => ({ name: p.display_name, lat: Number(p.lat), lon: Number(p.lon), type: p.type }));
}

const TILE = 256;
const lon2x = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z * TILE;
const lat2y = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z * TILE;
};

export const MAP_CREDIT = '© OpenStreetMap contributors (ODbL) https://www.openstreetmap.org/copyright';

/** A PNG map of `w`×`h` centred on a place, from OSM's standard tiles, with a pin and the required credit. */
export async function staticMap(p: { lat: number; lon: number }, zoom: number, w = 1200, h = 800, pin = '#e11d48'): Promise<Uint8Array> {
  const cx = lon2x(p.lon, zoom), cy = lat2y(p.lat, zoom);
  const x0 = cx - w / 2, y0 = cy - h / 2;
  const canvas = new OffscreenCanvas(w, h);
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#e5e3df';
  g.fillRect(0, 0, w, h);
  const n = 2 ** zoom;
  const jobs: Promise<void>[] = [];
  for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + w) / TILE); tx++) {
    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + h) / TILE); ty++) {
      if (ty < 0 || ty >= n) continue;
      const wx = ((tx % n) + n) % n;
      jobs.push((async () => {
        const r = await fetch(`https://tile.openstreetmap.org/${zoom}/${wx}/${ty}.png`);
        if (!r.ok) return;
        const bmp = await createImageBitmap(await r.blob());
        g.drawImage(bmp, tx * TILE - x0, ty * TILE - y0);
        bmp.close();
      })());
    }
  }
  await Promise.all(jobs);
  // pin
  const px = w / 2, py = h / 2;
  g.fillStyle = pin;
  g.beginPath();
  g.moveTo(px, py);
  g.bezierCurveTo(px - 6, py - 14, px - 18, py - 22, px - 18, py - 36);
  g.arc(px, py - 36, 18, Math.PI, 0);
  g.bezierCurveTo(px + 18, py - 22, px + 6, py - 14, px, py);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(px, py - 36, 7, 0, Math.PI * 2);
  g.fill();
  // credit (required by the tile usage policy)
  g.font = '13px Inter, sans-serif';
  const label = '© OpenStreetMap contributors';
  const tw = g.measureText(label).width + 12;
  g.fillStyle = 'rgba(255,255,255,.85)';
  g.fillRect(w - tw, h - 20, tw, 20);
  g.fillStyle = '#333';
  g.fillText(label, w - tw + 6, h - 6);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

// ---- DiceBear avatars ----

export const AVATAR_STYLES: { id: string; label: string; licence: string }[] = [
  { id: 'adventurer', label: 'Adventurer', licence: 'CC BY 4.0, Lisa Wischofsky' },
  { id: 'avataaars', label: 'Avataaars', licence: 'free for personal and commercial use, Pablo Stanley' },
  { id: 'lorelei', label: 'Lorelei', licence: 'CC0, Lisa Wischofsky' },
  { id: 'notionists', label: 'Notionists', licence: 'CC0, Zoish' },
  { id: 'open-peeps', label: 'Open Peeps', licence: 'CC0, Pablo Stanley' },
  { id: 'micah', label: 'Micah', licence: 'CC BY 4.0, Micah Lanier' },
  { id: 'personas', label: 'Personas', licence: 'CC BY 4.0, Draftbit' },
  { id: 'big-smile', label: 'Big Smile', licence: 'CC BY 4.0, Ashley Seo' },
  { id: 'fun-emoji', label: 'Fun Emoji', licence: 'CC BY 4.0, Davis Uche' },
  { id: 'bottts', label: 'Bottts', licence: 'free for personal and commercial use, Pablo Stanley' },
  { id: 'pixel-art', label: 'Pixel Art', licence: 'CC0, DiceBear' },
  { id: 'thumbs', label: 'Thumbs', licence: 'CC0, DiceBear' },
];

export const avatarUrl = (style: string, seed: string, format: 'svg' | 'png' = 'svg', size = 512) =>
  `https://api.dicebear.com/9.x/${style}/${format}?${new URLSearchParams({ seed, ...(format === 'png' ? { size: String(size) } : {}) })}`;

// ---- colour maths ----

export function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

export function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(100, s)) / 100; l = Math.max(0, Math.min(100, l)) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round((l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))) * 255);
  return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

export type Harmony = 'analogous' | 'complementary' | 'triadic' | 'split' | 'monochrome' | 'tetradic';
export const HARMONIES: { id: Harmony; label: string }[] = [
  { id: 'analogous', label: 'Analogous' }, { id: 'complementary', label: 'Complementary' }, { id: 'triadic', label: 'Triadic' },
  { id: 'split', label: 'Split complementary' }, { id: 'tetradic', label: 'Tetradic' }, { id: 'monochrome', label: 'Monochrome' },
];

/** Five colours in a colour-wheel harmony around `base`. */
export function harmony(base: string, kind: Harmony): string[] {
  const [h, s, l] = hexToHsl(base);
  const at = (dh: number, ds = 0, dl = 0) => hslToHex(h + dh, s + ds, l + dl);
  switch (kind) {
    case 'analogous': return [at(-40, -5, 10), at(-20), base, at(20), at(40, -5, -10)];
    case 'complementary': return [at(0, 0, 25), base, at(0, -10, -25), at(180), at(180, -10, 20)];
    case 'triadic': return [base, at(0, -20, 30), at(120), at(240), at(240, -10, -25)];
    case 'split': return [base, at(0, 0, -25), at(150), at(210), at(210, -15, 25)];
    case 'tetradic': return [base, at(90), at(180), at(270), at(0, -30, 35)];
    case 'monochrome': return [-36, -18, 0, 18, 32].map((d) => at(0, d > 0 ? -d / 3 : 0, d));
  }
}

/** A pleasant random palette (random hue, a random harmony). */
export function randomPalette(rand = Math.random): string[] {
  const base = hslToHex(rand() * 360, 45 + rand() * 40, 40 + rand() * 25);
  return harmony(base, HARMONIES[Math.floor(rand() * HARMONIES.length)]!.id);
}

// ---- gradients ----

export const GRADIENTS: { name: string; angle: number; colors: string[] }[] = [
  { name: 'Sunset', angle: 135, colors: ['#ff512f', '#dd2476'] },
  { name: 'Ocean', angle: 135, colors: ['#2193b0', '#6dd5ed'] },
  { name: 'Purple haze', angle: 135, colors: ['#7f00ff', '#e100ff'] },
  { name: 'Peach', angle: 135, colors: ['#ff9a9e', '#fad0c4'] },
  { name: 'Mint', angle: 135, colors: ['#11998e', '#38ef7d'] },
  { name: 'Night', angle: 160, colors: ['#0f0c29', '#302b63', '#24243e'] },
  { name: 'Citrus', angle: 120, colors: ['#f7971e', '#ffd200'] },
  { name: 'Berry', angle: 135, colors: ['#8e2de2', '#4a00e0'] },
  { name: 'Sky', angle: 180, colors: ['#7dd3fc', '#fef3c7'] },
  { name: 'Rose gold', angle: 135, colors: ['#f4c4f3', '#fc67fa'] },
  { name: 'Forest', angle: 160, colors: ['#134e5e', '#71b280'] },
  { name: 'Candy', angle: 90, colors: ['#ff6a00', '#ee0979'] },
];

export function gradientFill(angle: number, colors: string[]): Fill {
  return colors.length < 2 ? { type: 'solid', color: colors[0] ?? '#ffffff' } : { type: 'linear', angle, stops: colors.map((color, i) => ({ offset: i / (colors.length - 1), color })) };
}

export const gradientCss = (angle: number, colors: string[]) => `linear-gradient(${angle}deg, ${colors.join(', ')})`;

// ---- patterns (vector) ----

export type PatternKind = 'dots' | 'grid' | 'stripes' | 'checker' | 'waves' | 'zigzag' | 'triangles' | 'circles' | 'plus' | 'diamonds';
export const PATTERNS: PatternKind[] = ['dots', 'grid', 'stripes', 'checker', 'waves', 'zigzag', 'triangles', 'circles', 'plus', 'diamonds'];

const f2 = (v: number) => Math.round(v * 100) / 100;

/** One path covering w×h with the pattern at `size` px per tile. Stroke-drawn kinds return `stroke: true`. */
export function patternPath(kind: PatternKind, w: number, h: number, size: number): { d: string; stroke: boolean; width: number } {
  const s = Math.max(4, size);
  const cols = Math.ceil(w / s) + 1, rows = Math.ceil(h / s) + 1;
  let d = '';
  const circle = (cx: number, cy: number, r: number) => `M${f2(cx - r)} ${f2(cy)}a${f2(r)} ${f2(r)} 0 1 0 ${f2(2 * r)} 0a${f2(r)} ${f2(r)} 0 1 0 ${f2(-2 * r)} 0z`;
  switch (kind) {
    case 'dots':
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) d += circle(i * s + s / 2, j * s + s / 2, s * 0.14);
      return { d, stroke: false, width: 0 };
    case 'circles':
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) d += circle(i * s + s / 2, j * s + s / 2, s * 0.32);
      return { d, stroke: true, width: s * 0.06 };
    case 'grid':
      for (let i = 0; i <= cols; i++) d += `M${f2(i * s)} 0V${f2(h)}`;
      for (let j = 0; j <= rows; j++) d += `M0 ${f2(j * s)}H${f2(w)}`;
      return { d, stroke: true, width: Math.max(1, s * 0.04) };
    case 'stripes':
      for (let k = -rows; k < cols + rows; k++) d += `M${f2(k * s)} 0L${f2(k * s + h)} ${f2(h)}`;
      return { d, stroke: true, width: s * 0.25 };
    case 'checker':
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) if ((i + j) % 2 === 0) d += `M${f2(i * s)} ${f2(j * s)}h${f2(s)}v${f2(s)}h${f2(-s)}z`;
      return { d, stroke: false, width: 0 };
    case 'waves':
      for (let j = 0; j < rows; j++) {
        const y = j * s + s / 2;
        d += `M0 ${f2(y)}`;
        for (let i = 0; i < cols; i++) d += `q${f2(s / 4)} ${f2(-s / 4)} ${f2(s / 2)} 0t${f2(s / 2)} 0`;
      }
      return { d, stroke: true, width: s * 0.07 };
    case 'zigzag':
      for (let j = 0; j < rows; j++) {
        d += `M0 ${f2(j * s + s / 2)}`;
        for (let i = 0; i < cols * 2; i++) d += `l${f2(s / 2)} ${f2(i % 2 ? s / 3 : -s / 3)}`;
      }
      return { d, stroke: true, width: s * 0.08 };
    case 'triangles':
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) d += `M${f2(i * s + s / 2)} ${f2(j * s + s * 0.2)}l${f2(s * 0.3)} ${f2(s * 0.55)}h${f2(-s * 0.6)}z`;
      return { d, stroke: false, width: 0 };
    case 'plus':
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) { const cx = i * s + s / 2, cy = j * s + s / 2, a = s * 0.18; d += `M${f2(cx - a)} ${f2(cy)}h${f2(2 * a)}M${f2(cx)} ${f2(cy - a)}v${f2(2 * a)}`; }
      return { d, stroke: true, width: s * 0.07 };
    case 'diamonds':
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) { const cx = i * s + s / 2, cy = j * s + s / 2, a = s * 0.3; d += `M${f2(cx)} ${f2(cy - a)}l${f2(a)} ${f2(a)}l${f2(-a)} ${f2(a)}l${f2(-a)} ${f2(-a)}z`; }
      return { d, stroke: false, width: 0 };
  }
}

/** A pattern as a page-sized vector element. */
export function patternElement(kind: PatternKind, w: number, h: number, size: number, color: string, bg: string | null): PathElement {
  const p = patternPath(kind, w, h, size);
  const paths: PathElement['paths'] = [];
  if (bg) paths.push({ d: `M0 0H${f2(w)}V${f2(h)}H0z`, fill: { type: 'solid', color: bg }, stroke: null });
  paths.push({ d: p.d, fill: p.stroke ? null : { type: 'solid', color }, stroke: p.stroke ? { color, width: f2(p.width) } : null });
  return { id: newId('e_'), type: 'path', name: `Pattern: ${kind}`, x: 0, y: 0, w, h, rotation: 0, opacity: 1, viewBox: { x: 0, y: 0, w, h }, paths };
}

// ---- recolour a page with a palette ----


const hex6 = (c: string | undefined) => (c && /^#[0-9a-f]{6}/i.test(c) ? c.slice(0, 7).toLowerCase() : null);

/** Distinct solid colours on a page (background first). */
export function pageColors(page: ScenePage): string[] {
  const out = new Set<string>();
  const add = (c?: string) => { const h = hex6(c); if (h) out.add(h); };
  if (page.background.type === 'solid') add(page.background.color); else page.background.stops.forEach((s) => add(s.color));
  for (const e of walkEls(page.elements)) {
    if (e.type === 'text') { add(e.style.color); e.runs?.forEach((r) => add(r.style?.color)); }
    if (e.type === 'shape') { if (e.fill?.type === 'solid') add(e.fill.color); else e.fill?.stops.forEach((s) => add(s.color)); add(e.stroke?.color); }
    if (e.type === 'path') e.paths.forEach((p) => { if (p.fill?.type === 'solid') add(p.fill.color); add(p.stroke?.color); });
    if (e.type === 'line') add(e.stroke.color);
  }
  return [...out];
}

/** Map each page colour to a palette colour of similar lightness (darkest → darkest). */
export function paletteMap(colors: string[], palette: string[]): Map<string, string> {
  const src = [...colors].sort((a, b) => luminance(a) - luminance(b));
  const dst = [...palette].sort((a, b) => luminance(a) - luminance(b));
  const m = new Map<string, string>();
  src.forEach((c, i) => m.set(c, dst[Math.min(dst.length - 1, Math.floor((i * dst.length) / Math.max(1, src.length)))]!));
  return m;
}

export function recolorPage(page: ScenePage, map: Map<string, string>): ScenePage {
  const sw = (c: string) => { const h = hex6(c); return h && map.has(h) ? map.get(h)! + c.slice(7) : c; };
  const fill = <F extends Fill | null>(f: F): F => (!f ? f : f.type === 'solid' ? ({ ...f, color: sw(f.color) } as F) : ({ ...f, stops: f.stops.map((s) => ({ ...s, color: sw(s.color) })) } as F));
  const el = (e: SceneElement): SceneElement => {
    switch (e.type) {
      case 'text': return { ...e, style: { ...e.style, color: sw(e.style.color) }, ...(e.runs ? { runs: e.runs.map((r) => (r.style?.color ? { ...r, style: { ...r.style, color: sw(r.style.color) } } : r)) } : {}) };
      case 'shape': return { ...e, fill: fill(e.fill), stroke: e.stroke && { ...e.stroke, color: sw(e.stroke.color) } };
      case 'path': return { ...e, paths: e.paths.map((p) => ({ ...p, fill: fill(p.fill), stroke: p.stroke && { ...p.stroke, color: sw(p.stroke.color) } })) };
      case 'line': return { ...e, stroke: { ...e.stroke, color: sw(e.stroke.color) } };
      case 'group': return { ...e, children: e.children.map(el) };
      default: return e;
    }
  };
  return { ...page, background: fill(page.background), elements: page.elements.map(el) };
}

/** Draw an SVG to a PNG in the browser (keeps gradients and effects an SVG import would lose). */
export async function svgToPng(svg: string, size = 512): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const r = (img.naturalWidth || 1) / (img.naturalHeight || 1);
    const w = r >= 1 ? size : Math.round(size * r), h = r >= 1 ? Math.round(size / r) : size;
    const c = new OffscreenCanvas(w, h);
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
