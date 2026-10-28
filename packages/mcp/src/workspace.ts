/**
 * Where the agent's designs, uploads, brand kit and exports live.
 *
 *  - DriveWorkspace: the user's Google Drive, exactly as the web app keeps it
 *    ("Digital Canvas" folder, `assets/`, `brand.json`, plus `Exports/`).
 *  - FolderWorkspace (node/folder.ts): a folder on this computer (no Google account; tests).
 *
 * Tools only talk to this interface, so the same server runs locally (stdio)
 * and in the Cloud Function (one Drive workspace per signed-in user).
 */
import {
  DriveBrowser, DriveStore, assetId,
  type AssetCache, type DriveItem, type MediaKind, type ProjectStore, type TokenSource,
} from '@digital-canvas/storage';

export interface AssetInfo {
  /** Content-hash id: pass it to add_elements as `asset`. */
  id: string;
  mime: string;
  name?: string;
  width?: number;
  height?: number;
  /** Seconds (video, audio). */
  duration?: number;
  size?: number;
  thumbnailUrl?: string;
  createdTime?: string;
}

export interface DriveHit {
  fileId: string;
  name: string;
  mimeType: string;
  kind: 'image' | 'video' | 'audio' | 'folder' | 'design' | 'other';
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  duration?: number;
  size?: number;
  modifiedTime?: string;
}

export interface DriveSearch {
  query?: string;
  kind?: MediaKind;
  folderId?: string;
  pageToken?: string;
}

export interface ExportResult {
  name: string;
  mime: string;
  size: number;
  /** Where to open it (Drive link). */
  link?: string;
  /** A local file (folder workspace). */
  path?: string;
  fileId?: string;
}

export interface Workspace {
  readonly kind: 'drive' | 'folder';
  readonly label: string;
  readonly store: ProjectStore;
  listAssets(): Promise<AssetInfo[]>;
  getAsset(id: string): Promise<Uint8Array | undefined>;
  /** Keep a file in the uploads library (once per content). `extra`: sizes/durations measured on import (kept where the store can). */
  putAsset(bytes: Uint8Array, mime: string, name?: string, extra?: Partial<AssetInfo>): Promise<AssetInfo>;
  /**
   * Drive files this app can see under `drive.file`: its own folder plus the files the user
   * picked in the app (Uploads › Google Drive) or opened with it. Not the rest of Drive.
   */
  searchDrive?(q: DriveSearch): Promise<{ items: DriveHit[]; nextPageToken?: string }>;
  readDriveFile?(fileId: string): Promise<{ bytes: Uint8Array; mime: string; name: string }>;
  saveExport(name: string, bytes: Uint8Array, mime: string): Promise<ExportResult>;
}

// ---------------------------------------------------------------- Drive

/** Asset bytes kept in memory across calls (ids are content hashes, so they never go stale). */
export class MemoryAssetCache implements AssetCache {
  private map = new Map<string, Uint8Array>();
  private bytes = 0;
  constructor(private limit = 256 * 1024 * 1024) {}
  async get(id: string) {
    const hit = this.map.get(id);
    if (hit) { this.map.delete(id); this.map.set(id, hit); }
    return hit;
  }
  async set(id: string, b: Uint8Array) {
    if (this.map.has(id) || b.length > this.limit / 4) return;
    this.map.set(id, b);
    this.bytes += b.length;
    for (const [k, v] of this.map) {
      if (this.bytes <= this.limit) break;
      this.map.delete(k);
      this.bytes -= v.length;
    }
  }
}

const sharedCache = new MemoryAssetCache();

function kindOf(mime: string): DriveHit['kind'] {
  if (mime === 'application/vnd.google-apps.folder') return 'folder';
  if (mime === 'application/vnd.digital-canvas+zip') return 'design';
  const top = mime.split('/')[0];
  return top === 'image' || top === 'video' || top === 'audio' ? top : 'other';
}

const hit = (i: DriveItem): DriveHit => ({
  fileId: i.id, name: i.name, mimeType: i.mimeType, kind: kindOf(i.mimeType),
  ...(i.thumbnailLink ? { thumbnailUrl: i.thumbnailLink } : {}), ...(i.width ? { width: i.width, height: i.height } : {}),
  ...(i.duration ? { duration: i.duration } : {}), ...(i.size ? { size: i.size } : {}), ...(i.modifiedTime ? { modifiedTime: i.modifiedTime } : {}),
});

export class DriveWorkspace implements Workspace {
  readonly kind = 'drive';
  readonly label = 'Google Drive';
  readonly store: DriveStore;
  private browser: DriveBrowser;

  /** `_scope`: unused (the app only ever has drive.file). `cache`: asset bytes kept across calls (default 256 MB, shared). */
  constructor(private token: TokenSource, _scope?: string, cache: AssetCache = sharedCache) {
    this.store = new DriveStore(token, 'Digital Canvas', cache);
    this.browser = new DriveBrowser(token);
  }

  async listAssets(): Promise<AssetInfo[]> {
    return (await this.store.listAssets(true)).map((a) => ({
      id: a.id, mime: a.mime, ...(a.name ? { name: a.name } : {}), ...(a.width ? { width: a.width, height: a.height } : {}),
      ...(a.duration ? { duration: a.duration } : {}), ...(a.size ? { size: a.size } : {}),
      ...(a.thumbnailLink ? { thumbnailUrl: a.thumbnailLink } : {}), ...(a.createdTime ? { createdTime: a.createdTime } : {}),
    }));
  }

  getAsset(id: string) { return this.store.getAsset(id); }

  async putAsset(bytes: Uint8Array, mime: string, name?: string): Promise<AssetInfo> {
    const id = await assetId(bytes, mime);
    await this.store.addAsset(id, bytes, mime, name);
    return { id, mime, ...(name ? { name } : {}), size: bytes.length };
  }

  async searchDrive(q: DriveSearch) {
    const loc = q.folderId ? { source: 'my-drive' as const, folderId: q.folderId } : q.query?.trim() ? { source: 'my-drive' as const, search: q.query } : { source: 'recent' as const };
    const page = await this.browser.list(loc, q.kind ?? 'all', q.pageToken, true);
    return { items: page.items.map(hit), ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}) };
  }

  async readDriveFile(fileId: string) {
    const item = await this.browser.file(fileId).catch((e: { status?: number; message?: string }) => {
      throw new Error(e.status === 404
        ? `Drive file ${fileId} not found, or Digital Canvas may not read it (it only sees files the user picked in the app's Uploads › Google Drive, or files it created). Ask the user to pick it there.`
        : String(e.message ?? e));
    });
    const bytes = await this.browser.download(item);
    return { bytes, mime: item.mimeType, name: item.name };
  }

  async saveExport(name: string, bytes: Uint8Array, mime: string): Promise<ExportResult> {
    const r = await this.store.saveExport(name, bytes, mime);
    return { name, mime, size: bytes.length, fileId: r.id, link: r.webViewLink ?? `https://drive.google.com/file/d/${r.id}/view` };
  }
}
