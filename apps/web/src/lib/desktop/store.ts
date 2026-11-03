import { pack, unpack, type BrandData, type LibraryAsset, type ProjectFile, type ProjectMeta, type ProjectStore } from '@digital-canvas/storage';
import { brandJson, libraryJson, parseBrand, readLibrary, usedBrandAssets } from '@digital-canvas/storage';
import type { PluginLibrary } from '@digital-canvas/scene';
import { desktop } from './desktop.svelte.ts';

interface FolderAsset { id: string; mime: string; name?: string; size?: number; createdTime?: string; width?: number; height?: number; duration?: number }

/**
 * Designs in the chosen folder, through the app's local process: the very same
 * `NodeFolderStore` / `FolderWorkspace` the MCP server works on, so the app and
 * an agent see the same files live.
 */
export class DesktopStore implements ProjectStore {
  readonly kind = 'folder';
  constructor(readonly path: string) {}

  /** The folder's name, as the browser's folder store shows it. */
  get label(): string { return this.path.split(/[\\/]/).filter(Boolean).pop() ?? this.path; }

  list(): Promise<ProjectMeta[]> { return desktop.call('store.list'); }
  async open(id: string): Promise<ProjectFile> { return unpack(await desktop.call<Uint8Array>('store.read', { id })); }
  async save(file: ProjectFile): Promise<void> { await desktop.call('store.save', { bytes: pack(file) }); }
  async remove(id: string): Promise<void> { await desktop.call('store.remove', { id }); }
  async restore(id: string): Promise<void> { await desktop.call('store.restore', { id }); }

  async loadBrand(): Promise<BrandData | null> {
    const b = await desktop.call<{ json: string; assets: [string, Uint8Array][] } | null>('store.loadBrand');
    return b ? { kit: parseBrand(JSON.parse(b.json)), assets: new Map(b.assets) } : null;
  }
  async saveBrand(data: BrandData): Promise<void> {
    await desktop.call('store.saveBrand', { json: brandJson(data.kit), assets: [...usedBrandAssets(data)] });
  }

  // Plugins: plugins.json and plugin-assets/ in the folder (NodeFolderStore), over IPC like the brand kit.
  async loadPlugins(): Promise<PluginLibrary> {
    return readLibrary(await desktop.call<string>('store.loadPlugins'));
  }
  async savePlugins(lib: PluginLibrary, assets = new Map<string, Uint8Array>()): Promise<void> {
    await desktop.call('store.savePlugins', { json: libraryJson(lib), assets: [...assets] });
  }
  async pluginAsset(id: string): Promise<Uint8Array | null> {
    return (await desktop.call<Uint8Array | null>('store.pluginAsset', { id })) ?? null;
  }

  // The uploads library, with the same shape as DriveStore's.
  async listAssets(_fresh = false): Promise<LibraryAsset[]> {
    return (await desktop.call<FolderAsset[]>('store.listAssets')).map((a) => ({ ...a, fileId: '' }));
  }
  getAsset(id: string): Promise<Uint8Array | undefined> { return desktop.call('store.getAsset', { id }); }
  async addAsset(_id: string, bytes: Uint8Array, mime: string, label?: string): Promise<void> {
    await desktop.call('store.addAsset', { bytes, mime, name: label });
  }
  async hideAsset(id: string): Promise<void> { await desktop.call('store.hideAsset', { id }); }
}
