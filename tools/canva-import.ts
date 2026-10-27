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
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { FORMAT, VERSION, newId, line as lineElement, DEFAULT_TEXT_STYLE, type Doc, type Element, type Fill, type Page, type PathPart, type TextAlign, type TextElement, type TextStyle } from '@digital-canvas/scene';
import { googleFontFull } from './google-fonts.ts';
import { pack } from '@digital-canvas/storage';

interface CanvaMedia { type?: 'image' | 'video'; mediaId?: string; videoId?: string; imageBox?: { top: number; left: number; width: number; height: number }; recoloring?: Record<string, string> }
interface CanvaColor { color?: { type?: string; color?: string } }
interface CanvaLineEnd { marker?: string; top: number; left: number }

interface CanvaEl {
  id: string;
  type: 'shape' | 'rect' | 'text' | 'group' | 'line' | 'unsupported';
  top: number;
  left: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  paths?: { d: string; fill?: { color?: { color: string }; media?: CanvaMedia }; stroke?: { weight: number } & CanvaColor }[];
  viewBox?: { top: number; left: number; width: number; height: number };
  fill?: { media?: CanvaMedia; color?: { color: string }; flipX?: boolean; flipY?: boolean };
  stroke?: { weight: number } & CanvaColor;
  geometry?: 'straight' | 'curved' | 'elbowed';
  start?: CanvaLineEnd;
  end?: CanvaLineEnd;
  textRegions?: { characters: string; formatting: { fontSize: number; fontWeight: string; fontStyle: string; color: string; textAlign: string; decoration: string; strikethrough: string; lineHeight: number; letterSpacing: number; fontRef: string } }[];
  children?: CanvaEl[];
}

interface CanvaPage {
  dimensions: { width: number; height: number };
  background?: { color?: { type?: string; color?: string; stops?: { color: string; position: number; opacity?: number }[]; rotation?: number }; media?: CanvaMedia; flipX?: boolean; flipY?: boolean };
  elements: CanvaEl[];
}

const argv = process.argv.slice(2);
const fontsAt = argv.indexOf('--fonts');
const fontsFile = fontsAt >= 0 ? argv.splice(fontsAt, 2)[1] : undefined;
const cropsAt = argv.indexOf('--crops');
const cropsDir = cropsAt >= 0 ? argv.splice(cropsAt, 2)[1] : undefined;
/** Canva's original assets (`<mediaId>.png`, `<videoId>.mp4`), exported one per page from Canva. */
const exactAt = argv.indexOf('--exact');
const exactDir = exactAt >= 0 ? argv.splice(exactAt, 2)[1] : undefined;
const [pagesArg, assetsDir, out, title = 'Imported from Canva'] = argv;
if (!pagesArg || !assetsDir || !out) {
  console.error('usage: tsx tools/canva-import.ts <page.json>[,…] <assets-dir> <out.dcanvas> [title]');
  process.exit(1);
}

const gaps = new Map<string, number>();
const gap = (what: string) => gaps.set(what, (gaps.get(what) ?? 0) + 1);
const assets = new Map<string, Uint8Array>();
const assetMeta: Doc['assets'] = {};

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'video/mp4': 'mp4', 'font/ttf': 'ttf' };
/** Content-hash id, the same as `assetId` in the app (so Drive can share assets between designs). */
function hashId(bytes: Uint8Array, mime: string): string {
  return `${createHash('sha256').update(bytes).digest('hex').slice(0, 20)}.${EXT[mime] ?? 'bin'}`;
}
function addAsset(bytes: Uint8Array, mime: string, meta: Omit<Doc['assets'][string], 'mime'> = {}): string {
  const id = hashId(bytes, mime);
  if (!assets.has(id)) {
    assets.set(id, bytes);
    assetMeta[id] = { mime, ...meta };
  }
  return id;
}

/** An exact Canva image asset (recoloured like Canva when the element says so), or null. */
function exactImage(m: CanvaMedia): string | null {
  const mid = m.mediaId;
  if (!exactDir || !mid) return null;
  const file = join(exactDir, `${mid}.png`);
  if (!existsSync(file)) return null;
  let bytes: Uint8Array = new Uint8Array(readFileSync(file));
  if (m.recoloring && Object.keys(m.recoloring).length) {
    bytes = recolour(bytes, m.recoloring);
    gap('recoloured graphics');
  }
  return addAsset(bytes, 'image/png', { ...pngSize(bytes), name: mid });
}

const probed = new Map<string, { id: string; duration: number }>();
/** An exact Canva video asset with its poster frame, or null. */
function exactVideo(m: CanvaMedia): { id: string; duration: number } | null {
  const vid = m.videoId;
  if (!exactDir || !vid) return null;
  if (probed.has(vid)) return probed.get(vid)!;
  const file = join(exactDir, `${vid}.mp4`);
  if (!existsSync(file)) return null;
  const bytes = new Uint8Array(readFileSync(file));
  const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]).toString());
  const vs = info.streams.find((x: { codec_type: string }) => x.codec_type === 'video');
  const duration = Number(info.format.duration) || 0;
  const id = addAsset(bytes, 'video/mp4', { width: vs?.width, height: vs?.height, duration, name: vid });
  const poster = new Uint8Array(execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.05', '-i', file, '-frames:v', '1', '-f', 'image2', '-vcodec', 'png', '-'], { maxBuffer: 1 << 28 }));
  assets.set(`${id}.poster`, poster);
  assetMeta[`${id}.poster`] = { mime: 'image/png', ...pngSize(poster), name: `${vid} (poster)` };
  const r = { id, duration };
  probed.set(vid, r);
  return r;
}

/** Which part of an image fills the element box, from Canva's imageBox (relative to the box). */
function cropOf(box: { width: number; height: number }, ib?: { top: number; left: number; width: number; height: number }) {
  if (!ib) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: -ib.left / ib.width, y: -ib.top / ib.height, w: box.width / ib.width, h: box.height / ib.height };
}

const solid = (c?: { color?: string }): Fill | null => (c?.color ? { type: 'solid', color: c.color } : null);

/** Line end markers as small paths in page coordinates, pointing along (dx, dy). */
function marker(kind: string | undefined, x: number, y: number, dx: number, dy: number, w: number): PathPart[] {
  const k = (kind ?? 'NONE').toUpperCase();
  if (k === 'NONE') return [];
  const len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, px = -uy, py = ux;
  const s = Math.max(3, w) * 3;
  const pt = (a: number, b: number) => `${(x + ux * a + px * b).toFixed(2)} ${(y + uy * a + py * b).toFixed(2)}`;
  if (k === 'ARROW') return [{ d: `M${pt(-s, s * 0.6)}L${pt(0, 0)}L${pt(-s, -s * 0.6)}`, fill: null, stroke: null }];
  if (k === 'TRIANGLE') return [{ d: `M${pt(0, 0)}L${pt(-s, s * 0.55)}L${pt(-s, -s * 0.55)}Z`, fill: { type: 'solid', color: '#000' }, stroke: null }];
  if (k === 'BAR') return [{ d: `M${pt(0, s * 0.5)}L${pt(0, -s * 0.5)}`, fill: null, stroke: null }];
  if (k.includes('CIRCLE')) return [{ d: `M${pt(-s * 0.4, 0)}a${s * 0.4} ${s * 0.4} 0 1 0 ${(ux * s * 0.8).toFixed(2)} ${(uy * s * 0.8).toFixed(2)}a${s * 0.4} ${s * 0.4} 0 1 0 ${(-ux * s * 0.8).toFixed(2)} ${(-uy * s * 0.8).toFixed(2)}Z`, fill: k.startsWith('OPEN') ? null : { type: 'solid', color: '#000' }, stroke: null }];
  if (k.includes('SQUARE') || k.includes('DIAMOND')) return [{ d: `M${pt(0, 0)}L${pt(-s * 0.5, s * 0.5)}L${pt(-s, 0)}L${pt(-s * 0.5, -s * 0.5)}Z`, fill: k.startsWith('OPEN') ? null : { type: 'solid', color: '#000' }, stroke: null }];
  return [];
}

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

/**
 * Canva fontRef → the real font (names come from Canva's PDF export; faces from Google Fonts or a
 * local file, e.g. subsets merged out of that PDF). Key "_fallback" lists fonts tried for glyphs
 * the main font lacks (Canva falls back to Noto Sans, e.g. for ₹).
 */
interface FontFace { weight: number; italic?: boolean; google?: string; file?: string }
/** dx/dy (em): where Canva puts this font's text relative to ours (measured by tools/text-offsets.ts). */
interface MappedFont { family: string; faces: FontFace[]; uppercase?: boolean; dx?: number; dy?: number }
const fontMap: Record<string, MappedFont> = fontsFile ? JSON.parse(readFileSync(fontsFile, 'utf8')) : {};
const fallbacks = (fontMap._fallback as unknown as MappedFont[] | undefined) ?? [];
delete fontMap._fallback;
const embedded: NonNullable<Doc['fonts']> = [];

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
/** Longest video clip on the page being converted (its duration in a video design). */
let videoOnPage = 0;
/** Plate mode (with --crops): Canva's text is painted out of its export, every picture is cut from that clean plate. */
const plateMode = !!cropsDir;
/** Area of the page being converted (px²). */
let pageArea = 1;
/** The embedded faces per family, to see which characters they really have. */
const faceByFamily = new Map<string, import('canvaskit-wasm').Typeface[]>();
/** Canva cut the face to the characters it drew: no lowercase but the capitals means ALL CAPS. */
function capsOnly(family: string, text: string): boolean {
  const faces = faceByFamily.get(family);
  const lows = [...new Set(text.replace(/[^a-z]/g, ''))].join('');
  if (!faces?.length || !lows) return false;
  const has = (str: string) => faces.some((f) => [...f.getGlyphIDs(str)].filter((g) => g !== 0).length >= str.length * 0.8);
  return !has(lows) && has(lows.toUpperCase());
}
/** Text boxes converted before the plate is made (so the plate can be made from where our text sits). */
let textById = new Map<string, TextElement>();

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
function cropShot(x: number, y: number, w: number, h: number, myOrder = -1, key = true): Uint8Array | null {
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
  const keyable = key && (ownKey || pageShare >= 0.1);
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

/** Map each source colour to its replacement, keeping each pixel's shading relative to its source. */
function recolour(png: Uint8Array, map: Record<string, string>): Uint8Array {
  const img = ck!.MakeImageFromEncoded(png)!;
  const W = img.width(), H = img.height();
  const info = { width: W, height: H, colorType: ck!.ColorType.RGBA_8888, alphaType: ck!.AlphaType.Unpremul, colorSpace: ck!.ColorSpace.SRGB };
  const px = img.readPixels(0, 0, info) as Uint8Array;
  img.delete();
  const pairs = Object.entries(map).map(([a, b]) => [hexRgb(a), hexRgb(b)] as const);
  for (let i = 0; i < W * H; i++) {
    if (!px[i * 4 + 3]) continue;
    let best = -1, bd = Infinity;
    pairs.forEach(([src], k) => {
      const d = Math.hypot(px[i * 4]! - src[0]!, px[i * 4 + 1]! - src[1]!, px[i * 4 + 2]! - src[2]!);
      if (d < bd) { bd = d; best = k; }
    });
    if (best < 0 || bd > 90) continue;
    const [src, dst] = pairs[best]!;
    for (let c = 0; c < 3; c++) px[i * 4 + c] = Math.max(0, Math.min(255, dst[c]! + (px[i * 4 + c]! - src[c]!)));
  }
  const out = ck!.MakeImage(info, px, W * 4)!;
  const bytes = out.encodeToBytes(ck!.ImageFormat.PNG, 100)!;
  out.delete();
  return bytes;
}

/** Our editable copy of a Canva text box. */
function convertText(el: CanvaEl, base = { id: newId('e_'), x: el.left, y: el.top, w: el.width, h: el.height, rotation: el.rotation ?? 0, opacity: el.opacity ?? 1 }): TextElement {
    const regions = el.textRegions ?? [];
    // The largest run sets the box's base style; every run keeps its own differences.
    const f = regions.reduce((a, r) => (r.formatting.fontSize > a.formatting.fontSize ? r : a)).formatting;
    const styleOf = (fm: typeof f): TextStyle => {
      const ref = fm.fontRef.split(',')[0]!;
      const mapped = fontMap[ref];
      if (!mapped) gap(`font ${ref} not identified → Inter`);
      return {
        ...DEFAULT_TEXT_STYLE,
        fontFamily: mapped ? mapped.family : 'Inter',
        fontSize: fm.fontSize,
        // A mapped family usually has one face (Canva's "bold" is then that face); pick bold or
        // italic only when the family really ships such a face.
        bold: mapped ? fm.fontWeight === 'bold' && mapped.faces.some((f) => f.weight >= 600) && mapped.faces.some((f) => f.weight < 600) : fm.fontWeight === 'bold',
        italic: mapped ? fm.fontStyle === 'italic' && mapped.faces.some((f) => f.italic) : fm.fontStyle === 'italic',
        underline: fm.decoration === 'underline',
        strike: fm.strikethrough === 'strikethrough',
        color: fm.color,
        align: ALIGN[fm.textAlign] ?? 'left',
        lineHeight: fm.lineHeight,
        letterSpacing: fm.letterSpacing * fm.fontSize,
        uppercase: mapped?.uppercase ?? false,
        ...(mapped ? {} : FONT_LOOK[ref]),
      };
    };
    const style = styleOf(f);
    const diff = (st: TextStyle): Partial<TextStyle> => Object.fromEntries(Object.entries(st).filter(([k, v]) => style[k as keyof TextStyle] !== v)) as Partial<TextStyle>;
    const runs = regions.map((r) => ({ text: r.characters, style: diff(styleOf(r.formatting)) }));
    const mixed = runs.some((r) => Object.keys(r.style).length);
    const cal = fontMap[f.fontRef.split(',')[0]!];
    const el2: TextElement = {
      ...base,
      // Canva's text sits a font-specific distance from where ours would (its own line metrics).
      x: base.x + (cal?.dx ?? 0) * f.fontSize,
      y: base.y + (cal?.dy ?? 0) * f.fontSize,
      type: 'text',
      text: regions.map((r) => r.characters).join(''),
      style,
      ...(mixed ? { runs: runs.map((r) => (Object.keys(r.style).length ? r : { text: r.text })) } : {}),
    };
    if (mixed) gap('text boxes with mixed styles (kept as runs)');
    // A substituted font (Inter) can run wider than Canva's: keep the original line count.
    if (measure && !fontMap[f.fontRef.split(',')[0]!]) {
      const lh = style.lineHeight > 0 ? style.lineHeight : 1.2;
      const canvaLines = Math.max(1, Math.ceil(el.height / (f.fontSize * lh) - 0.15));
      const lines = () => Math.round(measure!.textHeight(el2) / (el2.style.fontSize * lh));
      for (let i = 0; i < 8 && (lines() > canvaLines || (canvaLines === 1 && measure.textWidth(el2) > el.width)); i++) {
        el2.style = { ...el2.style, fontSize: el2.style.fontSize * 0.93, letterSpacing: el2.style.letterSpacing * 0.93 };
        if (i === 0) gap('text shrunk to fit (font substitution)');
      }
    }
    return el2;
  }

function convert(el: CanvaEl): Element[] {
  const myOrder = el.type === 'group' ? -1 : leafOrder++;
  const base = { id: newId('e_'), x: el.left, y: el.top, w: el.width, h: el.height, rotation: el.rotation ?? 0, opacity: el.opacity ?? 1 };
  if (el.type === 'group') {
    const children = (el.children ?? []).flatMap(convert);
    if (!exactDir || children.length < 2) {
      gap('groups flattened');
      return children;
    }
    // Canva groups stay groups (children keep page coordinates, like ours).
    return [{ ...base, type: 'group', children }];
  }
  if (exactDir && el.type === 'rect' && el.fill?.media) {
    const m = el.fill.media;
    if (m.type === 'video') {
      const v = exactVideo(m);
      if (v) {
        videoOnPage = Math.max(videoOnPage, v.duration);
        return [{ ...base, type: 'video', asset: v.id, radius: 0, crop: cropOf(el, m.imageBox), flipX: el.fill.flipX || undefined, flipY: el.fill.flipY || undefined }];
      }
    } else {
      const id = exactImage(m);
      if (id) return [{ ...base, type: 'image', asset: id, radius: 0, crop: cropOf(el, m.imageBox), flipX: el.fill.flipX || undefined, flipY: el.fill.flipY || undefined }];
    }
    gap('assets not exported from Canva (cut from its render instead)');
  }
  if (exactDir && el.type === 'shape' && el.paths?.length && !el.paths.some((p) => p.fill?.media)) {
    const vb = el.viewBox ?? { top: 0, left: 0, width: el.width, height: el.height };
    const paths: PathPart[] = el.paths.map((p) => ({
      d: p.d,
      fill: solid(p.fill?.color),
      stroke: p.stroke && p.stroke.weight > 0 && p.stroke.color?.color ? { color: p.stroke.color.color, width: p.stroke.weight } : null,
    }));
    if (!paths.some((p) => p.fill || p.stroke)) return [];
    return [{ ...base, type: 'path', viewBox: { x: vb.left, y: vb.top, w: vb.width, h: vb.height }, paths }];
  }
  if (exactDir && el.type === 'rect' && el.fill?.color) {
    return [{ ...base, type: 'shape', shape: 'rect', fill: { type: 'solid', color: el.fill.color.color }, stroke: null, radius: 0 }];
  }
  if (exactDir && el.type === 'line' && el.start && el.end) {
    // A real (editable) line: Canva's ends, weight, colour, markers and route.
    const mk = (m?: string) => (({ ARROW: 'arrow', TRIANGLE: 'triangle', BAR: 'bar', CIRCLE: 'circle', OPEN_CIRCLE: 'circle', SQUARE: 'square', OPEN_SQUARE: 'square', DIAMOND: 'square', OPEN_DIAMOND: 'square' } as Record<string, 'arrow' | 'triangle' | 'bar' | 'circle' | 'square'>)[(m ?? '').toUpperCase()] ?? 'none');
    const route = el.geometry === 'curved' ? 'curved' : el.geometry === 'elbowed' ? 'elbow' : 'straight';
    if (route !== 'straight') gap('curved/elbow lines (route shape approximated)');
    const ln = lineElement({ x: el.start.left, y: el.start.top }, { x: el.end.left, y: el.end.top }, {
      stroke: { color: el.stroke?.color?.color ?? '#000000', width: el.stroke?.weight ?? 2 },
      route, start: mk(el.start.marker), end: mk(el.end.marker),
    });
    return [{ ...ln, opacity: base.opacity }];
  }
  if (exactDir && el.type === 'shape' && el.paths?.length === 1 && el.paths[0]!.fill?.media) {
    // A picture inside a shape (Canva frame): the image, masked by the shape's path.
    const p0 = el.paths[0]!;
    const id = exactImage(p0.fill!.media!);
    if (id) {
      const vb = el.viewBox ?? { top: 0, left: 0, width: el.width, height: el.height };
      const img: Element = { ...base, type: 'image', asset: id, radius: 0, crop: cropOf(el, p0.fill!.media!.imageBox), mask: { d: p0.d, viewBox: { x: vb.left, y: vb.top, w: vb.width, h: vb.height } } };
      const out: Element[] = [img];
      if (p0.stroke && p0.stroke.weight > 0 && p0.stroke.color?.color) {
        out.push({ ...base, id: newId('e_'), type: 'path', viewBox: { x: vb.left, y: vb.top, w: vb.width, h: vb.height }, paths: [{ d: p0.d, fill: null, stroke: { color: p0.stroke.color.color, width: p0.stroke.weight } }] });
      }
      return out;
    }
  }
  if (plateMode && pageShot && (el.type === 'rect' && el.fill?.media || el.type === 'shape' && el.paths?.some((p) => p.fill?.media) || exactDir && (el.type === 'line' || el.type === 'unsupported'))) {
    // Every picture comes from the text-free plate (it already holds Canva's own pixels, opacity included).
    const r = ((el.rotation ?? 0) * Math.PI) / 180;
    const cx = el.left + el.width / 2, cy = el.top + el.height / 2;
    const bw = Math.abs(el.width * Math.cos(r)) + Math.abs(el.height * Math.sin(r));
    const bh = Math.abs(el.width * Math.sin(r)) + Math.abs(el.height * Math.cos(r));
    const box = { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
    // Big pictures (backdrops) keep every pixel; keying is for cut-outs sitting on a backdrop.
    const bytes = cropShot(box.x, box.y, box.w, box.h, myOrder, bw * bh < pageArea * 0.45);
    if (bytes) {
      const id = `crop-${++cropN}`;
      assets.set(id, bytes);
      const mediaId = el.fill?.media?.mediaId ?? el.paths?.find((p) => p.fill?.media)?.fill?.media?.mediaId ?? 'picture';
      assetMeta[id] = { mime: 'image/png', ...pngSize(bytes), name: `${mediaId} (cut from Canva export)` };
      gap('pictures cut from Canva page export');
      return [{ ...base, ...box, rotation: 0, opacity: 1, type: 'image', asset: id, radius: 0, crop: { x: 0, y: 0, w: 1, h: 1 } }];
    }
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
    const file = join(assetsDir!, `${m.mediaId}.png`);
    let assetKey = m.mediaId;
    if (existsSync(file)) {
      let bytes = new Uint8Array(readFileSync(file));
      if (m.recoloring && Object.keys(m.recoloring).length) {
        // Canva recolours graphics (source colour → new colour): do the same to the pixels.
        assetKey = `${m.mediaId}-${Object.values(m.recoloring).join('').replace(/#/g, '')}`;
        bytes = recolour(bytes, m.recoloring);
        gap('recoloured graphics');
      }
      if (!assets.has(assetKey)) {
        assets.set(assetKey, bytes);
        assetMeta[assetKey] = { mime: 'image/png', ...pngSize(bytes), name: m.mediaId };
      }
    }
    if (!existsSync(file)) gap('images Canva would not hand over (placeholder)');
    const b = m.imageBox;
    const crop = { x: -b.left / b.width, y: -b.top / b.height, w: el.width / b.width, h: el.height / b.height };
    const exact = Math.abs(crop.x) < 1e-3 && Math.abs(crop.y) < 1e-3 && Math.abs(crop.w - 1) < 1e-3 && Math.abs(crop.h - 1) < 1e-3;
    return [{ ...base, type: 'image', asset: assetKey, radius: 0, ...(exact ? { crop: { x: 0, y: 0, w: 1, h: 1 } } : { crop }), flipX: el.fill.flipX || undefined, flipY: el.fill.flipY || undefined }];
  }
  if (el.type === 'text' && el.textRegions?.length) return [textById.get(el.id) ?? convertText(el, base)];
  gap(`unsupported element type ${el.type}`);
  return [];
}

/** Leaf text boxes of a page (inside groups too). */
function leafTexts(els: CanvaEl[]): CanvaEl[] {
  return els.flatMap((e) => (e.type === 'group' ? leafTexts(e.children ?? []) : e.type === 'text' && e.textRegions?.length ? [e] : []));
}

/**
 * Fill the masked pixels from their surroundings (pull-push: average down a pyramid of the known
 * pixels, then fill holes back up from coarser levels). Smooth, and fast enough for full pages.
 */
function inpaint(px: Uint8Array, W: number, H: number, mask: Uint8Array): void {
  type Level = { w: number; h: number; c: Float32Array; a: Float32Array };
  const l0: Level = { w: W, h: H, c: new Float32Array(W * H * 3), a: new Float32Array(W * H) };
  for (let i = 0; i < W * H; i++) {
    const a = mask[i] ? 0 : 1;
    l0.a[i] = a;
    for (let k = 0; k < 3; k++) l0.c[i * 3 + k] = px[i * 4 + k]! * a;
  }
  const levels = [l0];
  while (levels.at(-1)!.w > 1 || levels.at(-1)!.h > 1) {
    const p = levels.at(-1)!;
    const w = Math.max(1, Math.ceil(p.w / 2)), h = Math.max(1, Math.ceil(p.h / 2));
    const n: Level = { w, h, c: new Float32Array(w * h * 3), a: new Float32Array(w * h) };
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      const i = y * p.w + x, j = (y >> 1) * w + (x >> 1);
      n.a[j] += p.a[i]!;
      for (let k = 0; k < 3; k++) n.c[j * 3 + k] += p.c[i * 3 + k]!;
    }
    for (let j = 0; j < w * h; j++) if (n.a[j]! > 1) { for (let k = 0; k < 3; k++) n.c[j * 3 + k] /= n.a[j]!; n.a[j] = 1; }
    levels.push(n);
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const p = levels[l]!, q = levels[l + 1]!;
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      const i = y * p.w + x, j = (y >> 1) * q.w + (x >> 1), rest = 1 - p.a[i]!;
      if (rest <= 0) continue;
      for (let k = 0; k < 3; k++) p.c[i * 3 + k] += rest * q.c[j * 3 + k]!;
      p.a[i] = 1;
    }
  }
  for (let i = 0; i < W * H; i++) if (mask[i]) for (let k = 0; k < 3; k++) px[i * 4 + k] = Math.round(l0.c[i * 3 + k]!);
}

/** Grow a 0/1 mask by r pixels (square). */
function dilate(m: Uint8Array, W: number, H: number, r: number): Uint8Array {
  const tmp = new Uint8Array(W * H), out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    let run = -1e9;
    for (let x = 0; x < W; x++) { if (m[y * W + x]) run = x; if (x - run <= r) tmp[y * W + x] = 1; }
    run = 1e9;
    for (let x = W - 1; x >= 0; x--) { if (m[y * W + x]) run = x; if (run - x <= r) tmp[y * W + x] = 1; }
  }
  for (let x = 0; x < W; x++) {
    let run = -1e9;
    for (let y = 0; y < H; y++) { if (tmp[y * W + x]) run = y; if (y - run <= r) out[y * W + x] = 1; }
    run = 1e9;
    for (let y = H - 1; y >= 0; y--) { if (tmp[y * W + x]) run = y; if (run - y <= r) out[y * W + x] = 1; }
  }
  return out;
}

/**
 * Plate mode: convert the page's text boxes, draw them where they will sit, and paint those pixels
 * out of Canva's export (inpaint). Pictures are then cut from this text-free plate, so the only
 * text on the page is our own, editable copy.
 */
function makePlate(cp: CanvaPage): void {
  textById = new Map();
  if (!plateMode || !pageShot || !ck || !measure) return;
  const leaves = leafTexts(cp.elements);
  if (!leaves.length) return;
  const W = pageShot.width(), H = pageShot.height(), s = shotScale;
  const info = { width: W, height: H, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB };
  const px = pageShot.readPixels(0, 0, info) as Uint8Array;
  /** Our drawing of one text element over its box (plus a margin), at the render's scale. */
  const shot = (t: TextElement) => {
    const pad = t.style.fontSize * 0.3;
    const bx = Math.max(0, Math.floor((t.x - pad) * s)), by = Math.max(0, Math.floor((t.y - pad) * s));
    const bw = Math.min(W - bx, Math.ceil((t.w + 2 * pad) * s)), bh = Math.min(H - by, Math.ceil((t.h + 2 * pad) * s));
    if (bw <= 0 || bh <= 0) return null;
    const surf = ck!.MakeSurface(bw, bh)!;
    const c = surf.getCanvas();
    c.clear(ck!.TRANSPARENT);
    c.scale(s, s);
    c.translate(-bx / s, -by / s);
    measure!.drawElement(c, { ...t, opacity: 1 });
    const img = surf.makeImageSnapshot();
    const a = img.readPixels(0, 0, { ...info, width: bw, height: bh }) as Uint8Array;
    img.delete();
    surf.delete();
    return { a, bx, by, bw, bh };
  };
  /** Share of the pixels we draw that have Canva's colour at that spot (fit including effects). */
  const colourFit = (t: TextElement): number => {
    const r = shot(t);
    if (!r) return 0;
    let ink = 0, hit = 0;
    for (let j = 0; j < r.bh; j += 2) for (let i = 0; i < r.bw; i += 2) {
      const o = (j * r.bw + i) * 4;
      if (r.a[o + 3]! < 200) continue;
      ink++;
      const q = ((r.by + j) * W + r.bx + i) * 4;
      if (Math.hypot(px[q]! - r.a[o]!, px[q + 1]! - r.a[o + 1]!, px[q + 2]! - r.a[o + 2]!) < 70) hit++;
    }
    return ink ? hit / ink : 0;
  };
  /** Canva's outline effect isn't in the API: look for one ring colour around the letters. */
  const findOutline = (t: TextElement): TextElement => {
    if (t.effect) return t;
    // Canva's colours in rings around the letters, one ring per outline thickness step: an outline is
    // a ring colour next to the letters that is not the text's colour nor what lies further out.
    const steps = [20, 40, 60, 90, 130];
    const taken = new Set<number>();
    const bands: { med: number[]; same: number; n: number }[] = [];
    for (const thickness of steps) {
      const probe = shot({ ...t, effect: { type: 'outline', thickness, color: '#ff00ff' } });
      if (!probe) return t;
      const ring: number[][] = [];
      for (let j = 0; j < probe.bh; j += 2) for (let i = 0; i < probe.bw; i += 2) {
        const o = (j * probe.bw + i) * 4;
        if (!(probe.a[o + 3]! > 200 && probe.a[o]! > 230 && probe.a[o + 1]! < 30 && probe.a[o + 2]! > 230)) continue;
        const q = ((probe.by + j) * W + probe.bx + i) * 4;
        if (taken.has(q)) continue;
        taken.add(q);
        ring.push([px[q]!, px[q + 1]!, px[q + 2]!]);
      }
      if (ring.length < 30) return t;
      const med = [0, 1, 2].map((k) => ring.map((p) => p[k]!).sort((x, y) => x - y)[ring.length >> 1]!);
      const same = ring.filter((p) => Math.hypot(p[0]! - med[0]!, p[1]! - med[1]!, p[2]! - med[2]!) < 60).length / ring.length;
      bands.push({ med, same, n: ring.length });
    }
    const d = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
    const first = bands[0]!, far = bands[bands.length - 1]!;
    if (process.env.DC_DEBUG) console.error('outline', JSON.stringify(t.text), bands.map((b) => `${b.med}/${b.same.toFixed(2)}`).join(' '));
    if (first.same < 0.45 || d(first.med, hexRgb(t.style.color)) < 60 || d(first.med, far.med) < 60) return t;
    let k = 0;
    while (k + 1 < bands.length - 1 && d(bands[k + 1]!.med, first.med) < 60 && bands[k + 1]!.same >= 0.4) k++;
    const color = '#' + first.med.map((v) => v.toString(16).padStart(2, '0')).join('');
    gap('text outline (colour and thickness found by matching Canva\'s render)');
    return { ...t, effect: { type: 'outline', thickness: steps[k]!, color } };
  };
  /** Share of an element's ink that lands on Canva pixels of its colour (how well it lines up). */
  const fit = (t: TextElement): number => {
    const pad = t.style.fontSize * 0.3;
    const bx = Math.max(0, Math.floor((t.x - pad) * s)), by = Math.max(0, Math.floor((t.y - pad) * s));
    const bw = Math.min(W - bx, Math.ceil((t.w + 2 * pad) * s)), bh = Math.min(H - by, Math.ceil((t.h + 2 * pad) * s));
    if (bw <= 0 || bh <= 0) return 0;
    const surf = ck!.MakeSurface(bw, bh)!;
    const c = surf.getCanvas();
    c.clear(ck!.TRANSPARENT);
    c.scale(s, s);
    c.translate(-bx / s, -by / s);
    measure!.drawElement(c, { ...t, opacity: 1 });
    const img = surf.makeImageSnapshot();
    const a = img.readPixels(0, 0, { ...info, width: bw, height: bh }) as Uint8Array;
    img.delete();
    surf.delete();
    const col = hexRgb(t.style.color);
    let ink = 0, hit = 0;
    for (let j = 0; j < bh; j += 2) for (let i = 0; i < bw; i += 2) {
      if (a[(j * bw + i) * 4 + 3]! < 128) continue;
      ink++;
      const q = ((by + j) * W + bx + i) * 4;
      if (Math.hypot(px[q]! - col[0]!, px[q + 1]! - col[1]!, px[q + 2]! - col[2]!) < 70) hit++;
    }
    return ink ? hit / ink : 0;
  };
  for (const e of leaves) {
    let t = convertText(e);
    // Canva's ALL CAPS is a per-box setting the API doesn't report: keep whichever matches its render.
    if (/[a-z]/.test(t.text)) {
      const flip = (u: boolean): TextElement => ({ ...t, style: { ...t.style, uppercase: u }, runs: t.runs?.map((r) => (r.style ? { ...r, style: { ...r.style, uppercase: undefined } } : r)) });
      const lower = flip(false), upper = flip(true);
      const fl = fit(lower), fu = fit(upper);
      t = capsOnly(t.style.fontFamily, t.text) || fu > fl + 0.05 ? upper : lower;
      if (t.runs) t.runs = t.runs.map((r) => (r.style && Object.values(r.style).every((v) => v === undefined) ? { text: r.text } : r));
    }
    // Canva's curved text isn't in the API either: when the straight text doesn't line up, try curves.
    const straight = fit(t);
    // Only single-line boxes with real words: short or wrapped text fits badly for other reasons (font, size).
    const oneLine = t.h < t.style.fontSize * t.style.lineHeight * 1.6;
    if (straight < 0.6 && oneLine && !t.text.trim().includes('\n') && t.text.replace(/\s/g, '').length >= 6) {
      const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
      const curved = (k: number): TextElement => {
        const el: TextElement = { ...t, text: t.text.replace(/\n+$/, ''), curve: k };
        if (el.runs) el.runs = el.runs.map((r) => ({ ...r, text: r.text.replace(/\n+$/, '') })).filter((r) => r.text);
        const { w, h } = measure!.fitText(el);
        return { ...el, w, h, x: cx - w / 2, y: cy - h / 2 };
      };
      let best = { k: 0, sc: straight };
      for (let k = -100; k <= 100; k += 10) if (k) { const sc = fit(curved(k)); if (sc > best.sc) best = { k, sc }; }
      if (best.k) for (let k = best.k - 8; k <= best.k + 8; k += 2) if (k) { const sc = fit(curved(k)); if (sc > best.sc) best = { k, sc }; }
      if (process.env.DC_DEBUG) console.error('curve', JSON.stringify(t.text), straight.toFixed(2), best);
      if (Math.abs(best.k) >= 10 && best.sc > straight + 0.15) {
        t = curved(best.k);
        gap('curved text (curve found by matching Canva\'s render)');
      }
    }
    // Our face can be a little wider than Canva's (another build of the font): when the text wraps
    // into more lines than Canva's box holds, widen the box (up to 25%) instead of adding a line.
    if (!t.curve && measure!.fitText(t).h > t.h * 1.2) {
      const w0 = t.w;
      let w = w0;
      while (w < w0 * 1.25 && measure!.fitText({ ...t, w }).h > t.h * 1.2) w *= 1.03;
      if (measure!.fitText({ ...t, w }).h <= t.h * 1.2) {
        const dx = t.style.align === 'center' || t.style.align === 'justify' ? (w - w0) / 2 : t.style.align === 'right' ? w - w0 : 0;
        t = { ...t, w, x: t.x - dx };
      }
    }
    t = findOutline(t);
    textById.set(e.id, t);
    elementMap[e.id] = t.id;
  }
  const surface = ck.MakeSurface(W, H)!;
  const c = surface.getCanvas();
  c.clear(ck.TRANSPARENT);
  c.scale(s, s);
  for (const t of textById.values()) measure.drawElement(c, { ...t, opacity: 1 });
  surface.flush();
  const snap = surface.makeImageSnapshot();
  const ours = snap.readPixels(0, 0, info) as Uint8Array;
  snap.delete();
  surface.delete();
  const m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) m[i] = ours[i * 4 + 3]! > 6 ? 1 : 0;
  // Also Canva's own glyphs: pixels of a text's colour inside its (rotated) box.
  for (const e of leaves) {
    const cols = (e.textRegions ?? []).map((r) => hexRgb(r.formatting.color));
    const fs = Math.max(...(e.textRegions ?? []).map((r) => r.formatting.fontSize));
    const pad = fs * 0.15;
    const r = ((e.rotation ?? 0) * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
    const cx = e.left + e.width / 2, cy = e.top + e.height / 2, hw = e.width / 2 + pad, hh = e.height / 2 + pad;
    const ext = Math.hypot(hw, hh);
    const x0 = Math.max(0, Math.floor((cx - ext) * s)), x1 = Math.min(W, Math.ceil((cx + ext) * s));
    const y0 = Math.max(0, Math.floor((cy - ext) * s)), y1 = Math.min(H, Math.ceil((cy + ext) * s));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const dx = x / s - cx, dy = y / s - cy;
      const u = dx * cos + dy * sin, v = -dx * sin + dy * cos;
      if (Math.abs(u) > hw || Math.abs(v) > hh) continue;
      const q = (y * W + x) * 4;
      if (cols.some((col) => Math.hypot(px[q]! - col[0]!, px[q + 1]! - col[1]!, px[q + 2]! - col[2]!) < 60)) m[y * W + x] = 1;
    }
  }
  const mask = dilate(m, W, H, Math.max(2, Math.round(3 * s)));
  inpaint(px, W, H, mask);
  const plate = ck.MakeImage(info, px, W * 4)!;
  pageShot.delete();
  pageShot = plate;
}

const canvaPages: CanvaPage[] = pagesArg.split(',').map((p) => JSON.parse(readFileSync(p, 'utf8')));
const first = canvaPages[0]!;
{
  const require = createRequire(import.meta.url);
  ck = (await require('canvaskit-wasm/bin/full/canvaskit.js')()) as CanvasKit;
  const fonts = new FontLibrary(ck);
  await fonts.loadBundled(new URL('../apps/web/public/fonts/', import.meta.url).href, async (u) => readFileSync(new URL(u)).buffer as ArrayBuffer);
  measure = new Renderer(ck, fonts);
  // Embed every face the map names (Google faces with all subsets, so ₹ and accents render).
  for (const m of [...Object.values(fontMap), ...fallbacks]) {
    for (const face of m.faces) {
      const key = `${m.family}-${face.weight}${face.italic ? 'i' : ''}`;
      if (embedded.some((e) => `${e.family}-${e.weight}${e.italic ? 'i' : ''}` === key)) continue;
      const bytes = face.file ? new Uint8Array(readFileSync(face.file)) : await googleFontFull(face.google ?? m.family, face.weight, !!face.italic);
      const id = `font-${key.replace(/\W+/g, '-').toLowerCase()}.ttf`;
      assets.set(id, bytes);
      assetMeta[id] = { mime: 'font/ttf', name: `${m.family} ${face.weight}${face.italic ? ' italic' : ''}` };
      embedded.push({ family: m.family, asset: id, weight: face.weight, italic: !!face.italic });
      fonts.add(m.family, bytes);
      const tf = ck!.Typeface.MakeTypefaceFromData(bytes.slice().buffer as ArrayBuffer);
      if (tf) (faceByFamily.get(m.family) ?? faceByFamily.set(m.family, []).get(m.family)!).push(tf);
    }
  }
}
const pageDurations: number[] = [];
/** Canva text element id → our element id (for tools/canva-align.ts). */
const elementMap: Record<string, string> = {};
const pages: Page[] = canvaPages.map((cp, i) => {
  if (process.env.DEBUG) console.error(`page ${i + 1}`, process.memoryUsage().rss >> 20, "MB rss");
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
  pageArea = cp.dimensions.width * cp.dimensions.height;
  makePlate(cp);
  pageTexts = [];
  if (!plateMode) collectTexts(cp.elements, pageTexts);
  pageTexts.forEach((t, i) => (t.order = i));
  pageTexts = pageTexts.filter((t) => t.color.length);
  leafOrder = 0;
  videoOnPage = 0;
  const bg = cp.background;
  const bgFill: Fill = bg?.color?.type === 'linear_gradient' && bg.color.stops?.length
    ? { type: 'linear', angle: bg.color.rotation ?? 90, stops: bg.color.stops.map((st) => ({ offset: st.position, color: st.color })) }
    : { type: 'solid', color: bg?.color?.color ?? '#ffffff' };
  const page: Page = {
    id: newId('p_'),
    background: bgFill,
    // Text always on top: substituted fonts run wider than the originals and must not hide under photos.
    elements: (() => {
      const els = cp.elements.flatMap(convert);
      // The page's own picture or video (Canva's background media), under everything.
      if (exactDir && bg?.media) {
        const box = { width: cp.dimensions.width, height: cp.dimensions.height };
        const common = { id: newId('e_'), name: 'Background', x: 0, y: 0, w: box.width, h: box.height, rotation: 0, opacity: 1, radius: 0, locked: true, crop: cropOf(box, bg.media.imageBox), flipX: bg.flipX || undefined, flipY: bg.flipY || undefined };
        if (bg.media.type === 'video') {
          const v = exactVideo(bg.media);
          if (v) { videoOnPage = Math.max(videoOnPage, v.duration); els.unshift({ ...common, type: 'video', asset: v.id }); }
        } else {
          const id = exactImage(bg.media);
          if (id) els.unshift({ ...common, type: 'image', asset: id });
        }
        if (els[0]?.name === 'Background') return els;
      }
      if (exactDir) return els; // exact assets keep Canva's stacking order
      // A background picture: the plate under everything (Canva's page background is not a plain colour).
      if (plateMode && cp.background?.media && pageShot) {
        const bytes = cropShot(0, 0, cp.dimensions.width, cp.dimensions.height, -1, false);
        if (bytes) {
          const id = `crop-${++cropN}`;
          assets.set(id, bytes);
          assetMeta[id] = { mime: 'image/png', ...pngSize(bytes), name: 'Background (cut from Canva export)' };
          els.unshift({ id: newId('e_'), name: 'Background', type: 'image', asset: id, x: 0, y: 0, w: cp.dimensions.width, h: cp.dimensions.height, rotation: 0, opacity: 1, radius: 0, locked: true, crop: { x: 0, y: 0, w: 1, h: 1 } });
        }
      }
      // A text box that sits entirely inside a photo drawn *below* it in Canva is already in that
      // photo's pixels (we cut photos out of Canva's export). Keeping both would show it twice.
      const kept = els.filter((e, i) => {
        if (e.type !== 'text' || plateMode) return true;
        const inside = els.slice(0, i).some((c) => c.type === 'image' && c.asset.startsWith('crop-') && e.x >= c.x - 2 && e.y >= c.y - 2 && e.x + e.w <= c.x + c.w + 2 && e.y + e.h <= c.y + c.h + 2);
        if (inside) gap('text already inside a photo cut from Canva (kept as pixels)');
        return !inside;
      });
      return [...kept.filter((e) => e.type !== 'text'), ...kept.filter((e) => e.type === 'text')];
    })(),
  };
  pageDurations[i] = videoOnPage;
  return page;
});
// A design with video clips is a video: each page lasts as long as its longest clip (Canva's default 5 s otherwise).
if (pageDurations.some((d) => d > 0)) pages.forEach((p, i) => (p.duration = Math.round((pageDurations[i]! || 5) * 1000) / 1000));
const now = new Date().toISOString();
const doc: Doc = {
  format: FORMAT, version: VERSION, id: newId('d_'), title, unit: 'px',
  width: first.dimensions.width, height: first.dimensions.height, bleed: 0,
  pages, assets: assetMeta, ...(embedded.length ? { fonts: embedded } : {}), createdAt: now, updatedAt: now,
};
writeFileSync(out, pack({ doc, assets }));
writeFileSync(`${out}.map.json`, JSON.stringify(elementMap));
console.log(`wrote ${out}: ${pages.length} page(s), ${pages.reduce((n, p) => n + p.elements.length, 0)} elements, ${assets.size} images`);
for (const [g, n] of gaps) console.log(`  gap: ${g} ×${n}`);
