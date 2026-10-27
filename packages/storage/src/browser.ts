import { pack, unpack, type ProjectFile } from './file.ts';
import { KV, appDb, openDb } from './idb.ts';
import { brandJson, parseBrand, usedBrandAssets, type BrandData } from './brand.ts';
import { byRecent, metaOf, type ProjectMeta, type ProjectStore } from './store.ts';

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

  private brandKv = new KV<{ json: string; assets: [string, Uint8Array][] }>(appDb(), 'settings');

  async loadBrand(): Promise<BrandData | null> {
    const row = await this.brandKv.get('brand');
    return row ? { kit: parseBrand(JSON.parse(row.json)), assets: new Map(row.assets) } : null;
  }

  async saveBrand(data: BrandData): Promise<void> {
    await this.brandKv.set('brand', { json: brandJson(data.kit), assets: [...usedBrandAssets(data)] });
  }
}

/** Asset bytes kept in this browser by content hash, so reopening a Drive design downloads nothing twice. */
export function browserAssetCache(): import('./drive.ts').AssetCache {
  const kv = new KV<Uint8Array>(openDb('digital-canvas-assets', ['assets']), 'assets');
  return { get: (id) => kv.get(id), set: (id, bytes) => kv.set(id, bytes) };
}
