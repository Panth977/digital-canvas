/**
 * Free content from public APIs that need no key: icons from Iconify
 * (https://iconify.design, open-source icon sets) and CC-licensed photos from
 * Openverse (https://openverse.org).
 */

const ICONIFY = 'https://api.iconify.design';
const OPENVERSE = 'https://api.openverse.org/v1';

/** Icon names like `mdi:home` matching a search. */
export async function searchIcons(query: string, limit = 64): Promise<string[]> {
  const r = await fetch(`${ICONIFY}/search?query=${encodeURIComponent(query)}&limit=${limit}`);
  if (!r.ok) throw new Error(`icon search: HTTP ${r.status}`);
  const data = (await r.json()) as { icons?: string[] };
  return data.icons ?? [];
}

export function iconUrl(name: string): string {
  const [prefix, icon] = name.split(':');
  return `${ICONIFY}/${prefix}/${icon}.svg`;
}

export async function fetchIcon(name: string): Promise<string> {
  const r = await fetch(iconUrl(name));
  if (!r.ok) throw new Error(`icon ${name}: HTTP ${r.status}`);
  return r.text();
}

export interface Photo {
  id: string;
  title: string;
  creator: string;
  license: string;
  licenseVersion: string;
  /** Full-size file (on the creator's host; may refuse cross-origin downloads). */
  url: string;
  /** Openverse's own thumbnail (always downloadable). */
  thumbnail: string;
  /** The photo's page, for attribution. */
  page: string;
  width?: number;
  height?: number;
}

/** Photos whose licence allows commercial use and changes (designs crop and edit them). Anonymous requests get at most 20. */
export async function searchPhotos(query: string, pageSize = 20): Promise<Photo[]> {
  const r = await fetch(`${OPENVERSE}/images/?q=${encodeURIComponent(query)}&page_size=${pageSize}&license_type=commercial,modification`);
  if (!r.ok) throw new Error(`photo search: HTTP ${r.status}`);
  const data = (await r.json()) as { results?: Record<string, unknown>[] };
  return (data.results ?? []).map((x) => ({
    id: String(x.id),
    title: String(x.title ?? 'Untitled'),
    creator: String(x.creator ?? 'unknown'),
    license: String(x.license ?? ''),
    licenseVersion: String(x.license_version ?? ''),
    url: String(x.url ?? ''),
    thumbnail: String(x.thumbnail ?? `${OPENVERSE}/images/${x.id}/thumb/`),
    page: String(x.foreign_landing_url ?? ''),
    width: typeof x.width === 'number' ? x.width : undefined,
    height: typeof x.height === 'number' ? x.height : undefined,
  }));
}

/** Credit line kept as the asset's name: title, creator, licence, source page. */
export function attribution(p: Photo): string {
  const lic = p.license ? `${p.license.toLowerCase() === 'cc0' || p.license.toLowerCase() === 'pdm' ? p.license.toUpperCase() : `CC ${p.license.toUpperCase()}`} ${p.licenseVersion}`.trim() : 'CC';
  return `"${p.title}" by ${p.creator} (${lic})${p.page ? ` ${p.page}` : ''}`;
}

/** Download a photo: the full file when its host allows it, else Openverse's thumbnail. */
export async function fetchPhoto(p: Photo): Promise<{ bytes: Uint8Array; mime: string }> {
  for (const url of [p.url, p.thumbnail].filter(Boolean)) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const mime = (r.headers.get('content-type') ?? '').split(';')[0]!.trim();
      if (!mime.startsWith('image/')) continue;
      return { bytes: new Uint8Array(await r.arrayBuffer()), mime };
    } catch {
      // cross-origin refusal or network error: try the next source
    }
  }
  throw new Error(`couldn't download "${p.title}"`);
}
