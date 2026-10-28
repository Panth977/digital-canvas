/**
 * ffmpeg in Node (poster frames, MP4 export). Found via DC_FFMPEG / FFMPEG_PATH,
 * the optional `ffmpeg-static` package, or `ffmpeg` on PATH. It is never bundled
 * with this package (GPL).
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
