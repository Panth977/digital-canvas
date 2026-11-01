/**
 * What an element imported from a PDF keeps so it can be drawn and written back
 * exactly (r18). All of it is optional, and all of it stands aside by itself once
 * the user changes the thing it describes: see `exactText` and friends in pdfscene.ts.
 */
export type Matrix = [number, number, number, number, number, number];

/** A colour as the source file wrote it, so CMYK and spot inks survive. `rgb` is what it looks like on screen. */
export interface SourceColor {
  /** `g`, `rg`, `k`, or a colour space object number in the source file. */
  cs: 'g' | 'rg' | 'k' | number;
  v: number[];
  rgb: string;
}

export interface PdfClipPath {
  /** SVG path, page px. */
  d: string;
  evenOdd?: boolean;
}

/** Clip paths in page px at import, and the box they belong to: they follow the element when it moves. */
export interface PdfClip {
  paths: PdfClipPath[];
  box: { x: number; y: number; w: number; h: number };
}

export interface ShadeStop {
  offset: number;
  color: string;
}

/** An axial or radial shading. Coordinates are in the space of `matrix` (→ viewBox units). */
export interface PathShade {
  kind: 'axial' | 'radial';
  /** Axial: x0 y0 x1 y1. Radial: x0 y0 r0 x1 y1 r1. */
  coords: number[];
  stops: ShadeStop[];
  extend: [boolean, boolean];
  matrix: Matrix;
}

export interface PathExact {
  /** Stroke width, in the units `d` is in (0 = thinnest line the device can draw). */
  width?: number;
  cap?: 0 | 1 | 2;
  join?: 0 | 1 | 2;
  miter?: number;
  dash?: { array: number[]; phase: number };
  /** `d` is in this space, not viewBox units: strokes under an uneven scale. */
  ctm?: Matrix;
  fillSrc?: SourceColor;
  strokeSrc?: SourceColor;
  shade?: PathShade;
  /** The source file's pattern for this fill: PDF export writes it, the screen draws `shade`. */
  pattern?: { obj: number; base: Matrix };
  /** The source file's shading object for a `sh` fill, under `base`. */
  shading?: number;
  base?: Matrix;
  /** `fill` and `stroke` as imported: a change to either drops the exact paint. */
  sig: string;
}

/** One stretch of glyphs: PDF text state plus a TJ array. */
export interface ExactRun {
  /** Key into `Doc.pdf.fonts`. */
  font: string;
  size: number;
  /** Text space → box px. */
  m: Matrix;
  /** Character and word spacing, horizontal scale (1 = 100 %), rise. */
  tc?: number;
  tw?: number;
  th?: number;
  rise?: number;
  /** PDF render mode; absent = fill. */
  mode?: number;
  /** Hex character codes and TJ adjustments, in thousandths. */
  tj: (string | number)[];
  color: string;
  colorSrc?: SourceColor;
  stroke?: string;
  strokeSrc?: SourceColor;
  /** Stroke width in text space px. */
  lw?: number;
}

export interface TextExact {
  runs: ExactRun[];
  /** The box at import: a resize scales the glyphs. */
  w: number;
  h: number;
  /** `textSig` at import: any other text or font drops the exact glyphs. */
  sig: string;
  /** `style.color` at import: a new colour repaints the glyphs. */
  color: string;
  /** First baseline from the box top, px: where edited text sits. */
  baseline: number;
  /** A picture of the text for screens, when the font can't be drawn here (Type 3). */
  picture?: { asset: string; x: number; y: number; w: number; h: number };
}

export interface PdfImageSource {
  /** Object number in the source file. */
  obj: number;
  /** The element's asset at import. */
  asset: string;
  /** An image mask: drawn in this colour. */
  stencil?: SourceColor;
}

/** A fill with a tiling pattern from the source file. */
export interface PdfPatternFill {
  /** Page px at import. */
  d: string;
  evenOdd?: boolean;
  /** Pattern object in the source file. */
  obj: number;
  /** Pattern space's parent → page px. */
  base: Matrix;
  alpha: number;
  clips: PdfClipPath[];
}

/**
 * What a picture of a flattened region stands for: the screen shows the picture, a PDF
 * export writes the original objects so the region stays vector. Used while `asset` is unchanged.
 */
export interface PdfVectorSource {
  asset: string;
  /** The element's box at import: moving it moves this too. */
  box: { x: number; y: number; w: number; h: number };
  form?: { obj: number; m: Matrix; alpha: number; clips: PdfClipPath[] };
  fills?: PdfPatternFill[];
}

export interface PdfFont {
  /** Not embedded in the file: PDF export names it, as the source did. */
  standard?: { baseFont: string; subtype: string; encoding?: string };
  /** Name in the file, without the subset tag. */
  name: string;
  /** Design family for this font (absent: nothing could be extracted). */
  family?: string;
  /** Asset with the font program (absent: same). */
  asset?: string;
  /** Object number in the source file. */
  obj?: number;
  /** Bytes per character code. */
  bytes: 1 | 2;
  /** Advance per code, in glyph space thousandths. Keys are decimal codes. */
  widths: Record<string, number>;
  /** Glyph id per code in the font program. */
  gids: Record<string, number>;
  /** Text per code. */
  unicode: Record<string, string>;
  /** Advance scale (FontMatrix a × 1000, 1 for most fonts). */
  scale?: number;
  serif?: boolean;
  mono?: boolean;
  bold?: boolean;
  italic?: boolean;
  /** Glyphs live in the file as drawings: only the source can show them exactly. */
  type3?: boolean;
}

export interface PdfSource {
  /** Asset holding the original file (absent: it could not be parsed for reuse). */
  source?: string;
  fonts: Record<string, PdfFont>;
}

/** How a page imported from a PDF sits on the design's page. */
export interface PdfPageBox {
  /** The PDF page's size, pt. */
  w: number;
  h: number;
  /** Page px per pt, and where the PDF page's top-left sits, page px. */
  scale: number;
  x: number;
  y: number;
}

export interface PageLink {
  x: number;
  y: number;
  w: number;
  h: number;
  url?: string;
  /** 0-based page in this design. */
  page?: number;
}
