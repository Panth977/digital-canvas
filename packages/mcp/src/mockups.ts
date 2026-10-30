/**
 * Product mockups for agents: the library (index.json + per-mockup maps, see
 * packages/render/src/mockup.ts for the format) and a page composited onto
 * one. Files come from the platform (Node: the web app's public/mockups when
 * present, else the deployed site with a disk cache; browser: the app's own
 * /mockups/), decoded with CanvasKit so Node and the device worker match.
 */
import type { CanvasKit } from 'canvaskit-wasm';
import { compositeMockup, defaultFit, designSizeFor, mockupFiles, parseMockupIndex, parseHex, prepareMockup, type MockupEntry, type PreparedMockup, type Rgba } from '@digital-canvas/render';
import type { Page } from '@digital-canvas/scene';
import type { ProjectFile } from '@digital-canvas/storage';
import { ToolError } from './context.ts';
import { engine, withRenderer } from './engine.ts';
import { platform } from './platform.ts';

import { MOCKUPS_URL, fetchMockupFile } from './mockupfetch.ts';

export { MOCKUPS_URL, fetchMockupFile };

const memory = new Map<string, Promise<Uint8Array>>();

/** One library file (`index.json`, `<id>/base.jpg`, …). */
export function mockupFile(path: string): Promise<Uint8Array> {
  if (!/^[\w.-]+(\/[\w.-]+)?$/.test(path) || path.includes('..')) return Promise.reject(new Error(`bad mockup path ${path}`));
  const own = platform().mockupFile;
  if (own) return own(path);
  let hit = memory.get(path);
  if (!hit) {
    hit = fetchMockupFile(MOCKUPS_URL, path);
    hit.catch(() => memory.delete(path));
    memory.set(path, hit);
    if (memory.size > 64) memory.delete(memory.keys().next().value!);
  }
  return hit;
}

let indexCache: { at: number; list: Promise<MockupEntry[]> } | null = null;

/** The library (cached for 10 minutes). Empty when it isn't published yet. */
export function listMockups(): Promise<MockupEntry[]> {
  if (!indexCache || Date.now() - indexCache.at > 10 * 60_000) {
    const list = mockupFile('index.json').then((b) => parseMockupIndex(JSON.parse(new TextDecoder().decode(b))));
    list.catch(() => (indexCache = null));
    indexCache = { at: Date.now(), list };
  }
  return indexCache.list;
}

/** Forget the cached index and maps (tests). */
export function resetMockups(): void {
  indexCache = null;
  memory.clear();
  prepared.clear();
}

/** Decode a PNG/JPEG to straight RGBA with CanvasKit (no colour conversion: the UV maps are data). */
export function decodeRgba(ck: CanvasKit, bytes: Uint8Array, what: string): Rgba {
  const img = ck.MakeImageFromEncoded(bytes);
  if (!img) throw new Error(`could not decode ${what}`);
  try {
    const width = img.width(), height = img.height();
    const data = img.readPixels(0, 0, { width, height, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array | null;
    if (!data) throw new Error(`could not read ${what}`);
    return { width, height, data };
  } finally {
    img.delete();
  }
}

const prepared = new Map<string, Promise<PreparedMockup>>();

async function prepare(e: MockupEntry, maxSide?: number): Promise<PreparedMockup> {
  const key = `${e.id}@${maxSide ?? 0}`;
  let hit = prepared.get(key);
  if (!hit) {
    hit = (async () => {
      const { ck } = await engine();
      const f = mockupFiles(e);
      const [base, uvHi, uvLo, shade, tint] = await Promise.all([f.base, f.uvHi, f.uvLo, f.shade, f.tint].map((p) => (p ? mockupFile(p) : Promise.resolve(null))));
      const d = (b: Uint8Array | null, n: string) => decodeRgba(ck, b!, `${e.id}/${n}`);
      return prepareMockup({ base: d(base!, 'base'), uvHi: d(uvHi!, 'uv-hi'), uvLo: d(uvLo!, 'uv-lo'), shade: d(shade!, 'shade'), tint: tint ? d(tint, 'tint') : null }, maxSide);
    })();
    hit.catch(() => prepared.delete(key));
    prepared.set(key, hit);
    // full-size maps are big: keep a few
    if (prepared.size > 4) prepared.delete(prepared.keys().next().value!);
  }
  return hit;
}

export async function findMockup(id: string): Promise<MockupEntry> {
  const list = await listMockups().catch((e) => { throw new ToolError(`the mockup library is not available (${e instanceof Error ? e.message : e})`, 'try again later'); });
  const hit = list.find((m) => m.id === id);
  if (!hit) throw new ToolError(`no mockup "${id}"`, `call list_mockups for the ids (${list.length} available)`);
  return hit;
}

export interface MockupRender {
  bytes: Uint8Array;
  width: number;
  height: number;
  mockup: MockupEntry;
  color: string | null;
}

/** A page of a design composited onto a mockup, encoded. */
export async function renderPageMockup(file: ProjectFile, page: Page, mockupId: string, opts: { color?: string; format?: 'png' | 'jpeg'; maxSide?: number; fit?: 'cover' | 'contain' } = {}): Promise<MockupRender> {
  const e = await findMockup(mockupId);
  if (opts.color && !parseHex(opts.color)) throw new ToolError(`"${opts.color}" is not a colour`, 'pass #rrggbb');
  const color = e.tint ? opts.color ?? e.colors?.[0] ?? null : null;
  const m = await prepare(e, opts.maxSide && opts.maxSide < Math.max(e.width, e.height) ? opts.maxSide : undefined);
  const doc = file.doc;
  const size = designSizeFor(m, doc.width, doc.height);
  const design = await withRenderer(file, (r) => r.renderPageRgba(doc, page, size.width, size.height), [page]);
  const px = compositeMockup(m, design, { aspect: e.aspect, color, fit: opts.fit ?? defaultFit(e) });
  const { ck } = await engine();
  const img = ck.MakeImage({ width: m.width, height: m.height, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }, px, m.width * 4);
  if (!img) throw new Error('could not make the mockup image');
  try {
    const bytes = img.encodeToBytes(opts.format === 'jpeg' ? ck.ImageFormat.JPEG : ck.ImageFormat.PNG, 90);
    if (!bytes) throw new Error('encode failed');
    return { bytes, width: m.width, height: m.height, mockup: e, color };
  } finally {
    img.delete();
  }
}
