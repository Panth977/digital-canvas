/**
 * Media files: what a file is (from its bytes), image sizes (CanvasKit),
 * video/audio length and size (Mediabunny, MPL-2.0, parses containers without
 * decoding), and poster frames from the platform (ffmpeg in Node, WebCodecs in
 * a browser).
 */
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny';
import { engine } from './engine.ts';
import { platform } from './platform.ts';

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

/** MIME type from the first bytes (null when unknown). */
export function sniffMime(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (ascii(b, 0, 4) === 'GIF8') return 'image/gif';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'image/webp';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE') return 'audio/wav';
  if (ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    return /^M4A|^M4B|^F4A/.test(brand) ? 'audio/mp4' : 'video/mp4';
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  if (ascii(b, 0, 4) === 'OggS') return 'audio/ogg';
  if (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (ascii(b, 0, 4) === 'fLaC') return 'audio/flac';
  const head = new TextDecoder().decode(b.subarray(0, 512)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  if ((b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) || ascii(b, 0, 4) === 'OTTO' || ascii(b, 0, 4) === 'true') return 'font/ttf';
  return null;
}

export type MediaKind = 'image' | 'video' | 'audio';
export const kindOfMime = (mime: string): MediaKind | null => {
  const t = mime.split('/')[0];
  return t === 'image' || t === 'video' || t === 'audio' ? t : null;
};

export interface MediaInfo {
  mime: string;
  kind: MediaKind;
  width?: number;
  height?: number;
  duration?: number;
  /** PNG of an early frame (videos, when ffmpeg is available). */
  poster?: Uint8Array;
}

/** Width/height of an image CanvasKit can decode, else null. */
export async function imageSize(bytes: Uint8Array): Promise<{ width: number; height: number } | null> {
  const { ck } = await engine();
  const img = ck.MakeImageFromEncoded(bytes);
  if (!img) return null;
  const size = { width: img.width(), height: img.height() };
  img.delete();
  return size;
}

/** Look at a media file. Throws with a helpful message when it can't be used. */
export async function probe(bytes: Uint8Array, mimeHint?: string): Promise<MediaInfo> {
  const sniffed = sniffMime(bytes);
  let mime = sniffed ?? mimeHint ?? 'application/octet-stream';
  if (mime === 'video/quicktime') mime = 'video/mp4';
  const kind = kindOfMime(mime);
  if (!kind) throw new Error(`not an image, video or audio file (${mime})`);
  if (mime === 'image/svg+xml') throw new Error('SVG files cannot be placed as images; use an icon (type "icon") or a path element with the SVG path data');
  if (kind === 'image') {
    const size = await imageSize(bytes);
    if (!size) throw new Error(`could not decode the image (${mime})`);
    return { mime, kind, ...size };
  }
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  try {
    const duration = await input.computeDuration().catch(() => 0);
    if (kind === 'video') {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error('the video file has no video track');
      const info: MediaInfo = { mime, kind, width: track.displayWidth, height: track.displayHeight, duration };
      const poster = await platform().videoFrame(bytes, Math.min(0.1, duration / 2), mime).catch(() => null);
      if (poster) info.poster = poster;
      return info;
    }
    return { mime, kind, duration };
  } finally {
    input.dispose?.();
  }
}
