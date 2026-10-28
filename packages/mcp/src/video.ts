/// <reference path="./types/gifenc.d.ts" />
/**
 * Moving pictures: frames drawn by the same CanvasKit renderer as the editor
 * (animations via scene `animateAt`, page transitions via `frameAt`). MP4 is
 * the platform's (ffmpeg in Node, WebCodecs in a browser); GIFs use gifenc
 * like the web app.
 */
import type { Canvas } from 'canvaskit-wasm';
import * as gifencModule from 'gifenc';
// gifenc is CommonJS: plain Node ESM sees only a default export, bundlers see named ones
const gifenc = (typeof (gifencModule as { GIFEncoder?: unknown }).GIFEncoder === 'function' ? gifencModule : (gifencModule as unknown as { default: typeof gifencModule }).default);
const { GIFEncoder, applyPalette, quantize } = gifenc;
import {
  animateAt, animationEnd, clipTime, frameAt, isVideo, pageDuration, walk,
  type Doc, type Page,
} from '@digital-canvas/scene';
import { drawFrameAt, type Renderer } from '@digital-canvas/render';
import type { ProjectFile } from '@digital-canvas/storage';
import { gifFrames, gifPageDuration } from '../../../apps/web/src/lib/giftime.ts';
import { withRenderer, type Engine } from './engine.ts';
import { platform, type VideoExportOptions } from './platform.ts';

export const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Draw the timeline at `t` (page, animations, transition) onto a canvas already scaled to page px (shared with the editor: render `drawFrameAt`). */
export function drawAt(_eng: Engine, r: Renderer, canvas: Canvas, doc: Doc, t: number): void {
  drawFrameAt(r, canvas, doc, t);
}

/** RGBA pixels of a surface (unpremultiplied sRGB). */
export function snapshot(eng: Engine, surface: ReturnType<Engine['ck']['MakeSurface']>, W: number, H: number): Uint8Array {
  const ck = eng.ck;
  surface!.flush();
  const img = surface!.makeImageSnapshot();
  const px = img.readPixels(0, 0, { width: W, height: H, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array;
  img.delete();
  return px;
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
  const f = frameAt(file.doc, t);
  for (const el of walk(f.page.elements)) {
    if (el.type !== 'video' || !file.assets.has(el.asset)) continue;
    const ct = clipTime(el, f.local, file.doc.assets[el.asset]?.duration ?? Infinity);
    if (ct === null) continue;
    const png = await platform().videoFrame(file.assets.get(el.asset)!, ct, file.doc.assets[el.asset]?.mime).catch(() => null);
    if (png) out.set(el.asset, png);
  }
  return out;
}

/** The design as an MP4, by the platform (ffmpeg in Node, WebCodecs in a browser). */
export function exportMp4(file: ProjectFile, opts: VideoExportOptions = {}): Promise<Uint8Array> {
  const why = platform().videoProblem();
  if (why) return Promise.reject(new Error(why));
  return platform().exportMp4(file, opts);
}

export type { VideoExportOptions };
