/**
 * Font files: WOFF / WOFF2 → TTF for CanvasKit, and fontInfo.
 *
 * Fixtures in test/fixtures/fonts are Inter (OFL, apps/web/public/fonts) subset to a few
 * characters, made with fontTools by `fixtures/fonts/make.py` (see its docstring):
 * .woff = zlib tables, .woff2 = Brotli + glyf/loca transform, -hmtx.woff2 also transforms hmtx.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CanvasKit } from 'canvaskit-wasm';
import { addElements, createDoc, text } from '@digital-canvas/scene';
import { fontFormat, fontInfo, FontFileError, FontLibrary, Renderer, toSfnt } from '../src/index.ts';

const require = createRequire(import.meta.url);
const fx = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/fonts/${name}`, import.meta.url)));
let ck: CanvasKit;

beforeAll(async () => {
  ck = await require('canvaskit-wasm/bin/full/canvaskit.js')();
});

/** Table tag → bytes of an SFNT. */
function tables(b: Uint8Array) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < dv.getUint16(4); i++) {
    const d = 12 + 16 * i;
    out.set(String.fromCharCode(...b.subarray(d, d + 4)), b.subarray(dv.getUint32(d + 8), dv.getUint32(d + 8) + dv.getUint32(d + 12)));
  }
  return out;
}

/** Glyph ids and advances CanvasKit gets for a string with this face. */
function shape(bytes: Uint8Array, str = 'Hello Wörld éàüñ 0123') {
  const tf = ck.Typeface.MakeTypefaceFromData(bytes.slice().buffer);
  expect(tf).toBeTruthy();
  const font = new ck.Font(tf, 40);
  const ids = Array.from(font.getGlyphIDs(str));
  const widths = Array.from(font.getGlyphWidths(ids));
  const bounds = Array.from(font.getGlyphBounds(ids));
  font.delete(); tf!.delete();
  return { ids, widths, bounds };
}

describe('toSfnt', () => {
  const ttf = fx('inter-sub.ttf');

  it('returns TTF as is and rejects what is not a font', () => {
    expect(toSfnt(ttf)).toBe(ttf);
    expect(() => toSfnt(new TextEncoder().encode('<html>nope</html>'))).toThrow(FontFileError);
    expect(() => toSfnt(new Uint8Array([0x74, 0x74, 0x63, 0x66, 0, 1, 0, 0, 0, 0, 0, 0]))).toThrow(/collections/);
  });

  for (const name of ['inter-sub.woff', 'inter-sub.woff2', 'inter-sub-hmtx.woff2']) {
    it(`decodes ${name} to the same glyphs`, () => {
      const src = fx(name);
      expect(fontFormat(src)).toBe(name.endsWith('woff2') ? 'woff2' : 'woff');
      const out = toSfnt(src);
      expect(fontFormat(out)).toBe('ttf');
      const a = tables(ttf), b = tables(out);
      expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
      for (const tag of ['cmap', 'hhea', 'maxp', 'name', 'OS/2', 'hmtx', 'GPOS']) expect(b.get(tag), tag).toEqual(a.get(tag));
      if (name.endsWith('.woff')) { expect(b.get('glyf')).toEqual(a.get('glyf')); expect(b.get('loca')).toEqual(a.get('loca')); }
      // CanvasKit loads it and every glyph comes out the same as from the TTF
      const want = shape(ttf), got = shape(out);
      expect(got.ids).toEqual(want.ids);
      expect(got.ids.every((g) => g > 0)).toBe(true);
      expect(got.widths).toEqual(want.widths);
      expect(got.bounds.map((v) => Math.round(v * 100))).toEqual(want.bounds.map((v) => Math.round(v * 100)));
    });
  }

  it('a WOFF2 face draws text through FontLibrary', () => {
    const fonts = new FontLibrary(ck);
    fonts.add('Mine', fx('inter-sub.woff2'));
    const r = new Renderer(ck, fonts);
    let doc = createDoc({ width: 200, height: 60 });
    doc = addElements(doc, doc.pages[0]!.id, [text('Hello', { x: 5, y: 5, w: 190, h: 50 }, { fontSize: 36, color: '#000000', fontFamily: 'Mine' })]);
    const png = r.exportPage(doc, doc.pages[0]!);
    const img = ck.MakeImageFromEncoded(png)!;
    const px = img.readPixels(0, 0, { width: 200, height: 60, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array;
    img.delete();
    let dark = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i]! < 100) dark++;
    expect(dark).toBeGreaterThan(200);
    expect(fonts.faces[0]!.bytes[0]).toBe(0); // stored as TTF (exports embed it)
    r.dispose();
  });
});

describe('fontInfo', () => {
  it('reads family, weight and italic', () => {
    expect(fontInfo(fx('inter-sub.ttf'))).toEqual({ family: 'Inter', weight: 400, italic: false });
    expect(fontInfo(fx('inter-sub.woff'))).toEqual({ family: 'Inter', weight: 400, italic: false });
    expect(fontInfo(fx('inter-bi.woff2'))).toEqual({ family: 'Inter', weight: 700, italic: true });
  });
});
