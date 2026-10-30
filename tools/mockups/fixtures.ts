/**
 * Synthetic mockups (format v1) for tests: a framed poster, a mug with a
 * cylinder UV wrap and lighting, and a billboard in perspective. Real
 * mockups live in apps/web/public/mockups (made by another tool); these are
 * small, computed exactly, and served to e2e tests by routing /mockups/**.
 *
 *   npx tsx tools/mockups/fixtures.ts [outDir]   (default e2e/fixtures/mockups)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { zlibSync } from 'fflate';
import type { CanvasKit } from 'canvaskit-wasm';

const out = resolve(process.argv[2] ?? 'e2e/fixtures/mockups');

// ---- PNG (grey or RGB, 8-bit, no colour chunks: the bytes are data) ----
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc(b: Uint8Array): number { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Uint8Array): Uint8Array {
  const b = new Uint8Array(12 + data.length), dv = new DataView(b.buffer);
  dv.setUint32(0, data.length);
  b.set([...type].map((c) => c.charCodeAt(0)), 4);
  b.set(data, 8);
  dv.setUint32(8 + data.length, crc(b.subarray(4, 8 + data.length)));
  return b;
}
function png(w: number, h: number, channels: 1 | 3, px: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = channels === 1 ? 0 : 2;
  const raw = new Uint8Array(h * (w * channels + 1));
  for (let y = 0; y < h; y++) raw.set(px.subarray(y * w * channels, (y + 1) * w * channels), y * (w * channels + 1) + 1);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw, { level: 9 })), chunk('IEND', new Uint8Array())];
  const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return all;
}

interface Maps {
  base: Uint8Array; // RGB
  uvHi: Uint8Array; uvLo: Uint8Array; // RGB
  shade: Uint8Array; // L
  tint: Uint8Array | null; // L
}

function maps(w: number, h: number, tint: boolean): Maps {
  const n = w * h;
  return { base: new Uint8Array(n * 3), uvHi: new Uint8Array(n * 3), uvLo: new Uint8Array(n * 3), shade: new Uint8Array(n).fill(128), tint: tint ? new Uint8Array(n) : null };
}

const clamp = (x: number, a = 0, b = 255) => Math.max(a, Math.min(b, x));
function setBase(m: Maps, i: number, r: number, g: number, b: number): void { m.base[i * 3] = clamp(Math.round(r)); m.base[i * 3 + 1] = clamp(Math.round(g)); m.base[i * 3 + 2] = clamp(Math.round(b)); }
function setUv(m: Maps, i: number, u: number, v: number, cover: number): void {
  const U = Math.round(clamp(u, 0, 1) * 65535), V = Math.round(clamp(v, 0, 1) * 65535);
  m.uvHi[i * 3] = U >> 8; m.uvHi[i * 3 + 1] = V >> 8; m.uvHi[i * 3 + 2] = clamp(Math.round(cover * 255));
  m.uvLo[i * 3] = U & 255; m.uvLo[i * 3 + 1] = V & 255;
}

/** A flat poster in a black frame on a warm wall, with a glass reflection. */
function poster(): { w: number; h: number; m: Maps; aspect: number } {
  const w = 800, h = 1000, m = maps(w, h, false);
  const px = 190, py = 200, pw = 420, ph = 600, frame = 22;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const wall = 222 - 30 * Math.hypot((x - w / 2) / w, (y - h * 0.45) / h);
    setBase(m, i, wall, wall * 0.96, wall * 0.9);
    const inFrame = x >= px - frame && x < px + pw + frame && y >= py - frame && y < py + ph + frame;
    // drop shadow under the frame
    if (!inFrame && x > px - frame + 10 && x < px + pw + frame + 14 && y > py - frame + 14 && y < py + ph + frame + 22) setBase(m, i, wall * 0.78, wall * 0.75, wall * 0.7);
    if (inFrame) setBase(m, i, 28, 28, 30);
    if (x >= px && x < px + pw && y >= py && y < py + ph) {
      setBase(m, i, 245, 245, 245);
      // soft 1 px edge
      const e = Math.min(x - px + 0.5, px + pw - x - 0.5, y - py + 0.5, py + ph - y - 0.5);
      setUv(m, i, (x - px) / (pw - 1), (y - py) / (ph - 1), clamp(e, 0, 1));
      // light from the top left plus a diagonal glass glare
      const glare = Math.max(0, 1 - Math.abs((x - px) - (y - py) * 0.6 - 120) / 60) * 18;
      m.shade[i] = clamp(Math.round(124 + 8 * (1 - (x - px) / pw) - 6 * ((y - py) / ph) + glare));
    }
  }
  return { w, h, m, aspect: pw / ph };
}

/** A mug: cylinder radius R, the print wraps ±1 rad; Lambert light from the left plus a highlight. */
function mug(): { w: number; h: number; m: Maps; aspect: number } {
  const w = 1000, h = 800, m = maps(w, h, true);
  const cx = 470, R = 210, top = 190, bottom = 640, pTop = 250, pBottom = 580, arc = 1.0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const bg = 236 - (y / h) * 26;
    setBase(m, i, bg * 0.97, bg * 0.98, bg);
    // table shadow
    const sd = Math.hypot((x - cx - 30) / (R * 1.3), (y - bottom - 6) / 26);
    if (sd < 1) setBase(m, i, bg * (0.7 + 0.3 * sd), bg * (0.7 + 0.3 * sd), bg * (0.72 + 0.28 * sd));
    // handle: a ring on the right
    const hd = Math.hypot((x - (cx + R + 20)) / 95, (y - 410) / 130);
    if (hd > 0.62 && hd < 1 && x > cx + R - 20) {
      const l = 0.8 + 0.2 * Math.cos((hd - 0.81) * 9);
      setBase(m, i, 236 * l, 236 * l, 236 * l);
      m.tint![i] = 255;
    }
    const dx = (x + 0.5 - cx) / R;
    if (Math.abs(dx) <= 1 && y >= top && y < bottom) {
      const t = Math.asin(dx);
      const lambert = 0.62 + 0.38 * Math.cos(t + 0.55);
      const spec = Math.exp(-(((t + 0.45) / 0.09) ** 2)) * 0.35;
      const edge = clamp((1 - Math.abs(dx)) * R, 0, 1);
      const L = (lambert + spec) * 240;
      setBase(m, i, L, L, L);
      m.tint![i] = Math.round(255 * edge);
      if (Math.abs(t) <= arc && y >= pTop && y < pBottom) {
        const soft = Math.min(clamp((arc - Math.abs(t)) * R), clamp(y - pTop + 0.5, 0, 1), clamp(pBottom - y - 0.5, 0, 1));
        setUv(m, i, (t + arc) / (2 * arc), (y - pTop) / (pBottom - pTop - 1), soft * edge);
        m.shade[i] = clamp(Math.round(128 * (lambert / 0.86) + spec * 255));
      }
    }
    // rim at the top
    const rim = Math.hypot((x + 0.5 - cx) / R, (y - top) / 26);
    if (rim < 1) {
      const inner = rim < 0.9;
      const L = inner ? 150 + 40 * ((y - top + 26) / 52) : 245;
      setBase(m, i, L, L, L);
      m.tint![i] = 255;
      m.uvHi[i * 3 + 2] = 0;
    }
  }
  return { w, h, m, aspect: (2 * arc * R) / (pBottom - pTop) };
}

/** A billboard on two posts, seen at an angle: the print area is a perspective quad (inverse homography per pixel). */
function billboard(): { w: number; h: number; m: Maps; aspect: number } {
  const w = 1200, h = 800, m = maps(w, h, false);
  const quad: [number, number][] = [[250, 150], [1010, 230], [1000, 520], [262, 470]];
  const inv = homographyInverse(quad);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const sky = y < 560;
    if (sky) setBase(m, i, 120 + y * 0.12, 170 + y * 0.08, 235);
    else setBase(m, i, 96, 120 - (y - 560) * 0.04, 70);
    // two posts
    if ((Math.abs(x - 420) < 14 || Math.abs(x - 840) < 14) && y > 440 && y < 640) setBase(m, i, 70, 70, 76);
    const [u, v] = inv(x + 0.5, y + 0.5);
    const fu = 0.012, fv = 0.025; // frame width in uv
    if (u > -fu && u < 1 + fu && v > -fv && v < 1 + fv) setBase(m, i, 40, 42, 46);
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
      setBase(m, i, 240, 240, 240);
      const du = Math.min(u, 1 - u) * 760, dv = Math.min(v, 1 - v) * 320;
      setUv(m, i, u, v, clamp(Math.min(du, dv) + 0.5, 0, 1));
      m.shade[i] = clamp(Math.round(112 + 34 * u - 10 * v));
    }
  }
  return { w, h, m, aspect: 2.4 };
}

/** Pixel → (u, v) for the quad TL, TR, BR, BL: the inverse of the unit-square → quad homography. */
function homographyInverse(q: [number, number][]): (x: number, y: number) => [number, number] {
  // forward H (unit square → quad) as a matrix, then its inverse
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q as [[number, number], [number, number], [number, number], [number, number]];
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / det, hh = (dx1 * dy3 - dx3 * dy1) / det;
  const H = [x1 - x0 + g * x1, x3 - x0 + hh * x3, x0, y1 - y0 + g * y1, y3 - y0 + hh * y3, y0, g, hh, 1];
  const [a, b, c, d, e, f, gg, hhh, ii] = H as [number, number, number, number, number, number, number, number, number];
  const A = e * ii - f * hhh, B = -(d * ii - f * gg), C = d * hhh - e * gg;
  const D = -(b * ii - c * hhh), E = a * ii - c * gg, F = -(a * hhh - b * gg);
  const G = b * f - c * e, Hh = -(a * f - c * d), I = a * e - b * d;
  return (x, y) => { const z = C * x + F * y + I; return [(A * x + D * y + G) / z, (B * x + E * y + Hh) / z]; };
}

async function main(): Promise<void> {
  const require = createRequire(import.meta.url);
  const ck: CanvasKit = await require('canvaskit-wasm/bin/full/canvaskit.js')();
  const jpg = (w: number, h: number, rgb: Uint8Array, maxSide?: number): Uint8Array => {
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) { rgba[i * 4] = rgb[i * 3]!; rgba[i * 4 + 1] = rgb[i * 3 + 1]!; rgba[i * 4 + 2] = rgb[i * 3 + 2]!; rgba[i * 4 + 3] = 255; }
    const img = ck.MakeImage({ width: w, height: h, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }, rgba, w * 4)!;
    const s = maxSide ? maxSide / Math.max(w, h) : 1;
    const W = Math.round(w * s), H = Math.round(h * s);
    const surf = ck.MakeSurface(W, H)!;
    const c = surf.getCanvas();
    c.scale(s, s);
    c.drawImageCubic(img, 0, 0, 1 / 3, 1 / 3, null);
    surf.flush();
    const snap = surf.makeImageSnapshot();
    const bytes = snap.encodeToBytes(ck.ImageFormat.JPEG, 90)!;
    snap.delete(); surf.delete(); img.delete();
    return bytes;
  };

  const list = [
    { id: 'fx-poster', label: 'Framed poster', category: 'Print', make: poster, colors: [] as string[], credit: 'Synthetic test mockup (CC0)' },
    { id: 'fx-mug', label: 'Mug', category: 'Home', make: mug, colors: ['#ffffff', '#1f3a93', '#c0392b', '#111111'], credit: 'Synthetic test mockup (CC0)' },
    { id: 'fx-billboard', label: 'Billboard', category: 'Outdoor', make: billboard, colors: [] as string[], credit: 'Synthetic test mockup (CC0)' },
  ];
  const index = { version: 1, mockups: [] as unknown[] };
  for (const e of list) {
    const { w, h, m, aspect } = e.make();
    const dir = join(out, e.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'base.jpg'), jpg(w, h, m.base));
    writeFileSync(join(dir, 'thumb.jpg'), jpg(w, h, m.base, 400));
    writeFileSync(join(dir, 'uv-hi.png'), png(w, h, 3, m.uvHi));
    writeFileSync(join(dir, 'uv-lo.png'), png(w, h, 3, m.uvLo));
    writeFileSync(join(dir, 'shade.png'), png(w, h, 1, m.shade));
    if (m.tint) writeFileSync(join(dir, 'tint.png'), png(w, h, 1, m.tint));
    index.mockups.push({ id: e.id, label: e.label, category: e.category, width: w, height: h, aspect: Math.round(aspect * 1000) / 1000, tint: !!m.tint, colors: e.colors, credit: e.credit });
    console.log(`${e.id}: ${w}×${h}, aspect ${aspect.toFixed(3)}`);
  }
  writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 2) + '\n');
}

void main();
