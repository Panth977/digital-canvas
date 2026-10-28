/**
 * MP4 export in a browser or Web Worker, matching the Node exporter: frames
 * drawn by CanvasKit with animations and page transitions (drawAt), clips
 * decoded frame-exactly by WebCodecs (Mediabunny), sound (timeline audio with
 * trims, volume and fades, plus the clips' own sound) mixed in JS, encoded as
 * H.264 + AAC where the browser has them (else VP9 / Opus) into MP4.
 */
import {
  AudioSample, AudioSampleSource, BufferSource, BufferTarget, CanvasSource, Input, ALL_FORMATS, Mp4OutputFormat, Output, QUALITY_HIGH, VideoSampleSink,
  getFirstEncodableAudioCodec, getFirstEncodableVideoCodec, type VideoSample,
} from 'mediabunny';
import { clipTime, frameAt, pageDuration, pageStart, totalDuration, walk, type Doc, type Page, type VideoElement } from '@digital-canvas/scene';
import type { ProjectFile } from '@digital-canvas/storage';
import { withRenderer } from '../engine.ts';
import type { VideoExportOptions } from '../platform.ts';
import { drawAt, even, snapshot } from '../video.ts';
import { RATE, decodeStereo, samplePixels } from './media.ts';

interface Sound { asset: string; at: number; offset: number; dur: number; volume: number; loop?: boolean; fadeIn?: number; fadeOut?: number }

function sounds(doc: Doc, assets: Map<string, Uint8Array>): Sound[] {
  const out: Sound[] = (doc.audio ?? []).filter((a) => assets.has(a.asset)).map((a) => ({ asset: a.asset, at: a.start, offset: a.offset, dur: a.duration, volume: a.volume ?? 1, fadeIn: a.fadeIn, fadeOut: a.fadeOut }));
  for (const p of doc.pages) {
    if (p.hidden) continue;
    for (const e of walk(p.elements)) {
      if (e.type !== 'video' || e.muted || e.hidden || (e.volume ?? 1) === 0 || !assets.has(e.asset)) continue;
      const fileDur = doc.assets[e.asset]?.duration ?? pageDuration(p);
      const a = e.trimStart ?? 0, b = Math.min(e.trimEnd ?? fileDur, fileDur);
      out.push({ asset: e.asset, at: pageStart(doc, p.id), offset: a, dur: Math.min(pageDuration(p), e.loop ? pageDuration(p) : b - a), volume: e.volume ?? 1, loop: e.loop });
    }
  }
  return out;
}

/** Every sound of the design in one stereo buffer at RATE, or null when silent. */
export async function mixSounds(file: ProjectFile, total: number): Promise<[Float32Array, Float32Array] | null> {
  const list = sounds(file.doc, file.assets).filter((s) => s.at < total);
  if (!list.length) return null;
  const len = Math.max(1, Math.ceil(total * RATE));
  const L = new Float32Array(len), R = new Float32Array(len);
  const whole = new Map<string, [Float32Array, Float32Array] | null>();
  let any = false;
  for (const s of list) {
    const dur = Math.max(0.05, Math.min(s.dur, total - s.at));
    let src: [Float32Array, Float32Array] | null;
    let base = 0;
    if (s.loop) {
      if (!whole.has(s.asset)) whole.set(s.asset, await decodeStereo(file.assets.get(s.asset)!));
      src = whole.get(s.asset)!;
      base = Math.round(s.offset * RATE);
    } else {
      src = await decodeStereo(file.assets.get(s.asset)!, s.offset, s.offset + dur);
    }
    if (!src) continue;
    any = true;
    const [sl, sr] = src;
    const at = Math.round(s.at * RATE), n = Math.round(dur * RATE);
    const fi = Math.round((s.fadeIn ?? 0) * RATE), fo = Math.round((s.fadeOut ?? 0) * RATE);
    const loopLen = Math.max(1, sl.length - base);
    for (let i = 0; i < n && at + i < len; i++) {
      const j = s.loop ? base + (i % loopLen) : i;
      if (j >= sl.length) break;
      let g = s.volume;
      if (fi && i < fi) g *= i / fi;
      if (fo && i > n - fo) g *= Math.max(0, (n - i) / fo);
      L[at + i]! += sl[j]! * g;
      R[at + i]! += sr[j]! * g;
    }
  }
  return any ? [L, R] : null;
}

/** Can this browser encode video at all? */
export function webCodecsProblem(): string | null {
  if (typeof VideoEncoder === 'undefined' || typeof OffscreenCanvas === 'undefined') return 'this browser cannot encode video (no WebCodecs): use a current Chrome, Edge or Safari on the device, or export_gif';
  return null;
}

export async function exportMp4Browser(file: ProjectFile, opts: VideoExportOptions = {}): Promise<Uint8Array> {
  const doc = file.doc;
  const fps = opts.fps ?? 30;
  const total = totalDuration(doc);
  if (total <= 0) throw new Error('the design has no visible pages');
  const scale = Math.min(1, (opts.maxSide ?? 1920) / Math.max(doc.width, doc.height));
  const W = even(doc.width * scale), H = even(doc.height * scale);
  const frames = Math.max(1, Math.round(total * fps));

  const vcodec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1', 'vp8'], { width: W, height: H });
  if (!vcodec) throw new Error(`this browser cannot encode ${W}×${H} video`);
  const out2d = new OffscreenCanvas(W, H);
  const g = out2d.getContext('2d')!;
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const vsrc = new CanvasSource(out2d, { codec: vcodec, bitrate: QUALITY_HIGH });
  output.addVideoTrack(vsrc, { frameRate: fps });
  const mix = await mixSounds(file, total);
  let asrc: AudioSampleSource | null = null;
  if (mix) {
    const acodec = await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: RATE });
    if (acodec) { asrc = new AudioSampleSource({ codec: acodec, bitrate: 192_000 }); output.addAudioTrack(asrc); }
  }
  await output.start();

  // ---- which clip frames each output frame needs (the page, and the previous page during a transition)
  interface Plan { el: VideoElement; page: Page; times: number[]; at: Map<number, number>; last: number; w: number; h: number; it?: AsyncGenerator<VideoSample | null>; input?: Input }
  const plans = new Map<string, Plan>();
  const need = (page: Page, local: number, i: number) => {
    for (const el of walk(page.elements)) {
      if (el.type !== 'video' || el.hidden || !file.assets.has(el.asset)) continue;
      const ct = clipTime(el, local, doc.assets[el.asset]?.duration ?? Infinity);
      const key = `${page.id}/${el.id}`;
      let p = plans.get(key);
      if (!p) {
        const m = doc.assets[el.asset];
        const iw = m?.width ?? el.w, ih = m?.height ?? el.h;
        const k = Math.min(1, Math.max((el.w * scale) / iw, (el.h * scale) / ih) * 1.25);
        plans.set(key, (p = { el, page, times: [], at: new Map(), last: i, w: even(iw * k), h: even(ih * k) }));
      }
      if (ct === null) continue;
      p.at.set(i, p.times.length);
      p.times.push(Math.max(0, ct));
      p.last = i;
    }
  };
  for (let i = 0; i < frames; i++) {
    const f = frameAt(doc, i / fps);
    if (f.prev) need(f.prev.page, Math.max(0, f.prev.local - 1 / fps), i);
    need(f.page, f.local, i);
  }

  try {
    await withRenderer(file, async (r, eng) => {
      const ck = eng.ck;
      const surface = ck.MakeSurface(W, H);
      if (!surface) throw new Error(`could not make a ${W}×${H} surface`);
      try {
        for (let i = 0; i < frames; i++) {
          const t = i / fps;
          for (const p of plans.values()) {
            const idx = p.at.get(i);
            if (idx === undefined) {
              const f = frameAt(doc, t);
              if (f.page.id === p.page.id || f.prev?.page.id === p.page.id) r.setVideoFrame(p.el.asset, null);
              continue;
            }
            if (!p.it) {
              p.input = new Input({ source: new BufferSource(file.assets.get(p.el.asset)!), formats: ALL_FORMATS });
              const track = await p.input.getPrimaryVideoTrack();
              p.it = track && (await track.canDecode()) ? new VideoSampleSink(track).samplesAtTimestamps(p.times) : (async function* () { for (const _ of p.times) yield null; })();
            }
            const next = await p.it.next();
            const sample = next.done ? null : next.value;
            if (sample) {
              const px = samplePixels(sample, p.w, p.h);
              sample.close();
              r.setVideoFrame(p.el.asset, ck.MakeImage({ width: p.w, height: p.h, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }, px, p.w * 4));
            } else r.setVideoFrame(p.el.asset, null);
            if (i === p.last) { await p.it.return?.(undefined); p.input?.dispose?.(); }
          }
          const canvas = surface.getCanvas();
          canvas.clear(ck.WHITE);
          canvas.save();
          canvas.scale(W / doc.width, H / doc.height);
          drawAt(eng, r, canvas, doc, t);
          canvas.restore();
          const px = snapshot(eng, surface, W, H);
          g.putImageData(new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer, px.byteOffset, px.length), W, H), 0, 0);
          await vsrc.add(t, 1 / fps);
          opts.onProgress?.((i + 1) / frames * 0.95);
        }
      } finally {
        surface.delete();
      }
    });
    vsrc.close();
    if (asrc && mix) {
      const [L, R] = mix;
      const CH = RATE; // one second per sample
      for (let s = 0; s < L.length; s += CH) {
        const n = Math.min(CH, L.length - s);
        const data = new Float32Array(n * 2);
        data.set(L.subarray(s, s + n), 0);
        data.set(R.subarray(s, s + n), n);
        const sample = new AudioSample({ data, format: 'f32-planar', numberOfChannels: 2, sampleRate: RATE, timestamp: s / RATE });
        await asrc.add(sample);
        sample.close();
      }
      asrc.close();
    }
    await output.finalize();
    opts.onProgress?.(1);
    return new Uint8Array((output.target as BufferTarget).buffer!);
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  } finally {
    for (const p of plans.values()) { void p.it?.return?.(undefined); p.input?.dispose?.(); }
  }
}
