import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CanvasKit } from 'canvaskit-wasm';
import { parseDoc, walk, type Doc } from '@digital-canvas/scene';
import { FontLibrary, Renderer } from '../src/index.ts';

/** The built-in template library (apps/web/src/templates, built by tools/templates/penpot-import/build.ts). */
const dir = new URL('../../../apps/web/src/templates/', import.meta.url);
const thumbs = new URL('../../../apps/web/public/templates/', import.meta.url);
const assetsDir = new URL('../../../apps/web/public/templates/assets/', import.meta.url);
const credits = readFileSync(new URL('../../../apps/web/public/credits.html', import.meta.url), 'utf8');
const licences = readFileSync(new URL('../../../LICENSES', import.meta.url), 'utf8');
interface Credit { author: string; catalog: string; sourceUrl: string; licence: string; licenceUrl: string }
const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8')) as { id: string; title: string; category: string; width: number; height: number; pages: number; fonts: string[]; assets: string[]; credit: Credit }[];

const require = createRequire(import.meta.url);
let ck: CanvasKit;
let renderer: Renderer;
beforeAll(async () => {
  ck = await require('canvaskit-wasm/bin/full/canvaskit.js')();
  const fonts = new FontLibrary(ck);
  await fonts.loadBundled(new URL('../../../apps/web/public/fonts/', import.meta.url).href, async (u) => readFileSync(new URL(u)).buffer as ArrayBuffer);
  renderer = new Renderer(ck, fonts);
});

describe('template library', () => {
  it('has at least 30 real templates across several kinds, each credited under an open licence', () => {
    expect(index.length).toBeGreaterThanOrEqual(30);
    const cats = new Set(index.map((t) => t.category));
    for (const c of ['Social post', 'Resume', 'Planning', 'App screen', 'Presentation', 'Game']) expect(cats).toContain(c);
    expect(new Set(index.map((t) => t.id)).size).toBe(index.length);
    for (const t of index) {
      expect(t.credit.author, t.id).not.toBe('');
      expect(t.credit.catalog).toBe('Penpot Hub');
      expect(t.credit.sourceUrl).toMatch(/^https:\/\/penpot\.app\/penpothub\/libraries-templates\/[\w-]+$/);
      expect(['CC-BY-4.0', 'CC0-1.0', 'MIT', 'Apache-2.0', 'CC-BY-SA-4.0']).toContain(t.credit.licence);
      expect(credits).toContain(`data-template="${t.id}"`);
      expect(licences).toContain(`${t.id}: "${t.title}" by ${t.credit.author}`);
    }
  });

  it.each(index.map((t) => [t.id, t] as const))('%s parses, matches its index entry and renders', (id, entry) => {
    const doc: Doc = parseDoc(JSON.parse(readFileSync(new URL(`${id}.json`, dir), 'utf8')));
    expect([doc.width, doc.height, doc.pages.length]).toEqual([entry.width, entry.height, entry.pages]);
    expect(Object.keys(doc.assets).sort()).toEqual([...entry.assets].sort());
    for (const id of Object.keys(doc.assets)) renderer.setImage(id, new Uint8Array(readFileSync(new URL(id, assetsDir))));
    const ids = new Set<string>();
    const families = new Set<string>();
    for (const p of doc.pages) for (const e of walk(p.elements)) {
      expect(ids.has(e.id)).toBe(false);
      ids.add(e.id);
      if (e.type === 'text' || e.type === 'table' || e.type === 'chart') families.add(e.style.fontFamily);
      if (e.type === 'text') for (const r of e.runs ?? []) if (r.style?.fontFamily) families.add(r.style.fontFamily);
      if (e.type === 'image' && e.asset) expect(doc.assets[e.asset], e.id).toBeTruthy();
      if (e.type === 'text') expect(e.h).toBeGreaterThan(0);
    }
    expect([...families].sort()).toEqual(entry.fonts);
    expect(doc.pages.some((p) => p.elements.some((e) => e.type === 'text'))).toBe(true);
    expect(existsSync(new URL(`${id}.png`, thumbs))).toBe(true);
    // renders (fonts fall back to Inter here) and is not blank
    const png = renderer.exportPage(doc, doc.pages[0]!, { scale: 120 / Math.max(doc.width, doc.height) });
    const img = ck.MakeImageFromEncoded(png)!;
    const w = img.width(), h = img.height();
    const px = img.readPixels(0, 0, { width: w, height: h, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array;
    img.delete();
    const colours = new Set<number>();
    for (let i = 0; i < px.length; i += 16) colours.add((px[i]! >> 4) << 8 | (px[i + 1]! >> 4) << 4 | (px[i + 2]! >> 4));
    expect(colours.size).toBeGreaterThan(4);
  });
});
