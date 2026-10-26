/**
 * Convert a Canva page (the structured JSON the Canva connector's `read-design`
 * returns inside an editing transaction) into a `.dcanvas` file.
 *
 *   npx tsx tools/canva-import.ts <page.json>[,<page2.json>…] <assets-dir> <out.dcanvas> [title] [--crops <dir>]
 *
 * <assets-dir> holds `<mediaId>.png` for the images the pages use; missing ones
 * become grey placeholders. With `--crops <dir>` (holding `page<N>.png`, Canva's
 * own export of each page at any scale), every opaque image is instead cut out of
 * that export at its box: sharp, and it works for photos Canva's asset API won't
 * return. This is a test tool for comparing Digital Canvas
 * with Canva, not a full importer: fonts map to Inter, image recolouring and
 * per-run text styles are approximated (see the `gaps` it prints).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { CanvasKit, Image } from 'canvaskit-wasm';
import { FontLibrary, Renderer } from '@digital-canvas/render';
import { join } from 'node:path';
import { FORMAT, VERSION, newId, DEFAULT_TEXT_STYLE, type Doc, type Element, type Page, type TextAlign } from '@digital-canvas/scene';
import { pack } from '@digital-canvas/storage';

interface CanvaEl {
  id: string;
  type: 'shape' | 'rect' | 'text' | 'group';
  top: number;
  left: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  paths?: { d: string; fill?: { color?: { color: string } } }[];
  fill?: { media?: { mediaId: string; imageBox: { top: number; left: number; width: number; height: number }; recoloring?: Record<string, string> }; flipX?: boolean; flipY?: boolean };
  textRegions?: { characters: string; formatting: { fontSize: number; fontWeight: string; fontStyle: string; color: string; textAlign: string; decoration: string; strikethrough: string; lineHeight: number; letterSpacing: number; fontRef: string } }[];
  children?: CanvaEl[];
}

interface CanvaPage {
  dimensions: { width: number; height: number };
  background?: { color?: { color: string } };
  elements: CanvaEl[];
}

const argv = process.argv.slice(2);
const cropsAt = argv.indexOf('--crops');
const cropsDir = cropsAt >= 0 ? argv.splice(cropsAt, 2)[1] : undefined;
const [pagesArg, assetsDir, out, title = 'Imported from Canva'] = argv;
if (!pagesArg || !assetsDir || !out) {
  console.error('usage: tsx tools/canva-import.ts <page.json>[,…] <assets-dir> <out.dcanvas> [title]');
  process.exit(1);
}

const gaps = new Map<string, number>();
const gap = (what: string) => gaps.set(what, (gaps.get(what) ?? 0) + 1);
const assets = new Map<string, Uint8Array>();
const assetMeta: Doc['assets'] = {};

function pngSize(b: Uint8Array): { width: number; height: number } {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

/** Canva fonts seen in tests, approximated with Inter styles until real font loading lands (M3). */
const FONT_LOOK: Record<string, { uppercase?: boolean; bold?: boolean; italic?: boolean }> = {
  YACkoEA0Kc0: { uppercase: true, bold: true, italic: true }, // heavy italic display caps (section titles)
  YACgES4gM44: { uppercase: true, bold: true }, // small caps tagline
};

const ALIGN: Record<string, TextAlign> = { start: 'left', left: 'left', center: 'center', end: 'right', right: 'right', justify: 'justify' };

let ck: CanvasKit | null = null;
let measure: Renderer | null = null;
let pageShot: Image | null = null;
let shotScale = 1;
/** The page's dominant colour (its background), from Canva's export. */
let pageBg: number[] | null = null;
let cropN = 0;
/** Text boxes of the current page in Canva's drawing order, for scrubbing their pixels out of photo crops. */
let pageTexts: { order: number; x: number; y: number; w: number; h: number; color: number[] }[] = [];
let leafOrder = 0;

function hexRgb(h: string): number[] {
  const v = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
}

function collectTexts(els: CanvaEl[], out: typeof pageTexts): void {
  for (const e of els) {
    if (e.type === 'group') collectTexts(e.children ?? [], out);
    else {
      if (e.type === 'text' && e.textRegions?.length) out.push({ order: -1, x: e.left, y: e.top, w: e.width, h: e.height, color: hexRgb(e.textRegions[0]!.formatting.color) });
      else out.push({ order: -1, x: 0, y: 0, w: 0, h: 0, color: [] });
    }
  }
}

/**
 * Cut the box (page px) out of Canva's export of the current page and key out the
 * surrounding background colour (the median of the crop's border), so photos that
 * were transparent PNGs in Canva come back without a box. Returns PNG bytes.
 */
function cropShot(x: number, y: number, w: number, h: number, myOrder = -1): Uint8Array | null {
  if (!ck || !pageShot) return null;
  const s = shotScale;
  const W = Math.max(1, Math.round(w * s)), H = Math.max(1, Math.round(h * s));
  const surface = ck.MakeSurface(W, H)!;
  const c = surface.getCanvas();
  c.clear(ck.TRANSPARENT);
  c.drawImageRect(pageShot, ck.XYWHRect(x * s, y * s, W, H), ck.XYWHRect(0, 0, W, H), new ck.Paint());
  const snap = surface.makeImageSnapshot();
  const info = { width: W, height: H, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB };
  const px = snap.readPixels(0, 0, info) as Uint8Array;
  snap.delete();
  surface.delete();
  const border: number[][] = [];
  for (let i = 0; i < W; i++) for (const j of [0, H - 1]) border.push([px[(j * W + i) * 4]!, px[(j * W + i) * 4 + 1]!, px[(j * W + i) * 4 + 2]!]);
  for (let j = 0; j < H; j++) for (const i of [0, W - 1]) border.push([px[(j * W + i) * 4]!, px[(j * W + i) * 4 + 1]!, px[(j * W + i) * 4 + 2]!]);
  // background = the most common border colour (a median per channel breaks when photos touch the border)
  const bins = new Map<number, { n: number; sum: number[] }>();
  for (const b of border) {
    const key = ((b[0]! >> 3) << 10) | ((b[1]! >> 3) << 5) | (b[2]! >> 3);
    const e = bins.get(key) ?? { n: 0, sum: [0, 0, 0] };
    e.n++;
    e.sum = e.sum.map((v, i) => v + b[i]!);
    bins.set(key, e);
  }
  const top = [...bins.values()].sort((a, b) => b.n - a.n)[0]!;
  // Key against the border's own dominant colour; if no colour dominates (photo half off the page,
  // crowded by other photos), fall back to the page background when enough of the border shows it.
  const near = (c: number[], b: number[]) => Math.hypot(b[0]! - c[0]!, b[1]! - c[1]!, b[2]! - c[2]!) < 40;
  const pageShare = pageBg ? border.filter((b) => near(pageBg!, b)).length / border.length : 0;
  const ownKey = top.n / border.length > 0.4;
  const med = ownKey ? top.sum.map((v) => v / top.n) : pageBg!;
  const keyable = ownKey || pageShare >= 0.1;
  const T0 = 22, T1 = 60;
  if (keyable) {
    // Magic wand from the border: only background connected to the edge becomes transparent, so
    // dark or blue parts inside the photo (that happen to match the background) stay.
    const dist = (i: number) => Math.hypot(px[i * 4]! - med[0]!, px[i * 4 + 1]! - med[1]!, px[i * 4 + 2]! - med[2]!);
    const seen = new Uint8Array(W * H);
    const queue: number[] = [];
    const push = (i: number) => { if (!seen[i] && dist(i) < T1) { seen[i] = 1; queue.push(i); } };
    for (let i = 0; i < W; i++) { push(i); push((H - 1) * W + i); }
    for (let j = 0; j < H; j++) { push(j * W); push(j * W + W - 1); }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q]!, xx = i % W;
      if (xx > 0) push(i - 1);
      if (xx < W - 1) push(i + 1);
      if (i >= W) push(i - W);
      if (i < W * (H - 1)) push(i + W);
    }
    for (const i of queue) px[i * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0, (dist(i) - T0) / (T1 - T0))));
  }
  // Canva text drawn above this photo is baked into the export: scrub pixels close to that text's
  // colour inside its box, so our own (editable) copy of the text doesn't sit on a ghost.
  if (keyable) for (const t of pageTexts) {
    if (!t.color.length) continue; // text above, or below and showing through transparent parts
    // Canva's text ran over this photo's empty margin. Scrub a text-coloured pixel only when its
    // neighbourhood is mostly keyed-out background, so light parts of the photo itself stay.
    const textish = (k: number) => {
      const dt = Math.hypot(px[k]! - t.color[0]!, px[k + 1]! - t.color[1]!, px[k + 2]! - t.color[2]!);
      const db = Math.hypot(px[k]! - med[0]!, px[k + 1]! - med[1]!, px[k + 2]! - med[2]!);
      return dt < 90 || dt < db * 1.6;
    };
    const padX = 4, padY = 4;
    const x0 = Math.max(0, Math.floor((t.x - padX - x) * s)), y0 = Math.max(0, Math.floor((t.y - padY - y) * s));
    const x1 = Math.min(W, Math.ceil((t.x + t.w + padX - x) * s)), y1 = Math.min(H, Math.ceil((t.y + t.h + padY - y) * s));
    if (x1 <= x0 || y1 <= y0) continue;
    const bw = x1 - x0, bh = y1 - y0;
    // integral images over the box: non-text pixels, and those that are background
    const nt = new Int32Array((bw + 1) * (bh + 1)), bg = new Int32Array((bw + 1) * (bh + 1));
    const tx = new Uint8Array(bw * bh);
    for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
      const k = ((y0 + j) * W + (x0 + i)) * 4;
      const isText = textish(k);
      tx[j * bw + i] = isText ? 1 : 0;
      const n = isText ? 0 : 1, b = !isText && px[k + 3]! < 128 ? 1 : 0;
      const o = (j + 1) * (bw + 1) + (i + 1);
      nt[o] = n + nt[o - 1]! + nt[o - bw - 1]! - nt[o - bw - 2]!;
      bg[o] = b + bg[o - 1]! + bg[o - bw - 1]! - bg[o - bw - 2]!;
    }
    const R = Math.max(4, Math.round(3 * s));
    const sum = (A: Int32Array, i0: number, j0: number, i1: number, j1: number) => A[j1 * (bw + 1) + i1]! - A[j0 * (bw + 1) + i1]! - A[j1 * (bw + 1) + i0]! + A[j0 * (bw + 1) + i0]!;
    for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
      if (!tx[j * bw + i]) continue;
      const i0 = Math.max(0, i - R), j0 = Math.max(0, j - R), i1 = Math.min(bw, i + R + 1), j1 = Math.min(bh, j + R + 1);
      const n = sum(nt, i0, j0, i1, j1);
      if (n && sum(bg, i0, j0, i1, j1) / n > 0.7) px[((y0 + j) * W + (x0 + i)) * 4 + 3] = 0;
    }
  }
  const keyed = ck.MakeImage(info, px, W * 4)!;
  const bytes = keyed.encodeToBytes(ck.ImageFormat.PNG, 100);
  keyed.delete();
  return bytes;
}

function convert(el: CanvaEl): Element[] {
  const myOrder = el.type === 'group' ? -1 : leafOrder++;
  const base = { id: newId('e_'), x: el.left, y: el.top, w: el.width, h: el.height, rotation: el.rotation ?? 0, opacity: el.opacity ?? 1 };
  if (el.type === 'group') {
    gap('groups flattened (no group element yet)');
    return (el.children ?? []).flatMap(convert);
  }
  if (el.type === 'shape') {
    const color = el.paths?.[0]?.fill?.color?.color;
    if (!color) return []; // invisible layout box
    if ((el.paths?.length ?? 0) > 1 || !/^M0 0H64V64H0z$/.test(el.paths?.[0]?.d ?? '')) gap('custom vector paths drawn as rectangles');
    return [{ ...base, type: 'shape', shape: 'rect', fill: { type: 'solid', color }, stroke: null, radius: 0 }];
  }
  if (el.type === 'rect' && el.fill?.media && pageShot && (el.opacity ?? 1) > 0.99) {
    // Opaque image: take Canva's own pixels for its (rotated) bounding box.
    const r = ((el.rotation ?? 0) * Math.PI) / 180;
    const cx = el.left + el.width / 2, cy = el.top + el.height / 2;
    const bw = Math.abs(el.width * Math.cos(r)) + Math.abs(el.height * Math.sin(r));
    const bh = Math.abs(el.width * Math.sin(r)) + Math.abs(el.height * Math.cos(r));
    const box = { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
    const bytes = cropShot(box.x, box.y, box.w, box.h, myOrder);
    if (bytes) {
      const id = `crop-${++cropN}`;
      assets.set(id, bytes);
      assetMeta[id] = { mime: 'image/png', ...pngSize(bytes), name: `${el.fill.media.mediaId} (cut from Canva export)` };
      gap('opaque images cut from Canva page export');
      return [{ ...base, ...box, rotation: 0, type: 'image', asset: id, radius: 0, crop: { x: 0, y: 0, w: 1, h: 1 } }];
    }
  }
  if (el.type === 'rect' && el.fill?.media) {
    const m = el.fill.media;
    if (m.recoloring) gap('image recolouring ignored');
    const file = join(assetsDir!, `${m.mediaId}.png`);
    if (existsSync(file) && !assets.has(m.mediaId)) {
      const bytes = new Uint8Array(readFileSync(file));
      assets.set(m.mediaId, bytes);
      assetMeta[m.mediaId] = { mime: 'image/png', ...pngSize(bytes), name: m.mediaId };
    }
    if (!existsSync(file)) gap('images Canva would not hand over (placeholder)');
    const b = m.imageBox;
    const crop = { x: -b.left / b.width, y: -b.top / b.height, w: el.width / b.width, h: el.height / b.height };
    const exact = Math.abs(crop.x) < 1e-3 && Math.abs(crop.y) < 1e-3 && Math.abs(crop.w - 1) < 1e-3 && Math.abs(crop.h - 1) < 1e-3;
    return [{ ...base, type: 'image', asset: m.mediaId, radius: 0, ...(exact ? { crop: { x: 0, y: 0, w: 1, h: 1 } } : { crop }), flipX: el.fill.flipX || undefined, flipY: el.fill.flipY || undefined }];
  }
  if (el.type === 'text' && el.textRegions?.length) {
    const runs = el.textRegions;
    // Mixed sizes in one box (e.g. a small "PURE" over a big title): the largest run sets the style.
    const f = runs.reduce((a, r) => (r.formatting.fontSize > a.formatting.fontSize ? r : a)).formatting;
    if (runs.some((r) => r.formatting.decoration !== f.decoration || r.formatting.fontWeight !== f.fontWeight)) gap('mixed styles inside one text box (largest run wins)');
    gap(`font ${f.fontRef.split(',')[0]} → Inter`);
    const el2 = {
      ...base,
      type: 'text' as const,
      text: runs.map((r) => r.characters).join(''),
      style: {
        ...DEFAULT_TEXT_STYLE,
        fontFamily: 'Inter',
        fontSize: f.fontSize,
        bold: f.fontWeight === 'bold',
        italic: f.fontStyle === 'italic',
        underline: f.decoration === 'underline',
        strike: f.strikethrough === 'strikethrough',
        color: f.color,
        align: ALIGN[f.textAlign] ?? 'left',
        lineHeight: f.lineHeight,
        letterSpacing: f.letterSpacing * f.fontSize,
        uppercase: false,
        ...FONT_LOOK[f.fontRef.split(',')[0]!],
      },
    };
    // Inter is wider than most of Canva's fonts: a one-line label that would now wrap is
    // shrunk until it fits its original box, so the layout holds.
    if (measure && !el2.text.includes('\n') && el.height < el2.style.fontSize * Math.max(1, el2.style.lineHeight) * 1.6) {
      const natural = measure.textWidth(el2);
      if (natural > el.width) {
        const k = (el.width / natural) * 0.99;
        el2.style = { ...el2.style, fontSize: el2.style.fontSize * k, letterSpacing: el2.style.letterSpacing * k };
        gap('one-line text shrunk to fit (font substitution)');
      }
    }
    // If the substituted font needs more lines than Canva used (wider glyphs, merged runs), shrink until it fits.
    if (measure) {
      const lh = el2.style.lineHeight > 0 ? el2.style.lineHeight : 1.2;
      const canvaLines = Math.max(1, Math.ceil(el.height / (f.fontSize * lh) - 0.15));
      const lines = () => Math.round(measure!.textHeight(el2) / (el2.style.fontSize * lh));
      for (let i = 0; i < 8 && lines() > canvaLines; i++) {
        el2.style = { ...el2.style, fontSize: el2.style.fontSize * 0.93, letterSpacing: el2.style.letterSpacing * 0.93 };
        if (i === 0) gap('text shrunk to keep Canva\'s line count (font substitution)');
      }
    }
    return [el2];
  }
  gap(`unsupported element type ${el.type}`);
  return [];
}

const canvaPages: CanvaPage[] = pagesArg.split(',').map((p) => JSON.parse(readFileSync(p, 'utf8')));
const first = canvaPages[0]!;
{
  const require = createRequire(import.meta.url);
  ck = (await require('canvaskit-wasm/bin/full/canvaskit.js')()) as CanvasKit;
  const fonts = new FontLibrary(ck);
  await fonts.loadBundled(new URL('../apps/web/public/fonts/', import.meta.url).href, async (u) => readFileSync(new URL(u)).buffer as ArrayBuffer);
  measure = new Renderer(ck, fonts);
}
const pages: Page[] = canvaPages.map((cp, i) => {
  const shotFile = cropsDir ? join(cropsDir, `page${i + 1}.png`) : '';
  pageShot?.delete();
  pageShot = shotFile && existsSync(shotFile) ? ck!.MakeImageFromEncoded(readFileSync(shotFile)) : null;
  shotScale = pageShot ? pageShot.width() / cp.dimensions.width : 1;
  pageBg = null;
  if (pageShot) {
    const w = pageShot.width(), h = pageShot.height();
    const all = pageShot.readPixels(0, 0, { width: w, height: h, colorType: ck!.ColorType.RGBA_8888, alphaType: ck!.AlphaType.Unpremul, colorSpace: ck!.ColorSpace.SRGB }) as Uint8Array;
    const bins = new Map<number, { n: number; sum: number[] }>();
    for (let i = 0; i < w * h; i += 13) {
      const r = all[i * 4]!, g = all[i * 4 + 1]!, b = all[i * 4 + 2]!;
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      const e = bins.get(key) ?? { n: 0, sum: [0, 0, 0] };
      e.n++; e.sum[0]! += r; e.sum[1]! += g; e.sum[2]! += b;
      bins.set(key, e);
    }
    const top = [...bins.values()].sort((a, b) => b.n - a.n)[0]!;
    pageBg = top.sum.map((v) => v / top.n);
  }
  pageTexts = [];
  collectTexts(cp.elements, pageTexts);
  pageTexts.forEach((t, i) => (t.order = i));
  pageTexts = pageTexts.filter((t) => t.color.length);
  leafOrder = 0;
  return {
    id: newId('p_'),
    background: { type: 'solid', color: cp.background?.color?.color ?? '#ffffff' },
    // Text always on top: substituted fonts run wider than the originals and must not hide under photos.
    elements: (() => {
      const els = cp.elements.flatMap(convert);
      // A text box that sits entirely inside a photo drawn *below* it in Canva is already in that
      // photo's pixels (we cut photos out of Canva's export). Keeping both would show it twice.
      const kept = els.filter((e, i) => {
        if (e.type !== 'text') return true;
        const inside = els.slice(0, i).some((c) => c.type === 'image' && c.asset.startsWith('crop-') && e.x >= c.x - 2 && e.y >= c.y - 2 && e.x + e.w <= c.x + c.w + 2 && e.y + e.h <= c.y + c.h + 2);
        if (inside) gap('text already inside a photo cut from Canva (kept as pixels)');
        return !inside;
      });
      return [...kept.filter((e) => e.type !== 'text'), ...kept.filter((e) => e.type === 'text')];
    })(),
  };
});
const now = new Date().toISOString();
const doc: Doc = {
  format: FORMAT, version: VERSION, id: newId('d_'), title, unit: 'px',
  width: first.dimensions.width, height: first.dimensions.height, bleed: 0,
  pages, assets: assetMeta, createdAt: now, updatedAt: now,
};
writeFileSync(out, pack({ doc, assets }));
console.log(`wrote ${out}: ${pages.length} page(s), ${pages.reduce((n, p) => n + p.elements.length, 0)} elements, ${assets.size} images`);
for (const [g, n] of gaps) console.log(`  gap: ${g} ×${n}`);
