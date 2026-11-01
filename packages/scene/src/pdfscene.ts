import type { Element, PathPart, TextElement } from './types.ts';
import type { Matrix, PdfClip, PdfFont, TextExact } from './pdftypes.ts';

/** What makes a text box "the same text": its characters and fonts. Colour may change without losing the glyphs. */
export function textSig(el: Pick<TextElement, 'text' | 'style' | 'runs'>): string {
  const s = el.style;
  return JSON.stringify([el.text, s.fontFamily, s.fontSize, s.bold, s.italic, s.underline, s.strike, s.uppercase, s.letterSpacing, el.runs?.map((r) => [r.text.length, r.style?.fontFamily, r.style?.fontSize])]);
}

/** The exact glyphs of a text box, while they still say what the box says. */
export function exactText(el: TextElement): TextExact | null {
  const x = el.exact;
  return x && !el.curve && !el.effect && !el.gradient && !el.list && !el.live?.units && x.sig === textSig(el) ? x : null;
}

export const partSig = (p: Pick<PathPart, 'fill' | 'stroke'>): string => JSON.stringify([p.fill, p.stroke]);

/** The exact paint of a path part, unless the user recoloured it. */
export const exactPart = (p: PathPart) => (p.exact && p.exact.sig === partSig(p) ? p.exact : null);

/** The element's clip, as a matrix from import-time page px to page px now. Absent = no clip. */
export function clipOf(el: Element): { clip: PdfClip; m: Matrix } | null {
  const c = el.pdfClip;
  if (!c) return null;
  if (el.type === 'text' && !exactText(el)) return null; // edited text may outgrow it
  const sx = c.box.w > 0 ? el.w / c.box.w : 1, sy = c.box.h > 0 ? el.h / c.box.h : 1;
  return { clip: c, m: [sx, 0, 0, sy, el.x - c.box.x * sx, el.y - c.box.y * sy] };
}

export const mulMatrix = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];

export const applyMatrix = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Where each glyph of a TJ array lands along the run, in text space (before the horizontal scale). */
export interface PlacedGlyph { code: number; x: number }

export function placeGlyphs(run: { size: number; tc?: number; tw?: number; tj: (string | number)[] }, widths: Record<string, number>, bytes: 1 | 2, scale = 1): { glyphs: PlacedGlyph[]; end: number } {
  const glyphs: PlacedGlyph[] = [];
  let x = 0;
  const tc = run.tc ?? 0, tw = run.tw ?? 0, size = run.size, step = bytes * 2;
  for (const t of run.tj) {
    if (typeof t === 'number') { x -= (t / 1000) * size; continue; }
    for (let i = 0; i + step <= t.length; i += step) {
      const code = parseInt(t.slice(i, i + step), 16);
      glyphs.push({ code, x });
      x += ((widths[code] ?? 0) * scale * size) / 1000 + tc + (bytes === 1 && code === 32 ? tw : 0);
    }
  }
  return { glyphs, end: x };
}

/** The characters of `text` a font from a PDF has no glyph for: embedded fonts hold only what the file used. */
export function missingGlyphs(text: string, font: PdfFont): string[] {
  const have = new Set<string>();
  for (const [code, u] of Object.entries(font.unicode)) if (font.gids[code]) for (const c of u) have.add(c);
  const out = new Set<string>();
  for (const c of text) if (!/\s/.test(c) && !have.has(c)) out.add(c);
  return [...out];
}

const SAFE: [RegExp, string][] = [
  [/arial|helvetica|liberation ?sans|nimbus ?sans/i, 'Arimo'], [/times|liberation ?serif|nimbus ?rom/i, 'Tinos'], [/courier|liberation ?mono|nimbus ?mon/i, 'Cousine'],
  [/calibri/i, 'Carlito'], [/cambria/i, 'Caladea'], [/georgia/i, 'Gelasio'], [/verdana|dejavu ?sans/i, 'DejaVu Sans'], [/garamond/i, 'EB Garamond'], [/palatino|book ?antiqua/i, 'Crimson Text'],
  [/devanagari|mangal|kokila|hind/i, 'Noto Sans Devanagari'],
];

/** The nearest full font for text a PDF's subset can't show. */
export function closestFamily(f: Pick<PdfFont, 'name' | 'serif' | 'mono'> | undefined): string {
  if (!f) return 'Inter';
  const name = f.name.replace(/([a-z])([A-Z])/g, '$1 $2');
  for (const [re, fam] of SAFE) if (re.test(f.name) || re.test(name)) return fam;
  // the font's own family, when a full one exists under that name, is tried by the caller's catalogue first
  if (f.mono) return 'Roboto Mono';
  return f.serif ? 'Noto Serif' : 'Inter';
}
