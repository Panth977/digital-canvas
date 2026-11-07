import { pack, unpack, type ProjectFile } from './file.ts';
import { KV, appDb, openDb } from './idb.ts';
import { brandJson, parseBrand, usedBrandAssets, type BrandData } from './brand.ts';
import { byRecent, metaOf, type ProjectMeta, type ProjectStore } from './store.ts';
import { libraryAssets, libraryJson, readLibrary } from './plugins.ts';
import { JsonComments } from './comments.ts';
import type { PluginLibrary } from '@digital-canvas/scene';

interface Row {
  meta: ProjectMeta;
  bytes: Uint8Array;
}

/** Projects kept inside this browser (IndexedDB). Works everywhere, no setup. */
export class BrowserStore implements ProjectStore {
  readonly kind = 'browser';
  readonly label = 'This browser';
  private kv = new KV<Row>(appDb(), 'projects');

  async list(): Promise<ProjectMeta[]> {
    return (await this.kv.values()).map((r) => r.meta).sort(byRecent);
  }

  async open(id: string): Promise<ProjectFile> {
    const row = await this.kv.get(id);
    if (!row) throw new Error('This project is not in this browser any more.');
    return unpack(row.bytes);
  }

  async save(file: ProjectFile): Promise<void> {
    await this.kv.set(file.doc.id, { meta: metaOf(file), bytes: pack(file) });
  }

  async remove(id: string): Promise<void> {
    await this.kv.delete(id);
  }

  /** Comments: one JSON string per design in the settings table (`comments:<id>`). */
  private commentKv = new KV<string>(appDb(), 'settings');
  readonly comments = new JsonComments({
    read: async (id) => (await this.commentKv.get(`comments:${id}`)) ?? null,
    write: (id, json) => this.commentKv.set(`comments:${id}`, json),
  });

  private brandKv = new KV<{ json: string; assets: [string, Uint8Array][] }>(appDb(), 'settings');

  async loadBrand(): Promise<BrandData | null> {
    const row = await this.brandKv.get('brand');
    return row ? { kit: parseBrand(JSON.parse(row.json)), assets: new Map(row.assets) } : null;
  }

  async saveBrand(data: BrandData): Promise<void> {
    await this.brandKv.set('brand', { json: brandJson(data.kit), assets: [...usedBrandAssets(data)] });
  }

  private pluginKv = new KV<{ json: string; assets: [string, Uint8Array][] }>(appDb(), 'settings');

  async loadPlugins(): Promise<PluginLibrary> {
    return readLibrary((await this.pluginKv.get('plugins'))?.json);
  }

  async savePlugins(lib: PluginLibrary, assets = new Map<string, Uint8Array>()): Promise<void> {
    const old = new Map((await this.pluginKv.get('plugins'))?.assets ?? []);
    for (const [k, v] of assets) old.set(k, v);
    const keep = libraryAssets(lib);
    await this.pluginKv.set('plugins', { json: libraryJson(lib), assets: [...old].filter(([k]) => keep.has(k)) });
  }

  async pluginAsset(id: string): Promise<Uint8Array | null> {
    return new Map((await this.pluginKv.get('plugins'))?.assets ?? []).get(id) ?? null;
  }
}

/** Asset bytes kept in this browser by content hash, so reopening a Drive design downloads nothing twice. */
export function browserAssetCache(): import('./drive.ts').AssetCache {
  const kv = new KV<Uint8Array>(openDb('digital-canvas-assets', ['assets']), 'assets');
  return { get: (id) => kv.get(id), set: (id, bytes) => kv.set(id, bytes) };
}
