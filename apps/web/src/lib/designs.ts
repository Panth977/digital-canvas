/**
 * Whole-design actions shared by Home (card menu) and the editor's File menu:
 * make a copy, rename, move to trash, download as a .dcanvas file.
 */
import { newId, type Doc } from '@digital-canvas/scene';
import { EXTENSION, MIME, pack, type ProjectStore } from '@digital-canvas/storage';
import { download } from './files.ts';

/** Canva names a copy "Copy of <title>". */
export function copyTitle(title: string): string {
  return /^Copy of /.test(title) ? title : `Copy of ${title}`;
}

/** Save a copy of design `id` (new id, "Copy of …" title). Returns the new doc. */
export async function copyDesign(store: ProjectStore, id: string): Promise<Doc> {
  const file = await store.open(id);
  const now = new Date().toISOString();
  const doc: Doc = { ...file.doc, id: newId('d_'), title: copyTitle(file.doc.title), createdAt: now, updatedAt: now };
  await store.save({ ...file, doc });
  return doc;
}

export async function renameDesign(store: ProjectStore, id: string, title: string): Promise<void> {
  const t = title.trim();
  if (!t) return;
  const file = await store.open(id);
  await store.save({ ...file, doc: { ...file.doc, title: t, updatedAt: new Date().toISOString() } });
}

/** Drive moves the file to its trash; the other stores delete it. */
export function trashIsUndoable(store: ProjectStore): boolean {
  return store.kind === 'drive';
}

export async function downloadDesignFile(store: ProjectStore, id: string): Promise<void> {
  const file = await store.open(id);
  download(pack(file), `${file.doc.title}${EXTENSION}`, MIME);
}
