import { EXTENSION, MIME, fileName, pack, unpack, type ProjectFile } from './file.ts';
import { brandJson, parseBrand, type BrandData } from './brand.ts';
import { byRecent, type ProjectMeta, type ProjectStore } from './store.ts';

/** Returns a valid Drive access token (the caller caches and refreshes). */
export type TokenSource = (forceRefresh?: boolean) => Promise<string>;

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const ROOT_PROP = 'digitalCanvasRoot';
const DOC_PROP = 'dcDocId';
/** On the shared assets folder ('assets') and on each asset file (its content-hash id). */
const ASSETS_PROP = 'dcAssets';
const ASSET_PROP = 'dcAsset';
/** On `brand.json`. */
const BRAND_PROP = 'dcBrand';

/** Only content-hash ids (as `assetId` makes) are safe to share between designs. */
export const isSharedAssetId = (id: string) => /^[0-9a-f]{20}\.[a-z0-9]+$/.test(id);

/** A cache of asset bytes by id (ids are content hashes, so entries never go stale). */
export interface AssetCache {
  get(id: string): Promise<Uint8Array | undefined>;
  set(id: string, bytes: Uint8Array): Promise<void>;
}

interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  thumbnailLink?: string;
  appProperties?: Record<string, string>;
}

export class DriveError extends Error {
  override name = 'DriveError';
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Projects as `.dcanvas` files in the user's Google Drive, inside one app
 * folder ("Digital Canvas"). Uses only the `drive.file` scope: the app sees
 * the folder and files it created, nothing else in the user's Drive.
 *
 * Each file carries `appProperties.dcDocId` so the project id survives
 * renames; the Drive file id is looked up from it.
 *
 * Drive is the database, so saves stay small: a design's `.dcanvas` holds only
 * its document and thumbnail. Images, videos, sounds and fonts live once each
 * in `Digital Canvas/assets/`, named by content hash and shared by every
 * design; a save uploads only assets Drive doesn't have yet. Older files with
 * assets inside still open (and move their assets out on the next save).
 */
export class DriveStore implements ProjectStore {
  readonly kind = 'drive';
  readonly label = 'Google Drive';
  private folderId: string | null = null;
  private ids = new Map<string, string>(); // doc id → Drive file id
  private assetsFolderId: string | null = null;
  private assetIds: Promise<Map<string, string>> | null = null; // asset id → Drive file id

  constructor(private token: TokenSource, private folderName = 'Digital Canvas', private cache?: AssetCache) {}

  private async call(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await this.token(!retry)}` } });
    if (res.status === 401 && retry) return this.call(url, init, false);
    if (!res.ok) {
      let msg = `${res.status}`;
      try { msg = ((await res.json()) as { error?: { message?: string } }).error?.message ?? msg; } catch { /* not JSON */ }
      throw new DriveError(`Google Drive: ${msg}`, res.status);
    }
    return res;
  }

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    return (await (await this.call(url, init)).json()) as T;
  }

  /** The app folder, created on first use. */
  async folder(): Promise<string> {
    if (this.folderId) return this.folderId;
    const q = `mimeType='${FOLDER_MIME}' and trashed=false and appProperties has { key='${ROOT_PROP}' and value='1' }`;
    const found = await this.json<{ files: DriveFile[] }>(`${API}/files?${new URLSearchParams({ q, fields: 'files(id,name)', spaces: 'drive' })}`);
    if (found.files[0]) return (this.folderId = found.files[0].id);
    const made = await this.json<DriveFile>(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: this.folderName, mimeType: FOLDER_MIME, appProperties: { [ROOT_PROP]: '1' } }),
    });
    return (this.folderId = made.id);
  }

  /** `Digital Canvas/assets`, created on first use. */
  private async assetsFolder(): Promise<string> {
    if (this.assetsFolderId) return this.assetsFolderId;
    const parent = await this.folder();
    const q = `'${parent}' in parents and mimeType='${FOLDER_MIME}' and trashed=false and appProperties has { key='${ASSETS_PROP}' and value='1' }`;
    const found = await this.json<{ files: DriveFile[] }>(`${API}/files?${new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive' })}`);
    if (found.files[0]) return (this.assetsFolderId = found.files[0].id);
    const made = await this.json<DriveFile>(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'assets', mimeType: FOLDER_MIME, parents: [parent], appProperties: { [ASSETS_PROP]: '1', [ROOT_PROP]: 'assets' } }),
    });
    return (this.assetsFolderId = made.id);
  }

  /** Every asset already in Drive (listed once per session). */
  private stored(): Promise<Map<string, string>> {
    this.assetIds ??= (async () => {
      const parent = await this.assetsFolder();
      const map = new Map<string, string>();
      const q = `'${parent}' in parents and trashed=false`;
      let pageToken = '';
      do {
        const params = new URLSearchParams({ q, fields: 'nextPageToken,files(id,appProperties)', pageSize: '1000', spaces: 'drive' });
        if (pageToken) params.set('pageToken', pageToken);
        const r = await this.json<{ files: DriveFile[]; nextPageToken?: string }>(`${API}/files?${params}`);
        for (const f of r.files) { const a = f.appProperties?.[ASSET_PROP]; if (a) map.set(a, f.id); }
        pageToken = r.nextPageToken ?? '';
      } while (pageToken);
      return map;
    })();
    this.assetIds.catch(() => (this.assetIds = null));
    return this.assetIds;
  }

  private async uploadAsset(id: string, bytes: Uint8Array, mime: string): Promise<void> {
    const stored = await this.stored();
    if (stored.has(id)) return;
    const meta = { name: id, mimeType: mime, parents: [await this.assetsFolder()], appProperties: { [ASSET_PROP]: id } };
    const boundary = `dc${Math.random().toString(36).slice(2)}`;
    const head = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\ncontent-type: ${mime}\r\n\r\n`;
    const body = new Blob([head, bytes as BlobPart, `\r\n--${boundary}--`]);
    const r = await this.json<{ id: string }>(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body });
    stored.set(id, r.id);
  }

  private async downloadAsset(id: string): Promise<Uint8Array | undefined> {
    const hit = await this.cache?.get(id).catch(() => undefined);
    if (hit) return hit;
    const fileId = (await this.stored()).get(id);
    if (!fileId) return undefined;
    const bytes = new Uint8Array(await (await this.call(`${API}/files/${fileId}?alt=media`)).arrayBuffer());
    await this.cache?.set(id, bytes).catch(() => {});
    return bytes;
  }

  async list(): Promise<ProjectMeta[]> {
    const parent = await this.folder();
    const q = `'${parent}' in parents and trashed=false and appProperties has { key='${ROOT_PROP}' and value='0' }`;
    const out: ProjectMeta[] = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({ q, fields: 'nextPageToken,files(id,name,modifiedTime,thumbnailLink,appProperties)', pageSize: '200', spaces: 'drive' });
      if (pageToken) params.set('pageToken', pageToken);
      const r = await this.json<{ files: DriveFile[]; nextPageToken?: string }>(`${API}/files?${params}`);
      for (const f of r.files) {
        const p = f.appProperties ?? {};
        const id = p[DOC_PROP];
        if (!id) continue;
        this.ids.set(id, f.id);
        out.push({
          id,
          title: f.name.endsWith(EXTENSION) ? f.name.slice(0, -EXTENSION.length) : f.name,
          updatedAt: f.modifiedTime,
          width: Number(p.dcW) || 0,
          height: Number(p.dcH) || 0,
          thumbnailUrl: f.thumbnailLink,
        });
      }
      pageToken = r.nextPageToken ?? '';
    } while (pageToken);
    return out.sort(byRecent);
  }

  private async fileIdOf(docId: string): Promise<string | undefined> {
    if (this.ids.has(docId)) return this.ids.get(docId);
    const parent = await this.folder();
    const q = `'${parent}' in parents and trashed=false and appProperties has { key='${DOC_PROP}' and value='${docId.replace(/'/g, '')}' }`;
    const r = await this.json<{ files: DriveFile[] }>(`${API}/files?${new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive' })}`);
    const id = r.files[0]?.id;
    if (id) this.ids.set(docId, id);
    return id;
  }

  async open(id: string): Promise<ProjectFile> {
    const fileId = await this.fileIdOf(id);
    if (!fileId) throw new Error('This design is not in your Drive any more.');
    return this.openFile(fileId);
  }

  /** Open by Drive file id (e.g. "Open with" from Drive). */
  async openFile(fileId: string): Promise<ProjectFile> {
    const res = await this.call(`${API}/files/${fileId}?alt=media`);
    const file = unpack(new Uint8Array(await res.arrayBuffer()));
    this.ids.set(file.doc.id, fileId);
    // Linked assets: fetch what the file doesn't carry (a few at a time).
    const missing = Object.keys(file.doc.assets).filter((a) => !file.assets.has(a) && isSharedAssetId(a));
    const queue = [...missing];
    await Promise.all(Array.from({ length: Math.min(6, queue.length) }, async () => {
      for (let a = queue.shift(); a; a = queue.shift()) {
        const bytes = await this.downloadAsset(a);
        if (bytes) file.assets.set(a, bytes);
      }
    }));
    for (const [a, b] of file.assets) if (!missing.includes(a) && isSharedAssetId(a)) void this.cache?.set(a, b).catch(() => {});
    return file;
  }

  async save(file: ProjectFile): Promise<void> {
    const { doc } = file;
    // Assets first, so a saved design never points at something Drive doesn't have.
    const queue = Object.keys(doc.assets).filter((a) => file.assets.has(a) && isSharedAssetId(a));
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let a = queue.shift(); a; a = queue.shift()) await this.uploadAsset(a, file.assets.get(a)!, doc.assets[a]!.mime);
    }));
    const fileId = await this.fileIdOf(doc.id);
    const meta: Record<string, unknown> = {
      name: fileName(doc.title),
      mimeType: MIME,
      appProperties: { [ROOT_PROP]: '0', [DOC_PROP]: doc.id, dcW: String(Math.round(doc.width)), dcH: String(Math.round(doc.height)) },
      ...(file.thumbnail ? { contentHints: { thumbnail: { image: base64url(file.thumbnail), mimeType: 'image/png' } } } : {}),
    };
    if (!fileId) meta.parents = [await this.folder()];
    const boundary = `dc${Math.random().toString(36).slice(2)}`;
    const head = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\ncontent-type: ${MIME}\r\n\r\n`;
    // Assets with other ids (e.g. from old imports) stay inside the file.
    const inside = new Map([...file.assets].filter(([a]) => !isSharedAssetId(a)));
    const body = new Blob([head, pack({ doc, assets: inside, thumbnail: file.thumbnail }) as BlobPart, `\r\n--${boundary}--`]);
    const url = fileId ? `${UPLOAD}/files/${fileId}?uploadType=multipart&fields=id` : `${UPLOAD}/files?uploadType=multipart&fields=id`;
    const r = await this.json<{ id: string }>(url, { method: fileId ? 'PATCH' : 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body });
    this.ids.set(doc.id, r.id);
  }

  /** Moves the file to Drive's bin (recoverable for 30 days). */
  async remove(id: string): Promise<void> {
    const fileId = await this.fileIdOf(id);
    if (!fileId) return;
    await this.call(`${API}/files/${fileId}?fields=id`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
    this.ids.delete(id);
  }

  // ---- brand kit: `Digital Canvas/brand.json`, logos in `assets/` ----

  private brandFileId: string | null = null;

  private async brandFile(): Promise<string | null> {
    if (this.brandFileId) return this.brandFileId;
    const parent = await this.folder();
    const q = `'${parent}' in parents and trashed=false and appProperties has { key='${BRAND_PROP}' and value='1' }`;
    const r = await this.json<{ files: DriveFile[] }>(`${API}/files?${new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive' })}`);
    return (this.brandFileId = r.files[0]?.id ?? null);
  }

  async loadBrand(): Promise<BrandData | null> {
    const id = await this.brandFile();
    if (!id) return null;
    const kit = parseBrand(await (await this.call(`${API}/files/${id}?alt=media`)).json());
    const assets = new Map<string, Uint8Array>();
    await Promise.all(kit.logos.map(async (l) => {
      const bytes = await this.downloadAsset(l.asset).catch(() => undefined);
      if (bytes) assets.set(l.asset, bytes);
    }));
    return { kit, assets };
  }

  async saveBrand(data: BrandData): Promise<void> {
    for (const l of data.kit.logos) {
      const bytes = data.assets.get(l.asset);
      if (bytes && isSharedAssetId(l.asset)) await this.uploadAsset(l.asset, bytes, l.mime);
    }
    const id = await this.brandFile();
    const meta: Record<string, unknown> = { name: 'brand.json', mimeType: 'application/json', appProperties: { [BRAND_PROP]: '1', [ROOT_PROP]: 'brand' } };
    if (!id) meta.parents = [await this.folder()];
    const boundary = `dc${Math.random().toString(36).slice(2)}`;
    const body = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\ncontent-type: application/json\r\n\r\n${brandJson(data.kit)}\r\n--${boundary}--`;
    const url = id ? `${UPLOAD}/files/${id}?uploadType=multipart&fields=id` : `${UPLOAD}/files?uploadType=multipart&fields=id`;
    const r = await this.json<{ id: string }>(url, { method: id ? 'PATCH' : 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body });
    this.brandFileId = r.id;
  }

  // ---- the shared assets folder, for browsing (Projects panel) ----

  /** Every file in `Digital Canvas/assets` (images, videos, sounds, fonts), newest first. */
  async listAssets(): Promise<{ id: string; mime: string; name: string; modifiedTime: string; thumbnailUrl?: string }[]> {
    const parent = await this.assetsFolder();
    const out: { id: string; mime: string; name: string; modifiedTime: string; thumbnailUrl?: string }[] = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({ q: `'${parent}' in parents and trashed=false`, fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,thumbnailLink,appProperties)', pageSize: '1000', spaces: 'drive', orderBy: 'modifiedTime desc' });
      if (pageToken) params.set('pageToken', pageToken);
      const r = await this.json<{ files: (DriveFile & { mimeType: string })[]; nextPageToken?: string }>(`${API}/files?${params}`);
      for (const f of r.files) {
        const a = f.appProperties?.[ASSET_PROP];
        if (a) out.push({ id: a, mime: f.mimeType, name: f.name, modifiedTime: f.modifiedTime, thumbnailUrl: f.thumbnailLink });
      }
      pageToken = r.nextPageToken ?? '';
    } while (pageToken);
    return out;
  }

  /** One shared asset's bytes (cached). */
  readAsset(id: string): Promise<Uint8Array | undefined> {
    return this.downloadAsset(id);
  }
}
