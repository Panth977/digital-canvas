/**
 * Export a design as an MP4 video in the browser: each frame is drawn by the CanvasKit renderer,
 * video clips are decoded frame-exactly with WebCodecs (via Mediabunny), sounds are mixed with an
 * OfflineAudioContext, and everything is encoded (H.264 + AAC where the browser has them, else
 * VP9 / Opus) into an MP4 file. Frames are render `drawFrameAt` (animations, element
 * timing, page transitions): the same drawing as the editor's live playback.
 */
import {
  ALL_FORMATS, AudioBufferSource, BlobSource, BufferTarget, CanvasSource, Input, Mp3OutputFormat, Mp4OutputFormat, Output, QUALITY_HIGH,
  VideoSampleSink, canEncodeAudio, getFirstEncodableAudioCodec, getFirstEncodableVideoCodec,
} from 'mediabunny';
import { clipTime, frameAt, pageDuration, pageStart, totalDuration, walk, type Doc, type Page, type VideoElement } from '@digital-canvas/scene';
import { drawFrameAt } from '@digital-canvas/render';
import type { EditorState } from './editor.svelte.ts';
import { soundDuration, videoSize } from './exportutil.ts';

export interface Mp4Options {
  fps?: number;
  /** Longest side in px (default 1920, like a 1080p export). */
  maxSide?: number;
  /** Canva's quality (480, 720, 1080, 2160 = 4K): the video's short side in px. Wins over `maxSide`. */
  quality?: number;
  /** Export this design instead of the editor's (e.g. one page of it, see `pageDoc`). */
  doc?: Doc;
  onProgress?: (fraction: number) => void;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const RATE = 48000;

/** Mix every sound of the design (timeline sounds and the clips' own sound) into one buffer. */
export async function mixAudio(doc: Doc, assets: Map<string, Uint8Array>, total: number): Promise<AudioBuffer | null> {
  type Src = { asset: string; at: number; offset: number; dur: number; volume: number; loop?: boolean; fadeIn?: number; fadeOut?: number };
  const srcs: Src[] = (doc.audio ?? []).map((a) => ({ asset: a.asset, at: a.start, offset: a.offset, dur: a.duration, volume: a.volume ?? 1, fadeIn: a.fadeIn, fadeOut: a.fadeOut }));
  for (const p of doc.pages) {
    if (p.hidden) continue;
    for (const e of walk(p.elements)) {
      if (e.type !== 'video' || e.muted || e.hidden || (e.volume ?? 1) === 0) continue;
      const fileDur = doc.assets[e.asset]?.duration ?? 0;
      const a = e.trimStart ?? 0, b = Math.min(e.trimEnd ?? fileDur, fileDur);
      srcs.push({ asset: e.asset, at: pageStart(doc, p.id), offset: a, dur: Math.min(pageDuration(p), e.loop ? pageDuration(p) : b - a), volume: e.volume ?? 1, loop: e.loop });
    }
  }
  if (!srcs.length) return null;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(total * RATE)), RATE);
  const decoded = new Map<string, AudioBuffer | null>();
  let any = false;
  for (const s of srcs) {
    if (!decoded.has(s.asset)) {
      const bytes = assets.get(s.asset);
      let buf: AudioBuffer | null = null;
      if (bytes) try { buf = await ctx.decodeAudioData(bytes.slice().buffer as ArrayBuffer); } catch { buf = null; }
      decoded.set(s.asset, buf);
    }
    const buf = decoded.get(s.asset);
    if (!buf || s.at >= total) continue;
    const node = ctx.createBufferSource();
    node.buffer = buf;
    if (s.loop) { node.loop = true; node.loopStart = s.offset; node.loopEnd = s.offset + Math.max(0.01, Math.min(buf.duration - s.offset, s.dur)); }
    const gain = ctx.createGain();
    gain.gain.value = s.volume;
    // fades (like the MCP exporters and the editor's playback)
    const len = Math.min(s.dur, total - s.at);
    if (s.fadeIn && s.fadeIn > 0) { gain.gain.setValueAtTime(0, s.at); gain.gain.linearRampToValueAtTime(s.volume, s.at + Math.min(s.fadeIn, len)); }
    if (s.fadeOut && s.fadeOut > 0) { const end = s.at + len; gain.gain.setValueAtTime(s.volume, Math.max(s.at, end - s.fadeOut)); gain.gain.linearRampToValueAtTime(0, end); }
    node.connect(gain).connect(ctx.destination);
    node.start(s.at, s.offset, s.loop ? undefined : Math.min(s.dur, total - s.at));
    if (s.loop) node.stop(Math.min(total, s.at + s.dur));
    any = true;
  }
  return any ? ctx.startRendering() : null;
}

/** A drawing surface for export frames: draws the timeline at a time and reads its pixels. */
export interface FrameSurface {
  W: number;
  H: number;
  /** RGBA (unpremultiplied sRGB) of the frame at `t` seconds; clip pictures must be set first. */
  draw(t: number): Uint8Array;
  dispose(): void;
}

/** The export's frame drawer: white, scaled to W×H, then render `drawFrameAt` (animations, timing, transitions). */
export function frameSurface(ed: EditorState, W: number, H: number, doc: Doc = ed.doc): FrameSurface {
  const ck = ed.engine.ck;
  const surface = ck.MakeSurface(W, H);
  if (!surface) throw new Error('could not make a drawing surface');
  return {
    W, H,
    draw(t) {
      const canvas = surface.getCanvas();
      canvas.clear(ck.WHITE);
      canvas.save();
      canvas.scale(W / doc.width, H / doc.height);
      drawFrameAt(ed.renderer, canvas, doc, t);
      canvas.restore();
      surface.flush();
      const img = surface.makeImageSnapshot();
      const px = img.readPixels(0, 0, { width: W, height: H, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array;
      img.delete();
      return px;
    },
    dispose: () => surface.delete(),
  };
}

/**
 * Feeds the renderer the clip pictures each frame needs, decoded frame-exactly
 * (WebCodecs via Mediabunny): the clips of the page showing and, during a
 * transition, of the page before it. `times` must be visited in order.
 */
class ClipFrames {
  private plans = new Map<string, { el: VideoElement; page: Page; times: number[]; at: Map<number, number>; last: number; it?: AsyncGenerator<unknown>; input?: Input }>();
  constructor(private ed: EditorState, private times: number[], private doc: Doc = ed.doc) {
    const need = (page: Page, local: number, i: number) => {
      for (const el of walk(page.elements)) {
        if (el.type !== 'video' || el.hidden || !ed.assets.has(el.asset)) continue;
        const ct = clipTime(el, local, doc.assets[el.asset]?.duration ?? Infinity);
        const key = `${page.id}/${el.id}`;
        let p = this.plans.get(key);
        if (!p) this.plans.set(key, (p = { el, page, times: [], at: new Map(), last: i }));
        if (ct === null) continue;
        p.at.set(i, p.times.length);
        p.times.push(Math.max(0, ct));
        p.last = i;
      }
    };
    times.forEach((t, i) => {
      const f = frameAt(doc, t);
      if (f.prev) need(f.prev.page, f.prev.local, i);
      need(f.page, f.local, i);
    });
  }

  /** Set the clip pictures for frame `i` (index into `times`). */
  async set(i: number): Promise<void> {
    const ck = this.ed.engine.ck, r = this.ed.renderer, doc = this.doc;
    for (const p of this.plans.values()) {
      const idx = p.at.get(i);
      if (idx === undefined) {
        const f = frameAt(doc, this.times[i]!);
        if (f.page.id === p.page.id || f.prev?.page.id === p.page.id) r.setVideoFrame(p.el.asset, null);
        continue;
      }
      if (!p.it) {
        p.input = new Input({ source: new BlobSource(new Blob([this.ed.assets.get(p.el.asset)! as BlobPart])), formats: ALL_FORMATS });
        const track = await p.input.getPrimaryVideoTrack();
        p.it = track && (await track.canDecode()) ? new VideoSampleSink(track).samplesAtTimestamps(p.times) : (async function* () { for (const _ of p.times) yield null; })();
      }
      const next = await p.it.next();
      const sample = next.done ? null : (next.value as { toVideoFrame(): VideoFrame; close(): void } | null);
      if (sample) {
        const vf = sample.toVideoFrame();
        r.setVideoFrame(p.el.asset, ck.MakeImageFromCanvasImageSource(vf));
        vf.close();
        sample.close();
      } else r.setVideoFrame(p.el.asset, null);
      if (i === p.last) { await p.it.return?.(undefined); p.input?.dispose?.(); p.input = undefined; }
    }
  }

  dispose(): void {
    for (const p of this.plans.values()) { void p.it?.return?.(undefined); p.input?.dispose?.(); }
  }
}

export const exportSize = (doc: Doc, maxSide = 1920) => {
  const scale = Math.min(1, maxSide / Math.max(doc.width, doc.height));
  return { W: even(doc.width * scale), H: even(doc.height * scale) };
};

/**
 * The export's picture at `t` (what the MP4 holds at that moment), as RGBA.
 * Tests compare it with the editor's live playback at the same time.
 */
export async function exportFrameAt(ed: EditorState, t: number, W: number, H: number): Promise<Uint8Array> {
  const clips = new ClipFrames(ed, [t]);
  const fs = frameSurface(ed, W, H);
  try {
    await clips.set(0);
    return fs.draw(t);
  } finally {
    clips.dispose();
    fs.dispose();
    void ed.player.refresh();
  }
}

export async function exportMp4(ed: EditorState, opts: Mp4Options = {}): Promise<Uint8Array> {
  const doc = opts.doc ?? ed.doc;
  const fps = opts.fps ?? 30;
  const total = totalDuration(doc);
  if (total <= 0) throw new Error('the design has no duration');
  const { W, H } = opts.quality ? videoSize(doc, opts.quality) : exportSize(doc, opts.maxSide);

  const vcodec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1', 'vp8'], { width: W, height: H });
  if (!vcodec) throw new Error('this browser cannot encode video (WebCodecs missing)');
  const out2d = new OffscreenCanvas(W, H);
  const g = out2d.getContext('2d')!;
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const vsrc = new CanvasSource(out2d, { codec: vcodec, bitrate: QUALITY_HIGH });
  output.addVideoTrack(vsrc, { frameRate: fps });

  const mix = await mixAudio(doc, ed.assets, total);
  let asrc: AudioBufferSource | null = null;
  if (mix) {
    const acodec = await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: RATE });
    if (acodec) {
      asrc = new AudioBufferSource({ codec: acodec, bitrate: 192_000 });
      output.addAudioTrack(asrc);
    }
  }
  await output.start();

  const frames = Math.max(1, Math.round(total * fps));
  const times = Array.from({ length: frames }, (_, i) => i / fps);
  const clips = new ClipFrames(ed, times, doc);
  const fs = frameSurface(ed, W, H, doc);
  try {
    for (let i = 0; i < frames; i++) {
      await clips.set(i);
      const px = fs.draw(times[i]!);
      g.putImageData(new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer, px.byteOffset, px.length), W, H), 0, 0);
      await vsrc.add(times[i]!, 1 / fps);
      opts.onProgress?.(i / frames);
    }
    vsrc.close();
    if (asrc && mix) {
      await asrc.add(mix);
      asrc.close();
    }
    await output.finalize();
    opts.onProgress?.(1);
    return new Uint8Array((output.target as BufferTarget).buffer!);
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  } finally {
    fs.dispose();
    clips.dispose();
    // put the preview back
    void ed.player.refresh();
  }
}

/**
 * Canva's "MP3 (audio only)": the design's sound track (timeline sounds and the
 * clips' own sound, mixed like the MP4) as an MP3. Browsers have no MP3
 * encoder in WebCodecs, so Mediabunny's LAME (WASM) extension is loaded on demand.
 */
export async function exportMp3(ed: EditorState, opts: { onProgress?: (fraction: number) => void } = {}): Promise<Uint8Array> {
  const doc = ed.doc;
  const total = soundDuration(doc);
  const mix = total > 0 ? await mixAudio(doc, ed.assets, total) : null;
  if (!mix) throw new Error('the design has no sound');
  opts.onProgress?.(0.3);
  if (!(await canEncodeAudio('mp3'))) (await import('@mediabunny/mp3-encoder')).registerMp3Encoder();
  const output = new Output({ format: new Mp3OutputFormat(), target: new BufferTarget() });
  const src = new AudioBufferSource({ codec: 'mp3', bitrate: 192_000 });
  output.addAudioTrack(src);
  await output.start();
  await src.add(mix);
  src.close();
  await output.finalize();
  opts.onProgress?.(1);
  return new Uint8Array((output.target as BufferTarget).buffer!);
}
