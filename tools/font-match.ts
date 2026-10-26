/**
 * Find which Google Font a Canva font is, by rendering the design's own text with each candidate
 * face and comparing glyph pixels with Canva's export (intersection over union of the text masks).
 *
 *   npx tsx tools/font-match.ts <pages-dir> <ref-dir> <fontRef> <Family,Family,…>
 *
 * <pages-dir> holds page<N>.json (Canva connector), <ref-dir> page<N>.png (Canva export, any scale).
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { CanvasKit, Image } from 'canvaskit-wasm';
import { FontLibrary, Renderer } from '@digital-canvas/render';
import { DEFAULT_TEXT_STYLE, newId, type TextElement } from '@digital-canvas/scene';
import { googleFont } from './google-fonts.ts';

const [pagesDir, refDir, fontRef, familiesArg] = process.argv.slice(2);
if (!pagesDir || !refDir || !fontRef || !familiesArg) { console.error('usage: font-match.ts <pages-dir> <ref-dir> <fontRef> <families>'); process.exit(1); }

interface Sample { page: number; x: number; y: number; w: number; h: number; text: string; size: number; color: string; align: string; lh: number; ls: number; weight: string; italic: boolean }
const samples: Sample[] = [];
for (let n = 1; n <= 20 && samples.length < 10; n++) {
  const f = join(pagesDir, `page${n}.json`);
  if (!existsSync(f)) continue;
  const walk = (els: any[]) => { for (const e of els) {
    if (e.children) walk(e.children);
    if (e.type !== 'text' || e.rotation) continue;
    const runs = e.textRegions as any[];
    if (!runs.every((r) => r.formatting.fontRef.startsWith(fontRef))) continue;
    const text = runs.map((r) => r.characters).join('');
    if (text.trim().length < 4 || text.length > 60 || text.includes('\n') || /[^\x20-\x7e]/.test(text)) continue;
    const fm = runs[0].formatting;
    if (runs.some((r) => r.formatting.fontSize !== fm.fontSize)) continue;
    if (samples.length < 10) samples.push({ page: n, x: e.left, y: e.top, w: e.width, h: e.height, text, size: fm.fontSize, color: fm.color, align: fm.textAlign, lh: fm.lineHeight, ls: fm.letterSpacing, weight: fm.fontWeight, italic: fm.fontStyle === 'italic' });
  } };
  walk(JSON.parse(readFileSync(f, 'utf8')).elements);
}
if (!samples.length) { console.error('no single-style samples for', fontRef); process.exit(1); }
console.error(`${samples.length} samples: ${samples.map((s) => JSON.stringify(s.text)).join(', ')}`);

const require = createRequire(import.meta.url);
const ck: CanvasKit = await require('canvaskit-wasm/bin/full/canvaskit.js')();
const refs = new Map<number, { img: Image; px: Uint8Array; s: number }>();
const refOf = (n: number) => {
  if (!refs.has(n)) {
    const img = ck.MakeImageFromEncoded(readFileSync(join(refDir, `page${n}.png`)))!;
    const px = img.readPixels(0, 0, { width: img.width(), height: img.height(), colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array;
    refs.set(n, { img, px, s: img.width() / 794 });
  }
  return refs.get(n)!;
};
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/**
 * Text mask of Canva's pixels around the sample box (pixels close to the text colour). Canva's
 * glyphs can poke out of their box, so take a taller region and keep only the band of rows that
 * holds this line (row projection around the box centre), dropping neighbouring lines.
 */
function refMask(s: Sample, pad: number): { m: Uint8Array; W: number; H: number } {
  const r = refOf(s.page), sc = r.s, W0 = r.img.width(), H0 = r.img.height();
  const padY = pad + s.size * 0.45;
  const x0 = Math.round((s.x - pad) * sc), y0 = Math.round((s.y - padY) * sc);
  const W = Math.round((s.w + 2 * pad) * sc), H = Math.round((s.h + 2 * padY) * sc);
  const c = hex(s.color), m = new Uint8Array(W * H);
  const rows = new Int32Array(H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const X = x0 + i, Y = y0 + j;
    if (X < 0 || Y < 0 || X >= W0 || Y >= H0) continue;
    const k = (Y * W0 + X) * 4;
    if (Math.hypot(r.px[k]! - c[0]!, r.px[k + 1]! - c[1]!, r.px[k + 2]! - c[2]!) < 70) { m[j * W + i] = 1; rows[j]!++; }
  }
  // grow a band from the box centre through rows that have ink (gaps up to ~0.12em allowed)
  const mid = Math.round((padY + s.h / 2) * sc), gapMax = Math.max(1, Math.round(s.size * 0.05 * sc));
  let top = mid, bot = mid, gap = 0;
  for (let j = mid; j >= 0; j--) { if (rows[j]) { top = j; gap = 0; } else if (++gap > gapMax) break; }
  gap = 0;
  for (let j = mid; j < H; j++) { if (rows[j]) { bot = j; gap = 0; } else if (++gap > gapMax) break; }
  for (let j = 0; j < H; j++) if (j < top || j > bot) for (let i = 0; i < W; i++) m[j * W + i] = 0;
  return { m, W, H };
}

const ALIGN: Record<string, TextElement['style']['align']> = { start: 'left', end: 'right', center: 'center', justify: 'justify' };
const results: { face: string; score: number }[] = [];

/**
 * Shape similarity of two text masks, independent of where each sits: our glyphs are resampled
 * into the reference's bounding box (IoU of the shapes), then scaled by how close the boxes'
 * widths and heights are (a font that sets wider or taller breaks the layout).
 */
function compare(rm: Uint8Array, px: Uint8Array | null, W: number, H: number): number {
  if (!px) return 0;
  const box = (get: (i: number) => boolean) => {
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (get(j * W + i)) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
    return x1 < 0 ? null : { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };
  const ra = box((i) => rm[i] === 1), ob = box((i) => px[i * 4 + 3]! > 127);
  const p = px;
  if (!ra || !ob) return 0;
  // Resample both boxes onto the same coarse grid as ink coverage (0..1), then compare: tolerant
  // of anti-aliasing and 1px offsets, sensitive to letter shapes and proportions.
  const gw = 96, gh = Math.max(8, Math.round((96 * ra.h) / ra.w));
  const grid = (get: (x: number, y: number) => number, bx: { x0: number; y0: number; w: number; h: number }) => {
    const g = new Float32Array(gw * gh);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const xa = bx.x0 + Math.floor((i * bx.w) / gw), xb = bx.x0 + Math.max(Math.floor(((i + 1) * bx.w) / gw), Math.floor((i * bx.w) / gw) + 1);
      const ya = bx.y0 + Math.floor((j * bx.h) / gh), yb = bx.y0 + Math.max(Math.floor(((j + 1) * bx.h) / gh), Math.floor((j * bx.h) / gh) + 1);
      let sum = 0, n = 0;
      for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) { sum += get(x, y); n++; }
      g[j * gw + i] = n ? sum / n : 0;
    }
    return g;
  };
  const ga = grid((x, y) => rm[y * W + x]!, ra), gb = grid((x, y) => (p[(y * W + x) * 4 + 3]! > 127 ? 1 : 0), ob);
  let diff = 0, ink = 0;
  for (let i = 0; i < gw * gh; i++) { diff += Math.abs(ga[i]! - gb[i]!); ink += Math.max(ga[i]!, gb[i]!); }
  const inter = ink - diff, uni = ink; // soft IoU
  const wr = ob.w / ra.w, hr = ob.h / ra.h;
  return (uni ? inter / uni : 0) * Math.min(wr, 1 / wr) * Math.sqrt(Math.min(hr, 1 / hr));
}
const PAD = 2;
let failures = 0;
let faceN = 0;
let refMasks = samples.map((s) => refMask(s, PAD));
// SELFTEST="Family:weight" — use our own render of that face as the reference (checks the matcher).
if (process.env.SELFTEST) {
  const [fam, w] = process.env.SELFTEST.split(':');
  const face = (await googleFont(fam!)).find((f) => String(f.weight) === w && !f.italic)!;
  const fl = new FontLibrary(ck); fl.add('SELF', face.bytes); const rr = new Renderer(ck, fl);
  refMasks = samples.map((s, idx) => {
    const { W, H } = refMasks[idx]!; const sc = refOf(s.page).s;
    const surf = ck.MakeSurface(W, H)!; const c = surf.getCanvas(); c.clear(ck.TRANSPARENT); c.scale(sc, sc);
    rr.drawElement(c, { id: 'st' + idx, type: 'text', x: PAD + 1.3, y: PAD + s.size * 0.45 - 2.1, w: s.w, h: s.h, rotation: 0, opacity: 1, text: s.text, style: { ...DEFAULT_TEXT_STYLE, fontFamily: 'SELF', fontSize: s.size, color: '#000000', align: ALIGN[s.align] ?? 'left', lineHeight: s.lh, letterSpacing: s.ls * s.size, bold: false, italic: false } } as TextElement);
    const img = surf.makeImageSnapshot();
    const px = img.readPixels(0, 0, { width: W, height: H, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array;
    const m = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) m[i] = px[i * 4 + 3]! > 127 ? 1 : 0;
    return { m, W, H };
  });
}
let families = familiesArg.split(',').map((f) => f.trim()).filter(Boolean);
const cat = families.filter((f) => f.startsWith('category:')).map((f) => f.slice(9));
if (cat.length) {
  const all = JSON.parse(readFileSync('/tmp/gfonts.json', 'utf8')) as { family: string; category: string }[];
  families = [...families.filter((f) => !f.startsWith('category:')), ...all.filter((f) => cat.includes(f.category)).map((f) => f.family)];
}
const italics = process.env.ITALIC === '1';
// SLICE=a:b runs part of the list (CanvasKit leaks a little per font; big catalogues go in chunks).
if (process.env.SLICE) { const [a, b] = process.env.SLICE.split(':').map(Number); families = families.slice(a, b); }
const loaded = new Map<string, Awaited<ReturnType<typeof googleFont>>>();
for (let i = 0; i < families.length; i += 12) {
  await Promise.all(families.slice(i, i + 12).map(async (f) => { try { loaded.set(f, await googleFont(f)); } catch { /* skip */ } }));
  process.stderr.write(`\rfonts ${Math.min(i + 12, families.length)}/${families.length}`);
}
console.error('');
let fi = 0;
for (const family of families) {
  if (++fi % 50 === 0) console.error(`matched ${fi}/${families.length}, failures ${failures}`);
  const faces = (loaded.get(family) ?? []).filter((f) => italics || !f.italic);
  if (!faces.length) continue;
  for (const face of faces) {
    const fonts = new FontLibrary(ck);
    // A fresh family name per face: Skia caches typefaces by family name across font providers.
    const alias = `CAND${++faceN}`;
    fonts.add(alias, face.bytes);
    const r = new Renderer(ck, fonts);
    let total = 0;
    samples.forEach((s, idx) => {
      const { m: rm, W, H } = refMasks[idx]!;
      const sc = refOf(s.page).s;
      const el: TextElement = { id: newId('t'), type: 'text', x: PAD, y: PAD + s.size * 0.45, w: s.w, h: s.h, rotation: 0, opacity: 1, text: s.text,
        style: { ...DEFAULT_TEXT_STYLE, fontFamily: alias, fontSize: s.size, color: '#000000', align: ALIGN[s.align] ?? 'left', lineHeight: s.lh, letterSpacing: s.ls * s.size, bold: false, italic: false } };
      const surf = ck.MakeSurface(W, H);
      if (!surf) { failures++; return; }
      const c = surf.getCanvas();
      c.clear(ck.TRANSPARENT);
      c.scale(sc, sc);
      r.drawElement(c, el);
      const img = surf.makeImageSnapshot();
      const px = img.readPixels(0, 0, { width: W, height: H, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array;
      img.delete(); surf.delete();
      const best = compare(rm, px, W, H);
      total += best;
      if (process.env.DEBUG_FACE && `${face.family} ${face.weight}${face.italic ? 'i' : ''}` === process.env.DEBUG_FACE) {
        const out = new Uint8Array(W * H * 4);
        for (let i = 0; i < W * H; i++) { out[i * 4] = rm[i]! * 255; out[i * 4 + 1] = px[i * 4 + 3]! > 127 ? 255 : 0; out[i * 4 + 3] = 255; }
        const im = ck.MakeImage({ width: W, height: H, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }, out, W * 4)!;
        require('node:fs').writeFileSync(`/tmp/fm-debug-${idx}.png`, im.encodeToBytes()!);
      }
    });
    results.push({ face: `${face.family} ${face.weight}${face.italic ? ' italic' : ''}`, score: total / samples.length });
    r.dispose();
    fonts.dispose();
  }
}
results.sort((a, b) => b.score - a.score);
if (failures) console.error(`${failures} renders failed (no surface)`);
for (const r of results.slice(0, process.env.SLICE ? 40 : 15)) console.log(`${(r.score * 100).toFixed(1)}%  ${r.face}`);
