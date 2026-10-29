/**
 * Print geometry for PDF Print (Canva's "Crop marks and bleed"): where the
 * trim, the bleed and the crop marks go on the PDF sheet. Pure maths in page
 * px (96 px = 1 in), y down; the PDF writer turns it into points.
 */

/** 1 mm in px. */
export const MM = 96 / 25.4;

export interface Box { x: number; y: number; w: number; h: number }
export interface Segment { x1: number; y1: number; x2: number; y2: number }

export interface PrintLayout {
  /** The whole sheet (PDF MediaBox), px. */
  mediaW: number;
  mediaH: number;
  /** The finished page (PDF TrimBox) on the sheet. */
  trim: Box;
  /** The trim plus the bleed (PDF BleedBox): artwork is drawn up to here. */
  bleed: Box;
  /** Crop (trim) marks, outside the bleed, in sheet px. */
  marks: Segment[];
}

export interface PrintOptions {
  /** Bleed on every side, px (0 = none). */
  bleed: number;
  /** Draw crop marks in a slug around the bleed. */
  marks: boolean;
  /** Gap between the trim line and the start of a mark (default: the bleed, at least 3 mm), px. */
  markOffset?: number;
  /** Length of each mark (default 6 mm), px. */
  markLength?: number;
}

/**
 * Lay out a `w`×`h` page for print. Without marks the sheet is the page plus
 * its bleed. With marks a slug is added around the bleed and each corner gets
 * a horizontal and a vertical mark on the trim lines' extensions; marks start
 * outside the bleed so they never print on the artwork.
 */
export function printLayout(w: number, h: number, opts: PrintOptions): PrintLayout {
  const b = Math.max(0, opts.bleed);
  const offset = opts.marks ? Math.max(b, opts.markOffset ?? 3 * MM) : 0;
  const len = opts.marks ? (opts.markLength ?? 6 * MM) : 0;
  const m = opts.marks ? offset + len : b;
  const trim = { x: m, y: m, w, h };
  const marks: Segment[] = [];
  if (opts.marks) {
    for (const cx of [0, 1] as const) {
      for (const cy of [0, 1] as const) {
        const x = m + cx * w, y = m + cy * h;
        const sx = cx ? 1 : -1, sy = cy ? 1 : -1; // away from the page
        marks.push({ x1: x + sx * offset, y1: y, x2: x + sx * (offset + len), y2: y }); // horizontal, on the trim line y
        marks.push({ x1: x, y1: y + sy * offset, x2: x, y2: y + sy * (offset + len) }); // vertical, on the trim line x
      }
    }
  }
  return { mediaW: w + 2 * m, mediaH: h + 2 * m, trim, bleed: { x: m - b, y: m - b, w: w + 2 * b, h: h + 2 * b }, marks };
}

/**
 * sRGB (0..1) to CMYK (0..1) by the plain device formula with full grey
 * replacement (K = 1 − max). No ICC profile: a best effort, not a
 * colour-managed separation.
 */
export function rgbToCmyk(r: number, g: number, b: number): [number, number, number, number] {
  const k = 1 - Math.max(r, g, b);
  if (k >= 1 - 1e-6) return [0, 0, 0, 1];
  const d = 1 - k;
  return [(1 - r - k) / d, (1 - g - k) / d, (1 - b - k) / d, k];
}

/** RGBA pixels (unpremultiplied) to 8-bit CMYK plus an 8-bit alpha plane. */
export function rgbaToCmyk(px: Uint8Array): { cmyk: Uint8Array; alpha: Uint8Array; opaque: boolean } {
  const n = px.length / 4;
  const cmyk = new Uint8Array(n * 4), alpha = new Uint8Array(n);
  let opaque = true;
  for (let i = 0; i < n; i++) {
    const r = px[i * 4]!, g = px[i * 4 + 1]!, b = px[i * 4 + 2]!, a = px[i * 4 + 3]!;
    const max = Math.max(r, g, b);
    const k = 255 - max;
    if (max === 0) cmyk[i * 4 + 3] = 255;
    else {
      cmyk[i * 4] = Math.round(((max - r) * 255) / max);
      cmyk[i * 4 + 1] = Math.round(((max - g) * 255) / max);
      cmyk[i * 4 + 2] = Math.round(((max - b) * 255) / max);
      cmyk[i * 4 + 3] = k;
    }
    alpha[i] = a;
    if (a !== 255) opaque = false;
  }
  return { cmyk, alpha, opaque };
}
