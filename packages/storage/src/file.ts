import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { parseDoc, type Doc } from '@digital-canvas/scene';

/**
 * The `.dcanvas` file: one zip per project.
 *
 *   mimetype          "application/vnd.digital-canvas+zip" (first, stored)
 *   document.json     the Doc
 *   assets/<id>       image and font bytes, named by content hash
 *   thumbnail.png     first page preview (optional)
 */
export const MIME = 'application/vnd.digital-canvas+zip';
export const EXTENSION = '.dcanvas';

export interface ProjectFile {
  doc: Doc;
  assets: Map<string, Uint8Array>;
  thumbnail?: Uint8Array;
}

export class FileFormatError extends Error {
  override name = 'FileFormatError';
}

export function pack(file: ProjectFile): Uint8Array {
  const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 | 6 }]> = {
    mimetype: [strToU8(MIME), { level: 0 }],
    'document.json': [strToU8(JSON.stringify(file.doc)), { level: 6 }],
  };
  for (const id of Object.keys(file.doc.assets)) {
    const bytes = file.assets.get(id);
    // Images are already compressed; store them as-is.
    if (bytes) entries[`assets/${id}`] = [bytes, { level: 0 }];
  }
  if (file.thumbnail) entries['thumbnail.png'] = [file.thumbnail, { level: 0 }];
  return zipSync(entries);
}

export function unpack(bytes: Uint8Array): ProjectFile {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new FileFormatError('not a .dcanvas file (bad zip)');
  }
  const mime = files['mimetype'];
  if (!mime || strFromU8(mime) !== MIME) throw new FileFormatError('not a .dcanvas file (wrong mimetype)');
  const json = files['document.json'];
  if (!json) throw new FileFormatError('document.json is missing');
  const doc = parseDoc(JSON.parse(strFromU8(json)));
  const assets = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(files)) if (name.startsWith('assets/')) assets.set(name.slice(7), data);
  return { doc, assets, thumbnail: files['thumbnail.png'] };
}

/** Read only the thumbnail and title, for project lists. */
export function peek(bytes: Uint8Array): { doc: Doc; thumbnail?: Uint8Array } {
  const files = unzipSync(bytes, { filter: (f) => f.name === 'document.json' || f.name === 'thumbnail.png' || f.name === 'mimetype' });
  if (!files['mimetype'] || strFromU8(files['mimetype']) !== MIME || !files['document.json']) throw new FileFormatError('not a .dcanvas file');
  return { doc: parseDoc(JSON.parse(strFromU8(files['document.json']))), thumbnail: files['thumbnail.png'] };
}

const EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg',
  'font/ttf': 'ttf', 'font/otf': 'otf', 'font/woff': 'woff',
};

/** Content-addressed asset id: same bytes, same id, stored once. */
export async function assetId(bytes: Uint8Array, mime: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  const hex = Array.from(digest.slice(0, 10), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex}.${EXT[mime] ?? 'bin'}`;
}

/** A file name from a title: drops the characters file systems and Drive reject. */
export function fileName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '').trim().slice(0, 80) || 'Untitled design';
  return base + EXTENSION;
}
