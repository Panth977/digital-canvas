/**
 * Where the agent's designs, uploads, brand kit and exports live.
 *
 *  - DriveWorkspace: the user's Google Drive, exactly as the web app keeps it
 *    ("Digital Canvas" folder, `assets/`, `brand.json`, plus `Exports/`).
 *  - FolderWorkspace: a folder on this computer (no Google account; tests).
 *
 * Tools only talk to this interface, so the same server runs locally (stdio)
 * and in the Cloud Function (one Drive workspace per signed-in user).
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  DriveBrowser, DriveStore, EXTENSION, assetId, brandJson, byRecent, fileName, pack, parseBrand, peek, unpack, usedBrandAssets,
  type AssetCache, type BrandData, type DriveItem, type MediaKind, type ProjectFile, type ProjectMeta, type ProjectStore, type TokenSource,
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
  /** Keep a file in the uploads library (once per content). */
  putAsset(bytes: Uint8Array, mime: string, name?: string): Promise<AssetInfo>;
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

  /** `_scope`: the scopes the token carries (unused: the app only ever has drive.file). */
  constructor(private token: TokenSource, _scope?: string) {
    this.store = new DriveStore(token, 'Digital Canvas', sharedCache);
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

// ---------------------------------------------------------------- local folder

/**
 * Designs as `.dcanvas` files in a folder (same layout as the web app's
 * "folder" store), plus `assets/` for uploads, `Exports/` and `.trash/`.
 */
export class NodeFolderStore implements ProjectStore {
  readonly kind = 'folder';
  constructor(readonly dir: string) { mkdirSync(dir, { recursive: true }); }
  get label() { return this.dir; }

  private entries(): { name: string; meta: ProjectMeta }[] {
    const out: { name: string; meta: ProjectMeta }[] = [];
    for (const name of readdirSync(this.dir)) {
      if (!name.endsWith(EXTENSION)) continue;
      try {
        const bytes = new Uint8Array(readFileSync(join(this.dir, name)));
        const { doc, thumbnail } = peek(bytes);
        out.push({ name, meta: { id: doc.id, title: doc.title, updatedAt: doc.updatedAt, width: doc.width, height: doc.height, ...(thumbnail ? { thumbnail } : {}) } });
      } catch { /* not ours */ }
    }
    return out;
  }

  private nameOf(id: string): string | undefined {
    return this.entries().find((e) => e.meta.id === id)?.name;
  }

  async list() { return this.entries().map((e) => e.meta).sort(byRecent); }

  async open(id: string): Promise<ProjectFile> {
    const name = this.nameOf(id);
    if (!name) throw new Error(`no design with id "${id}" (call list_designs for ids)`);
    return unpack(new Uint8Array(readFileSync(join(this.dir, name))));
  }

  async save(file: ProjectFile): Promise<void> {
    const old = this.nameOf(file.doc.id);
    let name = fileName(file.doc.title);
    if (name !== old) {
      const base = name.slice(0, -EXTENSION.length);
      for (let i = 2; existsSync(join(this.dir, name)); i++) name = `${base} (${i})${EXTENSION}`;
    }
    writeFileSync(join(this.dir, name), pack(file));
    if (old && old !== name) rmSync(join(this.dir, old), { force: true });
  }

  /** Into `.trash/` (like Drive's bin). */
  async remove(id: string): Promise<void> {
    const name = this.nameOf(id);
    if (!name) return;
    mkdirSync(join(this.dir, '.trash'), { recursive: true });
    renameSync(join(this.dir, name), join(this.dir, '.trash', name));
  }

  async loadBrand(): Promise<BrandData | null> {
    const p = join(this.dir, 'brand.json');
    if (!existsSync(p)) return null;
    const kit = parseBrand(JSON.parse(readFileSync(p, 'utf8')));
    const assets = new Map<string, Uint8Array>();
    for (const l of kit.logos) {
      const f = join(this.dir, 'brand-assets', l.asset);
      if (existsSync(f)) assets.set(l.asset, new Uint8Array(readFileSync(f)));
    }
    return { kit, assets };
  }

  async saveBrand(data: BrandData): Promise<void> {
    const used = usedBrandAssets(data);
    if (used.size) mkdirSync(join(this.dir, 'brand-assets'), { recursive: true });
    for (const [id, b] of used) writeFileSync(join(this.dir, 'brand-assets', id), b);
    writeFileSync(join(this.dir, 'brand.json'), brandJson(data.kit));
  }
}

export class FolderWorkspace implements Workspace {
  readonly kind = 'folder';
  readonly store: NodeFolderStore;
  constructor(readonly dir: string) { this.store = new NodeFolderStore(dir); }
  get label() { return `folder ${this.dir}`; }

  private get assetsDir() { return join(this.dir, 'assets'); }
  private index(): Record<string, Omit<AssetInfo, 'id'>> {
    const p = join(this.assetsDir, 'index.json');
    try { return JSON.parse(readFileSync(p, 'utf8')) as Record<string, Omit<AssetInfo, 'id'>>; } catch { return {}; }
  }

  async listAssets(): Promise<AssetInfo[]> {
    const idx = this.index();
    return Object.entries(idx).filter(([id]) => existsSync(join(this.assetsDir, id)))
      .map(([id, m]) => ({ id, ...m })).sort((a, b) => (b.createdTime ?? '').localeCompare(a.createdTime ?? ''));
  }

  async getAsset(id: string) {
    if (!/^[\w.-]+$/.test(id)) return undefined;
    const p = join(this.assetsDir, id);
    return existsSync(p) ? new Uint8Array(readFileSync(p)) : undefined;
  }

  async putAsset(bytes: Uint8Array, mime: string, name?: string, extra: Partial<AssetInfo> = {}): Promise<AssetInfo> {
    const id = await assetId(bytes, mime);
    mkdirSync(this.assetsDir, { recursive: true });
    const p = join(this.assetsDir, id);
    if (!existsSync(p)) writeFileSync(p, bytes);
    const idx = this.index();
    idx[id] = { ...idx[id], ...extra, mime, ...(name ? { name } : {}), size: bytes.length, createdTime: idx[id]?.createdTime ?? new Date().toISOString() };
    writeFileSync(join(this.assetsDir, 'index.json'), JSON.stringify(idx, null, 1));
    return { id, ...idx[id]! };
  }

  /** Remember sizes/durations we measured (shown by list_assets). */
  async describeAsset(id: string, extra: Partial<AssetInfo>): Promise<void> {
    const idx = this.index();
    if (!idx[id]) return;
    idx[id] = { ...idx[id]!, ...extra };
    writeFileSync(join(this.assetsDir, 'index.json'), JSON.stringify(idx, null, 1));
  }

  async saveExport(name: string, bytes: Uint8Array, mime: string): Promise<ExportResult> {
    const dir = join(this.dir, 'Exports');
    mkdirSync(dir, { recursive: true });
    let file = name;
    const dot = name.lastIndexOf('.');
    for (let i = 2; existsSync(join(dir, file)); i++) file = `${name.slice(0, dot)} (${i})${name.slice(dot)}`;
    const path = join(dir, file);
    writeFileSync(path, bytes);
    return { name: file, mime, size: statSync(path).size, path, link: `file://${path}` };
  }
}
