import { BrowserStore, FolderStore, type ProjectStore } from '@digital-canvas/storage';

/**
 * Which store the app saves to. Starts with the remembered folder if the
 * user picked one, else this browser. Google Drive joins in M2.
 */
class Library {
  store = $state<ProjectStore>(new BrowserStore());
  /** A remembered folder that needs a click before we may read it. */
  pendingFolder = $state<FolderStore | null>(null);
  ready = $state(false);

  async init(): Promise<void> {
    const remembered = await FolderStore.remembered().catch(() => null);
    if (remembered) {
      if (remembered.needsPermission) this.pendingFolder = remembered.store;
      else this.store = remembered.store;
    }
    this.ready = true;
  }

  get folderSupported(): boolean {
    return FolderStore.supported();
  }

  async pickFolder(): Promise<void> {
    this.store = await FolderStore.pick();
    this.pendingFolder = null;
  }

  async reconnectFolder(): Promise<void> {
    const f = this.pendingFolder;
    if (f && (await f.grant())) {
      this.store = f;
      this.pendingFolder = null;
    }
  }

  async useBrowser(): Promise<void> {
    await FolderStore.forget();
    this.pendingFolder = null;
    this.store = new BrowserStore();
  }
}

export const library = new Library();
