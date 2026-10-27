/**
 * NASA Image and Video Library (https://images.nasa.gov): space and earth
 * photos, videos and audio. Open API, no key, CORS allowed. NASA media is
 * generally not subject to copyright in the United States (NASA media usage
 * guidelines: credit NASA, don't imply endorsement).
 */
import { getJson } from './http.ts';
import type { Fetch, Item, Page } from './types.ts';

export const NASA = 'https://images-api.nasa.gov';
const PAGE = 24;
export const NASA_LICENSE = 'NASA media (no US copyright)';

type NasaKind = 'photo' | 'video' | 'audio';
const MEDIA: Record<NasaKind, string> = { photo: 'image', video: 'video', audio: 'audio' };

/** NASA's URLs have raw spaces and plain http. */
export const fixUrl = (u: string) => encodeURI(decodeURI(u)).replace(/^http:/, 'https:');

interface NasaEntry {
  href: string;
  data?: { title?: string; nasa_id?: string; center?: string; photographer?: string; secondary_creator?: string }[];
  links?: { href: string; rel?: string; render?: string; width?: number; height?: number }[];
}

export async function searchNasa(kind: NasaKind, query: string, page = 1, f?: Fetch): Promise<Page<number>> {
  const url = `${NASA}/search?q=${encodeURIComponent(query)}&media_type=${MEDIA[kind]}&page=${page}&page_size=${PAGE}`;
  const data = await getJson<{ collection?: { items?: NasaEntry[]; links?: { rel: string }[] } }>(url, f);
  const items: Item[] = [];
  for (const e of data.collection?.items ?? []) {
    const d = e.data?.[0];
    if (!d?.nasa_id) continue;
    const thumb = e.links?.find((l) => l.render === 'image' && l.rel === 'preview') ?? e.links?.find((l) => l.render === 'image');
    if (kind !== 'audio' && !thumb) continue;
    items.push({
      key: `nasa:${d.nasa_id}`,
      kind,
      source: 'nasa',
      title: d.title ?? d.nasa_id,
      thumb: thumb ? fixUrl(thumb.href) : '',
      manifest: fixUrl(e.href),
      width: thumb?.width,
      height: thumb?.height,
      credit: { title: d.title ?? d.nasa_id, creator: d.photographer || d.secondary_creator || `NASA${d.center ? ` ${d.center}` : ''}`, license: NASA_LICENSE, page: `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}`, source: 'NASA' },
    });
  }
  const more = data.collection?.links?.some((l) => l.rel === 'next');
  return { items, next: more ? page + 1 : null };
}

const PREFER: Record<NasaKind, RegExp[]> = {
  photo: [/~large\.(jpe?g|png)$/i, /~medium\.(jpe?g|png)$/i, /~orig\.(jpe?g|png)$/i, /\.(jpe?g|png)$/i],
  video: [/~mobile\.mp4$/i, /~small\.mp4$/i, /~medium\.mp4$/i, /~preview\.mp4$/i, /\.mp4$/i],
  audio: [/~128k\.mp3$/i, /\.mp3$/i, /\.m4a$/i, /\.wav$/i],
};

/** Pick the file to download (and a preview) from an item's file list. */
export function pickNasaFiles(kind: NasaKind, files: string[]): { url?: string; preview?: string } {
  const find = (res: RegExp[]) => { for (const re of res) { const hit = files.find((u) => re.test(u)); if (hit) return fixUrl(hit); } return undefined; };
  const url = find(PREFER[kind]);
  const preview = kind === 'video' ? find([/~preview\.mp4$/i, /~mobile\.mp4$/i]) : kind === 'audio' ? url : undefined;
  return { url, preview };
}

/** Fill in `url` / `preview` of a NASA item (they live in a separate file list). */
export async function resolveNasa(item: Item, f?: Fetch): Promise<Item> {
  if (item.url || !item.manifest || item.source !== 'nasa') return item;
  const files = await getJson<string[]>(item.manifest, f, 30 * 86400e3);
  const picked = pickNasaFiles(item.kind as NasaKind, files);
  if (!picked.url) throw new Error('no downloadable file');
  return { ...item, ...picked };
}
