/**
 * Google Drive "Open with → Digital Canvas" and "New → Digital Canvas". Drive opens the app with
 * `?state={"ids":[…],"action":"open"}` (or `"action":"create","folderId":…`). The request is kept
 * across a sign-in redirect, then the file is opened (drive.file gives the app access to a file the
 * user opens with it) and the editor shows it.
 */
import { createDoc } from '@digital-canvas/scene';
import type { DriveStore } from '@digital-canvas/storage';
import { router } from './router.svelte.ts';

const KEY = 'dc.driveState';

export interface DriveRequest {
  action: 'open' | 'create';
  ids?: string[];
  folderId?: string;
}

function fromUrl(): DriveRequest | null {
  const raw = new URLSearchParams(location.search).get('state');
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as DriveRequest;
    return s.action === 'open' || s.action === 'create' ? s : null;
  } catch {
    return null;
  }
}

class OpenWith {
  /** A Drive request waiting for sign-in (or being handled). */
  pending = $state<DriveRequest | null>(null);
  error = $state('');
  busy = $state(false);

  constructor() {
    const s = fromUrl();
    if (s) {
      sessionStorage.setItem(KEY, JSON.stringify(s));
      history.replaceState(null, '', location.pathname + location.hash);
    }
    try {
      this.pending = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as DriveRequest | null;
    } catch {
      this.pending = null;
    }
  }

  /** Handle the pending request with the signed-in user's Drive. */
  async run(drive: DriveStore): Promise<void> {
    const req = this.pending;
    if (!req || this.busy) return;
    this.busy = true;
    this.error = '';
    try {
      if (req.action === 'open' && req.ids?.[0]) {
        const file = await drive.openFile(req.ids[0]);
        router.go({ name: 'editor', id: file.doc.id });
      } else {
        const doc = createDoc({ width: 1080, height: 1080, title: 'Untitled design' });
        await drive.save({ doc, assets: new Map() });
        router.go({ name: 'editor', id: doc.id });
      }
      sessionStorage.removeItem(KEY);
      this.pending = null;
    } catch (e) {
      this.error = `Couldn't open the file from Drive: ${e instanceof Error ? e.message : e}`;
      sessionStorage.removeItem(KEY);
      this.pending = null;
    } finally {
      this.busy = false;
    }
  }
}

export const openWith = new OpenWith();
