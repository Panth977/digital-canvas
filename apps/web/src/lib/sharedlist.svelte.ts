/**
 * Home › "Shared with you": designs from other people's Drives (and files opened
 * from Drive) that this browser has opened. With the drive.file scope the app
 * cannot list "Shared with me" itself, so the list is what this browser has
 * seen, per signed-in account, plus "Open a shared design" (Google Picker).
 * localStorage `dc.sharedList`.
 */
import type { KnownFileInfo } from '@digital-canvas/storage';

export interface SharedEntry extends KnownFileInfo {
  docId: string;
  fileId: string;
  /** Account (uid) that opened it. */
  uid: string;
  openedAt: string;
}

const KEY = 'dc.sharedList';

function load(): SharedEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as SharedEntry[];
    return Array.isArray(v) ? v.filter((e) => e && typeof e.fileId === 'string') : [];
  } catch {
    return [];
  }
}

class SharedList {
  all = $state<SharedEntry[]>(typeof localStorage === 'undefined' ? [] : load());

  /** Newest first, for one account. */
  of(uid: string | undefined): SharedEntry[] {
    if (!uid) return [];
    return this.all.filter((e) => e.uid === uid).sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  }

  add(e: SharedEntry): void {
    this.all = [e, ...this.all.filter((x) => !(x.uid === e.uid && x.fileId === e.fileId))].slice(0, 200);
    this.persist();
  }

  remove(uid: string, fileId: string): void {
    this.all = this.all.filter((x) => !(x.uid === uid && x.fileId === fileId));
    this.persist();
  }

  private persist(): void {
    try { localStorage.setItem(KEY, JSON.stringify(this.all)); } catch { /* storage blocked */ }
  }
}

export const sharedList = new SharedList();
