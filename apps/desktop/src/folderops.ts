/**
 * What the window asks of the folder store. The window packs and unpacks
 * `.dcanvas` itself, so designs cross as bytes.
 */
import { FolderWorkspace } from '@digital-canvas/mcp';
import { brandJson, libraryJson, parseBrand, readLibrary, unpack, type ProjectMeta } from '@digital-canvas/storage';

export interface FolderApi {
  list(): Promise<ProjectMeta[]>;
  read(id: string): Uint8Array;
  save(bytes: Uint8Array): Promise<void>;
  remove(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  listAssets(): Promise<unknown[]>;
  getAsset(id: string): Promise<Uint8Array | undefined>;
  addAsset(bytes: Uint8Array, mime: string, name?: string): Promise<void>;
  hideAsset(id: string): Promise<void>;
  loadBrand(): Promise<{ json: string; assets: [string, Uint8Array][] } | null>;
  saveBrand(json: string, assets: [string, Uint8Array][]): Promise<void>;
  /** plugins.json as text; plugin files by asset id. */
  loadPlugins(): Promise<string>;
  savePlugins(json: string, assets: [string, Uint8Array][]): Promise<void>;
  pluginAsset(id: string): Promise<Uint8Array | null>;
  /** A design's comment file (`.comments/<id>.json`), as text. */
  readComments(id: string): Promise<string | null>;
  writeComments(id: string, json: string): Promise<void>;
}

/** Fonts stay inside designs; the folder's `assets/` is for what the user uploads. */
const uploadable = (mime: string) => /^(image|video|audio)\//.test(mime);

export function folderApi(ws: FolderWorkspace): FolderApi {
  const store = ws.store;
  return {
    list: () => store.list(),
    read: (id) => store.readBytes(id),
    async save(bytes) {
      const file = unpack(bytes);
      store.saveBytes(file.doc.id, file.doc.title, bytes);
      for (const [id, data] of file.assets) {
        const m = file.doc.assets[id];
        if (!m || !uploadable(m.mime) || (await ws.getAsset(id))) continue;
        await ws.putAsset(data, m.mime, m.name);
      }
    },
    remove: (id) => store.remove(id),
    restore: (id) => store.restore(id),
    listAssets: () => ws.listAssets(),
    getAsset: (id) => ws.getAsset(id),
    addAsset: async (bytes, mime, name) => { await ws.putAsset(bytes, mime, name); },
    hideAsset: (id) => ws.hideAsset(id),
    async loadBrand() {
      const b = await store.loadBrand();
      return b ? { json: brandJson(b.kit), assets: [...b.assets] } : null;
    },
    saveBrand: (json, assets) => store.saveBrand({ kit: parseBrand(JSON.parse(json)), assets: new Map(assets) }),
    loadPlugins: async () => libraryJson(await store.loadPlugins()),
    savePlugins: (json, assets) => store.savePlugins(readLibrary(json), new Map(assets)),
    pluginAsset: (id) => store.pluginAsset(id),
    readComments: (id) => store.commentFiles.read(id),
    writeComments: (id, json) => store.commentFiles.write(id, json),
  };
}
