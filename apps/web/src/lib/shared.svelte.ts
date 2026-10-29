/**
 * Designs shared with you: what you may do with them (view only or edit),
 * "Make a copy", and opening a share link (`/d/<fileId>`, `/template/<fileId>`).
 */
import { newId, type Doc } from '@digital-canvas/scene';
import { DriveError, type DriveStore, type ProjectStore } from '@digital-canvas/storage';
import type { EditorState } from './editor.svelte.ts';
import { copyTitle } from './designs.ts';
import { router } from './router.svelte.ts';
import { toast } from './toast.svelte.ts';

const isDrive = (s: ProjectStore): s is DriveStore => s.kind === 'drive';

/** Look up owner and role (Drive): no edit right → the editor is view only. */
export async function loadAccess(ed: EditorState): Promise<void> {
  if (!isDrive(ed.store)) return;
  const a = await ed.store.access(ed.doc.id).catch(() => null);
  ed.access = a;
  ed.readOnly = !!a && !a.canEdit;
}

/** Save an editor's design as a new design of your own (all its assets copied into your Drive). */
export async function copyInto(store: ProjectStore, file: { doc: Doc; assets: Map<string, Uint8Array>; thumbnail?: Uint8Array }, title = copyTitle(file.doc.title)): Promise<Doc> {
  const now = new Date().toISOString();
  const doc: Doc = { ...file.doc, id: newId('d_'), title, createdAt: now, updatedAt: now };
  await store.save({ doc, assets: file.assets, thumbnail: file.thumbnail });
  return doc;
}

/** View only ▸ Make a copy: your own editable copy, opened. */
export async function makeOwnCopy(ed: EditorState, store: ProjectStore = ed.store): Promise<void> {
  try {
    toast.show('Making a copy…');
    const doc = await copyInto(store, { doc: ed.doc, assets: ed.assets, thumbnail: ed.thumbnail() });
    toast.show(`Made “${doc.title}”`);
    router.go({ name: 'editor', id: doc.id });
  } catch (e) {
    toast.show(`Couldn't make a copy: ${e instanceof Error ? e.message : e}`);
  }
}

/** Drive won't show this file to the app yet (drive.file: never opened with it). */
export const needsGrant = (e: unknown) => e instanceof DriveError && (e.status === 404 || e.status === 403);
