import { EXTENSION, MIME, fileName, pack, unpack, type ProjectFile } from './file.ts';
import { byRecent, type ProjectMeta, type ProjectStore } from './store.ts';

/** Returns a valid Drive access token (the caller caches and refreshes). */
export type TokenSource = (forceRefresh?: boolean) => Promise<string>;

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const ROOT_PROP = 'digitalCanvasRoot';
const DOC_PROP = 'dcDocId';

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
 */
export class DriveStore implements ProjectStore {
  readonly kind = 'drive';
  readonly label = 'Google Drive';
  private folderId: string | null = null;
  private ids = new Map<string, string>(); // doc id → Drive file id

  constructor(private token: TokenSource, private folderName = 'Digital Canvas') {}

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
    return file;
  }

  async save(file: ProjectFile): Promise<void> {
    const { doc } = file;
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
    const body = new Blob([head, pack(file) as BlobPart, `\r\n--${boundary}--`]);
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
}
