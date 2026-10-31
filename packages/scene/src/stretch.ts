/**
 * Change a sound's speed without changing its pitch (WSOLA: overlap-add of
 * short windows, each slid to line up with what is already written). Browsers
 * do this inside <video>, ffmpeg with `atempo`; browser exports have neither, so
 * they use this. Pure, and the channels stay in step.
 */
export function stretchAudio(channels: readonly Float32Array[], speed: number, rate = 48000): Float32Array[] {
  const first = channels[0];
  if (!first || speed === 1 || first.length === 0) return channels.map((c) => c);
  const n = first.length;
  const outLen = Math.round(n / speed);
  const W = Math.round(rate * 0.04 / 2) * 2, hop = W / 2, tol = Math.round(rate * 0.01);
  const window = new Float32Array(W);
  for (let i = 0; i < W; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / W);
  const mono = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) mono[i]! += c[i]! / channels.length;
  const out = channels.map(() => new Float32Array(outLen + W));
  const weight = new Float32Array(outLen + W);
  let prev = -1;
  for (let o = 0; o < outLen; o += hop) {
    const ideal = Math.round(o * speed);
    let best = Math.min(ideal, Math.max(0, n - 1));
    if (prev >= 0) {
      // the spot near `ideal` that sounds most like what would naturally follow
      const natural = prev + hop;
      let top = -Infinity;
      for (let s = Math.max(0, ideal - tol); s <= Math.min(n - W, ideal + tol); s += 4) {
        let c = 0;
        for (let i = 0; i < hop; i += 4) c += mono[natural + i]! * mono[s + i]!;
        if (c > top && Number.isFinite(c)) { top = c; best = s; }
      }
    }
    for (let i = 0; i < W && best + i < n; i++) {
      for (let k = 0; k < channels.length; k++) out[k]![o + i]! += channels[k]![best + i]! * window[i]!;
      weight[o + i]! += window[i]!;
    }
    prev = best;
  }
  return out.map((c) => {
    const r = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) r[i] = weight[i]! > 0.01 ? c[i]! / weight[i]! : 0;
    return r;
  });
}
