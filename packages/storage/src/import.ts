import { newId } from '@digital-canvas/scene';
import { FileFormatError, unpack, type ProjectFile } from './file.ts';
import { readMedia, type ReadVia } from './driveapi.ts';

/**
 * Bringing any `.dcanvas` file into your own store ("Open a .dcanvas file").
 *
 * A file saved by the app's Download is self-contained. A `.dcanvas` taken
 * straight from Google Drive is not: the Drive store keeps a design's pictures,
 * clips and fonts in the owner's `assets/` folder and the file only carries
 * `links.json` (asset id → Drive file id). Importing such a file fetches every
 * missing asset by its Drive id (OAuth first, then the API key, which reads
 * assets of shared designs) and returns a self-contained copy to save.
 *
 * The copy gets a new design id when the id is already taken in your store or
 * when its assets came from someone else's Drive, so an import never
 * overwrites a design (yours, or the owner's file you have opened before).
 */
export interface ImportOptions {
  /** Reads linked assets: the signed-in token (may be null) and the API key. */
  via: ReadVia;
  /** Your own copy of an asset (local cache or your Drive's assets/), tried before the link. */
  local?: (assetId: string) => Promise<Uint8Array | undefined>;
  /** A design with this id already exists in the store you import into. */
  exists?: (docId: string) => boolean | Promise<boolean>;
  /** Called as assets are fetched (done of total). */
  onProgress?: (done: number, total: number) => void;
}

export interface ImportResult {
  /** Self-contained: every asset that could be found is inside, no links. */
  file: ProjectFile;
  /** The design got a new id (clash, or it belongs to someone else). */
  renamed: boolean;
  /** Assets fetched through links.json. */
  fetched: number;
  /** Asset ids that could not be read (the design shows a placeholder there). */
  missing: string[];
}

/** A clear message for a file that is not a design. */
export class ImportError extends Error {
  override name = 'ImportError';
}

/** Throws ImportError with a message a person understands. */
export function readDesignFile(bytes: Uint8Array): ProjectFile {
  try {
    return unpack(bytes);
  } catch (e) {
    const head = new TextDecoder().decode(bytes.subarray(0, 200)).toLowerCase();
    if (head.includes('<html') || head.includes('<!doctype')) throw new ImportError('This is a web page, not a design. Download the .dcanvas file itself (in Drive: ⋮ › Download).');
    if (e instanceof FileFormatError) throw new ImportError(`This file is not a Digital Canvas design (${e.message.replace(/^not a \.dcanvas file \(?|\)$/g, '') || 'unknown format'}).`);
    throw new ImportError(`This design could not be read: ${e instanceof Error ? e.message : e}`);
  }
}

export async function prepareImport(bytes: Uint8Array, opts: ImportOptions): Promise<ImportResult> {
  const file = readDesignFile(bytes);
  const links = file.links ?? {};
  const want = Object.keys(file.doc.assets).filter((a) => !file.assets.has(a));
  const total = want.length;
  let done = 0;
  let fetched = 0;
  const missing: string[] = [];
  opts.onProgress?.(0, total);
  const queue = [...want];
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let a = queue.shift(); a; a = queue.shift()) {
      let b = await opts.local?.(a).catch(() => undefined);
      if (!b && links[a]) {
        b = await readMedia(links[a], opts.via).catch(() => undefined);
        if (b) fetched++;
      }
      if (b) file.assets.set(a, b);
      else missing.push(a);
      opts.onProgress?.(++done, total);
    }
  }));
  const clash = !!(await opts.exists?.(file.doc.id));
  const renamed = clash || fetched > 0;
  const now = new Date().toISOString();
  const doc = renamed ? { ...file.doc, id: newId('d_'), createdAt: now, updatedAt: now } : file.doc;
  return { file: { doc, assets: file.assets, ...(file.thumbnail ? { thumbnail: file.thumbnail } : {}) }, renamed, fetched, missing };
}
