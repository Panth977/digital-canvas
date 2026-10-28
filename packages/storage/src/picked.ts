import type { LibraryAsset } from './drive.ts';
import type { MediaKind } from './drivebrowse.ts';

/**
 * Files the user chose with Google Picker (Uploads → Google Drive). Picking
 * grants the app `drive.file` access to exactly those files; the app then
 * downloads each one once and keeps it in `Digital Canvas/assets` (content
 * hash id) with `appProperties.dcDrive = <Drive file id>`, so the
 * "From Google Drive" list comes back on every device without picking again.
 *
 * Everything here is pure (tested in packages/storage/test/picked.test.ts).
 */

/** One file from a Picker answer, as the app needs it. */
export interface PickedFile {
  /** Drive file id. */
  id: string;
  name: string;
  mimeType: string;
  size?: number;
}

/** A document in a Picker callback (`google.picker.ResponseObject.docs[]`), loosely typed. */
export interface PickerDoc {
  id?: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number | string;
  type?: string;
}

export const isMediaMime = (mime: string) => /^(image|video|audio)\//.test(mime);

/**
 * The usable files of a Picker answer: media only (folders, Docs and other
 * types are dropped), each id once, in the order picked.
 */
export function pickedFiles(docs: readonly PickerDoc[] | undefined): PickedFile[] {
  const out: PickedFile[] = [];
  const seen = new Set<string>();
  for (const d of docs ?? []) {
    if (!d.id || !d.mimeType || !isMediaMime(d.mimeType) || seen.has(d.id)) continue;
    seen.add(d.id);
    const size = Number(d.sizeBytes);
    out.push({ id: d.id, name: d.name || d.id, mimeType: d.mimeType, ...(size > 0 ? { size } : {}) });
  }
  return out;
}

/** "From Google Drive": uploads that came from a picked Drive file, newest first, one per Drive file. */
export function fromDrive(uploads: readonly LibraryAsset[], kind: MediaKind = 'all'): LibraryAsset[] {
  const seen = new Set<string>();
  const out: LibraryAsset[] = [];
  const sorted = [...uploads].sort((a, b) => (b.createdTime ?? '').localeCompare(a.createdTime ?? ''));
  for (const a of sorted) {
    if (!a.driveFileId || seen.has(a.driveFileId)) continue;
    if (kind !== 'all' && !a.mime.startsWith(`${kind}/`)) continue;
    seen.add(a.driveFileId);
    out.push(a);
  }
  return out;
}

/** The picked files that still need downloading (not already in Uploads from an earlier pick). */
export function notYetImported(picked: readonly PickedFile[], uploads: readonly LibraryAsset[]): PickedFile[] {
  const have = new Set(uploads.map((a) => a.driveFileId).filter(Boolean));
  return picked.filter((p) => !have.has(p.id));
}
