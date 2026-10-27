/**
 * Projects panel data: the images and videos in all your designs. In Drive
 * they are listed straight from `Digital Canvas/assets` (thumbnails from
 * Drive, bytes on demand); elsewhere we look inside recent designs.
 */
import { DriveStore, type ProjectMeta, type ProjectStore } from '@digital-canvas/storage';
import type { EditorState } from './editor.svelte.ts';

export interface MediaItem {
  id: string;
  mime: string;
  name: string;
  /** Design it came from (local stores). */
  from?: string;
  thumbUrl?: string;
  bytes?: Uint8Array;
  /** A still of a video (local stores). */
  poster?: Uint8Array;
  /** Fetch the bytes (Drive). */
  load?: () => Promise<Uint8Array | undefined>;
}

const MAX_DESIGNS = 40;

export async function listMedia(store: ProjectStore, designs: ProjectMeta[], kind: 'image' | 'video'): Promise<MediaItem[]> {
  if (store instanceof DriveStore) {
    const all = await store.listAssets();
    return all.filter((a) => a.mime.startsWith(`${kind}/`) && !a.id.endsWith('.poster')).map((a) => ({ id: a.id, mime: a.mime, name: a.name ?? a.id, thumbUrl: a.thumbnailLink, load: () => store.readAsset(a.id) }));
  }
  const seen = new Map<string, MediaItem>();
  for (const d of designs.slice(0, MAX_DESIGNS)) {
    try {
      const f = await store.open(d.id);
      for (const [id, meta] of Object.entries(f.doc.assets)) {
        if (!meta.mime.startsWith(`${kind}/`) || id.endsWith('.poster') || seen.has(id)) continue;
        const bytes = f.assets.get(id);
        if (bytes) seen.set(id, { id, mime: meta.mime, name: meta.name ?? id, from: d.title, bytes, ...(kind === 'video' ? { poster: f.assets.get(`${id}.poster`) } : {}) });
      }
    } catch { /* unreadable design: skip */ }
  }
  return [...seen.values()];
}

export async function bytesOf(item: MediaItem): Promise<Uint8Array | undefined> {
  item.bytes ??= await item.load?.();
  return item.bytes;
}

/**
 * Make an image usable by the open design right away (synchronously, for drag
 * and drop): bytes go into the editor and the doc lists the asset. Needs the
 * content-hash id, which every stored asset already has.
 */
export function registerImage(ed: EditorState, item: MediaItem): boolean {
  if (!item.bytes) return false;
  if (!ed.doc.assets[item.id]) {
    const size = ed.renderer.setImage(item.id, item.bytes);
    if (!size) return false;
    ed.assets.set(item.id, item.bytes);
    ed.commit({ ...ed.doc, assets: { ...ed.doc.assets, [item.id]: { mime: item.mime, ...size, name: item.name } } });
  }
  return true;
}

export async function addMedia(ed: EditorState, item: MediaItem): Promise<boolean> {
  const bytes = await bytesOf(item);
  if (!bytes) return false;
  if (item.mime.startsWith('image/')) {
    if (!registerImage(ed, item)) return false;
    ed.addImageAsset(item.id);
    return true;
  }
  return ed.addMediaFile(new File([bytes as BlobPart], item.name || 'video', { type: item.mime }));
}
