/** Native shell: share sheet for exports, photo library for picking images/videos. */

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 120) || 'export';
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Write the export to the app's cache folder and open the system share sheet (Save to Files/Photos, AirDrop, …). */
export function shareFile(blob: Blob, name: string): Promise<void> {
  return shareFiles([{ blob, name }]);
}

export async function shareFiles(files: { blob: Blob; name: string }[]): Promise<void> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  const dir = `exports/${Date.now()}`;
  // Last time's exports are no longer needed once the sheet has closed.
  await Filesystem.rmdir({ path: 'exports', directory: Directory.Cache, recursive: true }).catch(() => {});
  const uris: string[] = [];
  for (const f of files) {
    const { uri } = await Filesystem.writeFile({ path: `${dir}/${safeName(f.name)}`, data: await toBase64(f.blob), directory: Directory.Cache, recursive: true });
    uris.push(uri);
  }
  const title = files.length === 1 ? files[0]!.name : `${files.length} files`;
  try {
    await Share.share({ title, files: uris, dialogTitle: `Share ${title}` });
  } catch (e) {
    // Closing the sheet is not an error.
    if (!/cancel/i.test(String((e as Error)?.message ?? e))) throw e;
  }
}

export type GalleryKind = 'photo' | 'video' | 'all';

/** Which gallery a file-input `accept` list maps to; null when it needs the file picker (pure; tested). */
export function galleryKind(accept: string): GalleryKind | null {
  const parts = accept.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!parts.length) return null;
  const image = (p: string) => p.startsWith('image/') || /^\.(png|jpe?g|webp|gif|heic)$/.test(p);
  const video = (p: string) => p.startsWith('video/') || /^\.(mp4|mov|webm|m4v)$/.test(p);
  if (!parts.every((p) => image(p) || video(p))) return null;
  const hasImage = parts.some(image);
  const hasVideo = parts.some(video);
  return hasImage && hasVideo ? 'all' : hasVideo ? 'video' : 'photo';
}

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4', webm: 'video/webm',
};

/** The photo library picker (several at once); picked items become File objects. */
export async function pickFromGallery(kind: GalleryKind, multiple: boolean): Promise<File[]> {
  const { Camera, MediaTypeSelection } = await import('@capacitor/camera');
  const mediaType = kind === 'all' ? MediaTypeSelection.All : kind === 'video' ? MediaTypeSelection.Video : MediaTypeSelection.Photo;
  let results;
  try {
    ({ results } = await Camera.chooseFromGallery({ mediaType, allowMultipleSelection: multiple, limit: multiple ? 0 : 1, includeMetadata: true, editable: 'no', quality: 92 }));
  } catch (e) {
    if (/cancel/i.test(String((e as Error)?.message ?? e))) return [];
    throw e;
  }
  const files: File[] = [];
  for (const [i, m] of results.entries()) {
    if (!m.webPath) continue;
    const blob = await (await fetch(m.webPath)).blob();
    const ext = (m.metadata?.format ?? blob.type.split('/')[1] ?? 'jpg').toLowerCase().replace('jpeg', 'jpg');
    const type = blob.type && blob.type !== 'application/octet-stream' ? blob.type : EXT_MIME[ext] ?? 'image/jpeg';
    const base = m.webPath.split('/').pop()?.split('?')[0]?.replace(/\.[^.]+$/, '') || `photo-${i + 1}`;
    files.push(new File([blob], `${base}.${ext}`, { type, lastModified: Date.now() }));
  }
  return files;
}
