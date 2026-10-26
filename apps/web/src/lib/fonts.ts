/**
 * Fonts for the editor: the Google Fonts catalogue (served as TTF by
 * Fontsource's CDN, which CanvasKit can read), CSS faces so the in-place text
 * editor looks like the canvas, and fonts people upload.
 */
import type { EmbeddedFont } from '@digital-canvas/scene';
import { KV, openDb } from '@digital-canvas/storage';

const API = 'https://api.fontsource.org/v1/fonts';
const CDN = 'https://cdn.jsdelivr.net/fontsource/fonts';

export interface CatalogFont {
  id: string;
  family: string;
  category: string;
  weights: number[];
  styles: string[];
  subsets: string[];
}

export const CATEGORIES = ['sans-serif', 'serif', 'display', 'handwriting', 'monospace'] as const;

let catalogLoad: Promise<CatalogFont[]> | null = null;
const CATALOG_KEY = 'dc.fontCatalog.v1';
const WEEK = 7 * 86400e3;

/** Every font Fontsource has (≈2,000, mostly Google Fonts), cached for a week. */
export function catalog(): Promise<CatalogFont[]> {
  catalogLoad ??= (async () => {
    try {
      const hit = JSON.parse(localStorage.getItem(CATALOG_KEY) ?? 'null') as { at: number; list: CatalogFont[] } | null;
      if (hit && Date.now() - hit.at < WEEK && hit.list.length) return hit.list;
    } catch { /* ignore a broken cache */ }
    const r = await fetch(API);
    if (!r.ok) throw new Error(`font list: HTTP ${r.status}`);
    const raw = (await r.json()) as (CatalogFont & Record<string, unknown>)[];
    const list = raw.map(({ id, family, category, weights, styles, subsets }) => ({ id, family, category, weights, styles, subsets }))
      .sort((a, b) => a.family.localeCompare(b.family));
    try { localStorage.setItem(CATALOG_KEY, JSON.stringify({ at: Date.now(), list })); } catch { /* quota */ }
    return list;
  })();
  catalogLoad.catch(() => (catalogLoad = null));
  return catalogLoad;
}

// ---- CSS faces (for the text editor overlay and font previews) ----

const cssSeen = new Set<string>();

/** Make a face available to CSS under `family` (same name the canvas uses). */
export function addCssFace(family: string, key: string, bytes: Uint8Array, weight = 400, italic = false): void {
  if (cssSeen.has(key) || typeof FontFace === 'undefined') return;
  cssSeen.add(key);
  const face = new FontFace(family, bytes.slice().buffer as ArrayBuffer, { weight: String(weight), style: italic ? 'italic' : 'normal' });
  face.load().then((f) => document.fonts.add(f)).catch(() => cssSeen.delete(key));
}

/** A light preview face (latin, regular) for the font list; returns the CSS family to use. */
export function previewFamily(f: CatalogFont): string {
  const name = `dcpv-${f.id}`;
  if (!cssSeen.has(name) && typeof FontFace !== 'undefined') {
    cssSeen.add(name);
    const w = f.weights.includes(400) ? 400 : f.weights[0];
    const sub = f.subsets.includes('latin') ? 'latin' : f.subsets[0];
    const face = new FontFace(name, `url(${CDN}/${f.id}@latest/${sub}-${w}-normal.woff2)`);
    face.load().then((x) => document.fonts.add(x)).catch(() => {});
  }
  return name;
}

// ---- downloading faces to embed ----

export interface FontFile {
  family: string;
  bytes: Uint8Array;
  mime: string;
  weight: number;
  italic: boolean;
  subset?: string;
  source: string;
}

interface FontDetail {
  unicodeRange: Record<string, string>;
  variants: Record<string, Record<string, Record<string, { url: { ttf?: string } }>>>;
}

function inRanges(ranges: string, cp: number): boolean {
  for (const part of ranges.split(',')) {
    const m = /U\+([0-9A-F?]+)(?:-([0-9A-F]+))?/i.exec(part.trim());
    if (!m) continue;
    const lo = parseInt(m[1]!.replace(/\?/g, '0'), 16), hi = m[2] ? parseInt(m[2], 16) : parseInt(m[1]!.replace(/\?/g, 'F'), 16);
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

/** The weight in `have` closest to `want` (ties go up). */
function closest(have: number[], want: number): number {
  return [...have].sort((a, b) => Math.abs(a - want) - Math.abs(b - want) || b - a)[0]!;
}

/**
 * Download the faces of a catalogue font needed to draw `text`: regular and
 * bold, upright and italic (when the font has them), in Latin plus whichever
 * script subsets the text uses.
 */
export async function fetchFamily(f: CatalogFont, text: string): Promise<FontFile[]> {
  const r = await fetch(`${API}/${f.id}`);
  if (!r.ok) throw new Error(`${f.family}: HTTP ${r.status}`);
  const d = (await r.json()) as FontDetail;
  const cps = new Set([...text].map((c) => c.codePointAt(0)!).filter((c) => c > 0x7f));
  const subsets = Object.keys(d.unicodeRange).filter((s) => s === 'latin' || [...cps].some((cp) => inRanges(d.unicodeRange[s]!, cp)));
  if (!subsets.length) subsets.push(Object.keys(d.unicodeRange)[0]!);
  const weights = [...new Set([closest(f.weights, 400), closest(f.weights, 700)])];
  const jobs: Promise<FontFile | null>[] = [];
  for (const w of weights) {
    for (const style of f.styles.filter((s) => s === 'normal' || s === 'italic')) {
      for (const sub of subsets) {
        const url = d.variants[String(w)]?.[style]?.[sub]?.url.ttf;
        if (!url) continue;
        jobs.push((async () => {
          const res = await fetch(url);
          if (!res.ok) return null;
          return { family: f.family, bytes: new Uint8Array(await res.arrayBuffer()), mime: 'font/ttf', weight: w, italic: style === 'italic', subset: sub, source: `fontsource:${f.id}` };
        })());
      }
    }
  }
  const files = (await Promise.all(jobs)).filter((x): x is FontFile => !!x);
  if (!files.length) throw new Error(`${f.family}: no downloadable faces`);
  return files;
}

// ---- uploaded fonts ----

const FONT_MIME: Record<string, string> = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };
export const FONT_ACCEPT = '.ttf,.otf,.woff,.woff2';

/** Weight and italic from a font's OS/2 table (plain TTF/OTF only; others default to regular). */
export function faceInfo(bytes: Uint8Array): { weight: number; italic: boolean } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    const n = v.getUint16(4);
    for (let i = 0; i < n; i++) {
      const rec = 12 + i * 16;
      if (String.fromCharCode(bytes[rec]!, bytes[rec + 1]!, bytes[rec + 2]!, bytes[rec + 3]!) !== 'OS/2') continue;
      const off = v.getUint32(rec + 8);
      return { weight: v.getUint16(off + 4), italic: (v.getUint16(off + 62) & 1) === 1 };
    }
  } catch { /* not sfnt */ }
  return { weight: 400, italic: false };
}

/** Read an uploaded font file. `familyOf` names it (CanvasKit reads the name table). */
export async function readFontFile(file: File, familyOf: (bytes: Uint8Array) => string | null): Promise<FontFile | null> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const mime = FONT_MIME[ext];
  if (!mime) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const family = familyOf(bytes)?.trim() || file.name.replace(/\.[^.]+$/, '');
  return { family, bytes, mime, ...faceInfo(bytes), source: 'upload' };
}

/** Fonts you uploaded, kept in this browser so every design can use them. */
let uploads: KV<FontFile> | null = null;
function uploadDb(): KV<FontFile> {
  uploads ??= new KV<FontFile>(openDb('digital-canvas-fonts', ['uploads']), 'uploads');
  return uploads;
}

export async function saveUpload(f: FontFile, key: string): Promise<void> {
  await uploadDb().set(key, f);
}

export async function listUploads(): Promise<FontFile[]> {
  try {
    return await uploadDb().values();
  } catch {
    return [];
  }
}

export type { EmbeddedFont };
