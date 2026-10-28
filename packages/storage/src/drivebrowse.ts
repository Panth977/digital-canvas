import type { TokenSource } from './drive.ts';
import { DriveError } from './drive.ts';

/**
 * Listing, searching and downloading Drive files with the app's only scope,
 * `drive.file`: Drive answers with the files this app may see (the
 * "Digital Canvas" folder and the files the user picked with Google Picker or
 * opened with the app). Used by the MCP server's search_drive / import_from_drive
 * and by the web app to download picked files. Read-only; nothing here writes.
 *
 * The query builder (`listParams`) is pure so it can be tested on its own.
 */

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
const API = 'https://www.googleapis.com/drive/v3';

export type DriveSource = 'my-drive' | 'recent';
export type MediaKind = 'all' | 'image' | 'video' | 'audio';

/** Where the browser is: a source, optionally a folder inside it, or a search. */
export interface DriveLocation {
  source: DriveSource;
  /** A folder to list. */
  folderId?: string;
  /** The shared drive the folder belongs to, if any. */
  driveId?: string;
  /** Search by name (ignores source and folder). */
  search?: string;
}

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  /** For shared drives listed as folders. */
  driveId?: string;
  thumbnailLink?: string;
  iconLink?: string;
  size?: number;
  modifiedTime?: string;
  parents?: string[];
  width?: number;
  height?: number;
  /** Seconds (videos). */
  duration?: number;
}

export interface DrivePage {
  items: DriveItem[];
  nextPageToken?: string;
}

const FIELDS =
  'nextPageToken,files(id,name,mimeType,thumbnailLink,iconLink,size,modifiedTime,parents,driveId,imageMediaMetadata(width,height),videoMediaMetadata(width,height,durationMillis))';

/** Quote a value for a Drive query string. */
export const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** The media types the editor can place, as a Drive query clause. */
export function kindClause(kind: MediaKind): string {
  const types = kind === 'all' ? ['image/', 'video/', 'audio/'] : [`${kind}/`];
  const parts = types.map((t) => `mimeType contains '${t}'`);
  return parts.length === 1 ? parts[0]! : `(${parts.join(' or ')})`;
}

/** Drive `files.list` parameters for a location, a media filter and a page. */
export function listParams(loc: DriveLocation, kind: MediaKind = 'all', pageToken?: string, pageSize = 100): URLSearchParams {
  const media = kindClause(kind);
  const withFolders = `(mimeType = '${FOLDER_MIME}' or ${media})`;
  const p = new URLSearchParams({ fields: FIELDS, pageSize: String(pageSize), supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
  let q: string;
  let orderBy = 'folder,name_natural';
  const search = loc.search?.trim();
  if (search) {
    q = `name contains ${quote(search)} and ${withFolders} and trashed = false`;
    orderBy = 'folder,modifiedTime desc';
    p.set('corpora', 'allDrives');
  } else if (loc.folderId) {
    q = `${quote(loc.folderId)} in parents and ${withFolders} and trashed = false`;
    if (loc.driveId) {
      p.set('corpora', 'drive');
      p.set('driveId', loc.driveId);
    }
  } else {
    switch (loc.source) {
      case 'my-drive':
        q = `'root' in parents and ${withFolders} and trashed = false`;
        break;
      case 'recent':
        // Files (not folders) by their latest activity.
        q = `${media} and trashed = false`;
        orderBy = 'recency desc';
        break;
    }
  }
  p.set('q', q);
  p.set('orderBy', orderBy);
  if (pageToken) p.set('pageToken', pageToken);
  return p;
}

interface RawFile {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string;
  iconLink?: string;
  size?: string;
  modifiedTime?: string;
  parents?: string[];
  driveId?: string;
  imageMediaMetadata?: { width?: number; height?: number };
  videoMediaMetadata?: { width?: number; height?: number; durationMillis?: string };
}

export function toItem(f: RawFile): DriveItem {
  const m = f.imageMediaMetadata ?? f.videoMediaMetadata;
  const ms = Number(f.videoMediaMetadata?.durationMillis);
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    isFolder: f.mimeType === FOLDER_MIME,
    ...(f.driveId ? { driveId: f.driveId } : {}),
    ...(f.thumbnailLink ? { thumbnailLink: f.thumbnailLink } : {}),
    ...(f.iconLink ? { iconLink: f.iconLink } : {}),
    ...(f.size ? { size: Number(f.size) } : {}),
    ...(f.modifiedTime ? { modifiedTime: f.modifiedTime } : {}),
    ...(f.parents ? { parents: f.parents } : {}),
    ...(m?.width ? { width: m.width, height: m.height } : {}),
    ...(ms ? { duration: ms / 1000 } : {}),
  };
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Lists and downloads the Drive files this app can see. Listings are cached
 * in memory per query and page.
 */
export class DriveBrowser {
  private pages = new Map<string, Promise<DrivePage>>();

  constructor(private token: TokenSource, private fetchFn: FetchFn = (u, i) => fetch(u, i)) {}

  private async call(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const res = await this.fetchFn(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await this.token(!retry)}` } });
    if (res.status === 401 && retry) return this.call(url, init, false);
    if (!res.ok) {
      let msg = `${res.status}`;
      try { msg = ((await res.json()) as { error?: { message?: string } }).error?.message ?? msg; } catch { /* not JSON */ }
      throw new DriveError(`Google Drive: ${msg}`, res.status);
    }
    return res;
  }

  /** One page of a location. Cached; `fresh` drops the cache for this location first. */
  list(loc: DriveLocation, kind: MediaKind = 'all', pageToken?: string, fresh = false): Promise<DrivePage> {
    const params = listParams(loc, kind, pageToken);
    const key = params.toString();
    if (fresh) for (const k of this.pages.keys()) if (k.startsWith(listParams(loc, kind).toString())) this.pages.delete(k);
    let hit = this.pages.get(key);
    if (!hit) {
      hit = this.call(`${API}/files?${params}`).then(async (r) => {
        const body = (await r.json()) as { files?: RawFile[]; nextPageToken?: string };
        return { items: (body.files ?? []).map(toItem), ...(body.nextPageToken ? { nextPageToken: body.nextPageToken } : {}) };
      });
      hit.catch(() => this.pages.delete(key));
      this.pages.set(key, hit);
    }
    return hit;
  }

  /** One file's name, type and size (404 when the app may not see it). */
  async file(id: string): Promise<DriveItem> {
    const r = await this.call(`${API}/files/${encodeURIComponent(id)}?${new URLSearchParams({ fields: 'id,name,mimeType,size,parents,driveId', supportsAllDrives: 'true' })}`);
    return toItem((await r.json()) as RawFile);
  }

  /** Download a file's bytes, reporting progress (0..1) when Drive says how big it is. */
  async download(item: Pick<DriveItem, 'id' | 'size'>, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<Uint8Array> {
    const res = await this.call(`${API}/files/${encodeURIComponent(item.id)}?alt=media&supportsAllDrives=true`, signal ? { signal } : {});
    const total = Number(res.headers.get('content-length')) || item.size || 0;
    if (!res.body) return new Uint8Array(await res.arrayBuffer());
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (total) onProgress?.(Math.min(1, got / total));
    }
    const out = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    onProgress?.(1);
    return out;
  }

  /** Forget every cached listing. */
  clear(): void {
    this.pages.clear();
  }
}
