import { EXTENSION, fileName, pack, peek, unpack, type ProjectFile } from './file.ts';
import { KV, appDb } from './idb.ts';
import { brandJson, parseBrand, usedBrandAssets, type BrandData } from './brand.ts';
import { byRecent, type ProjectMeta, type ProjectStore } from './store.ts';

declare global {
  interface Window {
    showDirectoryPicker?(opts?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: string }): Promise<FileSystemDirectoryHandle>;
  }
  interface FileSystemHandle {
    queryPermission?(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
    requestPermission?(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  }
}

const settings = () => new KV<FileSystemDirectoryHandle>(appDb(), 'settings');
const HANDLE_KEY = 'folder';

/**
 * Projects as `.dcanvas` files in a folder on this computer (File System
 * Access API; Chromium browsers). The user picks the folder once; new
 * projects go there without asking for a path again.
 */
export class FolderStore implements ProjectStore {
  readonly kind = 'folder';
  /** project id → file name, filled by list(). */
  private names = new Map<string, string>();

  private constructor(private dir: FileSystemDirectoryHandle) {}

  get label(): string { return this.dir.name; }

  static supported(): boolean {
    return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
  }

  /** Ask the user for a folder and remember it. Must run from a click. */
  static async pick(): Promise<FolderStore> {
    const dir = await window.showDirectoryPicker!({ id: 'digital-canvas', mode: 'readwrite' });
    await settings().set(HANDLE_KEY, dir);
    return new FolderStore(dir);
  }

  /**
   * The remembered folder, if any. `needsPermission` means the browser wants
   * a click before we may read it again (call `grant()` from a click).
   */
  static async remembered(): Promise<{ store: FolderStore; needsPermission: boolean } | null> {
    const dir = await settings().get(HANDLE_KEY).catch(() => undefined);
    if (!dir) return null;
    const state = (await dir.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
    return { store: new FolderStore(dir), needsPermission: state !== 'granted' };
  }

  static async forget(): Promise<void> {
    await settings().delete(HANDLE_KEY);
  }

  async grant(): Promise<boolean> {
    return ((await this.dir.requestPermission?.({ mode: 'readwrite' })) ?? 'granted') === 'granted';
  }

  async list(): Promise<ProjectMeta[]> {
    const out: ProjectMeta[] = [];
    this.names.clear();
    for await (const entry of this.dir.values()) {
      if (entry.kind !== 'file' || !entry.name.endsWith(EXTENSION)) continue;
      try {
        const bytes = new Uint8Array(await (await (entry as FileSystemFileHandle).getFile()).arrayBuffer());
        const { doc, thumbnail } = peek(bytes);
        this.names.set(doc.id, entry.name);
        out.push({ id: doc.id, title: doc.title, updatedAt: doc.updatedAt, width: doc.width, height: doc.height, thumbnail });
      } catch {
        // Not ours or damaged: leave it alone.
      }
    }
    return out.sort(byRecent);
  }

  private async nameOf(id: string): Promise<string | undefined> {
    if (!this.names.has(id)) await this.list();
    return this.names.get(id);
  }

  async open(id: string): Promise<ProjectFile> {
    const name = await this.nameOf(id);
    if (!name) throw new Error('This project is not in the folder any more.');
    const file = await (await this.dir.getFileHandle(name)).getFile();
    return unpack(new Uint8Array(await file.arrayBuffer()));
  }

  /** Writes `<title>.dcanvas`; a renamed project moves to its new name. */
  async save(file: ProjectFile): Promise<void> {
    const old = await this.nameOf(file.doc.id);
    let name = fileName(file.doc.title);
    if (name !== old) name = await this.freeName(name);
    const handle = await this.dir.getFileHandle(name, { create: true });
    const w = await handle.createWritable();
    await w.write(pack(file) as BufferSource);
    await w.close();
    this.names.set(file.doc.id, name);
    if (old && old !== name) await this.dir.removeEntry(old).catch(() => {});
  }

  private async freeName(name: string): Promise<string> {
    const taken = new Set<string>();
    for await (const e of this.dir.values()) taken.add(e.name);
    if (!taken.has(name)) return name;
    const base = name.slice(0, -EXTENSION.length);
    for (let i = 2; ; i++) if (!taken.has(`${base} (${i})${EXTENSION}`)) return `${base} (${i})${EXTENSION}`;
  }

  async remove(id: string): Promise<void> {
    const name = await this.nameOf(id);
    if (name) await this.dir.removeEntry(name);
    this.names.delete(id);
  }

  /** `brand.json` in the folder, logos in `brand-assets/`. */
  async loadBrand(): Promise<BrandData | null> {
    let json: string;
    try {
      json = await (await (await this.dir.getFileHandle('brand.json')).getFile()).text();
    } catch {
      return null;
    }
    const kit = parseBrand(JSON.parse(json));
    const assets = new Map<string, Uint8Array>();
    const dir = await this.dir.getDirectoryHandle('brand-assets').catch(() => null);
    if (dir) for (const l of kit.logos) {
      try { assets.set(l.asset, new Uint8Array(await (await (await dir.getFileHandle(l.asset)).getFile()).arrayBuffer())); } catch { /* missing logo */ }
    }
    return { kit, assets };
  }

  async saveBrand(data: BrandData): Promise<void> {
    const used = usedBrandAssets(data);
    if (used.size) {
      const dir = await this.dir.getDirectoryHandle('brand-assets', { create: true });
      for (const [id, bytes] of used) {
        const w = await (await dir.getFileHandle(id, { create: true })).createWritable();
        await w.write(bytes as BufferSource);
        await w.close();
      }
    }
    const w = await (await this.dir.getFileHandle('brand.json', { create: true })).createWritable();
    await w.write(brandJson(data.kit));
    await w.close();
  }
}
