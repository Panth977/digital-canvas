/** A tiny promise wrapper over IndexedDB: one database, named object stores. */

export function openDb(name: string, stores: string[], version = 1): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => {
      for (const s of stores) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class KV<T> {
  constructor(private db: Promise<IDBDatabase>, private store: string) {}

  private async tx(mode: IDBTransactionMode) {
    return (await this.db).transaction(this.store, mode).objectStore(this.store);
  }
  async get(key: string): Promise<T | undefined> { return wrap((await this.tx('readonly')).get(key)); }
  async set(key: string, value: T): Promise<void> { await wrap((await this.tx('readwrite')).put(value, key)); }
  async delete(key: string): Promise<void> { await wrap((await this.tx('readwrite')).delete(key)); }
  async values(): Promise<T[]> { return wrap((await this.tx('readonly')).getAll()) as Promise<T[]>; }
}

const DB = 'digital-canvas';
let shared: Promise<IDBDatabase> | null = null;

/** The app's database: `projects` (browser store) and `settings`. */
export function appDb(): Promise<IDBDatabase> {
  shared ??= openDb(DB, ['projects', 'settings']);
  return shared;
}
