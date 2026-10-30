/**
 * Pure mask maths for the on-device image tools. Alphas are 0..255 byte arrays
 * (w×h); nothing here touches the DOM, so all of it is unit-tested.
 */

export interface Box { x: number; y: number; w: number; h: number }

/** Share of pixels that are clearly subject, 0..1. */
export function coverage(alpha: ArrayLike<number>): number {
  let n = 0;
  for (let i = 0; i < alpha.length; i++) if (alpha[i]! > 127) n++;
  return alpha.length ? n / alpha.length : 0;
}

/** The subject's box in fractions of the image, or null when there is no subject. */
export function subjectBox(alpha: ArrayLike<number>, w: number, h: number, threshold = 127): Box | null {
  let l = w, t = h, r = -1, b = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (alpha[y * w + x]! > threshold) {
      if (x < l) l = x;
      if (x > r) r = x;
      if (y < t) t = y;
      if (y > b) b = y;
    }
  }
  return r < 0 ? null : { x: l / w, y: t / h, w: (r - l + 1) / w, h: (b - t + 1) / h };
}

/** Box-filter a float image with radius `r` (edges use the pixels that exist). */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    let sum = 0, n = 0;
    const row = y * w;
    for (let x = 0; x <= Math.min(r, w - 1); x++) { sum += src[row + x]!; n++; }
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / n;
      if (x + r + 1 < w) { sum += src[row + x + r + 1]!; n++; }
      if (x - r >= 0) { sum -= src[row + x - r]!; n--; }
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0, n = 0;
    for (let y = 0; y <= Math.min(r, h - 1); y++) { sum += tmp[y * w + x]!; n++; }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / n;
      if (y + r + 1 < h) { sum += tmp[(y + r + 1) * w + x]!; n++; }
      if (y - r >= 0) { sum -= tmp[(y - r) * w + x]!; n--; }
    }
  }
  return out;
}

/**
 * Guided filter (He et al.): sharpens a soft, upscaled mask along the edges of
 * the full-size picture, so hair and fine outlines follow the photo rather than
 * the model's 512 px grid. `guide` and `mask` are 0..1 floats.
 */
export function guidedFilter(guide: Float32Array, mask: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
  const n = guide.length;
  const gp = new Float32Array(n), gg = new Float32Array(n);
  for (let i = 0; i < n; i++) { gp[i] = guide[i]! * mask[i]!; gg[i] = guide[i]! * guide[i]!; }
  const mg = boxBlur(guide, w, h, r), mp = boxBlur(mask, w, h, r), mgp = boxBlur(gp, w, h, r), mgg = boxBlur(gg, w, h, r);
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const cov = mgp[i]! - mg[i]! * mp[i]!, varg = mgg[i]! - mg[i]! * mg[i]!;
    a[i] = cov / (varg + eps);
    b[i] = mp[i]! - a[i]! * mg[i]!;
  }
  const ma = boxBlur(a, w, h, r), mb = boxBlur(b, w, h, r);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.max(0, Math.min(1, ma[i]! * guide[i]! + mb[i]!));
  return out;
}

/** Grow a binary mask by `r` pixels: an object's edge stays out of the fill. */
export function dilate(alpha: Uint8Array | Uint8ClampedArray, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return Uint8Array.from(alpha);
  const f = new Float32Array(alpha.length);
  for (let i = 0; i < f.length; i++) f[i] = alpha[i]! > 127 ? 1 : 0;
  const b = boxBlur(f, w, h, r);
  const out = new Uint8Array(alpha.length);
  for (let i = 0; i < out.length; i++) out[i] = b[i]! > 0.001 ? 255 : 0;
  return out;
}

/** Soften a mask's edge so a patch melts into the picture. */
export function feather(alpha: Uint8Array | Uint8ClampedArray, w: number, h: number, r: number): Uint8Array {
  const f = new Float32Array(alpha.length);
  for (let i = 0; i < f.length; i++) f[i] = alpha[i]! / 255;
  const b = boxBlur(boxBlur(f, w, h, r), w, h, r);
  const out = new Uint8Array(alpha.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(b[i]! * 255);
  return out;
}

/**
 * The window (in image pixels) to send to a 512 px inpainter: the mask's box
 * with room around it for context, never smaller than the model's input when
 * the image allows it, so small repairs keep their full sharpness. Square
 * unless the image is too narrow for that: the mask must always fit inside.
 */
export function inpaintWindow(mask: Box, iw: number, ih: number, size = 512): Box {
  const side = Math.max(size, Math.ceil(Math.max(mask.w, mask.h) * 1.8));
  const w = Math.min(iw, side), h = Math.min(ih, side);
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
  return { x: clamp(Math.round(mask.x + mask.w / 2 - w / 2), iw - w), y: clamp(Math.round(mask.y + mask.h / 2 - h / 2), ih - h), w, h };
}

/** The canvas box for extending an image to a new shape, and where the old image sits in it. */
export function expandLayout(iw: number, ih: number, aspect: number): { w: number; h: number; x: number; y: number } {
  const current = iw / ih;
  if (Math.abs(current - aspect) < 0.001) return { w: iw, h: ih, x: 0, y: 0 };
  if (aspect > current) { const w = Math.round(ih * aspect); return { w, h: ih, x: Math.round((w - iw) / 2), y: 0 }; }
  const h = Math.round(iw / aspect);
  return { w: iw, h, x: 0, y: Math.round((h - ih) / 2) };
}

/** A text line's colour: the mean of the pixels furthest from its background (the median tone). */
export function inkColor(px: ArrayLike<number>): string {
  const tones: number[] = [];
  for (let i = 0; i + 2 < px.length; i += 4) tones.push(0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!);
  const median = [...tones].sort((a, b) => a - b)[tones.length >> 1] ?? 0;
  let far = 0;
  for (const t of tones) far = Math.max(far, Math.abs(t - median));
  let r = 0, g = 0, b = 0, k = 0;
  tones.forEach((t, j) => { if (Math.abs(t - median) > far * 0.7) { r += px[j * 4]!; g += px[j * 4 + 1]!; b += px[j * 4 + 2]!; k++; } });
  const hex = (v: number) => Math.round(v / Math.max(1, k)).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
