/**
 * Video and sound in a browser or Web Worker, with WebCodecs through
 * Mediabunny (no DOM, no Web Audio: both work inside a worker).
 */
import { ALL_FORMATS, AudioSampleSink, BufferSource, Input, VideoSampleSink, type VideoSample } from 'mediabunny';

export const RATE = 48_000;

/** Draw a decoded frame at w×h and return its RGBA pixels. */
export function samplePixels(sample: VideoSample, w: number, h: number): Uint8Array {
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  sample.draw(g, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
}

/** One frame of a video as PNG (null when this browser can't decode the codec). */
export async function videoFrameWebCodecs(bytes: Uint8Array, at: number): Promise<Uint8Array | null> {
  if (typeof VideoDecoder === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const sink = new VideoSampleSink(track);
    const sample = (await sink.getSample(Math.max(0, at))) ?? (await sink.getSample(await track.getFirstTimestamp()));
    if (!sample) return null;
    try {
      const w = track.displayWidth, h = track.displayHeight;
      const c = new OffscreenCanvas(w, h);
      sample.draw(c.getContext('2d')!, 0, 0, w, h);
      return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
    } finally {
      sample.close();
    }
  } catch {
    return null;
  } finally {
    input.dispose?.();
  }
}

/** A sound decoded to stereo at RATE (null when it has no decodable audio). */
export async function decodeStereo(bytes: Uint8Array, from = 0, until = Infinity): Promise<[Float32Array, Float32Array] | null> {
  if (typeof AudioDecoder === 'undefined') return null;
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) return null;
    const sink = new AudioSampleSink(track);
    const chunks: { t: number; l: Float32Array; r: Float32Array; rate: number }[] = [];
    for await (const s of sink.samples(from, Number.isFinite(until) ? until : undefined)) {
      try {
        const n = s.numberOfFrames;
        const l = new Float32Array(n), r = new Float32Array(n);
        s.copyTo(l, { planeIndex: 0, format: 'f32-planar' });
        if (s.numberOfChannels > 1) s.copyTo(r, { planeIndex: 1, format: 'f32-planar' }); else r.set(l);
        chunks.push({ t: s.timestamp, l, r, rate: s.sampleRate });
      } finally {
        s.close();
      }
    }
    if (!chunks.length) return null;
    const end = Math.min(until, Math.max(...chunks.map((c) => c.t + c.l.length / c.rate)));
    const len = Math.max(1, Math.ceil((end - from) * RATE));
    const L = new Float32Array(len), R = new Float32Array(len);
    for (const c of chunks) {
      // linear resampling into the output timeline
      const start = Math.round((c.t - from) * RATE);
      const outN = Math.round((c.l.length / c.rate) * RATE);
      const k = c.rate / RATE;
      for (let i = 0; i < outN; i++) {
        const o = start + i;
        if (o < 0 || o >= len) continue;
        const x = i * k, i0 = Math.floor(x), f = x - i0, i1 = Math.min(c.l.length - 1, i0 + 1);
        L[o] = c.l[i0]! * (1 - f) + c.l[i1]! * f;
        R[o] = c.r[i0]! * (1 - f) + c.r[i1]! * f;
      }
    }
    return [L, R];
  } catch {
    return null;
  } finally {
    input.dispose?.();
  }
}
