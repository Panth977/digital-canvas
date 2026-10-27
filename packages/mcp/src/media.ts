/**
 * Media files in Node: what a file is (from its bytes), image sizes (CanvasKit),
 * video/audio length and size (Mediabunny, MPL-2.0, parses containers without
 * decoding), and ffmpeg when it is available (poster frames, video export).
 *
 * ffmpeg is found via DC_FFMPEG / FFMPEG_PATH, the optional `ffmpeg-static`
 * package, or `ffmpeg` on PATH. It is never bundled with this package (GPL).
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny';
import { engine } from './engine.ts';

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
      const poster = await videoFrame(bytes, Math.min(0.1, duration / 2)).catch(() => null);
      if (poster) info.poster = poster;
      return info;
    }
    return { mime, kind, duration };
  } finally {
    input.dispose?.();
  }
}

// ---------------------------------------------------------------- ffmpeg

let ffmpegPath: string | null | undefined;

/** The ffmpeg binary to use, or null when there is none. */
export function ffmpeg(): string | null {
  if (ffmpegPath !== undefined) return ffmpegPath;
  const ok = (p: string) => { try { return spawnSync(p, ['-version'], { stdio: 'ignore' }).status === 0; } catch { return false; } };
  const candidates: string[] = [];
  for (const e of [process.env.DC_FFMPEG, process.env.FFMPEG_PATH]) if (e) candidates.push(e);
  try {
    const p = createRequire(import.meta.url)('ffmpeg-static') as string | { default?: string } | null;
    const s = typeof p === 'string' ? p : p?.default;
    if (s) candidates.push(s);
  } catch { /* optional */ }
  candidates.push('ffmpeg');
  ffmpegPath = candidates.find(ok) ?? null;
  return ffmpegPath;
}

/** Run ffmpeg; resolves with stdout (bytes). `input` is written to stdin. */
export function runFfmpeg(args: string[], input?: Uint8Array): Promise<Uint8Array> {
  const bin = ffmpeg();
  if (!bin) return Promise.reject(new Error('ffmpeg is not available'));
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ['-hide_banner', '-loglevel', 'error', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [], err: Buffer[] = [];
    p.stdout.on('data', (d: Buffer) => out.push(d));
    p.stderr.on('data', (d: Buffer) => err.push(d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(new Uint8Array(Buffer.concat(out))) : reject(new Error(`ffmpeg failed: ${Buffer.concat(err).toString().slice(-400)}`))));
    p.stdin.on('error', () => {});
    if (input) p.stdin.end(input);
    else p.stdin.end();
  });
}

/** A temp folder removed after `fn`. */
export async function withTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'dc-mcp-'));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** One frame of a video as PNG (seconds from the start). */
export async function videoFrame(bytes: Uint8Array, at: number): Promise<Uint8Array | null> {
  if (!ffmpeg()) return null;
  return withTemp(async (dir) => {
    const src = join(dir, 'in');
    writeFileSync(src, bytes);
    const out = join(dir, 'f.png');
    await runFfmpeg(['-ss', String(Math.max(0, at)), '-i', src, '-frames:v', '1', '-y', out]);
    return new Uint8Array(readFileSync(out));
  });
}
