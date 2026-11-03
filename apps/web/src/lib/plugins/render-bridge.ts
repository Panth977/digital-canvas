/**
 * The render pieces plugins use, from `@digital-canvas/render` (r20-render):
 * shader compiling, font conversion and font names. Kept as one seam so the
 * web code has a single place that knows their shapes.
 */
import { compileShader as compile, fontInfo as info, toSfnt as sfnt, type FontInfo } from '@digital-canvas/render';
import type { CanvasKit } from 'canvaskit-wasm';

export type { FontInfo };
export interface CompileResult { ok: boolean; error?: string }

/** Compile SkSL: ok, or the compiler's message. */
export function compileShader(ck: CanvasKit, sksl: string): CompileResult {
  const r = compile(ck, sksl);
  return r.ok ? { ok: true } : { ok: false, error: cleanError(r.error ?? '') || 'The shader does not compile.' };
}

/** CanvasKit's message without the echoed source lines: "Line 1: unknown identifier 'foo'". */
export function cleanError(e: string): string {
  const lines = e.split('\n').filter((l) => /^\s*error:/.test(l));
  return (lines.length ? lines : [e.split('\n')[0] ?? '']).map((l) => l.replace(/^\s*error:\s*/, 'Line ')).join('\n').trim();
}

/** WOFF / WOFF2 → plain TrueType / OpenType (throws FontFileError on a broken file). */
export const toSfnt = (bytes: Uint8Array): Uint8Array => sfnt(bytes);

/** Family, weight and italic, or null when the file can't be read. */
export function fontInfo(bytes: Uint8Array): FontInfo | null {
  try { return info(bytes); } catch { return null; }
}

/** Mime type of font bytes, by their signature. */
export function fontMime(bytes: Uint8Array): string | null {
  const t = bytes.length >= 4 ? String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!) : '';
  if (t === 'wOFF') return 'font/woff';
  if (t === 'wOF2') return 'font/woff2';
  if (t === 'OTTO') return 'font/otf';
  if (t === 'true' || t === '\0\x01\0\0') return 'font/ttf';
  return null;
}
