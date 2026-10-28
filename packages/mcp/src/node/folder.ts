/**
 * A folder on this computer as the workspace (Node only): designs as
 * `.dcanvas` files, `assets/` for uploads, `Exports/` and `.trash/`.
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  EXTENSION, assetId, brandJson, byRecent, fileName, pack, parseBrand, peek, unpack, usedBrandAssets,
  type BrandData, type ProjectFile, type ProjectMeta, type ProjectStore,
} from '@digital-canvas/storage';
import type { AssetInfo, ExportResult, Workspace } from '../workspace.ts';

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

  async save(file: ProjectFile): Promise<void> {
    const old = this.nameOf(file.doc.id);
    let name = fileName(file.doc.title);
    if (name !== old) {
      const base = name.slice(0, -EXTENSION.length);
      for (let i = 2; existsSync(join(this.dir, name)); i++) name = `${base} (${i})${EXTENSION}`;
    }
    writeFileSync(join(this.dir, name), pack(file));
    if (old && old !== name) rmSync(join(this.dir, old), { force: true });
  }

  /** Into `.trash/` (like Drive's bin). */
  async remove(id: string): Promise<void> {
    const name = this.nameOf(id);
    if (!name) return;
    mkdirSync(join(this.dir, '.trash'), { recursive: true });
    renameSync(join(this.dir, name), join(this.dir, '.trash', name));
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
}

export class FolderWorkspace implements Workspace {
  readonly kind = 'folder';
  readonly store: NodeFolderStore;
  constructor(readonly dir: string) { this.store = new NodeFolderStore(dir); }
  get label() { return `folder ${this.dir}`; }

  private get assetsDir() { return join(this.dir, 'assets'); }
  private index(): Record<string, Omit<AssetInfo, 'id'>> {
    const p = join(this.assetsDir, 'index.json');
    try { return JSON.parse(readFileSync(p, 'utf8')) as Record<string, Omit<AssetInfo, 'id'>>; } catch { return {}; }
  }

  async listAssets(): Promise<AssetInfo[]> {
    const idx = this.index();
    return Object.entries(idx).filter(([id]) => existsSync(join(this.assetsDir, id)))
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
    idx[id] = { ...idx[id], ...extra, mime, ...(name ? { name } : {}), size: bytes.length, createdTime: idx[id]?.createdTime ?? new Date().toISOString() };
    writeFileSync(join(this.assetsDir, 'index.json'), JSON.stringify(idx, null, 1));
    return { id, ...idx[id]! };
  }

  /** Remember sizes/durations we measured (shown by list_assets). */
  async describeAsset(id: string, extra: Partial<AssetInfo>): Promise<void> {
    const idx = this.index();
    if (!idx[id]) return;
    idx[id] = { ...idx[id]!, ...extra };
    writeFileSync(join(this.assetsDir, 'index.json'), JSON.stringify(idx, null, 1));
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
