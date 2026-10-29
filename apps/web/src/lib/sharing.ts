/**
 * App-side settings for sharing: the API key that reads link-shared files,
 * where share links point, and the designs shared with you that this browser
 * has opened (so `#/d/<docId>` finds their Drive file again after a reload).
 */
import { DRIVE_API_KEY } from '@digital-canvas/backend/google';
import { SHARE_ORIGIN, type KnownFiles } from '@digital-canvas/storage';
import { sharedList } from './sharedlist.svelte.ts';

/** `files.get?alt=media&key=` for files shared "anyone with the link". */
export function driveApiKey(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  return env.VITE_DRIVE_API_KEY || env.VITE_PICKER_API_KEY || DRIVE_API_KEY;
}

/** Share links always point at the public app (also from a dev server), unless VITE_SHARE_ORIGIN says otherwise. */
export function shareOrigin(): string {
  return (import.meta.env as Record<string, string | undefined>).VITE_SHARE_ORIGIN || SHARE_ORIGIN;
}

const KEY = 'dc.sharedFiles';

/** The signed-in account (set by the library when it makes the Drive store). */
let currentUid = '';
export function setSharedUser(uid: string): void {
  currentUid = uid;
}

/** doc id → Drive file id of designs that live in someone else's Drive (localStorage). */
export const knownFiles: KnownFiles = {
  get(docId) {
    try { return (JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>)[docId]; } catch { return undefined; }
  },
  set(docId, fileId, info) {
    if (info && currentUid) sharedList.add({ ...info, docId, fileId, uid: currentUid, openedAt: new Date().toISOString() });
    try {
      const all = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>;
      if (all[docId] === fileId) return;
      all[docId] = fileId;
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch { /* storage blocked: the link still opens it */ }
  },
};
