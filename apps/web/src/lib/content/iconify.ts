/**
 * Graphics, stickers and icons from Iconify (https://iconify.design): an open
 * API over 200+ open-source icon and emoji sets. No key; CORS allowed.
 * We only offer sets whose licence allows commercial use (MIT, Apache,
 * ISC, CC BY); CC BY sets keep their credit with the element.
 */
import { getJson } from './http.ts';
import type { Fetch, Item, Kind, Page } from './types.ts';

export const ICONIFY = 'https://api.iconify.design';

export interface IconSet {
  prefix: string;
  title: string;
  license: string;
  author: string;
}

const set = (prefix: string, title: string, license: string, author: string): IconSet => ({ prefix, title, license, author });

/** Sets offered per kind, best first. */
export const SETS: Record<'graphic' | 'sticker' | 'icon', IconSet[]> = {
  sticker: [
    set('fluent-emoji-flat', 'Fluent Emoji Flat', 'MIT', 'Microsoft'),
    set('noto', 'Noto Emoji', 'Apache 2.0', 'Google'),
    set('twemoji', 'Twemoji', 'CC BY 4.0', 'Twitter'),
    set('fluent-emoji', 'Fluent Emoji', 'MIT', 'Microsoft'),
    set('openmoji', 'OpenMoji', 'CC BY-SA 4.0', 'HfG Schwäbisch Gmünd'),
  ],
  graphic: [
    set('fluent-color', 'Fluent UI System Color Icons', 'MIT', 'Microsoft'),
    set('streamline-color', 'Streamline Color', 'CC BY 4.0', 'Streamline'),
    set('flat-color-icons', 'Flat Color Icons', 'MIT', 'Icons8'),
    set('streamline-plump-color', 'Streamline Plump Color', 'CC BY 4.0', 'Streamline'),
    set('meteocons', 'Meteocons', 'MIT', 'Bas Milius'),
    set('circle-flags', 'Circle Flags', 'MIT', 'HatScripts'),
  ],
  icon: [
    set('ph', 'Phosphor', 'MIT', 'Phosphor Icons'),
    set('tabler', 'Tabler Icons', 'MIT', 'Paweł Kuna'),
    set('mdi', 'Material Design Icons', 'Apache 2.0', 'Pictogrammers'),
    set('lucide', 'Lucide', 'ISC', 'Lucide Contributors'),
    set('material-symbols', 'Material Symbols', 'Apache 2.0', 'Google'),
  ],
};

const ALL_SETS = new Map(Object.values(SETS).flat().map((s) => [s.prefix, s]));

export function iconUrl(name: string): string {
  const [prefix, icon] = name.split(':');
  return `${ICONIFY}/${prefix}/${icon}.svg`;
}

// ---- icon data in batches ----
// Iconify rate-limits per IP, so a grid must not ask for each SVG on its own:
// `/<prefix>.json?icons=a,b,c` returns many icons in one answer and we build
// the SVGs here (thumbnails become data: URLs).

interface IconJson {
  prefix: string;
  icons?: Record<string, { body: string; width?: number; height?: number; left?: number; top?: number }>;
  aliases?: Record<string, { parent: string; width?: number; height?: number; rotate?: number; hFlip?: boolean; vFlip?: boolean }>;
  width?: number;
  height?: number;
  not_found?: string[];
}

const svgs = new Map<string, string>();

/** Build an SVG document from an icon's JSON data. */
export function buildSvg(data: IconJson, icon: string): string | null {
  const alias = data.aliases?.[icon];
  if (alias && (alias.rotate || alias.hFlip || alias.vFlip)) return null; // transformed aliases: not worth it
  const it = data.icons?.[alias ? alias.parent : icon];
  if (!it) return null;
  const w = alias?.width ?? it.width ?? data.width ?? 16, h = alias?.height ?? it.height ?? data.height ?? 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${it.left ?? 0} ${it.top ?? 0} ${w} ${h}">${it.body}</svg>`;
}

/** Load SVGs for Iconify names (`prefix:name`), a few requests per batch. Missing ones are left out. */
export async function loadIcons(names: string[], f?: Fetch): Promise<Map<string, string>> {
  const want = new Map<string, string[]>();
  for (const n of names) {
    if (svgs.has(n)) continue;
    const [prefix = '', icon = ''] = n.split(':');
    if (!prefix || !icon) continue;
    want.set(prefix, [...(want.get(prefix) ?? []), icon]);
  }
  const jobs: Promise<void>[] = [];
  for (const [prefix, icons] of want) {
    for (let i = 0; i < icons.length; i += 80) {
      const chunk = [...new Set(icons.slice(i, i + 80))].sort();
      jobs.push(getJson<IconJson>(`${ICONIFY}/${prefix}.json?icons=${chunk.join(',')}`, f, 30 * 86400e3).then((data) => {
        for (const icon of chunk) { const svg = buildSvg(data, icon); if (svg) svgs.set(`${prefix}:${icon}`, svg); }
      }));
    }
  }
  const results = await Promise.allSettled(jobs);
  if (jobs.length && results.every((r) => r.status === 'rejected')) throw (results[0] as PromiseRejectedResult).reason;
  return new Map(names.filter((n) => svgs.has(n)).map((n) => [n, svgs.get(n)!]));
}

export const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** The SVG of one icon (from the batch cache, else one request). */
export async function iconSvg(name: string, f?: Fetch): Promise<string> {
  const got = (await loadIcons([name], f)).get(name);
  if (!got) throw new Error(`no icon ${name}`);
  return got;
}

/** Results for names, with their thumbnails ready (icons Iconify doesn't have are dropped). */
export async function iconItems(names: string[], kind?: Kind, f?: Fetch): Promise<Item[]> {
  const loaded = await loadIcons(names, f);
  return names.filter((n) => loaded.has(n)).map((n) => ({ ...iconItem(n, kind), thumb: svgDataUrl(loaded.get(n)!) }));
}

const nice = (icon: string) => icon.replace(/-/g, ' ').replace(/\b\w/, (c) => c.toUpperCase());

/** A result for an Iconify name. Unknown sets are treated as icons with an unknown licence. */
export function iconItem(name: string, kind?: Kind): Item {
  const [prefix = '', icon = ''] = name.split(':');
  const s = ALL_SETS.get(prefix);
  const k = kind ?? ((Object.keys(SETS) as (keyof typeof SETS)[]).find((key) => SETS[key].some((x) => x.prefix === prefix)) ?? 'icon');
  return {
    key: `iconify:${name}`,
    kind: k,
    source: 'iconify',
    title: nice(icon),
    thumb: iconUrl(name),
    icon: name,
    credit: { title: nice(icon), creator: s ? `${s.title} by ${s.author}` : prefix, license: s?.license ?? 'see icon set', page: `https://icon-sets.iconify.design/${prefix}/${icon}/`, source: 'Iconify' },
  };
}

const PAGE = 48;
/** Iconify returns at most 999 results per query. */
const MAX = 999;

/** Search icon sets. The cursor is the index of the first result. */
export async function searchIconify(kind: keyof typeof SETS, query: string, start = 0, f?: Fetch, prefixes = SETS[kind].map((s) => s.prefix)): Promise<Page<number>> {
  const limit = Math.min(MAX, start + PAGE);
  if (start >= limit) return { items: [], next: null };
  const url = `${ICONIFY}/search?query=${encodeURIComponent(query)}&limit=${Math.max(32, limit)}${start ? `&start=${start}` : ''}&prefixes=${prefixes.join(',')}`;
  const data = await getJson<{ icons?: string[] }>(url, f);
  const icons = data.icons ?? [];
  return { items: await iconItems(icons, kind, f), next: icons.length >= limit - start && limit < MAX ? limit : null };
}

/** Every icon name in a set (for browsing without a search). */
export async function listSet(prefix: string, f?: Fetch): Promise<string[]> {
  const d = await getJson<{ categories?: Record<string, string[]>; uncategorized?: string[] }>(`${ICONIFY}/collection?prefix=${prefix}`, f, 7 * 86400e3);
  const names = [...Object.values(d.categories ?? {}).flat(), ...(d.uncategorized ?? [])];
  return [...new Set(names)].map((n) => `${prefix}:${n}`);
}

/** Browse sets round-robin, no query. The cursor is the position in the merged list. */
export async function browseIconify(kind: keyof typeof SETS, start = 0, f?: Fetch): Promise<Page<number>> {
  const lists = await Promise.all(SETS[kind].slice(0, 3).map((s) => listSet(s.prefix, f).catch(() => [] as string[])));
  const merged: string[] = [];
  for (let i = 0; merged.length < start + PAGE && lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) merged.push(l[i]!);
  const names = merged.slice(start, start + PAGE);
  return { items: await iconItems(names, kind, f), next: names.length === PAGE ? start + PAGE : null };
}

/**
 * Can our SVG reader draw this exactly? It reads paths and basic shapes with
 * flat colours; gradients, transforms, masks, clips and `<use>` it can't, so
 * such graphics go in as a picture instead.
 */
export function isSimpleSvg(svg: string): boolean {
  return !/url\(#|<use\b|\btransform=|<mask\b|<clipPath\b|<image\b|<style\b|<filter\b|<pattern\b|<text\b/i.test(svg);
}
