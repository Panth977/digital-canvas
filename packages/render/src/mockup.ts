/**
 * Mockup compositor (format v1, see apps/web/public/mockups/index.json):
 * puts a design onto a photo of a product through a UV map, with the
 * product's lighting multiplied onto the design and an optional product
 * colour. Pure TypeScript on RGBA buffers (no DOM, no CanvasKit), so the web
 * app (in a Web Worker) and the MCP server (Node) share it.
 *
 * Per pixel (the contract):
 *   color = base
 *   if tint: color = lerp(color, color * productColor, tint/255)
 *   m = uvHi.B / 255
 *   if m > 0:
 *     u = (uvHi.R*256 + uvLo.R)/65535, v = (uvHi.G*256 + uvLo.G)/65535
 *     d = bilinear(design, u*(dw-1), v*(dh-1))   // design cover-fitted to `aspect`
 *     lit = clamp(d.rgb * shade/128)
 *     color = lerp(color, lit, m * d.a)
 *
 * The bilinear filter weights the four texels by their alpha (premultiplied
 * interpolation, then back to straight colour), so transparent texels never
 * bleed black into the edge of an opaque one; on opaque designs and at texel
 * centres it is the plain formula.
 *
 * Two steps so the expensive part is done once per mockup and size:
 * `prepareMockup` decodes the UV bytes to floats (and can shrink everything
 * to a small grid size), `compositeMockup` then runs per design or colour.
 */

/** A decoded image: RGBA 8-bit, straight alpha, rows top to bottom. */
export interface Rgba {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

/** One entry of index.json. */
export interface MockupEntry {
  id: string;
  label: string;
  category: string;
  width: number;
  height: number;
  /** width / height of the print area: the design is cover-fitted to it. */
  aspect: number;
  tint?: boolean;
  colors?: string[];
  credit?: string;
}

export interface MockupIndex {
  version: number;
  mockups: MockupEntry[];
}

/** The files of one mockup, decoded to RGBA (grey images: R = G = B). */
export interface MockupBuffers {
  base: Rgba;
  uvHi: Rgba;
  uvLo: Rgba;
  shade: Rgba;
  tint?: Rgba | null;
}

/**
 * A mockup ready to composite at one size. The print-area arrays are
 * compact: entry k describes pixel `inside[k]` (most of a photo is outside
 * the print area, so this keeps a prepared mockup small).
 */
export interface PreparedMockup {
  width: number;
  height: number;
  /** RGBA, opaque. */
  base: Uint8ClampedArray;
  /** Product mask 0..255 per pixel, or null (no recolouring). */
  tint: Uint8Array | null;
  /** Pixel indices with coverage > 0 (the only ones the design touches). */
  inside: Uint32Array;
  /** Print-area coordinates in [0,1], per inside pixel. */
  u: Float32Array;
  v: Float32Array;
  /** Coverage 0..1, per inside pixel. */
  cover: Float32Array;
  /** Lighting factor (shade/128), per inside pixel. */
  light: Float32Array;
}

export interface CompositeOptions {
  /** width / height of the print area (index.json `aspect`). */
  aspect: number;
  /** Product colour (#rgb / #rrggbb); only where the tint mask is set. */
  color?: string | null;
  /** 'cover' fills the print area (edges of a different-shaped design are cut off); 'contain' shows the whole design. */
  fit?: MockupFit;
}

export type MockupFit = 'cover' | 'contain';

/** Garments, packaging and home goods show the whole design; screens, signs and prints are filled edge to edge. */
export function defaultFit(entry: { category?: string; fit?: string }): MockupFit {
  if (entry.fit === 'cover' || entry.fit === 'contain') return entry.fit;
  return entry.category === 'Apparel' || entry.category === 'Packaging' || entry.category === 'Home' ? 'contain' : 'cover';
}

/** The categories the panel filters by (index.json may use others; they show under All). */
export const MOCKUP_CATEGORIES = ['Apparel', 'Outdoor', 'Print', 'Packaging', 'Devices', 'Home'] as const;

/** Long side of the grid renders. */
export const MOCKUP_SMALL = 400;

/** "#rgb" / "#rrggbb" → [r, g, b] in 0..1 (null when not a colour). */
export function parseHex(hex: string | null | undefined): [number, number, number] | null {
  if (!hex) return null;
  let s = hex.trim().replace(/^#/, '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  const n = parseInt(s, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function same(a: Rgba, b: Rgba, name: string): void {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`mockup ${name} is ${b.width}×${b.height}, base is ${a.width}×${a.height}`);
  if (b.data.length < b.width * b.height * 4) throw new Error(`mockup ${name}: expected RGBA pixels`);
}

/**
 * Decode the UV maps and lighting once. With `maxSide` smaller than the
 * mockup, every map is box-filtered down to that long side (u/v averaged by
 * coverage, so the print area's edges stay soft and in place).
 */
export function prepareMockup(b: MockupBuffers, maxSide?: number): PreparedMockup {
  const W = b.base.width, H = b.base.height;
  same(b.base, b.uvHi, 'uv-hi'); same(b.base, b.uvLo, 'uv-lo'); same(b.base, b.shade, 'shade');
  if (b.tint) same(b.base, b.tint, 'tint');
  const f = maxSide && maxSide < Math.max(W, H) ? Math.max(W, H) / maxSide : 1;
  return f === 1 ? prepareFull(b, W, H) : prepareSmall(b, W, H, f);
}

function prepareFull(b: MockupBuffers, W: number, H: number): PreparedMockup {
  const n = W * H;
  const hi = b.uvHi.data, lo = b.uvLo.data, sh = b.shade.data, bs = b.base.data, tn = b.tint?.data;
  let count = 0;
  for (let p = 2; p < n * 4; p += 4) if (hi[p]! > 0) count++;
  const base = new Uint8ClampedArray(n * 4);
  const tint = tn ? new Uint8Array(n) : null;
  const inside = new Uint32Array(count), u = new Float32Array(count), v = new Float32Array(count), cover = new Float32Array(count), light = new Float32Array(count);
  for (let i = 0, p = 0, k = 0; i < n; i++, p += 4) {
    base[p] = bs[p]!; base[p + 1] = bs[p + 1]!; base[p + 2] = bs[p + 2]!; base[p + 3] = 255;
    if (tint) tint[i] = tn![p]!;
    const m = hi[p + 2]!;
    if (m > 0) {
      inside[k] = i;
      cover[k] = m / 255;
      u[k] = (hi[p]! * 256 + lo[p]!) / 65535;
      v[k] = (hi[p + 1]! * 256 + lo[p + 1]!) / 65535;
      light[k] = sh[p]! / 128;
      k++;
    }
  }
  return { width: W, height: H, base, tint, inside, u, v, cover, light };
}

/** Box filter to `W/f × H/f`: each output pixel averages the source pixels under it. */
function prepareSmall(b: MockupBuffers, W: number, H: number, f: number): PreparedMockup {
  const w = Math.max(1, Math.round(W / f)), h = Math.max(1, Math.round(H / f));
  const n = w * h;
  const base = new Uint8ClampedArray(n * 4);
  const tint = b.tint ? new Uint8Array(n) : null;
  const U = new Float32Array(n), V = new Float32Array(n), C = new Float32Array(n), L = new Float32Array(n);
  const hi = b.uvHi.data, lo = b.uvLo.data, sh = b.shade.data, bs = b.base.data, tn = b.tint?.data;
  const fx = W / w, fy = H / h;
  let count = 0;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.min(H, Math.floor((y + 1) * fy)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.min(W, Math.floor((x + 1) * fx)));
      let r = 0, g = 0, bl = 0, t = 0, mc = 0, mu = 0, mv = 0, ml = 0, k = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0, p = (sy * W + x0) * 4; sx < x1; sx++, p += 4) {
          r += bs[p]!; g += bs[p + 1]!; bl += bs[p + 2]!;
          if (tn) t += tn[p]!;
          const m = hi[p + 2]! / 255;
          if (m > 0) {
            mc += m;
            mu += m * (hi[p]! * 256 + lo[p]!) / 65535;
            mv += m * (hi[p + 1]! * 256 + lo[p + 1]!) / 65535;
            ml += m * sh[p]! / 128;
          }
          k++;
        }
      }
      const i = y * w + x, q = i * 4;
      base[q] = r / k; base[q + 1] = g / k; base[q + 2] = bl / k; base[q + 3] = 255;
      if (tint) tint[i] = Math.round(t / k);
      if (mc > 0) {
        C[i] = mc / k; U[i] = mu / mc; V[i] = mv / mc; L[i] = ml / mc;
        count++;
      }
    }
  }
  const inside = new Uint32Array(count), u = new Float32Array(count), v = new Float32Array(count), cover = new Float32Array(count), light = new Float32Array(count);
  for (let i = 0, k = 0; i < n; i++) {
    if (!(C[i]! > 0)) continue;
    inside[k] = i; u[k] = U[i]!; v[k] = V[i]!; cover[k] = C[i]!; light[k] = L[i]!;
    k++;
  }
  return { width: w, height: h, base, tint, inside, u, v, cover, light };
}

/**
 * The part of the design shown in the print area: the largest centred
 * rectangle with the print area's aspect (CSS `object-fit: cover`).
 */
export function mockupCrop(dw: number, dh: number, aspect: number): { x: number; y: number; w: number; h: number } {
  if (!(aspect > 0)) return { x: 0, y: 0, w: dw, h: dh };
  if (dw / dh > aspect) {
    const w = dh * aspect;
    return { x: (dw - w) / 2, y: 0, w, h: dh };
  }
  const h = dw / aspect;
  return { x: 0, y: (dh - h) / 2, w: dw, h };
}

/** Composite a design onto a prepared mockup. Returns opaque RGBA (`out` is reused when given and big enough). */
export function compositeMockup(m: PreparedMockup, design: Rgba, opts: CompositeOptions, out?: Uint8ClampedArray): Uint8ClampedArray {
  const n = m.width * m.height;
  const dst = out && out.length === n * 4 ? out : new Uint8ClampedArray(n * 4);
  // 1. base, recoloured where the product is
  const pc = m.tint ? parseHex(opts.color) : null;
  if (pc && m.tint) {
    const [cr, cg, cb] = pc, tint = m.tint, base = m.base;
    const k255 = 1 / 255;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const t = tint[i]! * k255;
      const r = base[p]!, g = base[p + 1]!, b = base[p + 2]!;
      dst[p] = r + (r * cr - r) * t;
      dst[p + 1] = g + (g * cg - g) * t;
      dst[p + 2] = b + (b * cb - b) * t;
      dst[p + 3] = 255;
    }
  } else dst.set(m.base);

  // 2. the design through the UV map
  const dw = design.width, dh = design.height, d = design.data;
  if (dw < 1 || dh < 1) return dst;
  const crop = opts.fit === 'contain' ? { x: 0, y: 0, w: dw, h: dh } : mockupCrop(dw, dh, opts.aspect);
  const sx = Math.max(0, crop.w - 1), sy = Math.max(0, crop.h - 1);
  // contain: the design is a centred box inside the print area (fu × fv of it); outside it the product shows
  let fu = 1, fv = 1;
  if (opts.fit === 'contain' && opts.aspect > 0) {
    const da = dw / dh;
    if (da > opts.aspect) fv = opts.aspect / da; else fu = da / opts.aspect;
  }
  const ou = (1 - fu) / 2, ov = (1 - fv) / 2;
  const maxX = dw - 1, maxY = dh - 1;
  const { u, v, cover, light, inside } = m;
  for (let k = 0; k < inside.length; k++) {
    const i = inside[k]!;
    let uu = u[k]!, vv = v[k]!;
    if (fu < 1 || fv < 1) {
      uu = (uu - ou) / fu; vv = (vv - ov) / fv;
      if (uu < 0 || uu > 1 || vv < 0 || vv > 1) continue;
    }
    let x = crop.x + uu * sx, y = crop.y + vv * sy;
    if (x < 0) x = 0; else if (x > maxX) x = maxX;
    if (y < 0) y = 0; else if (y > maxY) y = maxY;
    const x0 = x | 0, y0 = y | 0;
    const x1 = x0 < maxX ? x0 + 1 : x0, y1 = y0 < maxY ? y0 + 1 : y0;
    const fx = x - x0, fy = y - y0;
    const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
    const p00 = (y0 * dw + x0) * 4, p10 = (y0 * dw + x1) * 4, p01 = (y1 * dw + x0) * 4, p11 = (y1 * dw + x1) * 4;
    const a00 = d[p00 + 3]! * w00, a10 = d[p10 + 3]! * w10, a01 = d[p01 + 3]! * w01, a11 = d[p11 + 3]! * w11;
    const a = a00 + a10 + a01 + a11; // 0..255
    if (a <= 0) continue;
    const ia = 1 / a;
    const L = light[k]!;
    let r = (d[p00]! * a00 + d[p10]! * a10 + d[p01]! * a01 + d[p11]! * a11) * ia * L;
    let g = (d[p00 + 1]! * a00 + d[p10 + 1]! * a10 + d[p01 + 1]! * a01 + d[p11 + 1]! * a11) * ia * L;
    let b = (d[p00 + 2]! * a00 + d[p10 + 2]! * a10 + d[p01 + 2]! * a01 + d[p11 + 2]! * a11) * ia * L;
    if (r > 255) r = 255;
    if (g > 255) g = 255;
    if (b > 255) b = 255;
    const t = cover[k]! * (a / 255);
    const p = i * 4;
    const cr = dst[p]!, cg = dst[p + 1]!, cb = dst[p + 2]!;
    dst[p] = cr + (r - cr) * t;
    dst[p + 1] = cg + (g - cg) * t;
    dst[p + 2] = cb + (b - cb) * t;
  }
  return dst;
}

/** Pixel size to render the design at for a prepared mockup: enough for the print area, never more than the mockup's long side. */
export function designSizeFor(m: Pick<PreparedMockup, 'width' | 'height'>, docW: number, docH: number): { width: number; height: number } {
  const s = Math.min(Math.max(m.width, m.height) / Math.max(docW, docH), 4);
  return { width: Math.max(1, Math.round(docW * s)), height: Math.max(1, Math.round(docH * s)) };
}

/** Prepare and composite in one go (MCP, one-off renders). */
export function renderMockup(b: MockupBuffers, design: Rgba, opts: CompositeOptions & { maxSide?: number }): Rgba {
  const m = prepareMockup(b, opts.maxSide);
  return { width: m.width, height: m.height, data: compositeMockup(m, design, opts) };
}

/** Validate index.json (unknown fields kept; bad entries dropped). */
export function parseMockupIndex(json: unknown): MockupEntry[] {
  const list = (json as MockupIndex | null)?.mockups;
  if (!Array.isArray(list)) return [];
  return list.filter((e): e is MockupEntry => !!e && typeof e.id === 'string' && /^[\w.-]+$/.test(e.id) && typeof e.label === 'string'
    && Number(e.width) > 0 && Number(e.height) > 0 && Number(e.aspect) > 0)
    .map((e) => ({ ...e, category: typeof e.category === 'string' ? e.category : 'Other', colors: Array.isArray(e.colors) ? e.colors.filter((c) => typeof c === 'string' && c.startsWith('#') && !!parseHex(c)) : [] }));
}

/** The files of a mockup, relative to the library folder. */
export function mockupFiles(e: Pick<MockupEntry, 'id' | 'tint'>): { base: string; uvHi: string; uvLo: string; shade: string; tint: string | null; thumb: string } {
  return { base: `${e.id}/base.jpg`, uvHi: `${e.id}/uv-hi.png`, uvLo: `${e.id}/uv-lo.png`, shade: `${e.id}/shade.png`, tint: e.tint ? `${e.id}/tint.png` : null, thumb: `${e.id}/thumb.jpg` };
}

// ---------------------------------------------------------------- quad mockups (user photos)

export type Quad = readonly [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]];

/** A mockup made from any photo and the four corners of its print area (scene `MockupPlugin`). */
export interface QuadMockup {
  /** Print-area corners, clockwise from top-left, in a `width × height` picture of the photo. */
  corners: Quad;
  /** 0..1: how much of the photo's light and shade lands on the design (default 0.8). */
  shade?: number;
  /** The size the corners were picked on (the photo may be decoded at another size: corners are scaled). */
  width: number;
  height: number;
}

/** 3×3 row-major homography taking the unit square (0,0) (1,0) (1,1) (0,1) to the quad (Heckbert's square-to-quad). */
function squareToQuad(q: Quad): number[] {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) return [x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0, 1]; // a parallelogram
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
}

function invert3(m: number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = m as [number, number, number, number, number, number, number, number, number];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!det || !Number.isFinite(det)) return null;
  const k = 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}

/** width / height of the print area: mean of the top and bottom edges over mean of the sides (what the design is fitted to). */
export function quadAspect(corners: Quad): number {
  const len = (a: readonly [number, number], b: readonly [number, number]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const [tl, tr, br, bl] = corners;
  const w = (len(tl, tr) + len(bl, br)) / 2, h = (len(tl, bl) + len(tr, br)) / 2;
  return w > 0 && h > 0 ? w / h : 1;
}

/** The index entry for a quad mockup (id, label and category from the plugin). */
export function quadMockupEntry(p: QuadMockup & { id: string; name: string; category?: string }): MockupEntry {
  return { id: p.id, label: p.name, category: p.category ?? 'My mockups', width: p.width, height: p.height, aspect: quadAspect(p.corners) };
}

/**
 * The format-v1 maps for a photo and a print-area quad, so `prepareMockup` /
 * `compositeMockup` put a design on any photo: u,v by the inverse homography
 * of the corners, coverage 1 inside the quad with a 1 px anti-aliased edge
 * (× the mask's luminance and alpha when given: white = print area), and a
 * shade map from the photo's luminance inside the quad relative to its mean
 * (flat = 128 = no change, `shade` scales it).
 */
export function quadMockupBuffers(photo: Rgba, plugin: QuadMockup, mask?: Rgba | null): MockupBuffers {
  const W = photo.width, H = photo.height, n = W * H, src = photo.data;
  if (W < 1 || H < 1 || src.length < n * 4) throw new Error('quad mockup: expected an RGBA photo');
  const kx = plugin.width > 0 ? W / plugin.width : 1, ky = plugin.height > 0 ? H / plugin.height : 1;
  const q = plugin.corners.map(([x, y]) => [x * kx, y * ky] as const) as unknown as Quad;
  const inv = invert3(squareToQuad(q));
  if (!inv) throw new Error('quad mockup: the corners do not make a quadrilateral');
  // edges as lines a·x + b·y + c = signed distance, positive inside (needs a convex quad)
  let area = 0;
  for (let i = 0; i < 4; i++) { const [ax, ay] = q[i]!, [bx, by] = q[(i + 1) % 4]!; area += ax * by - bx * ay; }
  const s = area >= 0 ? 1 : -1;
  const edges = q.map(([ax, ay], i) => {
    const [bx, by] = q[(i + 1) % 4]!;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const a = (-(by - ay) / len) * s, b = ((bx - ax) / len) * s;
    return [a, b, -(a * ax + b * ay)] as const; // distance positive on the inner side
  });
  const convex = q.every((_, i) => {
    const [ax, ay] = q[i]!, [bx, by] = q[(i + 1) % 4]!, [cx, cy] = q[(i + 2) % 4]!;
    return ((bx - ax) * (cy - by) - (by - ay) * (cx - bx)) * s >= 0;
  });
  const maskAt = mask && mask.width > 0 && mask.height > 0 ? (x: number, y: number) => {
    const mx = Math.min(mask.width - 1, Math.floor((x + 0.5) * mask.width / W)), my = Math.min(mask.height - 1, Math.floor((y + 0.5) * mask.height / H));
    const p = (my * mask.width + mx) * 4, d = mask.data;
    return ((0.299 * d[p]! + 0.587 * d[p + 1]! + 0.114 * d[p + 2]!) / 255) * (d[p + 3]! / 255);
  } : null;

  const uvHi = new Uint8Array(n * 4), uvLo = new Uint8Array(n * 4), shade = new Uint8Array(n * 4);
  const cover = new Float32Array(n), lum = new Float32Array(n);
  let sumL = 0, sumM = 0;
  for (let y = 0, i = 0; y < H; y++) {
    const py = y + 0.5;
    for (let x = 0; x < W; x++, i++) {
      const px = x + 0.5, p = i * 4;
      const L = 0.299 * src[p]! + 0.587 * src[p + 1]! + 0.114 * src[p + 2]!;
      lum[i] = L;
      const w = inv[6]! * px + inv[7]! * py + inv[8]!;
      if (!(w > 0) && !(w < 0)) continue;
      const u = (inv[0]! * px + inv[1]! * py + inv[2]!) / w, v = (inv[3]! * px + inv[4]! * py + inv[5]!) / w;
      let m: number;
      if (convex) {
        let d = Infinity;
        for (const [a, b, c] of edges) d = Math.min(d, a * px + b * py + c);
        m = Math.max(0, Math.min(1, d + 0.5));
      } else m = u >= 0 && u <= 1 && v >= 0 && v <= 1 ? 1 : 0;
      if (m > 0 && maskAt) m *= maskAt(x, y);
      if (m <= 0) continue;
      const U = Math.round(Math.max(0, Math.min(1, u)) * 65535), V = Math.round(Math.max(0, Math.min(1, v)) * 65535);
      const M = Math.max(1, Math.round(m * 255));
      uvHi[p] = U >> 8; uvHi[p + 1] = V >> 8; uvHi[p + 2] = M; uvHi[p + 3] = 255;
      uvLo[p] = U & 255; uvLo[p + 1] = V & 255; uvLo[p + 3] = 255;
      cover[i] = M / 255;
      sumL += L * cover[i]!; sumM += cover[i]!;
    }
  }
  const mean = sumM > 0 ? sumL / sumM : 0;
  const k = Math.max(0, Math.min(1, plugin.shade ?? 0.8));
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    let g = 128;
    if (cover[i]! > 0 && mean > 0) g = Math.round(Math.max(0, Math.min(255, 128 * (1 + k * (lum[i]! / mean - 1)))));
    shade[p] = shade[p + 1] = shade[p + 2] = g; shade[p + 3] = 255;
    if (!uvHi[p + 3]) { uvHi[p + 3] = 255; uvLo[p + 3] = 255; }
  }
  const base = new Uint8Array(n * 4);
  for (let p = 0; p < n * 4; p += 4) { base[p] = src[p]!; base[p + 1] = src[p + 1]!; base[p + 2] = src[p + 2]!; base[p + 3] = 255; }
  return { base: { width: W, height: H, data: base }, uvHi: { width: W, height: H, data: uvHi }, uvLo: { width: W, height: H, data: uvLo }, shade: { width: W, height: H, data: shade }, tint: null };
}
