/**
 * Keyless integrations for the Apps panel: Wikimedia Commons, OpenStreetMap
 * maps (Nominatim search + tiles), DiceBear avatars, Iconify icon sets and
 * Noto emoji; plus the open colour, gradient and pattern catalogues (data
 * built by tools/catalogs/build.ts).
 */
import { walk as walkEls, type Element as SceneElement, type Fill, type Page as ScenePage } from '@digital-canvas/scene';
import GRADIENT_DATA from './content/data/gradients.json';
import PALETTE_DATA from './content/data/palettes.json';

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
  { prefix: 'openmoji', label: 'OpenMoji', licence: 'CC BY-SA 4.0' },
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

/** Open-licensed styles only, per https://www.dicebear.com/licenses (checked 2026-10-30). */
export const AVATAR_STYLES: { id: string; label: string; licence: string }[] = [
  { id: 'notionists', label: 'Notionists', licence: 'CC0, Zoish' },
  { id: 'open-peeps', label: 'Open Peeps', licence: 'CC0, Pablo Stanley' },
  { id: 'lorelei', label: 'Lorelei', licence: 'CC0, Lisa Wischofsky' },
  { id: 'adventurer', label: 'Adventurer', licence: 'CC BY 4.0, Lisa Wischofsky' },
  { id: 'micah', label: 'Micah', licence: 'CC BY 4.0, Micah Lanier' },
  { id: 'personas', label: 'Personas', licence: 'CC BY 4.0, Draftbit' },
  { id: 'big-smile', label: 'Big Smile', licence: 'CC BY 4.0, Ashley Seo' },
  { id: 'fun-emoji', label: 'Fun Emoji', licence: 'CC BY 4.0, Davis Uche' },
  { id: 'pixel-art', label: 'Pixel Art', licence: 'CC0, DiceBear' },
  { id: 'thumbs', label: 'Thumbs', licence: 'CC0, DiceBear' },
];

export const avatarUrl = (style: string, seed: string, format: 'svg' | 'png' = 'svg', size = 512) =>
  `https://api.dicebear.com/9.x/${style}/${format}?${new URLSearchParams({ seed, ...(format === 'png' ? { size: String(size) } : {}) })}`;

// ---- colour maths ----

export const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

// ---- catalogues ----

export interface Palette { id: string; name: string; catalog: string; colors: string[] }
/** Open Color and Tailwind CSS, both MIT. */
export const PALETTES = PALETTE_DATA as Palette[];
export const PALETTE_CATALOGS = [...new Set(PALETTES.map((p) => p.catalog))];

/** uiGradients (MIT). Angle 90 is how uiGradients shows them, left to right. */
export const GRADIENTS: { name: string; angle: number; colors: string[] }[] = (GRADIENT_DATA as { name: string; colors: string[] }[]).map((g) => ({ ...g, angle: 90 }));

export function gradientFill(angle: number, colors: string[]): Fill {
  return colors.length < 2 ? { type: 'solid', color: colors[0] ?? '#ffffff' } : { type: 'linear', angle, stops: colors.map((color, i) => ({ offset: i / (colors.length - 1), color })) };
}

export const gradientCss = (angle: number, colors: string[]) => `linear-gradient(${angle}deg, ${colors.join(', ')})`;

// ---- patterns: Hero Patterns ----

export interface HeroPattern { id: string; name: string; width: number; height: number; svg: string }
export const PATTERN_CREDIT = 'Hero Patterns by Steve Schoger (CC BY 4.0) https://heropatterns.com';

/** The tiles load with the app (they are a few hundred KB). */
export const loadPatterns = async (): Promise<HeroPattern[]> => (await import('./content/data/patterns.json')).default as HeroPattern[];

export const patternTile = (p: HeroPattern, color: string) => p.svg.replace(/\{\{color\}\}/g, color);
export const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** The pattern repeated over w×h, `scale` times its natural tile size, as a PNG. A page-sized vector of hundreds of tiles would be far heavier. */
export async function patternPng(p: HeroPattern, w: number, h: number, scale: number, color: string, bg: string | null): Promise<Uint8Array> {
  const img = new Image();
  img.src = svgDataUrl(patternTile(p, color));
  await img.decode();
  const k = Math.min(2, 2400 / Math.max(w, h)); // sharp at twice the page size, within reason
  const c = new OffscreenCanvas(Math.round(w * k), Math.round(h * k));
  const g = c.getContext('2d')!;
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); }
  const tw = Math.max(1, Math.round(p.width * scale * k)), th = Math.max(1, Math.round(p.height * scale * k));
  for (let x = 0; x < c.width; x += tw) for (let y = 0; y < c.height; y += th) g.drawImage(img, x, y, tw, th);
  return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
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
