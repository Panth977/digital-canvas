import type { TokenSource } from './drive.ts';
import { DriveError } from './drive.ts';

/**
 * Browsing the user's whole Google Drive (needs the `drive.readonly` scope):
 * My Drive folders, Computers (Drive for desktop backups), Shared with me,
 * Shared drives, Starred, Recent and search. Read-only; nothing here writes.
 *
 * The query builder (`listParams`) is pure so it can be tested on its own.
 */

export const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
const API = 'https://www.googleapis.com/drive/v3';

export type DriveSource = 'my-drive' | 'computers' | 'shared' | 'shared-drives' | 'starred' | 'recent';
export type MediaKind = 'all' | 'image' | 'video' | 'audio';

/** Where the browser is: a source, optionally a folder inside it, or a search. */
export interface DriveLocation {
  source: DriveSource;
  /** A folder to list (inside My Drive, a computer, a shared drive, …). */
  folderId?: string;
  /** The shared drive the folder belongs to, if any. */
  driveId?: string;
  /** Search the whole Drive by name (ignores source and folder). */
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
      case 'shared':
        q = `sharedWithMe and ${withFolders} and trashed = false`;
        break;
      case 'starred':
        q = `starred and ${withFolders} and trashed = false`;
        break;
      case 'recent':
        // Drive's Recent tab: files (not folders) by their latest activity.
        q = `${media} and trashed = false`;
        orderBy = 'recency desc';
        break;
      case 'computers':
        // There is no API for the Computers tab. Each computer is a folder you
        // own that has no parent, so list your folders and keep the parentless ones.
        q = `'me' in owners and mimeType = '${FOLDER_MIME}' and trashed = false`;
        orderBy = 'name_natural';
        p.set('pageSize', '1000');
        p.set('fields', 'nextPageToken,files(id,name,mimeType,parents,modifiedTime)');
        break;
      case 'shared-drives':
        throw new Error('shared drives are listed with drives.list');
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

/** A Drive folder id from a pasted link (drive.google.com/drive/folders/<id>, ?id=<id>) or a bare id. */
export function folderIdFromLink(text: string): string | null {
  const s = text.trim();
  const m = /\/folders\/([\w-]{10,})/.exec(s) ?? /[?&]id=([\w-]{10,})/.exec(s) ?? /^([\w-]{10,})$/.exec(s);
  return m?.[1] ?? null;
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Lists and downloads files anywhere in the user's Drive. Listings are cached
 * in memory per query and page, so going back to a folder is instant.
 */
export class DriveBrowser {
  private pages = new Map<string, Promise<DrivePage>>();
  private computerList: Promise<DriveItem[]> | null = null;

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
    if (!loc.search && !loc.folderId && loc.source === 'computers') return this.computers(fresh).then((items) => ({ items }));
    if (!loc.search && !loc.folderId && loc.source === 'shared-drives') return this.sharedDrives(pageToken, fresh);
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

  /** The computers backed up with Drive for desktop: folders you own that have no parent. */
  computers(fresh = false): Promise<DriveItem[]> {
    if (fresh) this.computerList = null;
    this.computerList ??= (async () => {
      const out: DriveItem[] = [];
      let pageToken: string | undefined;
      // A Drive with a huge number of folders: stop after 20 000 rather than hang.
      for (let i = 0; i < 20; i++) {
        const r = (await (await this.call(`${API}/files?${listParams({ source: 'computers' }, 'all', pageToken)}`)).json()) as { files?: RawFile[]; nextPageToken?: string };
        for (const f of r.files ?? []) if (!f.parents?.length) out.push(toItem(f));
        pageToken = r.nextPageToken;
        if (!pageToken) break;
      }
      return out;
    })();
    this.computerList.catch(() => (this.computerList = null));
    return this.computerList;
  }

  private sharedDrives(pageToken?: string, fresh = false): Promise<DrivePage> {
    const params = new URLSearchParams({ pageSize: '100', fields: 'nextPageToken,drives(id,name)' });
    if (pageToken) params.set('pageToken', pageToken);
    const key = `drives:${params}`;
    if (fresh) this.pages.delete(key);
    let hit = this.pages.get(key);
    if (!hit) {
      hit = this.call(`${API}/drives?${params}`).then(async (r) => {
        const body = (await r.json()) as { drives?: { id: string; name: string }[]; nextPageToken?: string };
        return {
          items: (body.drives ?? []).map((d) => ({ id: d.id, name: d.name, mimeType: FOLDER_MIME, isFolder: true, driveId: d.id })),
          ...(body.nextPageToken ? { nextPageToken: body.nextPageToken } : {}),
        };
      });
      hit.catch(() => this.pages.delete(key));
      this.pages.set(key, hit);
    }
    return hit;
  }

  /** A folder's name and parents (for a pasted link). */
  async folder(id: string): Promise<DriveItem> {
    const r = await this.call(`${API}/files/${encodeURIComponent(id)}?${new URLSearchParams({ fields: 'id,name,mimeType,parents,driveId', supportsAllDrives: 'true' })}`);
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
    this.computerList = null;
  }
}

/** The scopes an access token carries (Google's tokeninfo endpoint). */
export async function tokenScopes(accessToken: string, fetchFn: FetchFn = (u, i) => fetch(u, i)): Promise<string[]> {
  const r = await fetchFn(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
  if (!r.ok) return [];
  const body = (await r.json()) as { scope?: string };
  return (body.scope ?? '').split(' ').filter(Boolean);
}
