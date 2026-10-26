/**
 * The Digital Canvas document format.
 *
 * A document is a stack of same-sized pages; each page holds absolutely
 * positioned elements. Every length is in CSS pixels (96 per inch) — `unit`
 * only says how sizes are shown to the user. The format is plain JSON so
 * people, scripts and AI agents can read and write it.
 */

export const FORMAT = 'digital-canvas';
export const VERSION = 1;

export type Unit = 'px' | 'in' | 'mm' | 'cm';

/** `#rrggbb` or `#rrggbbaa`. */
export type Color = string;

export interface GradientStop {
  offset: number; // 0..1
  color: Color;
}

export type Fill =
  | { type: 'solid'; color: Color }
  | { type: 'linear'; angle: number; stops: GradientStop[] };

export interface Stroke {
  color: Color;
  width: number;
  dash?: 'solid' | 'dashed' | 'dotted';
}

export interface ElementBase {
  id: string;
  name?: string;
  /** Top-left of the unrotated box, in page coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees, clockwise, around the box centre. */
  rotation: number;
  opacity: number; // 0..1
  flipX?: boolean;
  flipY?: boolean;
  locked?: boolean;
  hidden?: boolean;
}

export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'diamond' | 'pentagon' | 'hexagon' | 'star' | 'arrow';

export interface ShapeElement extends ElementBase {
  type: 'shape';
  shape: ShapeKind;
  fill: Fill | null;
  stroke: Stroke | null;
  /** Corner radius in px (rect only). */
  radius: number;
}

export type TextAlign = 'left' | 'center' | 'right' | 'justify';

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: Color;
  align: TextAlign;
  /** Multiple of the font size. */
  lineHeight: number;
  /** Extra space between letters, in px. */
  letterSpacing: number;
  uppercase: boolean;
}

/** A stretch of text with its own look (e.g. one underlined word). Overrides the element's style. */
export interface TextRun {
  text: string;
  style?: Partial<TextStyle>;
}

export interface TextElement extends ElementBase {
  type: 'text';
  /** The whole text. With `runs`, it equals the runs' texts joined. */
  text: string;
  style: TextStyle;
  /** Mixed styles inside one box. Absent = the whole text uses `style`. */
  runs?: TextRun[];
}

export interface ImageElement extends ElementBase {
  type: 'image';
  /** Key into `Doc.assets`. */
  asset: string;
  /** Corner radius in px. */
  radius: number;
  /**
   * Which part of the image fills the box, as fractions of the image
   * (0..1). Absent = cover-fit, centred.
   */
  crop?: { x: number; y: number; w: number; h: number };
}

export type Element = ShapeElement | TextElement | ImageElement;
export type ElementType = Element['type'];

export interface Page {
  id: string;
  name?: string;
  background: Fill;
  hidden?: boolean;
  elements: Element[];
}

export interface AssetMeta {
  /** MIME type, e.g. `image/png`. */
  mime: string;
  /** Intrinsic size for images. */
  width?: number;
  height?: number;
  /** Original file name, for the uploads panel. */
  name?: string;
}

/** A font face shipped inside the file, so the design looks the same anywhere. */
export interface EmbeddedFont {
  family: string;
  /** Key into `Doc.assets` (mime font/ttf or font/otf). */
  asset: string;
  weight?: number;
  italic?: boolean;
}

export interface Doc {
  format: typeof FORMAT;
  version: typeof VERSION;
  id: string;
  title: string;
  unit: Unit;
  /** Page size in px. */
  width: number;
  height: number;
  /** Print bleed in px (0 = none). */
  bleed: number;
  pages: Page[];
  assets: Record<string, AssetMeta>;
  /** Fonts the design uses that are not built into the app. */
  fonts?: EmbeddedFont[];
  createdAt: string;
  updatedAt: string;
}
