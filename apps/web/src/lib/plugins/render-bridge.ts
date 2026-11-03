/**
 * The render pieces plugins need from `@digital-canvas/render` (branch
 * r20-render): `compileShader`, `toSfnt`, `fontInfo`. Until they are merged,
 * the fallbacks below do the same job, so the merge is a change to this file
 * only (the mockup one, `quad-bridge.ts`, is separate because it runs in the
 * mockup worker, which must not load CanvasKit).
 *
 * Each export prefers the render package's function when it exists.
 */
import * as Render from '@digital-canvas/render';
import { unzlibSync } from 'fflate';
import type { CanvasKit } from 'canvaskit-wasm';

const R = Render as unknown as Record<string, unknown>;

// ---------------------------------------------------------------- shaders

export interface CompileResult { ok: boolean; error?: string }

/** Compile SkSL with CanvasKit's RuntimeEffect: ok, or the compiler's message. */
export function compileShader(ck: CanvasKit, sksl: string): CompileResult {
  const own = R.compileShader as ((ck: CanvasKit, s: string) => CompileResult) | undefined;
  if (typeof own === 'function') return own(ck, sksl);
  let error = '';
  const fx = ck.RuntimeEffect.Make(sksl, (e: string) => { error = e; });
  if (!fx) return { ok: false, error: cleanError(error) || 'The shader does not compile.' };
  fx.delete();
  return { ok: true };
}

/** CanvasKit's message without the echoed source lines: "1: unknown identifier 'foo'". */
export function cleanError(e: string): string {
  const lines = e.split('\n').filter((l) => /^error:/.test(l.trim()));
  return (lines.length ? lines : [e.split('\n')[0] ?? '']).map((l) => l.replace(/^\s*error:\s*/, 'Line ')).join('\n').trim();
}

// ---------------------------------------------------------------- fonts

export interface FontInfo { family: string; weight: number; italic: boolean; fullName?: string }

/** WOFF / WOFF2 → plain TrueType / OpenType when we can (WOFF2 stays as it is: CanvasKit, CSS and fontkit read it). */
export function toSfnt(bytes: Uint8Array): Uint8Array {
  const own = R.toSfnt as ((b: Uint8Array) => Uint8Array) | undefined;
  if (typeof own === 'function') return own(bytes);
  return tag(bytes, 0) === 'wOFF' ? woffToSfnt(bytes) : bytes;
}

/** Mime type of font bytes, by their signature. */
export function fontMime(bytes: Uint8Array): string | null {
  const t = tag(bytes, 0);
  if (t === 'wOFF') return 'font/woff';
  if (t === 'wOF2') return 'font/woff2';
  if (t === 'OTTO') return 'font/otf';
  if (t === 'true' || t === '\0\x01\0\0') return 'font/ttf';
  return null;
}

/** Family, weight and italic from the font's name and OS/2 tables (WOFF2: CanvasKit names it). */
export function fontInfo(bytes: Uint8Array, ck?: CanvasKit): FontInfo | null {
  const own = R.fontInfo as ((b: Uint8Array) => FontInfo | null) | undefined;
  if (typeof own === 'function') return own(bytes);
  const sfnt = toSfnt(bytes);
  const parsed = sfntInfo(sfnt);
  if (parsed) return parsed;
  if (!ck) return null;
  const tf = ck.Typeface.MakeTypefaceFromData(sfnt.slice().buffer as ArrayBuffer);
  if (!tf) return null;
  const family = tf.getFamilyName?.() ?? '';
  tf.delete();
  return family ? { family, weight: 400, italic: false } : null;
}

function tag(b: Uint8Array, at: number): string {
  return b.length >= at + 4 ? String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!) : '';
}

/** WOFF 1.0 (zlib per table) → sfnt. */
function woffToSfnt(b: Uint8Array): Uint8Array {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const flavor = v.getUint32(4), n = v.getUint16(12);
  const tables: { tag: number; sum: number; data: Uint8Array }[] = [];
  for (let i = 0; i < n; i++) {
    const r = 44 + i * 20;
    const off = v.getUint32(r + 4), comp = v.getUint32(r + 8), orig = v.getUint32(r + 12);
    const raw = b.subarray(off, off + comp);
    tables.push({ tag: v.getUint32(r), sum: v.getUint32(r + 16), data: comp < orig ? unzlibSync(raw) : raw });
  }
  let pow = 1, log = 0;
  while (pow * 2 <= n) { pow *= 2; log++; }
  const head = 12 + n * 16;
  const size = tables.reduce((s, t) => s + ((t.data.length + 3) & ~3), head);
  const out = new Uint8Array(size);
  const o = new DataView(out.buffer);
  o.setUint32(0, flavor); o.setUint16(4, n); o.setUint16(6, pow * 16); o.setUint16(8, log); o.setUint16(10, n * 16 - pow * 16);
  let at = head;
  tables.forEach((t, i) => {
    const r = 12 + i * 16;
    o.setUint32(r, t.tag); o.setUint32(r + 4, t.sum); o.setUint32(r + 8, at); o.setUint32(r + 12, t.data.length);
    out.set(t.data, at);
    at += (t.data.length + 3) & ~3;
  });
  return out;
}

/** name (16 typographic family, else 1) + OS/2 (weight, italic bit) of a plain sfnt. */
export function sfntInfo(b: Uint8Array): FontInfo | null {
  const t = tag(b, 0);
  if (t !== 'OTTO' && t !== 'true' && t !== '\0\x01\0\0') return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    const n = v.getUint16(4);
    const find = (name: string) => {
      for (let i = 0; i < n; i++) if (tag(b, 12 + i * 16) === name) return v.getUint32(12 + i * 16 + 8);
      return -1;
    };
    let weight = 400, italic = false;
    const os2 = find('OS/2');
    if (os2 >= 0) { weight = v.getUint16(os2 + 4) || 400; italic = (v.getUint16(os2 + 62) & 1) === 1; }
    const names = new Map<number, string>();
    const nm = find('name');
    if (nm >= 0) {
      const count = v.getUint16(nm + 2), strings = nm + v.getUint16(nm + 4);
      for (let i = 0; i < count; i++) {
        const r = nm + 6 + i * 12;
        const platform = v.getUint16(r), id = v.getUint16(r + 6), len = v.getUint16(r + 8), off = strings + v.getUint16(r + 10);
        if (names.has(id) && platform !== 3) continue;
        let s = '';
        if (platform === 3 || platform === 0) for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(v.getUint16(off + k));
        else for (let k = 0; k < len; k++) s += String.fromCharCode(b[off + k]!);
        if (s) names.set(id, s);
      }
    }
    const family = (names.get(16) ?? names.get(1) ?? '').trim();
    if (!family) return null;
    return { family, weight, italic, ...(names.get(4) ? { fullName: names.get(4)! } : {}) };
  } catch {
    return null;
  }
}
