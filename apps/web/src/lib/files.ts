/** Browser helpers for files: downloads, picking, image sizes. */

export function download(bytes: Uint8Array | Blob, name: string, mime = 'application/octet-stream'): void {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function pickFiles(accept: string, multiple = true): Promise<File[]> {
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
