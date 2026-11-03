/**
 * Mockups made from a photo (mockup plugins): the photo + four corners of the
 * print area → the maps of mockup format v1 (render/mockup.ts), so the
 * existing compositor draws them like any library mockup.
 *
 * `quadMockupBuffers` comes from `@digital-canvas/render/mockup` once r20-render
 * is merged; until then the fallback below makes the same maps. Pure (no DOM),
 * so it runs in the mockup worker.
 */
import * as Mockup from '@digital-canvas/render/mockup';
import type { MockupBuffers, Rgba } from '@digital-canvas/render/mockup';

export type Corners = [[number, number], [number, number], [number, number], [number, number]];
export interface QuadSpec { corners: Corners; shade?: number; width: number; height: number }

const M = Mockup as unknown as Record<string, unknown>;

export function quadMockupBuffers(photo: Rgba, spec: QuadSpec, mask?: Rgba | null): MockupBuffers {
  const own = M.quadMockupBuffers as ((p: Rgba, s: QuadSpec, m?: Rgba | null) => MockupBuffers) | undefined;
  if (typeof own === 'function') return own(photo, spec, mask);
  return quadBuffers(photo, spec, mask);
}

/** width / height of the print area: mean of the opposite edges. */
export function quadAspect(c: Corners): number {
  const d = (a: [number, number], b: [number, number]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const w = (d(c[0], c[1]) + d(c[3], c[2])) / 2, h = (d(c[0], c[3]) + d(c[1], c[2])) / 2;
  return h > 0 ? w / h : 1;
}

/** The unit square → the quad (TL, TR, BR, BL) as a 3×3 homography, row-major (Heckbert). */
export function squareToQuad(c: Corners): number[] {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = c;
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) return [x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0, 1];
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
}

/** Inverse of a 3×3 matrix (row-major). */
export function invert3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m as [number, number, number, number, number, number, number, number, number];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error('the corners do not make a four-sided shape');
  const k = 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}

/** A photo point → (u, v) on the print area (0..1 inside). */
export function uvAt(inv: number[], x: number, y: number): [number, number] {
  const w = inv[6]! * x + inv[7]! * y + inv[8]!;
  return [(inv[0]! * x + inv[1]! * y + inv[2]!) / w, (inv[3]! * x + inv[4]! * y + inv[5]!) / w];
}

const lum = (d: Uint8Array | Uint8ClampedArray, p: number) => 0.2126 * d[p]! + 0.7152 * d[p + 1]! + 0.0722 * d[p + 2]!;

function quadBuffers(photo: Rgba, spec: QuadSpec, mask?: Rgba | null): MockupBuffers {
  const W = photo.width, H = photo.height, n = W * H;
  // corners are in the plugin's photo pixels; the photo may be decoded at another size
  const kx = W / (spec.width || W), ky = H / (spec.height || H);
  const c = spec.corners.map(([x, y]) => [x * kx, y * ky]) as Corners;
  const inv = invert3(squareToQuad(c));
  const shadeAmt = Math.max(0, Math.min(1, spec.shade ?? 0.8));
  const uvHi = new Uint8ClampedArray(n * 4), uvLo = new Uint8ClampedArray(n * 4), shade = new Uint8ClampedArray(n * 4);
  const pd = photo.data;
  const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
  const bx0 = Math.max(0, Math.floor(Math.min(...xs)) - 1), bx1 = Math.min(W - 1, Math.ceil(Math.max(...xs)) + 1);
  const by0 = Math.max(0, Math.floor(Math.min(...ys)) - 1), by1 = Math.min(H - 1, Math.ceil(Math.max(...ys)) + 1);
  const inside = (u: number, v: number) => u >= 0 && u <= 1 && v >= 0 && v <= 1;
  // mean light of the print area: the design keeps its colours where the photo is as bright as that
  let sum = 0, cnt = 0;
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
    const [u, v] = uvAt(inv, x + 0.5, y + 0.5);
    if (inside(u, v)) { sum += lum(pd, (y * W + x) * 4); cnt++; }
  }
  const mean = cnt ? Math.max(1, sum / cnt) : 128;
  const maskAt = (x: number, y: number): number => {
    if (!mask) return 1;
    const mx = Math.min(mask.width - 1, Math.floor(((x + 0.5) / W) * mask.width)), my = Math.min(mask.height - 1, Math.floor(((y + 0.5) / H) * mask.height));
    const p = (my * mask.width + mx) * 4;
    return (lum(mask.data, p) / 255) * (mask.data[p + 3]! / 255);
  };
  for (let i = 0, p = 0; i < n; i++, p += 4) { shade[p] = shade[p + 1] = shade[p + 2] = 128; shade[p + 3] = uvHi[p + 3] = uvLo[p + 3] = 255; }
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      // 4 samples per pixel: soft edges
      let hits = 0;
      for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]] as const) { const [u, v] = uvAt(inv, x + ox, y + oy); if (inside(u, v)) hits++; }
      if (!hits) continue;
      const cover = (hits / 4) * maskAt(x, y);
      if (cover <= 0) continue;
      let [u, v] = uvAt(inv, x + 0.5, y + 0.5);
      u = Math.min(1, Math.max(0, u)); v = Math.min(1, Math.max(0, v));
      const U = Math.round(u * 65535), V = Math.round(v * 65535);
      const p = (y * W + x) * 4;
      uvHi[p] = U >> 8; uvLo[p] = U & 255;
      uvHi[p + 1] = V >> 8; uvLo[p + 1] = V & 255;
      uvHi[p + 2] = Math.max(1, Math.round(cover * 255));
      const light = 1 + (lum(pd, p) / mean - 1) * shadeAmt;
      shade[p] = shade[p + 1] = shade[p + 2] = Math.max(0, Math.min(255, Math.round(light * 128)));
    }
  }
  return { base: photo, uvHi: { width: W, height: H, data: uvHi }, uvLo: { width: W, height: H, data: uvLo }, shade: { width: W, height: H, data: shade }, tint: null };
}
