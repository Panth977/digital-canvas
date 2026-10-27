/**
 * Export a design as an MP4 video in the browser: each frame is drawn by the CanvasKit renderer,
 * video clips are decoded frame-exactly with WebCodecs (via Mediabunny), sounds are mixed with an
 * OfflineAudioContext, and everything is encoded (H.264 + AAC where the browser has them, else
 * VP9 / Opus) into an MP4 file.
 */
import {
  ALL_FORMATS, AudioBufferSource, BlobSource, BufferTarget, CanvasSource, Input, Mp4OutputFormat, Output, QUALITY_HIGH,
  VideoSampleSink, getFirstEncodableAudioCodec, getFirstEncodableVideoCodec,
} from 'mediabunny';
import { clipTime, pageDuration, pageStart, totalDuration, walk, type Doc, type VideoElement } from '@digital-canvas/scene';
import type { EditorState } from './editor.svelte.ts';

export interface Mp4Options {
  fps?: number;
  /** Longest side in px (default 1920, like a 1080p export). */
  maxSide?: number;
  onProgress?: (fraction: number) => void;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const RATE = 48000;

/** Mix every sound of the design (timeline sounds and the clips' own sound) into one buffer. */
async function mixAudio(doc: Doc, assets: Map<string, Uint8Array>, total: number): Promise<AudioBuffer | null> {
  type Src = { asset: string; at: number; offset: number; dur: number; volume: number; loop?: boolean };
  const srcs: Src[] = (doc.audio ?? []).map((a) => ({ asset: a.asset, at: a.start, offset: a.offset, dur: a.duration, volume: a.volume ?? 1 }));
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
    node.connect(gain).connect(ctx.destination);
    node.start(s.at, s.offset, s.loop ? undefined : Math.min(s.dur, total - s.at));
    if (s.loop) node.stop(Math.min(total, s.at + s.dur));
    any = true;
  }
  return any ? ctx.startRendering() : null;
}

export async function exportMp4(ed: EditorState, opts: Mp4Options = {}): Promise<Uint8Array> {
  const doc = ed.doc;
  const fps = opts.fps ?? 30;
  const total = totalDuration(doc);
  if (total <= 0) throw new Error('the design has no duration');
  const scale = Math.min(1, (opts.maxSide ?? 1920) / Math.max(doc.width, doc.height));
  const W = even(doc.width * scale), H = even(doc.height * scale);

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

  const ck = ed.engine.ck;
  const surface = ck.MakeSurface(W, H);
  if (!surface) throw new Error('could not make a drawing surface');
  const inputs: Input[] = [];
  const tracks = new Map<string, VideoSampleSink | null>();
  const sinkFor = async (asset: string) => {
    if (tracks.has(asset)) return tracks.get(asset)!;
    const bytes = ed.assets.get(asset);
    let sink: VideoSampleSink | null = null;
    if (bytes) {
      const input = new Input({ source: new BlobSource(new Blob([bytes as BlobPart])), formats: ALL_FORMATS });
      inputs.push(input);
      const track = await input.getPrimaryVideoTrack();
      if (track && (await track.canDecode())) sink = new VideoSampleSink(track);
    }
    tracks.set(asset, sink);
    return sink;
  };

  try {
    const frames = Math.max(1, Math.round(total * fps));
    let i = 0;
    for (const page of doc.pages) {
      if (page.hidden) continue;
      const start = pageStart(doc, page.id);
      const end = start + pageDuration(page);
      const first = i, last = Math.min(frames, Math.round(end * fps));
      // one sample iterator per clip on this page, fed the clip times of this page's frames
      const clips: { el: VideoElement; it: AsyncGenerator<unknown> | null; times: number[] }[] = [];
      for (const el of walk(page.elements)) {
        if (el.type !== 'video' || el.hidden) continue;
        const sink = await sinkFor(el.asset);
        const fileDur = doc.assets[el.asset]?.duration ?? Infinity;
        const times: number[] = [];
        for (let f = first; f < last; f++) times.push(clipTime(el, f / fps - start, fileDur) ?? -1);
        clips.push({ el, times, it: sink ? sink.samplesAtTimestamps(times.map((t) => Math.max(0, t))) : null });
      }
      for (let f = first; f < last; f++, i++) {
        for (const c of clips) {
          const t = c.times[f - first]!;
          const r = c.it ? await c.it.next() : null;
          const sample = r && !r.done ? (r.value as { toVideoFrame(): VideoFrame; close(): void } | null) : null;
          if (sample && t >= 0) {
            const vf = sample.toVideoFrame();
            ed.renderer.setVideoFrame(c.el.asset, ck.MakeImageFromCanvasImageSource(vf));
            vf.close();
          } else ed.renderer.setVideoFrame(c.el.asset, null);
          sample?.close();
        }
        const canvas = surface.getCanvas();
        canvas.clear(ck.WHITE);
        canvas.save();
        canvas.scale(W / doc.width, H / doc.height);
        ed.renderer.drawPage(canvas, doc, page);
        canvas.restore();
        surface.flush();
        const img = surface.makeImageSnapshot();
        const px = img.readPixels(0, 0, { width: W, height: H, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array;
        img.delete();
        g.putImageData(new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer, px.byteOffset, px.length), W, H), 0, 0);
        await vsrc.add(i / fps, 1 / fps);
        opts.onProgress?.(i / frames);
      }
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
    surface.delete();
    for (const inp of inputs) inp.dispose?.();
    // put the preview back
    void ed.player.seek(ed.player.time);
  }
}
