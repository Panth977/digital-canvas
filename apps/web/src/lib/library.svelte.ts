import { BrowserStore, DriveStore, FolderStore, browserAssetCache, type ProjectStore } from '@digital-canvas/storage';
import { account } from './account.svelte.ts';
import { driveApiKey, knownFiles, setSharedUser } from './sharing.ts';

/**
 * Which store the app saves to. Signed in: your Google Drive. Signed out:
 * the remembered folder on this computer if you picked one, else this browser.
 */
class Library {
  private local = $state<ProjectStore>(new BrowserStore());
  private drive: { uid: string; store: DriveStore } | null = null;
  /** A remembered folder that needs a click before we may read it. */
  pendingFolder = $state<FolderStore | null>(null);
  private folderChecked = $state(false);

  get ready(): boolean {
    return this.folderChecked && account.known;
  }

  get store(): ProjectStore {
    const u = account.user;
    if (u) {
      setSharedUser(u.uid);
      if (this.drive?.uid !== u.uid) this.drive = { uid: u.uid, store: new DriveStore(account.driveToken, 'Digital Canvas', browserAssetCache(), { apiKey: driveApiKey(), known: knownFiles }) };
      return this.drive.store;
    }
    return this.local;
  }

  /** The local store, for importing designs into Drive. */
  get localStore(): ProjectStore {
    return this.local;
  }

  async init(): Promise<void> {
    const remembered = await FolderStore.remembered().catch(() => null);
    if (remembered) {
      if (remembered.needsPermission) this.pendingFolder = remembered.store;
      else this.local = remembered.store;
    }
    this.folderChecked = true;
  }

  get folderSupported(): boolean {
    return FolderStore.supported();
  }

  async pickFolder(): Promise<void> {
    this.local = await FolderStore.pick();
    this.pendingFolder = null;
  }

  async reconnectFolder(): Promise<void> {
    const f = this.pendingFolder;
    if (f && (await f.grant())) {
      this.local = f;
      this.pendingFolder = null;
    }
  }

  async useBrowser(): Promise<void> {
    await FolderStore.forget();
    this.pendingFolder = null;
    this.local = new BrowserStore();
  }

  /** Copy a design from this computer into Drive (keeps the same id). */
  async copyToDrive(id: string): Promise<void> {
    if (!account.user) return;
    const file = await this.local.open(id);
    await this.store.save(file);
  }
}

export const library = new Library();
if (import.meta.env.DEV) (window as unknown as { __library?: Library }).__library = library;
