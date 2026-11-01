/** Speech samples → what goes on the timeline: an even level, a WAV file. Pure. */

/** Bring speech to one loudness, so lines and voices match; peaks stay clear of clipping. */
export function levelSpeech(pcm: Float32Array, rms = 0.11, peak = 0.92): Float32Array {
  let sum = 0, top = 0;
  for (const v of pcm) { sum += v * v; top = Math.max(top, Math.abs(v)); }
  if (!pcm.length || top === 0) return pcm;
  const g = Math.min(rms / Math.sqrt(sum / pcm.length), peak / top);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i]! * g;
  return out;
}

/** 16-bit mono WAV: every browser, Mediabunny and ffmpeg read it without a codec. */
export function encodeWav(pcm: Float32Array, rate: number): Uint8Array {
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const d = new DataView(bytes.buffer);
  const tag = (at: number, s: string): void => { for (let i = 0; i < 4; i++) d.setUint8(at + i, s.charCodeAt(i)); };
  tag(0, 'RIFF'); d.setUint32(4, 36 + pcm.length * 2, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, rate, true); d.setUint32(28, rate * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true);
  tag(36, 'data'); d.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) d.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, pcm[i]!)) * 32767), true);
  return bytes;
}
