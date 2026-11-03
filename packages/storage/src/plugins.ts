/**
 * Where user plugins are kept (see scene/plugins.ts for the format).
 *
 * Every store keeps one `plugins.json` library next to `brand.json`; plugin
 * files (font faces, mockup photos) are assets: Drive keeps them in the shared
 * `Digital Canvas/assets/` folder, a local folder in `plugin-assets/`. They
 * are read on demand (`pluginAsset`), so listing plugins downloads nothing big.
 *
 * A single plugin travels as a `.dcplugin` file: a zip with `plugin.json` and
 * `assets/<id>` for each file it needs (`packPlugin` / `unpackPlugin`).
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { emptyLibrary, parseLibrary, parsePlugin, pluginAssets, type Plugin, type PluginLibrary } from '@digital-canvas/scene';

export const PLUGIN_EXT = '.dcplugin';
export const PLUGIN_MIME = 'application/vnd.digital-canvas.plugin+zip';

/** Stores that can keep plugins (every built-in store can). */
export interface PluginStore {
  loadPlugins(): Promise<PluginLibrary>;
  /** Save the library; `assets` holds bytes of files that may be new (others are already stored). */
  savePlugins(lib: PluginLibrary, assets?: Map<string, Uint8Array>): Promise<void>;
  /** Bytes of one plugin file (font face, mockup photo), or null. */
  pluginAsset(id: string): Promise<Uint8Array | null>;
}

export function isPluginStore(s: object): s is PluginStore {
  const p = s as Partial<PluginStore>;
  return typeof p.loadPlugins === 'function' && typeof p.savePlugins === 'function' && typeof p.pluginAsset === 'function';
}

export function libraryJson(lib: PluginLibrary): string {
  return JSON.stringify(lib, null, 2);
}

export function readLibrary(json: string | null | undefined): PluginLibrary {
  if (!json) return emptyLibrary();
  try { return parseLibrary(JSON.parse(json)); } catch { return emptyLibrary(); }
}

/** Every asset id the library needs. */
export function libraryAssets(lib: PluginLibrary): Set<string> {
  return new Set(lib.plugins.flatMap(pluginAssets));
}

/** One plugin and its files → `.dcplugin` bytes. */
export async function packPlugin(p: Plugin, asset: (id: string) => Promise<Uint8Array | null>): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = { 'plugin.json': strToU8(JSON.stringify(p, null, 2)) };
  for (const id of pluginAssets(p)) {
    const b = await asset(id);
    if (!b) throw new Error(`plugin file ${id} is missing`);
    files[`assets/${id}`] = b;
  }
  return zipSync(files, { level: 6 });
}

/** `.dcplugin` bytes → the plugin (checked) and its files. A plain plugin JSON is accepted too. */
export function unpackPlugin(bytes: Uint8Array): { plugin: Plugin; assets: Map<string, Uint8Array> } {
  if (bytes[0] === 0x7b /* { */) return { plugin: parsePlugin(JSON.parse(strFromU8(bytes))), assets: new Map() };
  const files = unzipSync(bytes);
  const json = files['plugin.json'];
  if (!json) throw new Error('not a .dcplugin file (no plugin.json)');
  const plugin = parsePlugin(JSON.parse(strFromU8(json)));
  const assets = new Map<string, Uint8Array>();
  for (const id of pluginAssets(plugin)) {
    const b = files[`assets/${id}`];
    if (!b) throw new Error(`the .dcplugin is missing ${id}`);
    assets.set(id, b);
  }
  return { plugin, assets };
}

/** Plugins kept in memory (tests, and stores without a place for them). */
export class MemoryPlugins implements PluginStore {
  private lib = emptyLibrary();
  private files = new Map<string, Uint8Array>();
  async loadPlugins(): Promise<PluginLibrary> { return structuredClone(this.lib); }
  async savePlugins(lib: PluginLibrary, assets = new Map<string, Uint8Array>()): Promise<void> {
    this.lib = structuredClone(lib);
    for (const [id, b] of assets) this.files.set(id, b);
    const keep = libraryAssets(lib);
    for (const id of [...this.files.keys()]) if (!keep.has(id)) this.files.delete(id);
  }
  async pluginAsset(id: string): Promise<Uint8Array | null> { return this.files.get(id) ?? null; }
}
