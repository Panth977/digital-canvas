/**
 * "Shared with you" from the backend's share inbox (backend/functions/src/shares.ts).
 * drive.file can't list Drive's "Shared with me", so:
 *  - the sharer's app calls syncShares after any change in the Share popover, and once in a
 *    while for all its shared designs (so shares made in Drive itself or older ones show up too);
 *  - the recipient's Home asks sharedWithMe and lists those designs on any device, before they
 *    were ever opened there. Opening one goes through `/d/<fileId>` (SharedOpen), which asks
 *    Google Drive to confirm the file once (Picker) if the app hasn't seen it yet.
 * Both calls send the Google access token, not a Firebase session, so the desktop app works too.
 */
import { syncShares, sharedWithMe } from './icebase.ts';

export interface InboxItem {
  fileId: string;
  docId?: string;
  title: string;
  role: string;
  ownerName?: string;
  ownerEmail?: string;
  sharedAt: string;
}

type Token = () => Promise<string>;
const CACHE = 'dc.shareInbox.';
const HIDDEN = 'dc.shareInboxHidden.';
const SYNCED = 'dc.shareSync.';
/** Re-sync all your shared designs at most this often per browser (a popover change syncs at once). */
const SYNC_EVERY = 6 * 3600_000;

const read = <T>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };

class ShareInbox {
  /** Inbox of the signed-in account (cached copy first, then the server's). */
  items = $state<InboxItem[]>([]);
  loading = $state(false);
  private uid = '';
  private hidden = new Set<string>();

  /** Fetch the list for this account (Home calls it when shown). */
  async load(uid: string, token: Token): Promise<void> {
    if (this.uid !== uid) {
      this.uid = uid;
      this.hidden = new Set(read<string[]>(HIDDEN + uid, []));
      this.items = read<InboxItem[]>(CACHE + uid, []).filter((i) => !this.hidden.has(i.fileId));
    }
    this.loading = true;
    try {
      const r = await sharedWithMe({ accessToken: await token() });
      if (this.uid !== uid) return;
      write(CACHE + uid, r.items);
      this.items = r.items.filter((i) => !this.hidden.has(i.fileId));
    } catch (e) {
      console.warn('Shared with you: list failed', e);
    } finally {
      this.loading = false;
    }
  }

  /** "Remove from this list" (it comes back if the owner shares it again with a new role). */
  hide(fileId: string): void {
    if (!this.uid) return;
    this.hidden.add(fileId);
    write(HIDDEN + this.uid, [...this.hidden]);
    this.items = this.items.filter((i) => i.fileId !== fileId);
  }

  /** After changing who can open these designs (Share popover): update the recipients' lists now. */
  async sync(fileIds: string[], token: Token): Promise<void> {
    if (!fileIds.length) return;
    try {
      for (let i = 0; i < fileIds.length; i += 50) await syncShares({ accessToken: await token(), fileIds: fileIds.slice(i, i + 50) });
    } catch (e) {
      console.warn('Shared with you: sync failed', e);
    }
  }

  /** Your shared designs, every few hours (covers sharing done in Drive itself, and older shares). */
  async syncOwn(uid: string, fileIds: string[], token: Token): Promise<void> {
    const key = SYNCED + uid;
    const last = read<{ at: number; ids: string }>(key, { at: 0, ids: '' });
    const ids = [...fileIds].sort().join(',');
    if (!ids || (ids === last.ids && Date.now() - last.at < SYNC_EVERY)) return;
    await this.sync(fileIds, token);
    write(key, { at: Date.now(), ids });
  }
}

export const shareInbox = new ShareInbox();
