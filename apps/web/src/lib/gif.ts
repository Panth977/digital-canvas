/**
 * Export pages as an animated GIF (gifenc, MIT): each page plays its
 * animations (scene `animateAt`) and then holds; a single static page is a
 * one-frame GIF. Frames are drawn with the CanvasKit renderer like the MP4 export.
 */
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { animateAt, animationEnd, isVideo, pageDuration } from '@digital-canvas/scene';
import type { EditorState } from './editor.svelte.ts';
import { gifFrames, gifPageDuration } from './giftime.ts';

export interface GifOptions {
  /** Page ids, in order. */
  pages: string[];
  /** Output scale (default: longest side 800 px, never above 1). */
  scale?: number;
  /** Frames per second while animating (default 15). */
  fps?: number;
  /** Leave the page background out: see-through pixels (GIF has 1-bit transparency). */
  transparent?: boolean;
  onProgress?: (fraction: number) => void;
}

export async function exportGif(ed: EditorState, opts: GifOptions): Promise<Uint8Array> {
  const doc = ed.doc;
  const pages = opts.pages.map((id) => doc.pages.find((p) => p.id === id)).filter((p) => !!p);
  if (!pages.length) throw new Error('no pages to export');
  const fps = opts.fps ?? 15;
  const scale = opts.scale ?? Math.min(1, 800 / Math.max(doc.width, doc.height));
  const W = Math.max(1, Math.round(doc.width * scale)), H = Math.max(1, Math.round(doc.height * scale));
  const video = isVideo(doc);
  const frames = gifFrames(pages.map((p) => {
    const animEnd = animationEnd(p);
    return { duration: gifPageDuration(video, pageDuration(p), animEnd), animEnd };
  }), fps);
  // one static page: a still GIF
  const still = frames.length === 1;

  const ck = ed.engine.ck;
  const surface = ck.MakeSurface(W, H);
  if (!surface) throw new Error('could not make a drawing surface');
  const gif = GIFEncoder();
  try {
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i]!;
      const page = pages[f.page]!;
      const canvas = surface.getCanvas();
      canvas.clear(opts.transparent ? ck.TRANSPARENT : ck.WHITE);
      canvas.save();
      canvas.scale(W / doc.width, H / doc.height);
      ed.renderer.drawPage(canvas, doc, animateAt(doc, page, f.t), {}, !opts.transparent);
      canvas.restore();
      surface.flush();
      const img = surface.makeImageSnapshot();
      const px = img.readPixels(0, 0, { width: W, height: H, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array;
      img.delete();
      let palette, index, tr: { transparent?: boolean; transparentIndex?: number; dispose?: number } = {};
      if (opts.transparent) {
        // half-transparent pixels round to fully on or off
        palette = quantize(px, 256, { format: 'rgba4444', oneBitAlpha: true });
        index = applyPalette(px, palette, 'rgba4444');
        const t = palette.findIndex((c) => c[3] === 0);
        // each frame replaces the last (no smearing through the see-through parts)
        if (t >= 0) tr = { transparent: true, transparentIndex: t, dispose: 2 };
      } else {
        palette = quantize(px, 256);
        index = applyPalette(px, palette);
      }
      gif.writeFrame(index, W, H, still ? { palette, ...tr } : { palette, delay: f.delay, repeat: i === 0 ? 0 : undefined, ...tr });
      opts.onProgress?.((i + 1) / frames.length);
      // let the page breathe on long exports
      if (i % 8 === 7) await new Promise((r) => setTimeout(r, 0));
    }
    gif.finish();
    return gif.bytes();
  } finally {
    surface.delete();
  }
}
