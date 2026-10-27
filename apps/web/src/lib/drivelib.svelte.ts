import { DriveBrowser, DriveStore, type DriveItem, type DriveLocation, type DriveSource, type LibraryAsset, type MediaKind } from '@digital-canvas/storage';
import { account } from './account.svelte.ts';
import { library } from './library.svelte.ts';

/** A step in the breadcrumbs. */
export interface Crumb {
  name: string;
  loc: DriveLocation;
}

export const SOURCES: { id: DriveSource; label: string }[] = [
  { id: 'my-drive', label: 'My Drive' },
  { id: 'computers', label: 'Computers' },
  { id: 'shared', label: 'Shared with me' },
  { id: 'shared-drives', label: 'Shared drives' },
  { id: 'starred', label: 'Starred' },
  { id: 'recent', label: 'Recent' },
];

/**
 * State behind the Uploads panel, kept outside the component so switching
 * rail sections doesn't lose the folder you were in or the listings.
 */
class DriveLibrary {
  tab = $state<'uploads' | 'drive'>('uploads');
  kind = $state<MediaKind>('all');

  // ---- Google Drive tab ----
  crumbs = $state<Crumb[]>([{ name: 'My Drive', loc: { source: 'my-drive' } }]);
  items = $state.raw<DriveItem[]>([]);
  next = $state<string | undefined>(undefined);
  loading = $state(false);
  error = $state('');
  search = $state('');
  private browser: { uid: string; b: DriveBrowser } | null = null;
  private seq = 0;

  // ---- Uploads tab ----
  uploads = $state.raw<LibraryAsset[]>([]);
  uploadsLoading = $state(false);
  uploadsError = $state('');
  private uploadsFor = '';

  get loc(): DriveLocation {
    return this.crumbs[this.crumbs.length - 1]!.loc;
  }

  get source(): DriveSource {
    return this.crumbs[0]!.loc.source;
  }

  /** The Drive-backed design store, when signed in. */
  get store(): DriveStore | null {
    const s = library.store;
    return s instanceof DriveStore ? s : null;
  }

  get drive(): DriveBrowser | null {
    const u = account.user;
    if (!u) return null;
    if (this.browser?.uid !== u.uid) this.browser = { uid: u.uid, b: new DriveBrowser(account.driveToken) };
    return this.browser.b;
  }

  /** Load the first page of the current location (cached). */
  async load(fresh = false): Promise<void> {
    const d = this.drive;
    if (!d) return;
    const my = ++this.seq;
    this.loading = true;
    this.error = '';
    if (fresh) this.items = [];
    try {
      const page = await d.list(this.loc, this.kind, undefined, fresh);
      if (my !== this.seq) return;
      this.items = page.items;
      this.next = page.nextPageToken;
    } catch (e) {
      if (my !== this.seq) return;
      this.items = [];
      this.next = undefined;
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      if (my === this.seq) this.loading = false;
    }
  }

  /** Infinite scroll: the next page. */
  async more(): Promise<void> {
    const d = this.drive;
    if (!d || !this.next || this.loading) return;
    const my = this.seq;
    this.loading = true;
    try {
      const page = await d.list(this.loc, this.kind, this.next);
      if (my !== this.seq) return;
      const seen = new Set(this.items.map((i) => i.id));
      this.items = [...this.items, ...page.items.filter((i) => !seen.has(i.id))];
      this.next = page.nextPageToken;
    } catch (e) {
      if (my === this.seq) this.error = e instanceof Error ? e.message : String(e);
    } finally {
      if (my === this.seq) this.loading = false;
    }
  }

  go(source: DriveSource): void {
    this.search = '';
    this.crumbs = [{ name: SOURCES.find((s) => s.id === source)!.label, loc: { source } }];
    void this.load();
  }

  open(folder: DriveItem): void {
    const parent = this.loc;
    const loc: DriveLocation = { source: parent.source, folderId: folder.id, ...(folder.driveId ?? parent.driveId ? { driveId: folder.driveId ?? parent.driveId } : {}) };
    this.crumbs = [...this.crumbs.filter((c) => !c.loc.search), { name: folder.name, loc }];
    void this.load();
  }

  /** Breadcrumb click. */
  back(i: number): void {
    this.crumbs = this.crumbs.slice(0, i + 1);
    void this.load();
  }

  find(text: string): void {
    const q = text.trim();
    const base = this.crumbs.filter((c) => !c.loc.search);
    this.crumbs = q ? [...base, { name: `“${q}”`, loc: { source: this.source, search: q } }] : base;
    void this.load();
  }

  setKind(k: MediaKind): void {
    this.kind = k;
    if (this.tab === 'drive') void this.load();
  }

  /** Open a folder from a pasted Drive link (e.g. a backed-up computer the scan missed). */
  async openLink(id: string): Promise<void> {
    const d = this.drive;
    if (!d) return;
    try {
      const f = await d.folder(id);
      if (!f.isFolder) throw new Error('That link is not a folder.');
      this.open(f);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
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
