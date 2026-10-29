/**
 * "Open a .dcanvas file": bring any design file into your own store (Drive when
 * signed in), from this device or from Google Drive (Picker). Files taken
 * straight from Drive only link their pictures (links.json): those are fetched
 * here with progress, so the saved copy is self-contained. See storage/import.ts.
 */
import { DriveStore, prepareImport, readMedia, browserAssetCache, type ProjectStore } from '@digital-canvas/storage';
import { account } from './account.svelte.ts';
import { library } from './library.svelte.ts';
import { router } from './router.svelte.ts';
import { toast } from './toast.svelte.ts';
import { pickFiles } from './files.ts';
import { isNative } from './native/platform.ts';
import { driveApiKey, knownFiles } from './sharing.ts';
import { pickDesignFile } from './picker.ts';

export interface ImportProgress {
  name: string;
  phase: 'download' | 'assets' | 'saving';
  done: number;
  total: number;
}

class ImportState {
  /** The import running now (Home shows a progress card). */
  job = $state<ImportProgress | null>(null);
}
export const importer = new ImportState();

/**
 * The accept list of the file input. Phones get none: Android and iOS don't know
 * the .dcanvas type and would grey the file out; the file is checked after picking.
 */
export function designAccept(phone: boolean): string {
  return phone ? '' : '.dcanvas,.zip,application/vnd.digital-canvas+zip,application/zip,application/x-zip-compressed,application/octet-stream';
}

const isPhone = () => isNative() || matchMedia('(max-width: 767px), (pointer: coarse)').matches;

const cache = browserAssetCache();

/** Import file bytes into the current store and open the design. Returns the new design id (null on error). */
export async function importBytes(bytes: Uint8Array, name: string, store: ProjectStore = library.store): Promise<string | null> {
  importer.job = { name, phase: 'assets', done: 0, total: 0 };
  try {
    const drive = store instanceof DriveStore ? store : null;
    const ids = new Set((await store.list().catch(() => [])).map((p) => p.id));
    const r = await prepareImport(bytes, {
      via: { token: account.user ? account.driveToken : null, apiKey: driveApiKey() },
      local: async (id) => (await cache.get(id).catch(() => undefined)) ?? (drive ? await drive.getAsset(id).catch(() => undefined) : undefined),
      exists: (id) => ids.has(id) || !!knownFiles.get(id),
      onProgress: (done, total) => { if (importer.job) importer.job = { ...importer.job, phase: 'assets', done, total }; },
    });
    importer.job = { ...importer.job!, phase: 'saving' };
    await store.save(r.file);
    const title = r.file.doc.title;
    if (r.missing.length) {
      toast.show(`Opened “${title}”, but ${r.missing.length} picture${r.missing.length === 1 ? '' : 's'} or font${r.missing.length === 1 ? '' : 's'} could not be loaded. Ask the owner to share the design with you, then import it again.`, { timeout: 10_000 });
    } else toast.show(r.fetched ? `Imported “${title}” with ${r.fetched} picture${r.fetched === 1 ? '' : 's'} from Google Drive` : `Imported “${title}”`);
    router.go({ name: 'editor', id: r.file.doc.id });
    return r.file.doc.id;
  } catch (e) {
    toast.show(`Couldn't open “${name}”: ${e instanceof Error ? e.message.replace(/^Google Drive: /, '') : e}`, { timeout: 10_000 });
    return null;
  } finally {
    importer.job = null;
  }
}

/** Home › Open a .dcanvas file › From this device. */
export async function importFromDevice(): Promise<void> {
  const [file] = await pickFiles(designAccept(isPhone()), false, 'files');
  if (!file) return;
  if (!/\.(dcanvas|zip)$/i.test(file.name) && file.size > 0 && file.type && !/zip|octet-stream|digital-canvas/.test(file.type)) {
    toast.show(`“${file.name}” is not a Digital Canvas design. Choose a .dcanvas file.`, { timeout: 8000 });
    return;
  }
  await importBytes(new Uint8Array(await file.arrayBuffer()), file.name);
}

/** Home › Open a .dcanvas file › From Google Drive: the Picker grants the file, then it is imported. */
export async function importFromDrive(): Promise<void> {
  try {
    const picked = await pickDesignFile(await account.driveToken(), 'import');
    if (!picked) return;
    importer.job = { name: picked.name, phase: 'download', done: 0, total: 0 };
    const bytes = await readMedia(picked.id, { token: account.driveToken, apiKey: driveApiKey() });
    await importBytes(bytes, picked.name);
  } catch (e) {
    importer.job = null;
    toast.show(`Couldn't open the file from Google Drive: ${e instanceof Error ? e.message.replace(/^Google Drive: /, '') : e}`, { timeout: 10_000 });
  }
}
