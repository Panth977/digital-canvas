/**
 * Openverse (https://openverse.org, WordPress Foundation): a search over
 * hundreds of millions of openly licensed photos, illustrations and sounds
 * (Flickr, Freesound, Jamendo, museums…). No key needed; anonymous pages are
 * at most 20 results. We only ask for licences that allow commercial use
 * and changes, and keep the credit with each asset.
 */
import { getJson } from './http.ts';
import type { Credit, Fetch, Item, Page } from './types.ts';

export const OPENVERSE = 'https://api.openverse.org/v1';
const PAGE = 20;

/** "CC BY 4.0", "CC0 1.0", "PDM 1.0". */
export function licenseName(license: string, version = ''): string {
  const l = license.toLowerCase();
  const name = l === 'cc0' || l === 'pdm' ? l.toUpperCase() : l ? `CC ${l.toUpperCase()}` : 'CC';
  return `${name} ${version}`.trim();
}

function credit(x: Record<string, unknown>): Credit {
  return {
    title: String(x.title ?? 'Untitled'),
    creator: x.creator ? String(x.creator) : undefined,
    license: licenseName(String(x.license ?? ''), String(x.license_version ?? '')),
    page: x.foreign_landing_url ? String(x.foreign_landing_url) : undefined,
    source: `Openverse${x.source ? ` · ${String(x.source)}` : ''}`,
  };
}

const num = (v: unknown) => (typeof v === 'number' && v > 0 ? v : undefined);

/** Photos (`photograph`) or illustrations. The cursor is the page number. */
export async function searchImages(query: string, opts: { category?: 'photograph' | 'illustration'; page?: number } = {}, f?: Fetch): Promise<Page<number>> {
  const page = opts.page ?? 1;
  const url = `${OPENVERSE}/images/?q=${encodeURIComponent(query)}&page_size=${PAGE}&page=${page}&license_type=commercial,modification${opts.category ? `&category=${opts.category}` : ''}`;
  const data = await getJson<{ results?: Record<string, unknown>[]; page_count?: number }>(url, f);
  const items: Item[] = (data.results ?? []).map((x) => ({
    key: `openverse:${x.id}`,
    kind: opts.category === 'illustration' ? 'illustration' : 'photo',
    source: 'openverse',
    title: String(x.title ?? 'Untitled'),
    thumb: String(x.thumbnail ?? `${OPENVERSE}/images/${x.id}/thumb/`),
    url: x.url ? String(x.url) : undefined,
    fallback: String(x.thumbnail ?? `${OPENVERSE}/images/${x.id}/thumb/`),
    width: num(x.width),
    height: num(x.height),
    size: num(x.filesize),
    credit: credit(x),
  }));
  return { items, next: items.length && page < (data.page_count ?? 0) ? page + 1 : null };
}

/** Music or sound effects. */
export async function searchAudio(query: string, opts: { category?: 'music' | 'sound_effect'; page?: number } = {}, f?: Fetch): Promise<Page<number>> {
  const page = opts.page ?? 1;
  const url = `${OPENVERSE}/audio/?q=${encodeURIComponent(query)}&page_size=${PAGE}&page=${page}&license_type=commercial,modification${opts.category ? `&category=${opts.category}` : ''}`;
  const data = await getJson<{ results?: Record<string, unknown>[]; page_count?: number }>(url, f);
  const items: Item[] = (data.results ?? []).filter((x) => x.url).map((x) => {
    const title = String(x.title ?? 'Untitled').replace(/\.(wav|mp3|ogg|flac|aiff?)$/i, '');
    return {
      key: `openverse:${x.id}`,
      kind: 'audio',
      source: 'openverse',
      title,
      thumb: x.thumbnail ? String(x.thumbnail) : '',
      url: String(x.url),
      preview: String(x.url),
      duration: typeof x.duration === 'number' ? x.duration / 1000 : undefined,
      size: num(x.filesize),
      credit: { ...credit(x), title },
    };
  });
  return { items, next: items.length && page < (data.page_count ?? 0) ? page + 1 : null };
}
