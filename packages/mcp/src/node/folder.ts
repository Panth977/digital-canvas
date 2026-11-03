/**
 * A folder on this computer as the workspace (Node only): designs as
 * `.dcanvas` files, `assets/` for uploads, `Exports/` and `.trash/`.
 */
import type { PluginLibrary } from '@digital-canvas/scene';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  EXTENSION, assetId, brandJson, libraryJson, readLibrary, byRecent, fileName, pack, parseBrand, peek, unpack, usedBrandAssets,
  type BrandData, type ProjectFile, type ProjectMeta, type ProjectStore,
} from '@digital-canvas/storage';
import type { AssetInfo, ExportResult, Workspace } from '../workspace.ts';

/**
 * Write through a temp name, then rename: the desktop app and an MCP server can
 * share one folder, and neither may ever read a half-written design.
 */
function writeAtomic(path: string, bytes: Uint8Array): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, bytes);
  try {
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/**
 * Designs as `.dcanvas` files in a folder (same layout as the web app's
 * "folder" store), plus `assets/` for uploads, `Exports/` and `.trash/`.
 */
export class NodeFolderStore implements ProjectStore {
  readonly kind = 'folder';
  constructor(readonly dir: string) { mkdirSync(dir, { recursive: true }); }
  get label() { return this.dir; }

  private entries(): { name: string; meta: ProjectMeta }[] {
    const out: { name: string; meta: ProjectMeta }[] = [];
    for (const name of readdirSync(this.dir)) {
      if (!name.endsWith(EXTENSION)) continue;
      try {
        const bytes = new Uint8Array(readFileSync(join(this.dir, name)));
        const { doc, thumbnail } = peek(bytes);
        out.push({ name, meta: { id: doc.id, title: doc.title, updatedAt: doc.updatedAt, width: doc.width, height: doc.height, ...(thumbnail ? { thumbnail } : {}) } });
      } catch { /* not ours */ }
    }
    return out;
  }

  private nameOf(id: string): string | undefined {
    return this.entries().find((e) => e.meta.id === id)?.name;
  }

  async list() { return this.entries().map((e) => e.meta).sort(byRecent); }

  async open(id: string): Promise<ProjectFile> {
    const name = this.nameOf(id);
    if (!name) throw new Error(`no design with id "${id}" (call list_designs for ids)`);
    return unpack(new Uint8Array(readFileSync(join(this.dir, name))));
  }

  /** The file as it is on disk (the desktop app sends it to its window unopened). */
  readBytes(id: string): Uint8Array {
    const name = this.nameOf(id);
    if (!name) throw new Error(`no design with id "${id}" (call list_designs for ids)`);
    return new Uint8Array(readFileSync(join(this.dir, name)));
  }

  async save(file: ProjectFile): Promise<void> {
    this.saveBytes(file.doc.id, file.doc.title, pack(file));
  }

  /** Save an already packed `.dcanvas`. */
  saveBytes(id: string, title: string, bytes: Uint8Array): void {
    const old = this.nameOf(id);
    let name = fileName(title);
    if (name !== old) {
      const base = name.slice(0, -EXTENSION.length);
      for (let i = 2; existsSync(join(this.dir, name)); i++) name = `${base} (${i})${EXTENSION}`;
    }
    writeAtomic(join(this.dir, name), bytes);
    if (old && old !== name) rmSync(join(this.dir, old), { force: true });
  }

  /** Into `.trash/` (like Drive's bin). */
  async remove(id: string): Promise<void> {
    const name = this.nameOf(id);
    if (!name) return;
    mkdirSync(join(this.dir, '.trash'), { recursive: true });
    renameSync(join(this.dir, name), join(this.dir, '.trash', name));
  }

  /** Back out of `.trash/`, under a free name. */
  async restore(id: string): Promise<void> {
    const bin = join(this.dir, '.trash');
    if (!existsSync(bin)) return;
    for (const name of readdirSync(bin)) {
      if (!name.endsWith(EXTENSION)) continue;
      const from = join(bin, name);
      try {
        if (peek(new Uint8Array(readFileSync(from))).doc.id !== id) continue;
      } catch { continue; }
      const base = name.slice(0, -EXTENSION.length);
      let to = name;
      for (let i = 2; existsSync(join(this.dir, to)); i++) to = `${base} (${i})${EXTENSION}`;
      renameSync(from, join(this.dir, to));
      return;
    }
  }

  async loadBrand(): Promise<BrandData | null> {
    const p = join(this.dir, 'brand.json');
    if (!existsSync(p)) return null;
    const kit = parseBrand(JSON.parse(readFileSync(p, 'utf8')));
    const assets = new Map<string, Uint8Array>();
    for (const l of kit.logos) {
      const f = join(this.dir, 'brand-assets', l.asset);
      if (existsSync(f)) assets.set(l.asset, new Uint8Array(readFileSync(f)));
    }
    return { kit, assets };
  }

  async saveBrand(data: BrandData): Promise<void> {
    const used = usedBrandAssets(data);
    if (used.size) mkdirSync(join(this.dir, 'brand-assets'), { recursive: true });
    for (const [id, b] of used) writeFileSync(join(this.dir, 'brand-assets', id), b);
    writeFileSync(join(this.dir, 'brand.json'), brandJson(data.kit));
  }

  /** `plugins.json` in the folder, files in `plugin-assets/`. */
  async loadPlugins(): Promise<PluginLibrary> {
    const p = join(this.dir, 'plugins.json');
    return readLibrary(existsSync(p) ? readFileSync(p, 'utf8') : null);
  }

  async savePlugins(lib: PluginLibrary, assets = new Map<string, Uint8Array>()): Promise<void> {
    if (assets.size) mkdirSync(join(this.dir, 'plugin-assets'), { recursive: true });
    for (const [id, b] of assets) writeFileSync(join(this.dir, 'plugin-assets', id.replace(/[\\/]/g, '_')), b);
    writeFileSync(join(this.dir, 'plugins.json'), libraryJson(lib));
  }

  async pluginAsset(id: string): Promise<Uint8Array | null> {
    const f = join(this.dir, 'plugin-assets', id.replace(/[\\/]/g, '_'));
    return existsSync(f) ? new Uint8Array(readFileSync(f)) : null;
  }
}

export class FolderWorkspace implements Workspace {
  readonly kind = 'folder';
  readonly store: NodeFolderStore;
  constructor(readonly dir: string) { this.store = new NodeFolderStore(dir); }
  get label() { return `folder ${this.dir}`; }

  private get assetsDir() { return join(this.dir, 'assets'); }
  private index(): Record<string, Omit<AssetInfo, 'id'> & { hidden?: boolean }> {
    const p = join(this.assetsDir, 'index.json');
    try { return JSON.parse(readFileSync(p, 'utf8')) as Record<string, Omit<AssetInfo, 'id'> & { hidden?: boolean }>; } catch { return {}; }
  }
  private writeIndex(idx: ReturnType<FolderWorkspace['index']>): void {
    writeAtomic(join(this.assetsDir, 'index.json'), Buffer.from(JSON.stringify(idx, null, 1)));
  }

  async listAssets(): Promise<AssetInfo[]> {
    const idx = this.index();
    return Object.entries(idx).filter(([id, m]) => !m.hidden && existsSync(join(this.assetsDir, id)))
      .map(([id, m]) => ({ id, ...m })).sort((a, b) => (b.createdTime ?? '').localeCompare(a.createdTime ?? ''));
  }

  async getAsset(id: string) {
    if (!/^[\w.-]+$/.test(id)) return undefined;
    const p = join(this.assetsDir, id);
    return existsSync(p) ? new Uint8Array(readFileSync(p)) : undefined;
  }

  async putAsset(bytes: Uint8Array, mime: string, name?: string, extra: Partial<AssetInfo> = {}): Promise<AssetInfo> {
    const id = await assetId(bytes, mime);
    mkdirSync(this.assetsDir, { recursive: true });
    const p = join(this.assetsDir, id);
    if (!existsSync(p)) writeFileSync(p, bytes);
    const idx = this.index();
    const { hidden: _shown, ...was } = idx[id] ?? ({} as Partial<NonNullable<typeof idx[string]>>);
    idx[id] = { ...was, ...extra, mime, ...(name ? { name } : {}), size: bytes.length, createdTime: was.createdTime ?? new Date().toISOString() };
    this.writeIndex(idx);
    return { id, ...idx[id]! };
  }

  /** Remember sizes/durations we measured (shown by list_assets). */
  async describeAsset(id: string, extra: Partial<AssetInfo>): Promise<void> {
    const idx = this.index();
    if (!idx[id]) return;
    idx[id] = { ...idx[id]!, ...extra };
    this.writeIndex(idx);
  }

  /** Off the uploads list; the file stays, since designs may still use it. */
  async hideAsset(id: string): Promise<void> {
    const idx = this.index();
    if (!idx[id]) return;
    idx[id] = { ...idx[id]!, hidden: true };
    this.writeIndex(idx);
  }

  async saveExport(name: string, bytes: Uint8Array, mime: string): Promise<ExportResult> {
    const dir = join(this.dir, 'Exports');
    mkdirSync(dir, { recursive: true });
    let file = name;
    const dot = name.lastIndexOf('.');
    for (let i = 2; existsSync(join(dir, file)); i++) file = `${name.slice(0, dot)} (${i})${name.slice(dot)}`;
    const path = join(dir, file);
    writeFileSync(path, bytes);
    return { name: file, mime, size: statSync(path).size, path, link: `file://${path}` };
  }
}
