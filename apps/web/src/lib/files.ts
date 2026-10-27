/** Browser helpers for files: downloads, picking, image sizes. */
import { isNative } from './native/platform.ts';

/**
 * Save a file. Browsers download it; the native app writes it to its cache
 * and opens the share sheet (Save to Files / Photos, AirDrop, other apps).
 */
export async function download(bytes: Uint8Array | Blob, name: string, mime = 'application/octet-stream'): Promise<void> {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type: mime });
  if (isNative()) return (await import('./native/files.ts')).shareFile(blob, name);
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Native app: several files to the share sheet at once (e.g. one image per page). */
export async function shareAll(files: { bytes: Uint8Array; name: string; mime: string }[]): Promise<void> {
  const m = await import('./native/files.ts');
  return m.shareFiles(files.map((f) => ({ blob: new Blob([f.bytes as BlobPart], { type: f.mime }), name: f.name })));
}

/**
 * Let the user pick files. In the native app, image/video-only lists open the
 * photo library (several at once); anything else uses the system file picker.
 * `source: 'files'` forces the file picker.
 */
export async function pickFiles(accept: string, multiple = true, source: 'auto' | 'files' = 'auto'): Promise<File[]> {
  if (isNative() && source === 'auto') {
    const m = await import('./native/files.ts');
    const kind = m.galleryKind(accept);
    if (kind) return m.pickFromGallery(kind, multiple);
  }
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept, multiple });
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.click();
  });
}

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export function isImage(f: File): boolean {
  return IMAGE_TYPES.includes(f.type);
}

const urls = new WeakMap<Uint8Array, string>();

/** A cached object URL for bytes (thumbnails). */
export function objectUrl(bytes: Uint8Array, mime = 'image/png'): string {
  let u = urls.get(bytes);
  if (!u) {
    u = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
    urls.set(bytes, u);
  }
  return u;
}

export function timeAgo(iso: string): string {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}
