import { pack, unpack, type ProjectFile } from './file.ts';
import { KV, appDb } from './idb.ts';
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
}
