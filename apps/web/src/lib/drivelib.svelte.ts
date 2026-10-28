import { DriveBrowser, DriveStore, assetId, fromDrive, notYetImported, type LibraryAsset, type MediaKind, type PickedFile } from '@digital-canvas/storage';
import { account } from './account.svelte.ts';
import { library } from './library.svelte.ts';
import { openPicker } from './picker.ts';

/** A picked Drive file on its way into Uploads. */
export interface Importing extends PickedFile {
  /** 0..1 */
  progress: number;
}

/**
 * State behind the Uploads panel, kept outside the component so switching
 * rail sections doesn't lose the listings or a running import.
 */
class DriveLibrary {
  tab = $state<'uploads' | 'drive'>('uploads');
  kind = $state<MediaKind>('all');

  // ---- Uploads tab ----
  uploads = $state.raw<LibraryAsset[]>([]);
  uploadsLoading = $state(false);
  uploadsError = $state('');
  private uploadsFor = '';

  // ---- Google Drive tab (Google Picker) ----
  picking = $state(false);
  importing = $state<Importing[]>([]);
  pickError = $state('');
  private browser: { uid: string; b: DriveBrowser } | null = null;

  /** The Drive-backed design store, when signed in. */
  get store(): DriveStore | null {
    const s = library.store;
    return s instanceof DriveStore ? s : null;
  }

  /** Downloads picked files (drive.file lets the app read exactly those). */
  private get drive(): DriveBrowser | null {
    const u = account.user;
    if (!u) return null;
    if (this.browser?.uid !== u.uid) this.browser = { uid: u.uid, b: new DriveBrowser(account.driveToken) };
    return this.browser.b;
  }

  /** "From Google Drive": files picked before (on any device), newest first. */
  get picked(): LibraryAsset[] {
    return fromDrive(this.uploads, this.kind);
  }

  setKind(k: MediaKind): void {
    this.kind = k;
  }

  /**
   * Open Google Picker; download each new pick (with progress) into
   * `Digital Canvas/assets`, once, marked with its Drive file id.
   * Returns the uploads for everything picked (already imported ones too).
   */
  async pick(opts: { phone?: boolean } = {}): Promise<LibraryAsset[]> {
    const store = this.store;
    const drive = this.drive;
    if (!store || !drive || this.picking) return [];
    this.pickError = '';
    this.picking = true;
    let files: PickedFile[] | null;
    try {
      files = await openPicker(await account.driveToken(), opts);
    } catch (e) {
      this.pickError = e instanceof Error ? e.message : String(e);
      return [];
    } finally {
      this.picking = false;
    }
    if (!files?.length) return [];
    await this.loadUploads();
    const todo = notYetImported(files, this.uploads);
    this.importing = [...todo.map((f) => ({ ...f, progress: 0 })), ...this.importing];
    const failed: string[] = [];
    await Promise.all(todo.map(async (f) => {
      try {
        const bytes = await drive.download(f, (p) => this.setProgress(f.id, p));
        const id = await assetId(bytes, f.mimeType);
        await store.addAsset(id, bytes, f.mimeType, f.name, f.id);
        // Show it at once (bytes are cached locally); the listing below adds Drive's thumbnail.
        this.uploads = [{ id, fileId: '', mime: f.mimeType, name: f.name, size: bytes.length, createdTime: new Date().toISOString(), driveFileId: f.id }, ...this.uploads];
      } catch (e) {
        failed.push(`${f.name}: ${e instanceof Error ? e.message : e}`);
      } finally {
        this.importing = this.importing.filter((i) => i.id !== f.id);
      }
    }));
    if (todo.length) await this.loadUploads(true);
    if (failed.length) this.pickError = `Couldn't copy ${failed.join('; ')}`;
    const byDrive = new Map(this.uploads.filter((a) => a.driveFileId).map((a) => [a.driveFileId!, a]));
    return files.map((f) => byDrive.get(f.id)).filter((a): a is LibraryAsset => !!a);
  }

  private setProgress(id: string, p: number): void {
    this.importing = this.importing.map((i) => (i.id === id ? { ...i, progress: p } : i));
  }

  // ---- Uploads ----

  async loadUploads(fresh = false): Promise<void> {
    const s = this.store;
    const key = account.user?.uid ?? '';
    if (!s) {
      this.uploads = [];
      return;
    }
    if (!fresh && this.uploadsFor === key) return;
    this.uploadsFor = key;
    this.uploadsLoading = true;
    this.uploadsError = '';
    try {
      this.uploads = await s.listAssets(fresh);
    } catch (e) {
      this.uploadsFor = '';
      this.uploadsError = e instanceof Error ? e.message : String(e);
    } finally {
      this.uploadsLoading = false;
    }
  }

  async removeUpload(id: string): Promise<void> {
    const s = this.store;
    if (!s) return;
    await s.hideAsset(id);
    this.uploads = this.uploads.filter((a) => a.id !== id);
  }

  /** After a save uploaded new assets: list again next time the tab shows. */
  stale(): void {
    this.uploadsFor = '';
  }
}

export const driveLib = new DriveLibrary();
if (import.meta.env.DEV) (window as unknown as { __driveLib?: DriveLibrary }).__driveLib = driveLib;
