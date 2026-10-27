/**
 * What every tool works with: the workspace, plus helpers to open a design,
 * bring media into it, and save it back (fonts embedded, unused assets
 * dropped, a fresh thumbnail).
 */
import { pruneAssets, pruneFonts, type AssetMeta, type Doc } from '@digital-canvas/scene';
import { assetId, type ProjectFile } from '@digital-canvas/storage';
import { thumbnail } from './engine.ts';
import { embedFonts } from './fonts.ts';
import { probe, type MediaInfo } from './media.ts';
import { download } from './net.ts';
import type { JobRunner } from './jobs.ts';
import { FolderWorkspace, type AssetInfo, type Workspace } from './workspace.ts';

export const DEFAULT_EDITOR_URL = 'https://digital-canvas-p977.web.app';

export interface ServerOptions {
  /** Where the web editor lives (for open_in_editor links). */
  editorUrl?: string;
  /** Runs long exports (video). Default: in this process. */
  jobs?: JobRunner;
  /** 'remote' = a shared server: URL imports may not reach private addresses. */
  mode?: 'local' | 'remote';
  /** Name shown to clients. */
  name?: string;
}

/** A tool error the agent can act on: say what was wrong and how to call it instead. */
export class ToolError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message);
  }
}

/** Where a picture, clip or sound comes from (exactly one). */
export interface MediaRef {
  /** An asset id from list_assets / import_* (content hash, e.g. "3f9a…c1.png"). */
  asset?: string;
  /** A public http(s) URL to download. */
  url?: string;
  /** A Google Drive file id (from search_drive). */
  driveFileId?: string;
  /** Kept as the asset's name (file name or credit line). */
  name?: string;
}

export class Context {
  readonly editorUrl: string;
  constructor(readonly ws: Workspace, readonly opts: ServerOptions = {}) {
    this.editorUrl = (opts.editorUrl ?? DEFAULT_EDITOR_URL).replace(/\/$/, '');
  }

  get remote(): boolean { return this.opts.mode === 'remote'; }

  editorLink(id: string): string {
    return `${this.editorUrl}/#/d/${encodeURIComponent(id)}`;
  }

  async open(id: string): Promise<ProjectFile> {
    if (!id) throw new ToolError('design_id is required', 'call list_designs or create_design first');
    try {
      return await this.ws.store.open(id);
    } catch (e) {
      throw new ToolError(`could not open design "${id}": ${e instanceof Error ? e.message : String(e)}`, 'use an id from list_designs (designs are identified by their `id`, not their title)');
    }
  }

  /** Embed fonts, drop unused assets, refresh the thumbnail, save. Returns fonts that could not be found. */
  async save(file: ProjectFile): Promise<{ missingFonts: string[] }> {
    const { missing } = await embedFonts(file);
    file.doc = pruneFonts(pruneAssets({ ...file.doc, updatedAt: new Date().toISOString() }));
    for (const k of [...file.assets.keys()]) if (!file.doc.assets[k]) file.assets.delete(k);
    file.thumbnail = await thumbnail(file).catch(() => file.thumbnail);
    await this.ws.store.save(file);
    return { missingFonts: missing };
  }

  /** Open, change, save. `fn` may replace `file.doc`. */
  async edit<T>(id: string, fn: (file: ProjectFile) => Promise<T> | T): Promise<T & { missingFonts?: string[] }> {
    const file = await this.open(id);
    const out = await fn(file);
    const { missingFonts } = await this.save(file);
    return { ...(out as T), ...(missingFonts.length ? { missingFonts } : {}) };
  }

  // ---- media ----

  /** Bytes + name of a media reference (downloading or reading Drive when needed). */
  async fetchRef(ref: MediaRef): Promise<{ bytes: Uint8Array; mime?: string; name?: string; id?: string }> {
    const n = Number(!!ref.asset) + Number(!!ref.url) + Number(!!ref.driveFileId);
    if (n !== 1) throw new ToolError('give exactly one of `asset`, `url` or `driveFileId`', 'asset ids come from list_assets or import_*; Drive ids from search_drive');
    if (ref.asset) {
      const bytes = await this.ws.getAsset(ref.asset);
      if (!bytes) throw new ToolError(`no asset "${ref.asset}" in your uploads`, 'call list_assets for ids, or import the file first (import_from_url / import_from_drive / import_stock)');
      return { bytes, id: ref.asset, ...(ref.name ? { name: ref.name } : {}) };
    }
    if (ref.url) {
      const got = await download(ref.url, { allowPrivate: !this.remote }).catch((e: unknown) => { throw new ToolError(e instanceof Error ? e.message : String(e), 'check the URL is a direct link to the file (not a web page)'); });
      return { bytes: got.bytes, mime: got.mime, name: ref.name ?? got.name };
    }
    if (!this.ws.readDriveFile) throw new ToolError('this workspace has no Google Drive', 'use `asset` or `url` instead');
    const got = await this.ws.readDriveFile(ref.driveFileId!);
    return { bytes: got.bytes, mime: got.mime, name: ref.name ?? got.name };
  }

  /** Bring a media file into the uploads library (persisted), probed. */
  async importMedia(ref: MediaRef): Promise<AssetInfo & { kind: MediaInfo['kind'] }> {
    const got = await this.fetchRef(ref);
    const info = await probe(got.bytes, got.mime).catch((e: unknown) => { throw new ToolError(`cannot use this file: ${e instanceof Error ? e.message : String(e)}`); });
    const extra = { ...(info.width ? { width: info.width, height: info.height } : {}), ...(info.duration ? { duration: round(info.duration, 2) } : {}) };
    let asset: AssetInfo;
    if (got.id) asset = { id: got.id, mime: info.mime, ...(got.name ? { name: got.name } : {}) };
    else if (this.ws instanceof FolderWorkspace) asset = await this.ws.putAsset(got.bytes, info.mime, got.name, extra);
    else asset = await this.ws.putAsset(got.bytes, info.mime, got.name);
    return { ...asset, ...extra, kind: info.kind };
  }

  /**
   * Make sure the design carries a media file: bytes in `file.assets`, meta in
   * `doc.assets` (and a poster for videos). Returns the asset id and its meta.
   */
  async attach(file: ProjectFile, ref: MediaRef): Promise<{ id: string; meta: AssetMeta; info: MediaInfo }> {
    if (ref.asset && file.doc.assets[ref.asset] && file.assets.has(ref.asset)) {
      const meta = file.doc.assets[ref.asset]!;
      const kind = meta.mime.split('/')[0] as MediaInfo['kind'];
      return { id: ref.asset, meta, info: { mime: meta.mime, kind, width: meta.width, height: meta.height, duration: meta.duration } };
    }
    const got = await this.fetchRef(ref);
    const info = await probe(got.bytes, got.mime).catch((e: unknown) => { throw new ToolError(`cannot use this file: ${e instanceof Error ? e.message : String(e)}`); });
    const id = got.id ?? await assetId(got.bytes, info.mime);
    if (!got.id) await this.ws.putAsset(got.bytes, info.mime, got.name).catch(() => undefined);
    const meta: AssetMeta = { mime: info.mime, ...(info.width ? { width: info.width, height: info.height } : {}), ...(info.duration ? { duration: info.duration } : {}), ...(got.name ? { name: got.name } : {}) };
    file.assets.set(id, got.bytes);
    const assets: Doc['assets'] = { ...file.doc.assets, [id]: meta };
    if (info.kind === 'video' && info.poster) {
      file.assets.set(`${id}.poster`, info.poster);
      assets[`${id}.poster`] = { mime: 'image/png', width: info.width, height: info.height, name: `${got.name ?? id} (poster)` };
    }
    file.doc = { ...file.doc, assets };
    return { id, meta, info };
  }
}

export const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
