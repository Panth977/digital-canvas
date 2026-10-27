/**
 * Wikimedia Commons (https://commons.wikimedia.org): 100M+ freely licensed
 * photos, videos and sounds. The MediaWiki API needs no key and allows CORS
 * (`origin=*`); files on upload.wikimedia.org can be downloaded from the
 * browser. Every file on Commons is under a free licence or public domain;
 * we keep its licence and author with the asset.
 */
import { getJson, stripHtml } from './http.ts';
import type { Fetch, Item, Page } from './types.ts';

export const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const PAGE = 24;

type CommonsKind = 'photo' | 'video' | 'audio';

const FILTER: Record<CommonsKind, string> = {
  // Commons' "Quality images" are reviewed photos: far better picks than a raw search
  photo: 'filetype:bitmap incategory:Quality_images',
  video: 'filetype:video',
  audio: 'filetype:audio',
};

export function commonsUrl(kind: CommonsKind, query: string, offset = 0): string {
  const q = `${query} ${FILTER[kind]}`.trim();
  return `${COMMONS}?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=${PAGE}${offset ? `&gsroffset=${offset}` : ''}&gsrsearch=${encodeURIComponent(q)}`
    + `&prop=imageinfo|videoinfo&iiprop=url|size|mime|extmetadata&iiextmetadatafilter=LicenseShortName|Artist|ObjectName&iiurlwidth=330&viprop=derivatives`;
}

interface Derivative { src: string; type: string; width?: number; height?: number; bandwidth?: number; transcodekey?: string }
interface Info {
  url: string; descriptionurl?: string; thumburl?: string; width?: number; height?: number; size?: number; duration?: number; mime: string;
  extmetadata?: Record<string, { value: string }>;
}
interface PageInfo { title: string; index?: number; imageinfo?: Info[]; videoinfo?: { derivatives?: Derivative[] }[] }

const clean = (u: string) => u.replace(/\?utm_[^#]*$/, '');

/** A Commons thumbnail URL at another of its standard widths. */
export function thumbAt(thumb: string, width: number): string {
  return clean(thumb).replace(/\/(\d+)px-([^/]+)$/, `/${width}px-$2`);
}

/** Pick a video rendition: the smallest WebM at least `min` pixels tall (Commons transcodes everything to VP9 WebM). */
export function pickVideo(ds: Derivative[], min: number): Derivative | undefined {
  const webm = ds.filter((d) => d.type.startsWith('video/webm') && d.transcodekey).sort((a, b) => (a.height ?? 0) - (b.height ?? 0));
  return webm.find((d) => (d.height ?? 0) >= min) ?? webm.at(-1) ?? ds.find((d) => d.type.startsWith('video/webm'));
}

function toItem(kind: CommonsKind, p: PageInfo): Item | null {
  const info = p.imageinfo?.[0];
  if (!info) return null;
  const meta = info.extmetadata ?? {};
  const file = p.title.replace(/^File:/, '');
  const title = stripHtml(meta.ObjectName?.value ?? '') || file.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
  const credit = {
    title,
    creator: stripHtml(meta.Artist?.value ?? '') || undefined,
    license: stripHtml(meta.LicenseShortName?.value ?? '') || 'see file page',
    page: info.descriptionurl,
    source: 'Wikimedia Commons',
  };
  const base = { key: `commons:${file}`, kind, source: 'commons' as const, title, width: info.width, height: info.height, duration: info.duration, credit };
  if (kind === 'photo') {
    if (!info.thumburl || !/^image\/(jpeg|png|webp|gif)$/.test(info.mime)) return null;
    const big = (info.width ?? 0) > 1920;
    return { ...base, thumb: clean(info.thumburl), url: big ? thumbAt(info.thumburl, 1920) : clean(info.url), fallback: thumbAt(info.thumburl, 960), size: big ? undefined : info.size };
  }
  const ds = p.videoinfo?.[0]?.derivatives ?? [];
  if (kind === 'video') {
    const main = pickVideo(ds, 480), small = pickVideo(ds, 240);
    if (!main || !info.thumburl) return null;
    const size = main.bandwidth && info.duration ? Math.round((main.bandwidth * info.duration) / 8) : undefined;
    return { ...base, thumb: clean(info.thumburl), url: clean(main.src), preview: clean(small?.src ?? main.src), width: main.width ?? info.width, height: main.height ?? info.height, size };
  }
  // audio: Commons transcodes to MP3 as well; prefer it (every browser plays it)
  const mp3 = ds.find((d) => d.type.startsWith('audio/mpeg'));
  const src = clean(mp3?.src ?? info.url);
  return { ...base, thumb: '', url: src, preview: src, size: mp3 ? undefined : info.size };
}

/** Search Commons. The cursor is the result offset. */
export async function searchCommons(kind: CommonsKind, query: string, offset = 0, f?: Fetch): Promise<Page<number>> {
  const data = await getJson<{ query?: { pages?: Record<string, PageInfo> }; continue?: { gsroffset?: number } }>(commonsUrl(kind, query, offset), f);
  const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const items = pages.map((p) => toItem(kind, p)).filter((x): x is Item => !!x);
  return { items, next: data.continue?.gsroffset ?? null };
}
