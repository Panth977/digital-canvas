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
export function coverCrop(dw: number, dh: number, aspect: number): { x: number; y: number; w: number; h: number } {
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
  const crop = coverCrop(dw, dh, opts.aspect);
  const sx = Math.max(0, crop.w - 1), sy = Math.max(0, crop.h - 1);
  const maxX = dw - 1, maxY = dh - 1;
  const { u, v, cover, light, inside } = m;
  for (let k = 0; k < inside.length; k++) {
    const i = inside[k]!;
    let x = crop.x + u[k]! * sx, y = crop.y + v[k]! * sy;
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
