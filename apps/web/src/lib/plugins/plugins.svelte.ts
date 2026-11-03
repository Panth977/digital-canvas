/**
 * The user's plugins in the editor: the library of the current store (Drive:
 * `Digital Canvas/plugins.json` + files in `assets/`; signed out: this browser
 * or the chosen folder; desktop: the folder over IPC), saved back on every
 * change. Plugin files (font faces, mockup photos) are read on demand.
 */
import {
  assetId, isPluginStore, packPlugin, pluginFileName, pluginLink, sharePluginFile, unpackPlugin,
  DriveStore, type ProjectStore,
} from '@digital-canvas/storage';
import {
  emptyLibrary, newPluginId, removePlugin, upsertPlugin,
  type FontPlugin, type MockupPlugin, type Plugin, type PluginKind, type PluginLibrary,
} from '@digital-canvas/scene';
import type { MockupEntry } from '@digital-canvas/render/mockup';
import { untrack } from 'svelte';
import { account } from '../account.svelte.ts';
import { library } from '../library.svelte.ts';
import { shareOrigin } from '../sharing.ts';
import { addCssFace, type FontFile } from '../fonts.ts';
import type { EditorState } from '../editor.svelte.ts';
import { copyName } from './pluginutil.ts';
import { fontMime, toSfnt } from './render-bridge.ts';
import { quadAspect } from './quad-bridge.ts';
import { mockupClient, userThumbs } from '../mockups/mockups.svelte.ts';

class Plugins {
  lib = $state.raw<PluginLibrary>(emptyLibrary());
  status = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  error = $state('');
  saving = $state(false);
  /** The creator open in the Plugins panel (another panel can ask for one). */
  editing = $state<{ kind: PluginKind; id?: string } | null>(null);
  /** Goes up on every change (previews, mockup tiles). */
  version = $state(0);
  private loadedFrom: ProjectStore | null = null;
  /** Plugin file bytes by asset id (read once). */
  private files = new Map<string, Uint8Array>();

  get list(): Plugin[] { return this.lib.plugins; }

  of<K extends PluginKind>(kind: K): Extract<Plugin, { kind: K }>[] {
    return this.lib.plugins.filter((p): p is Extract<Plugin, { kind: K }> => p.kind === kind);
  }

  get(id: string): Plugin | undefined { return this.lib.plugins.find((p) => p.id === id); }

  /** Where plugins can be kept right now. */
  get supported(): boolean { return isPluginStore(library.store); }

  /** Load the library of the current store (once per store). */
  async load(store: ProjectStore = library.store, force = false): Promise<void> {
    if (!force && this.loadedFrom === store && untrack(() => this.status) !== 'error') return;
    this.loadedFrom = store;
    this.status = 'loading';
    this.error = '';
    try {
      const lib = isPluginStore(store) ? await store.loadPlugins() : emptyLibrary();
      if (this.loadedFrom !== store) return;
      this.lib = lib;
      this.status = 'ready';
      this.version++;
    } catch (e) {
      this.status = 'error';
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  private get store(): ProjectStore { return this.loadedFrom ?? library.store; }

  private async persist(lib: PluginLibrary, assets?: Map<string, Uint8Array>): Promise<void> {
    const store = this.store;
    this.lib = lib;
    this.version++;
    if (assets) for (const [k, v] of assets) this.files.set(k, v);
    if (!isPluginStore(store)) return;
    this.saving = true;
    try {
      await store.savePlugins(lib, assets);
      this.error = '';
    } catch (e) {
      this.error = `Couldn't save your plugins: ${e instanceof Error ? e.message : e}`;
      throw e;
    } finally {
      this.saving = false;
    }
  }

  /** Bytes of one plugin file, or null. */
  async asset(id: string): Promise<Uint8Array | null> {
    const hit = this.files.get(id);
    if (hit) return hit;
    const store = this.store;
    const b = isPluginStore(store) ? await store.pluginAsset(id).catch(() => null) : null;
    if (b) this.files.set(id, b);
    return b;
  }

  /** Keep file bytes for a plugin being made (saved with it). Returns the asset id. */
  async addFile(bytes: Uint8Array, mime: string): Promise<string> {
    const id = await assetId(bytes, mime);
    this.files.set(id, bytes);
    return id;
  }

  /** Add or update a plugin; `assets` = files it may need that the store doesn't have yet. */
  async save(p: Plugin, assets?: Map<string, Uint8Array>): Promise<Plugin> {
    const files = assets ?? new Map<string, Uint8Array>();
    // files added with addFile travel with the plugin that uses them
    for (const id of fileIds(p)) { const b = this.files.get(id); if (b && !files.has(id)) files.set(id, b); }
    await this.persist(upsertPlugin(this.lib, p), files);
    return this.get(p.id)!;
  }

  async remove(id: string): Promise<void> {
    await this.persist(removePlugin(this.lib, id));
  }

  async duplicate(id: string): Promise<Plugin | null> {
    const p = this.get(id);
    if (!p) return null;
    const now = new Date().toISOString();
    const copy = { ...structuredClone(p), id: newPluginId(), name: copyName(p.name, this.list.map((x) => x.name)), createdAt: now, updatedAt: now } as Plugin;
    return this.save(copy);
  }

  /** `.dcplugin` bytes of one plugin. */
  async pack(id: string): Promise<Uint8Array> {
    const p = this.get(id);
    if (!p) throw new Error('no such plugin');
    return packPlugin(p, (a) => this.asset(a));
  }

  /** Install a `.dcplugin` (or plugin JSON). The same plugin again replaces the installed one. */
  async install(bytes: Uint8Array): Promise<Plugin> {
    const { plugin, assets } = unpackPlugin(bytes);
    return this.save(plugin, assets);
  }

  /** Install a plugin that was already read (the /plugin/<id> screen). */
  installRead(plugin: Plugin, assets: Map<string, Uint8Array>): Promise<Plugin> {
    return this.save(plugin, assets);
  }

  /** Share by link: Drive only. Returns the `/plugin/<fileId>` link. */
  async share(id: string): Promise<string> {
    const store = this.store;
    if (!(store instanceof DriveStore) || !account.user) throw new Error('Sign in with Google to share plugins by link.');
    const p = this.get(id);
    if (!p) throw new Error('no such plugin');
    const bytes = await this.pack(id);
    const fileId = await sharePluginFile(account.driveToken, await store.folder(), p, bytes);
    return pluginLink(fileId, shareOrigin());
  }

  fileName(id: string): string { return pluginFileName(this.get(id) ?? { name: 'Plugin' }); }

  // ---- fonts ----

  private cssFaces = new Set<string>();

  /** Font faces of a font plugin, as files the editor can embed (WOFF made plain). */
  async fontFiles(p: FontPlugin): Promise<FontFile[]> {
    const out: FontFile[] = [];
    for (const f of p.faces) {
      const raw = await this.asset(f.asset);
      if (!raw) continue;
      const bytes = toSfnt(raw);
      out.push({ family: p.family, bytes, mime: fontMime(bytes) ?? f.mime, weight: f.weight, italic: f.italic, source: `plugin:${p.id}` });
    }
    return out;
  }

  /** Make the family available to CSS (font list previews). */
  async previewFont(p: FontPlugin): Promise<void> {
    if (this.cssFaces.has(p.id)) return;
    this.cssFaces.add(p.id);
    for (const f of await this.fontFiles(p).catch(() => [])) addCssFace(p.family, `plugin:${p.id}:${f.weight}:${f.italic}`, f.bytes, f.weight, f.italic);
  }

  /** Use a font plugin on the selected text: its faces are embedded in the design. */
  async useFont(ed: EditorState, p: FontPlugin): Promise<void> {
    const key = `font:${Date.now()}`;
    const files = await this.fontFiles(p);
    if (!files.length) throw new Error(`${p.name}: its font files are missing`);
    const have = new Set((ed.doc.fonts ?? []).map((f) => f.asset));
    const ids = await Promise.all(files.map((f) => assetId(f.bytes, f.mime)));
    const missing = files.filter((_, i) => !have.has(ids[i]!));
    if (missing.length) await ed.addFonts(missing, key);
    ed.updateTextStyle({ fontFamily: p.family }, key);
    ed.seal();
    ed.refitText();
  }

  // ---- mockups ----

  /** Mockup plugins as entries of the mockup library. */
  get mockupEntries(): MockupEntry[] {
    return this.of('mockup').map(mockupEntry);
  }

  private quadsSent = new Map<string, string>();

  /** Hand the compositor this mockup's photo and corners (again only when they changed). Resolves false when its files are missing. */
  async ensureMockup(p: MockupPlugin, id: string = p.id): Promise<boolean> {
    const key = JSON.stringify([p.photo, p.mask, p.corners, p.shade, p.width, p.height]);
    if (this.quadsSent.get(id) === key) return true;
    const [photo, mask] = await Promise.all([this.asset(p.photo), p.mask ? this.asset(p.mask) : Promise.resolve(null)]);
    if (!photo) return false;
    this.quadsSent.set(id, key);
    mockupClient.setQuad(id, { photo, mask, corners: p.corners, shade: p.shade, width: p.width, height: p.height });
    userThumbs.set(id, () => this.photoUrl(p));
    return true;
  }

  private thumbs = new Map<string, string>();

  /** An object URL of the plugin's photo ('' until read). */
  photoUrl(p: MockupPlugin): string {
    const hit = this.thumbs.get(p.photo);
    if (hit) return hit;
    const b = this.files.get(p.photo);
    if (!b) { void this.asset(p.photo).then((x) => { if (x) this.version++; }); return ''; }
    const url = URL.createObjectURL(new Blob([b as BlobPart], { type: mimeOfImage(b) }));
    this.thumbs.set(p.photo, url);
    return url;
  }
}

/** Asset ids a plugin uses. */
function fileIds(p: Plugin): string[] {
  if (p.kind === 'font') return p.faces.map((f) => f.asset);
  if (p.kind === 'mockup') return [p.photo, ...(p.mask ? [p.mask] : [])];
  return [];
}

export function mockupEntry(p: MockupPlugin): MockupEntry {
  return { id: p.id, label: p.name, category: p.category || 'My mockups', width: p.width, height: p.height, aspect: quadAspect(p.corners), credit: 'My mockup' };
}

/** Image mime from its signature. */
export function mimeOfImage(b: Uint8Array): string {
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57) return 'image/webp';
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
  return 'application/octet-stream';
}

export const plugins = new Plugins();
if (import.meta.env.DEV) (window as unknown as { __plugins?: Plugins }).__plugins = plugins;
