/// <reference path="./types/gifenc.d.ts" />
/**
 * Moving pictures in Node: frames drawn by the same CanvasKit renderer as the
 * editor (animations via scene `animateAt`, page transitions via `frameAt`),
 * video clips decoded by ffmpeg, sound mixed by ffmpeg (trim, volume, fades),
 * encoded as H.264 + AAC MP4. GIFs use gifenc like the web app.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Canvas, Image, Paint } from 'canvaskit-wasm';
import * as gifencModule from 'gifenc';
// gifenc is CommonJS: plain Node ESM sees only a default export, bundlers see named ones
const gifenc = (typeof (gifencModule as { GIFEncoder?: unknown }).GIFEncoder === 'function' ? gifencModule : (gifencModule as unknown as { default: typeof gifencModule }).default);
const { GIFEncoder, applyPalette, quantize } = gifenc;
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny';
import {
  animateAt, animationEnd, clipTime, frameAt, isVideo, pageDuration, pageStart, totalDuration, transitionLayers, walk,
  type Doc, type Page, type TransitionLayer, type VideoElement,
} from '@digital-canvas/scene';
import type { Renderer } from '@digital-canvas/render';
import type { ProjectFile } from '@digital-canvas/storage';
import { gifFrames, gifPageDuration } from '../../../apps/web/src/lib/giftime.ts';
import { withRenderer, type Engine } from './engine.ts';
import { ffmpeg, runFfmpeg, videoFrame, withTemp } from './media.ts';

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Draw one page with a transition layer applied. */
function drawLayer(eng: Engine, r: Renderer, canvas: Canvas, doc: Doc, page: Page, L: TransitionLayer): void {
  const ck = eng.ck;
  if (L.alpha <= 0) return;
  canvas.save();
  if (L.clip) canvas.clipRect(ck.XYWHRect(L.clip.x, L.clip.y, L.clip.w, L.clip.h), ck.ClipOp.Intersect, true);
  canvas.translate(L.dx, L.dy);
  if (L.scale !== 1) {
    canvas.translate(doc.width / 2, doc.height / 2);
    canvas.scale(L.scale, L.scale);
    canvas.translate(-doc.width / 2, -doc.height / 2);
  }
  if (L.alpha < 1) {
    const p = new ck.Paint();
    p.setAlphaf(L.alpha);
    canvas.saveLayer(p);
    p.delete();
  }
  r.drawPage(canvas, doc, page);
  if (L.alpha < 1) canvas.restore();
  canvas.restore();
}

/** Draw the timeline at `t` (page, animations, transition) onto a canvas already scaled to page px. */
export function drawAt(eng: Engine, r: Renderer, canvas: Canvas, doc: Doc, t: number): void {
  const f = frameAt(doc, t);
  const now = animateAt(doc, f.page, f.local);
  if (!f.prev || !f.transition) {
    r.drawPage(canvas, doc, now);
    return;
  }
  const L = transitionLayers(f.transition, f.progress ?? 1, doc.width, doc.height);
  if (L.black) canvas.drawRect(eng.ck.XYWHRect(0, 0, doc.width, doc.height), blackPaint(eng));
  drawLayer(eng, r, canvas, doc, animateAt(doc, f.prev.page, f.prev.local), L.prev);
  drawLayer(eng, r, canvas, doc, now, L.next);
}

let black: Paint | null = null;
function blackPaint(eng: Engine) {
  if (!black) { black = new eng.ck.Paint(); black.setColor(eng.ck.BLACK); }
  return black;
}

function snapshot(eng: Engine, surface: ReturnType<Engine['ck']['MakeSurface']>, W: number, H: number): Uint8Array {
  const ck = eng.ck;
  surface!.flush();
  const img = surface!.makeImageSnapshot();
  const px = img.readPixels(0, 0, { width: W, height: H, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array;
  img.delete();
  return px;
}

/** Frames of one clip, read in order from an ffmpeg pipe. */
class ClipReader {
  private proc: ChildProcess;
  private buf: Buffer[] = [];
  private have = 0;
  private ended = false;
  private waiting: (() => void) | null = null;
  readonly frameBytes: number;
  index = -1;
  last: Uint8Array | null = null;

  constructor(bin: string, file: string, start: number, length: number, loop: boolean, fps: number, readonly w: number, readonly h: number) {
    this.frameBytes = w * h * 4;
    const args = ['-hide_banner', '-loglevel', 'error', ...(loop ? ['-stream_loop', '-1'] : []), '-ss', String(start), '-i', file, '-t', String(Math.max(0.05, length)), '-an',
      '-vf', `fps=${fps},scale=${w}:${h}:flags=bicubic`, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'];
    this.proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    this.proc.stdout!.on('data', (d: Buffer) => {
      this.buf.push(d);
      this.have += d.length;
      if (this.have > this.frameBytes * 8) this.proc.stdout!.pause();
      this.waiting?.();
    });
    this.proc.on('close', () => { this.ended = true; this.waiting?.(); });
  }

  private async frame(): Promise<Uint8Array | null> {
    while (this.have < this.frameBytes && !this.ended) {
      this.proc.stdout!.resume();
      await new Promise<void>((res) => (this.waiting = res));
      this.waiting = null;
    }
    if (this.have < this.frameBytes) return null;
    const all = Buffer.concat(this.buf);
    const out = new Uint8Array(all.subarray(0, this.frameBytes));
    const rest = all.subarray(this.frameBytes);
    this.buf = rest.length ? [rest] : [];
    this.have = rest.length;
    if (this.have < this.frameBytes * 4) this.proc.stdout!.resume();
    return out;
  }

  /** The frame for index `i` (frames are read forward only). */
  async at(i: number): Promise<Uint8Array | null> {
    while (this.index < i) {
      const f = await this.frame();
      this.index++;
      if (!f) { this.last = null; this.index = i; break; }
      this.last = f;
    }
    return this.last;
  }

  close(): void { if (!this.ended) this.proc.kill('SIGKILL'); }
}

export interface VideoExportOptions {
  fps?: number;
  /** Longest side in px (default 1920). */
  maxSide?: number;
  onProgress?: (fraction: number) => void;
}

async function hasAudioTrack(bytes: Uint8Array): Promise<boolean> {
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  try { return !!(await input.getPrimaryAudioTrack()); } catch { return false; } finally { input.dispose?.(); }
}

/** The design as an MP4 (H.264 + AAC). Needs ffmpeg. */
export async function exportMp4(file: ProjectFile, opts: VideoExportOptions = {}): Promise<Uint8Array> {
  const bin = ffmpeg();
  if (!bin) throw new Error('video export needs ffmpeg: install it (brew install ffmpeg / apt install ffmpeg) or `npm i ffmpeg-static` next to this server, or set DC_FFMPEG');
  const doc = file.doc;
  const fps = opts.fps ?? 30;
  const total = totalDuration(doc);
  if (total <= 0) throw new Error('the design has no visible pages');
  const scale = Math.min(1, (opts.maxSide ?? 1920) / Math.max(doc.width, doc.height));
  const W = even(doc.width * scale), H = even(doc.height * scale);
  const frames = Math.max(1, Math.round(total * fps));

  return withTemp(async (dir) => {
    const path = new Map<string, string>();
    const fileOf = (asset: string) => {
      if (!path.has(asset)) { const p = join(dir, asset.replace(/[^\w.-]/g, '_')); writeFileSync(p, file.assets.get(asset)!); path.set(asset, p); }
      return path.get(asset)!;
    };
    // ---- sound
    type Src = { asset: string; at: number; offset: number; dur: number; volume: number; loop?: boolean; fadeIn?: number; fadeOut?: number };
    const srcs: Src[] = (doc.audio ?? []).filter((a) => file.assets.has(a.asset)).map((a) => ({ asset: a.asset, at: a.start, offset: a.offset, dur: a.duration, volume: a.volume ?? 1, fadeIn: a.fadeIn, fadeOut: a.fadeOut }));
    for (const p of doc.pages) {
      if (p.hidden) continue;
      for (const e of walk(p.elements)) {
        if (e.type !== 'video' || e.muted || e.hidden || (e.volume ?? 1) === 0 || !file.assets.has(e.asset)) continue;
        if (!(await hasAudioTrack(file.assets.get(e.asset)!))) continue;
        const fileDur = doc.assets[e.asset]?.duration ?? pageDuration(p);
        const a = e.trimStart ?? 0, b = Math.min(e.trimEnd ?? fileDur, fileDur);
        srcs.push({ asset: e.asset, at: pageStart(doc, p.id), offset: a, dur: Math.min(pageDuration(p), e.loop ? pageDuration(p) : b - a), volume: e.volume ?? 1, loop: e.loop });
      }
    }
    const audioArgs: string[] = [];
    const filters: string[] = [];
    srcs.forEach((s, i) => {
      if (s.at >= total) return;
      audioArgs.push(...(s.loop ? ['-stream_loop', '-1'] : []), '-i', fileOf(s.asset));
      const dur = Math.max(0.05, Math.min(s.dur, total - s.at));
      const chain = [`atrim=start=${s.offset}:duration=${dur}`, 'asetpts=PTS-STARTPTS', `volume=${s.volume}`];
      if (s.fadeIn) chain.push(`afade=t=in:st=0:d=${Math.min(s.fadeIn, dur)}`);
      if (s.fadeOut) chain.push(`afade=t=out:st=${Math.max(0, dur - s.fadeOut)}:d=${Math.min(s.fadeOut, dur)}`);
      const ms = Math.round(s.at * 1000);
      chain.push(`adelay=${ms}|${ms}`, 'aformat=sample_rates=48000:channel_layouts=stereo');
      filters.push(`[${filters.length + 1}:a]${chain.join(',')}[a${i}]`);
    });
    const nAudio = filters.length;
    const labels = filters.map((f) => /\[(a\d+)\]$/.exec(f)![1]);
    const graph = nAudio ? [...filters, `${labels.map((l) => `[${l}]`).join('')}amix=inputs=${nAudio}:normalize=0:dropout_transition=0,atrim=0:${total}[aout]`].join(';') : '';
    const out = join(dir, 'out.mp4');
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(fps), '-i', 'pipe:0', ...audioArgs,
      ...(nAudio ? ['-filter_complex', graph, '-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', '192k'] : ['-map', '0:v']),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-t', String(total), out];
    const enc = spawn(bin, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    const errs: Buffer[] = [];
    enc.stderr!.on('data', (d: Buffer) => errs.push(d));
    const done = new Promise<void>((res, rej) => enc.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg: ${Buffer.concat(errs).toString().slice(-500)}`)))));
    let encErr: Error | null = null;
    enc.stdin!.on('error', (e) => { encErr = e; });
    const write = (buf: Uint8Array) => new Promise<void>((res) => { if (enc.stdin!.write(buf)) res(); else enc.stdin!.once('drain', () => res()); });

    // ---- pictures
    const readers = new Map<string, ClipReader>(); // `${pageId}/${elementId}`
    try {
      await withRenderer(file, async (r, eng) => {
        const ck = eng.ck;
        const surface = ck.MakeSurface(W, H);
        if (!surface) throw new Error(`could not make a ${W}×${H} surface`);
        try {
          const clipsOf = (page: Page) => [...walk(page.elements)].filter((e): e is VideoElement => e.type === 'video' && !e.hidden && file.assets.has(e.asset));
          const reader = (page: Page, el: VideoElement): ClipReader => {
            const key = `${page.id}/${el.id}`;
            let rd = readers.get(key);
            if (!rd) {
              const m = doc.assets[el.asset];
              const fileDur = m?.duration ?? pageDuration(page);
              const a = el.trimStart ?? 0, b = Math.min(el.trimEnd ?? fileDur, fileDur);
              const len = el.loop ? pageDuration(page) : Math.min(pageDuration(page), b - a);
              const iw = m?.width ?? el.w, ih = m?.height ?? el.h;
              const k = Math.min(1, Math.max((el.w * scale) / iw, (el.h * scale) / ih) * 1.25);
              rd = new ClipReader(bin, fileOf(el.asset), a, len, !!el.loop && b - a < pageDuration(page), fps, even(iw * k), even(ih * k));
              readers.set(key, rd);
            }
            return rd;
          };
          const setFrames = async (page: Page, local: number) => {
            for (const el of clipsOf(page)) {
              const fileDur = doc.assets[el.asset]?.duration ?? Infinity;
              if (clipTime(el, local, fileDur) === null) { r.setVideoFrame(el.asset, null); continue; }
              const rd = reader(page, el);
              const px = await rd.at(Math.floor(local * fps + 1e-6));
              const img: Image | null = px ? ck.MakeImage({ width: rd.w, height: rd.h, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }, px, rd.w * 4) : null;
              r.setVideoFrame(el.asset, img);
            }
          };
          let lastPage: string | null = null;
          for (let i = 0; i < frames; i++) {
            const t = i / fps;
            const f = frameAt(doc, t);
            if (f.prev) await setFrames(f.prev.page, Math.max(0, f.prev.local - 1 / fps));
            await setFrames(f.page, f.local);
            if (lastPage && lastPage !== f.page.id && !f.prev) {
              for (const [k, rd] of readers) if (!k.startsWith(`${f.page.id}/`)) { rd.close(); readers.delete(k); }
            }
            lastPage = f.page.id;
            const canvas = surface.getCanvas();
            canvas.clear(ck.WHITE);
            canvas.save();
            canvas.scale(W / doc.width, H / doc.height);
            drawAt(eng, r, canvas, doc, t);
            canvas.restore();
            if (encErr) throw encErr;
            await write(snapshot(eng, surface, W, H));
            opts.onProgress?.((i + 1) / frames * 0.97);
          }
        } finally {
          surface.delete();
        }
      });
      enc.stdin!.end();
      await done;
    } catch (e) {
      enc.kill('SIGKILL');
      throw e;
    } finally {
      for (const rd of readers.values()) rd.close();
    }
    opts.onProgress?.(1);
    return new Uint8Array(readFileSync(out));
  });
}

/** Pages as an animated GIF (each page plays its animations, then holds). */
export async function exportGif(file: ProjectFile, opts: { pages?: string[]; maxSide?: number; fps?: number } = {}): Promise<Uint8Array> {
  const doc = file.doc;
  const pages = (opts.pages ?? doc.pages.filter((p) => !p.hidden).map((p) => p.id)).map((id) => doc.pages.find((p) => p.id === id)).filter((p): p is Page => !!p);
  if (!pages.length) throw new Error('no pages to export');
  const fps = opts.fps ?? 15;
  const scale = Math.min(1, (opts.maxSide ?? 800) / Math.max(doc.width, doc.height));
  const W = Math.max(1, Math.round(doc.width * scale)), H = Math.max(1, Math.round(doc.height * scale));
  const video = isVideo(doc);
  const frames = gifFrames(pages.map((p) => ({ duration: gifPageDuration(video, pageDuration(p), animationEnd(p)), animEnd: animationEnd(p) })), fps);
  const still = frames.length === 1;
  return withRenderer(file, (r, eng) => {
    const ck = eng.ck;
    const surface = ck.MakeSurface(W, H)!;
    const gif = GIFEncoder();
    try {
      frames.forEach((f, i) => {
        const canvas = surface.getCanvas();
        canvas.clear(ck.WHITE);
        canvas.save();
        canvas.scale(W / doc.width, H / doc.height);
        r.drawPage(canvas, doc, animateAt(doc, pages[f.page]!, f.t));
        canvas.restore();
        const px = snapshot(eng, surface, W, H);
        const palette = quantize(px, 256);
        gif.writeFrame(applyPalette(px, palette), W, H, still ? { palette } : { palette, delay: f.delay, repeat: i === 0 ? 0 : undefined });
      });
      gif.finish();
      return gif.bytes();
    } finally {
      surface.delete();
    }
  }, pages);
}

/** Pictures of the video clips at `t` on the timeline (for still renders of a moment). */
export async function framesAt(file: ProjectFile, t: number): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  if (!ffmpeg()) return out;
  const f = frameAt(file.doc, t);
  for (const el of walk(f.page.elements)) {
    if (el.type !== 'video' || !file.assets.has(el.asset)) continue;
    const ct = clipTime(el, f.local, file.doc.assets[el.asset]?.duration ?? Infinity);
    if (ct === null) continue;
    const png = await videoFrame(file.assets.get(el.asset)!, ct).catch(() => null);
    if (png) out.set(el.asset, png);
  }
  return out;
}

export { runFfmpeg };
