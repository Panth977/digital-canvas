import { EXTENSION, MIME, fileName, pack, unpack, type ProjectFile } from './file.ts';
import { brandJson, parseBrand, type BrandData } from './brand.ts';
import { byRecent, type ProjectMeta, type ProjectStore, type Version } from './store.ts';
import { API, DriveError, driveCall, readMedia, type TokenSource } from './driveapi.ts';
import { DriveSharing, readAccess, type FileAccess } from './share.ts';

export { DriveError, type TokenSource };
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const ROOT_PROP = 'digitalCanvasRoot';
const DOC_PROP = 'dcDocId';
/** On the shared assets folder ('assets') and on each asset file (its content-hash id). */
const ASSETS_PROP = 'dcAssets';
const ASSET_PROP = 'dcAsset';
/** The original file name of an asset, and the "removed from Uploads" flag. */
const NAME_PROP = 'dcName';
const HIDDEN_PROP = 'dcHidden';
/** The Drive file an asset was copied from (Google Picker → "From Google Drive"). */
const DRIVE_PROP = 'dcDrive';
/** `<provider>/<model>` of an AI-generated asset (Drive appProperties are short: 124 bytes key+value). */
const AI_PROP = 'dcAi';
/** On an asset file made "anyone with the link: reader" because a design using it is shared. */
const PUBLIC_PROP = 'dcPublic';

/** One of your uploads in `Digital Canvas/assets`. */
export interface LibraryAsset {
  /** Content-hash asset id (as in a design's `assets`). */
  id: string;
  fileId: string;
  mime: string;
  name?: string;
  thumbnailLink?: string;
  size?: number;
  createdTime?: string;
  width?: number;
  height?: number;
  duration?: number;
  /** The Drive file it was picked from (Uploads → Google Drive). */
  driveFileId?: string;
}
/** On `Digital Canvas/Exports`. */
const EXPORTS_PROP = 'dcExports';
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

/** Remembers the Drive file of designs outside your folder (shared with you), so they reopen after a reload. */
export interface KnownFiles {
  get(docId: string): string | undefined;
  set(docId: string, fileId: string): void;
}

export interface DriveStoreOptions {
  /** Browser API key: reads designs and assets shared "anyone with the link" that OAuth can't see. */
  apiKey?: string;
  known?: KnownFiles;
}

/** Drive limits an app property's key + value to 124 bytes. */
function shortLabel(s: string): string {
  const b = new TextEncoder().encode(s);
  return b.length <= 100 ? s : new TextDecoder().decode(b.slice(0, 100)).replace(/\uFFFD+$/, '');
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
  private hidden = new Set<string>(); // assets removed from Uploads
  private binned = new Map<string, string>(); // doc id → Drive file id, after remove()
  private published = new Set<string>(); // asset ids whose file is "anyone with the link: reader"
  /** Linked assets of designs that live elsewhere: doc id → (asset id → Drive file id), from links.json. */
  private remote = new Map<string, Record<string, string>>();
  /** Doc ids whose last open/save wrote a links.json. */
  private linked = new Set<string>();
  /** Owner / role of opened designs. */
  private accessOf = new Map<string, FileAccess>();
  /** Designs shared with anyone besides the owner: their new assets are published on save. */
  private sharedDocs = new Set<string>();
  readonly sharing: DriveSharing;

  constructor(private token: TokenSource, private folderName = 'Digital Canvas', private cache?: AssetCache, private opts: DriveStoreOptions = {}) {
    this.sharing = new DriveSharing(token);
  }

  private call(url: string, init: RequestInit = {}): Promise<Response> {
    return driveCall(this.token, url, init);
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
        for (const f of r.files) {
          const a = f.appProperties?.[ASSET_PROP];
          if (!a) continue;
          map.set(a, f.id);
          if (f.appProperties?.[HIDDEN_PROP]) this.hidden.add(a);
          if (f.appProperties?.[PUBLIC_PROP]) this.published.add(a);
        }
        pageToken = r.nextPageToken ?? '';
      } while (pageToken);
      return map;
    })();
    this.assetIds.catch(() => (this.assetIds = null));
    return this.assetIds;
  }

  private async uploadAsset(id: string, bytes: Uint8Array, mime: string, label?: string, driveFileId?: string, ai?: { provider: string; model: string }): Promise<void> {
    const stored = await this.stored();
    if (stored.has(id)) {
      // Used again after "Remove from Uploads": show it again. Picked from Drive: remember where from.
      const patch: Record<string, string | null> = {};
      if (this.hidden.has(id)) patch[HIDDEN_PROP] = null;
      if (driveFileId) patch[DRIVE_PROP] = driveFileId;
      if (Object.keys(patch).length) {
        this.hidden.delete(id);
        await this.call(`${API}/files/${stored.get(id)}?fields=id`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appProperties: patch }) }).catch(() => {});
      }
      return;
    }
    const props: Record<string, string> = { [ASSET_PROP]: id };
    if (label) props[NAME_PROP] = shortLabel(label);
    if (driveFileId) props[DRIVE_PROP] = driveFileId;
    if (ai) props[AI_PROP] = `${ai.provider}/${ai.model}`.slice(0, 110);
    const meta = { name: id, mimeType: mime, parents: [await this.assetsFolder()], appProperties: props };
    const boundary = `dc${Math.random().toString(36).slice(2)}`;
    const head = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\ncontent-type: ${mime}\r\n\r\n`;
    const body = new Blob([head, bytes as BlobPart, `\r\n--${boundary}--`]);
    const r = await this.json<{ id: string }>(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body });
    stored.set(id, r.id);
  }

  /**
   * Your uploads: every asset in `Digital Canvas/assets`, newest first, minus
   * the ones removed from Uploads. `fresh` lists Drive again.
   */
  async listAssets(fresh = false): Promise<LibraryAsset[]> {
    if (fresh) this.assetIds = null;
    const parent = await this.assetsFolder();
    const out: LibraryAsset[] = [];
    const map = new Map<string, string>();
    this.hidden.clear();
    const q = `'${parent}' in parents and trashed=false`;
    let pageToken = '';
    do {
      const params = new URLSearchParams({ q, fields: 'nextPageToken,files(id,mimeType,size,createdTime,thumbnailLink,appProperties,imageMediaMetadata(width,height),videoMediaMetadata(width,height,durationMillis))', pageSize: '1000', spaces: 'drive', orderBy: 'createdTime desc' });
      if (pageToken) params.set('pageToken', pageToken);
      const r = await this.json<{ files: (DriveFile & { mimeType: string; size?: string; createdTime?: string; imageMediaMetadata?: { width?: number; height?: number }; videoMediaMetadata?: { width?: number; height?: number; durationMillis?: string } })[]; nextPageToken?: string }>(`${API}/files?${params}`);
      for (const f of r.files) {
        const p = f.appProperties ?? {};
        const id = p[ASSET_PROP];
        if (!id) continue;
        map.set(id, f.id);
        if (p[PUBLIC_PROP]) this.published.add(id);
        if (p[HIDDEN_PROP]) { this.hidden.add(id); continue; }
        const m = f.imageMediaMetadata ?? f.videoMediaMetadata;
        out.push({
          id,
          fileId: f.id,
          mime: f.mimeType,
          ...(p[NAME_PROP] ? { name: p[NAME_PROP] } : {}),
          ...(f.thumbnailLink ? { thumbnailLink: f.thumbnailLink } : {}),
          ...(f.size ? { size: Number(f.size) } : {}),
          ...(f.createdTime ? { createdTime: f.createdTime } : {}),
          ...(m?.width ? { width: m.width, height: m.height } : {}),
          ...(Number(f.videoMediaMetadata?.durationMillis) ? { duration: Number(f.videoMediaMetadata!.durationMillis) / 1000 } : {}),
          ...(p[DRIVE_PROP] ? { driveFileId: p[DRIVE_PROP] } : {}),
        });
      }
      pageToken = r.nextPageToken ?? '';
    } while (pageToken);
    this.assetIds = Promise.resolve(map);
    return out;
  }

  /** An uploaded asset's bytes (from the local cache when we have them). */
  getAsset(id: string): Promise<Uint8Array | undefined> {
    return this.downloadAsset(id);
  }

  /**
   * Remove an asset from Uploads. The file stays in Drive (marked hidden),
   * because designs that already use it still need it.
   */
  async hideAsset(id: string): Promise<void> {
    const fileId = (await this.stored()).get(id);
    if (!fileId) return;
    await this.call(`${API}/files/${fileId}?fields=id`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appProperties: { [HIDDEN_PROP]: '1' } }) });
    this.hidden.add(id);
  }

  /**
   * An asset's bytes: the local cache, then your own `assets/` folder, then the
   * file a shared design links to (`links`), read with OAuth first and the API
   * key second (the owner made it "anyone with the link" when sharing).
   */
  private async downloadAsset(id: string, links?: Record<string, string>): Promise<Uint8Array | undefined> {
    const hit = await this.cache?.get(id).catch(() => undefined);
    if (hit) return hit;
    const own = (await this.stored()).get(id);
    const fileId = own ?? links?.[id];
    if (!fileId) return undefined;
    const bytes = own
      ? new Uint8Array(await (await this.call(`${API}/files/${fileId}?alt=media`)).arrayBuffer())
      : await readMedia(fileId, { token: this.token, apiKey: this.opts.apiKey }).catch(() => undefined);
    if (!bytes) return undefined;
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
    const known = this.opts.known?.get(docId);
    if (known) {
      this.ids.set(docId, known);
      return known;
    }
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
    // a design shared "anyone with the link" opens even before the Picker granted it (API key)
    const [bytes, access] = await Promise.all([
      readMedia(fileId, { token: this.token, apiKey: this.opts.apiKey }),
      readAccess(fileId, { token: this.token, apiKey: this.opts.apiKey }).catch(() => undefined),
    ]);
    const file = unpack(bytes);
    const docId = file.doc.id;
    this.ids.set(docId, fileId);
    if (access) {
      this.accessOf.set(docId, access);
      if (access.shared) this.sharedDocs.add(docId);
    }
    if (!access?.ownedByMe) this.opts.known?.set(docId, fileId);
    if (file.links) {
      this.remote.set(docId, file.links);
      this.linked.add(docId);
    }
    return this.withAssets(file);
  }

  /** Owner, sharer and your role for a design (cached from open; null when Drive won't say). */
  async access(docId: string, fresh = false): Promise<FileAccess | null> {
    if (!fresh && this.accessOf.has(docId)) return this.accessOf.get(docId)!;
    const fileId = await this.fileIdOf(docId);
    if (!fileId) return null;
    const a = await this.sharing.access(fileId).catch(() => null);
    if (a) {
      this.accessOf.set(docId, a);
      if (a.shared) this.sharedDocs.add(docId);
    }
    return a;
  }

  /** The design is now shared (or not): while it is, each save publishes its new assets. */
  setShared(docId: string, shared: boolean): void {
    if (shared) this.sharedDocs.add(docId);
    else this.sharedDocs.delete(docId);
    const a = this.accessOf.get(docId);
    if (a) this.accessOf.set(docId, { ...a, shared });
  }

  isShared(docId: string): boolean {
    return this.sharedDocs.has(docId);
  }

  /** The design's saved file has a links.json (older saves don't: save again before sharing). */
  hasLinks(docId: string): boolean {
    return this.linked.has(docId);
  }

  /**
   * Make every asset of the design that lives in your `assets/` folder
   * "anyone with the link: reader" (and mark it, so it is done once).
   * Returns how many files changed.
   */
  async publishAssets(docId: string, assetIds?: string[]): Promise<number> {
    const stored = await this.stored();
    const ids = (assetIds ?? this.usedAssets.get(docId) ?? []).filter((a) => stored.has(a) && !this.published.has(a));
    if (!ids.length) return 0;
    const done = new Set(await this.sharing.publish(ids.map((a) => stored.get(a)!)));
    let n = 0;
    for (const a of ids) {
      const fileId = stored.get(a)!;
      if (!done.has(fileId)) continue;
      this.published.add(a);
      n++;
      await this.call(`${API}/files/${fileId}?fields=id`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appProperties: { [PUBLIC_PROP]: '1' } }) }).catch(() => {});
    }
    return n;
  }

  /** Linked asset ids of each design (last open or save). */
  private usedAssets = new Map<string, string[]>();

  /** Drive keeps earlier saves of a file as revisions (about 30 days or 100 of them). */
  async versions(id: string): Promise<Version[]> {
    const fileId = await this.fileIdOf(id);
    if (!fileId) return [];
    const r = await this.json<{ revisions?: { id: string; modifiedTime: string; size?: string }[] }>(
      `${API}/files/${fileId}/revisions?${new URLSearchParams({ fields: 'revisions(id,modifiedTime,size)', pageSize: '200' })}`);
    return (r.revisions ?? []).map((v) => ({ id: v.id, modifiedTime: v.modifiedTime, size: v.size ? Number(v.size) : undefined }))
      .sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
  }

  async openVersion(id: string, versionId: string): Promise<ProjectFile> {
    const fileId = await this.fileIdOf(id);
    if (!fileId) throw new Error('This design is not in your Drive any more.');
    const res = await this.call(`${API}/files/${fileId}/revisions/${encodeURIComponent(versionId)}?alt=media`);
    return this.withAssets(unpack(new Uint8Array(await res.arrayBuffer())));
  }

  /** Fetch the linked assets a file doesn't carry. */
  private async withAssets(file: ProjectFile): Promise<ProjectFile> {
    // Linked assets: fetch what the file doesn't carry (a few at a time).
    const missing = Object.keys(file.doc.assets).filter((a) => !file.assets.has(a) && isSharedAssetId(a));
    this.usedAssets.set(file.doc.id, Object.keys(file.doc.assets).filter(isSharedAssetId));
    const queue = [...missing];
    await Promise.all(Array.from({ length: Math.min(6, queue.length) }, async () => {
      for (let a = queue.shift(); a; a = queue.shift()) {
        const bytes = await this.downloadAsset(a, file.links);
        if (bytes) file.assets.set(a, bytes);
      }
    }));
    for (const [a, b] of file.assets) if (!missing.includes(a) && isSharedAssetId(a)) void this.cache?.set(a, b).catch(() => {});
    return file;
  }

  async save(file: ProjectFile): Promise<void> {
    const { doc } = file;
    const stored = await this.stored();
    // A design shared with you links the owner's asset files: don't copy those into your Drive.
    const remote = this.remote.get(doc.id) ?? {};
    const used = Object.keys(doc.assets).filter(isSharedAssetId);
    // Assets first, so a saved design never points at something Drive doesn't have.
    const queue = used.filter((a) => file.assets.has(a) && !(remote[a] && !stored.has(a)));
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let a = queue.shift(); a; a = queue.shift()) await this.uploadAsset(a, file.assets.get(a)!, doc.assets[a]!.mime, doc.assets[a]!.name, undefined, doc.assets[a]!.ai);
    }));
    const links: Record<string, string> = {};
    for (const a of used) {
      const f = stored.get(a) ?? remote[a];
      if (f) links[a] = f;
    }
    this.usedAssets.set(doc.id, used);
    // shared: new assets get the same "anyone with the link" access before the design points at them
    if (this.sharedDocs.has(doc.id)) await this.publishAssets(doc.id, used).catch(() => 0);
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
    const body = new Blob([head, pack({ doc, assets: inside, thumbnail: file.thumbnail, links }) as BlobPart, `\r\n--${boundary}--`]);
    const url = fileId ? `${UPLOAD}/files/${fileId}?uploadType=multipart&fields=id` : `${UPLOAD}/files?uploadType=multipart&fields=id`;
    const r = await this.json<{ id: string }>(url, { method: fileId ? 'PATCH' : 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body });
    this.ids.set(doc.id, r.id);
    if (Object.keys(remote).length) this.remote.set(doc.id, { ...remote, ...links });
    this.linked.add(doc.id);
  }

  /** Moves the file to Drive's bin (recoverable for 30 days). */
  async remove(id: string): Promise<void> {
    const fileId = await this.fileIdOf(id);
    if (!fileId) return;
    await this.call(`${API}/files/${fileId}?fields=id`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
    this.ids.delete(id);
    this.binned.set(id, fileId);
  }

  /** Undo `remove`: take the file out of Drive's bin. */
  async restore(id: string): Promise<void> {
    const fileId = this.binned.get(id);
    if (!fileId) throw new Error('This design is no longer in the bin.');
    await this.call(`${API}/files/${fileId}?fields=id`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trashed: false }) });
    this.binned.delete(id);
    this.ids.set(id, fileId);
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

  // ---- add to Uploads (picked Drive files, the MCP server), save exports ----

  /**
   * Put a file into `Digital Canvas/assets` (stored once under its content-hash id).
   * `driveFileId`: the Drive file it was picked from (listed under "From Google Drive").
   */
  async addAsset(id: string, bytes: Uint8Array, mime: string, label?: string, driveFileId?: string, ai?: { provider: string; model: string }): Promise<void> {
    await this.uploadAsset(id, bytes, mime, label, driveFileId, ai);
    await this.cache?.set(id, bytes).catch(() => {});
  }

  private exportsFolderId: string | null = null;

  /** `Digital Canvas/Exports`, created on first use. */
  private async exportsFolder(): Promise<string> {
    if (this.exportsFolderId) return this.exportsFolderId;
    const parent = await this.folder();
    const q = `'${parent}' in parents and mimeType='${FOLDER_MIME}' and trashed=false and appProperties has { key='${EXPORTS_PROP}' and value='1' }`;
    const found = await this.json<{ files: DriveFile[] }>(`${API}/files?${new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive' })}`);
    if (found.files[0]) return (this.exportsFolderId = found.files[0].id);
    const made = await this.json<DriveFile>(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Exports', mimeType: FOLDER_MIME, parents: [parent], appProperties: { [EXPORTS_PROP]: '1', [ROOT_PROP]: 'exports' } }),
    });
    return (this.exportsFolderId = made.id);
  }

  /** Save an exported file (PNG, PDF, MP4…) into `Digital Canvas/Exports`; returns its Drive id and link. */
  async saveExport(name: string, bytes: Uint8Array, mime: string): Promise<{ id: string; webViewLink?: string }> {
    const meta = { name, mimeType: mime, parents: [await this.exportsFolder()] };
    const boundary = `dc${Math.random().toString(36).slice(2)}`;
    const head = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\ncontent-type: ${mime}\r\n\r\n`;
    const body = new Blob([head, bytes as BlobPart, `\r\n--${boundary}--`]);
    return this.json<{ id: string; webViewLink?: string }>(`${UPLOAD}/files?uploadType=multipart&fields=id,webViewLink`, { method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body });
  }

  /** The Drive file id of a design (for links). */
  driveFileId(id: string): Promise<string | undefined> {
    return this.fileIdOf(id);
  }

  // ---- the shared assets folder, for browsing (Projects panel) ----

  /** One shared asset's bytes (cached). */
  readAsset(id: string): Promise<Uint8Array | undefined> {
    return this.downloadAsset(id);
  }
}
