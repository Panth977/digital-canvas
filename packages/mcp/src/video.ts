/// <reference path="./types/gifenc.d.ts" />
/**
 * Moving pictures: frames drawn by the same CanvasKit renderer as the editor
 * (animations via scene `animateAt`, page transitions via `frameAt`). MP4 is
 * the platform's (ffmpeg in Node, WebCodecs in a browser); GIFs use gifenc
 * like the web app.
 */
import type { Canvas, Paint } from 'canvaskit-wasm';
import * as gifencModule from 'gifenc';
// gifenc is CommonJS: plain Node ESM sees only a default export, bundlers see named ones
const gifenc = (typeof (gifencModule as { GIFEncoder?: unknown }).GIFEncoder === 'function' ? gifencModule : (gifencModule as unknown as { default: typeof gifencModule }).default);
const { GIFEncoder, applyPalette, quantize } = gifenc;
import {
  animateAt, animationEnd, clipTime, frameAt, isVideo, pageDuration, transitionLayers, walk,
  type Doc, type Page, type TransitionLayer,
} from '@digital-canvas/scene';
import type { Renderer } from '@digital-canvas/render';
import type { ProjectFile } from '@digital-canvas/storage';
import { gifFrames, gifPageDuration } from '../../../apps/web/src/lib/giftime.ts';
import { withRenderer, type Engine } from './engine.ts';
import { platform, type VideoExportOptions } from './platform.ts';

export const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

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
