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

/**
 * A look applied to the whole text box. Amounts are 0..100 like Canva's
 * sliders and scale with the font size; `direction` is in degrees
 * (0 = right, 90 = down).
 */
export type TextEffect =
  | { type: 'shadow'; offset: number; direction: number; blur: number; transparency: number; color: Color }
  | { type: 'lift'; intensity: number }
  | { type: 'hollow'; thickness: number }
  | { type: 'splice'; thickness: number; offset: number; direction: number; color: Color }
  | { type: 'outline'; thickness: number; color: Color }
  | { type: 'echo'; offset: number; direction: number; color: Color }
  | { type: 'glitch'; offset: number; direction: number; colors: 'blue-red' | 'blue-yellow' }
  | { type: 'neon'; intensity: number }
  | { type: 'background'; roundness: number; spread: number; transparency: number; color: Color };

export type TextEffectType = TextEffect['type'];

export type ListStyle = 'bullet' | 'number';

export interface TextElement extends ElementBase {
  type: 'text';
  /** The whole text. With `runs`, it equals the runs' texts joined. */
  text: string;
  style: TextStyle;
  /** Mixed styles inside one box. Absent = the whole text uses `style`. */
  runs?: TextRun[];
  effect?: TextEffect;
  /** Bend the text along a circle: -100..100 (0 or absent = straight). Curved text is one line. */
  curve?: number;
  /** Each line (paragraph) becomes a list item. */
  list?: ListStyle;
  /** Gradient fill for the letters; replaces the colours while set. */
  gradient?: Extract<Fill, { type: 'linear' }>;
}

/**
 * Photo adjustments, each -100..100 like Canva's sliders (0 or absent = unchanged).
 * `blur` and `sharpen` are 0..100; a negative `vignette` lightens the edges instead.
 */
export interface ImageAdjust {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  /** Warm (+) or cool (-). */
  temperature?: number;
  /** Magenta (+) or green (-). */
  tint?: number;
  highlights?: number;
  shadows?: number;
  /** Lifts the blacks (a washed-out look). */
  fade?: number;
  vignette?: number;
  blur?: number;
  sharpen?: number;
}

export type ImageAdjustKey = keyof ImageAdjust;

/** A named filter (see `IMAGE_FILTERS`) at 0..100 intensity. */
export interface ImageFilter {
  name: string;
  intensity: number;
}

/**
 * A look for the whole image. Amounts are 0..100 like Canva's sliders and
 * scale with the image size; `direction` is in degrees (0 = right, 90 = down).
 */
export type ImageEffect =
  | { type: 'shadow'; offset: number; direction: number; blur: number; transparency: number; color: Color }
  | { type: 'glow'; size: number; transparency: number; color: Color }
  | { type: 'duotone'; light: Color; dark: Color }
  | { type: 'pixelate'; size: number }
  | { type: 'outline'; thickness: number; color: Color };

export type ImageEffectType = ImageEffect['type'];

/** Look settings shared by images and video clips. */
export interface ImageLook {
  adjust?: ImageAdjust;
  filter?: ImageFilter;
  effect?: ImageEffect;
}

export interface ImageElement extends ElementBase, ImageLook {
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
  /** The asset before its background was removed (kept so it can be restored). */
  original?: string;
  /**
   * Frame: the image shows only inside this shape (a shape kind, or SVG path
   * `d` in `viewBox` units scaled to the box). An empty `asset` is an empty
   * frame waiting for a photo.
   */
  mask?: ShapeKind | MaskPath;
}

/** A frame outline in its own units, stretched over the element's box. */
export interface MaskPath {
  d: string;
  viewBox: { x: number; y: number; w: number; h: number };
}

/** A video clip on the page. Plays while its page is on screen (from the page's start). */
export interface VideoElement extends ElementBase, ImageLook {
  type: 'video';
  /** Key into `Doc.assets` (video/mp4, video/webm…). */
  asset: string;
  radius: number;
  crop?: { x: number; y: number; w: number; h: number };
  /** Part of the clip to use, in seconds of the file. Absent = the whole clip. */
  trimStart?: number;
  trimEnd?: number;
  /** Start again when the clip ends before the page does. */
  loop?: boolean;
  muted?: boolean;
  /** 0..1 (default 1). */
  volume?: number;
}

/** One vector path of a PathElement, in viewBox units (SVG path syntax). */
export interface PathPart {
  d: string;
  fill: Fill | null;
  stroke: Stroke | null;
  /** Fill with the even-odd rule (SVG `fill-rule="evenodd"`). */
  evenOdd?: boolean;
}

/**
 * A vector graphic: SVG paths scaled from `viewBox` to the element's box (like an SVG with
 * preserveAspectRatio="none"). Imported Canva shapes and graphics, freehand drawings, icons.
 */
export interface PathElement extends ElementBase {
  type: 'path';
  viewBox: { x: number; y: number; w: number; h: number };
  paths: PathPart[];
  /** A QR code: the text it encodes (so it can be changed later). */
  qr?: string;
}

/**
 * Elements that move, resize and rotate together. `children` are stored in
 * **page coordinates** (like any top-level element), so hit testing, snapping
 * and drawing need no extra transform. The group's own box is the frame the
 * children were laid out in: changing it (`updateElements`) transforms the
 * children with it, and changing a child refits the box. The renderer draws
 * the children as they are and applies only the group's `opacity`.
 */
export interface GroupElement extends ElementBase {
  type: 'group';
  children: Element[];
}


// ---- lines, connectors, tables, charts (M6) ----

export type LineMarker = 'none' | 'arrow' | 'triangle' | 'circle' | 'square' | 'bar';
export type LineRoute = 'straight' | 'elbow' | 'curved';

/** A connector end stuck to an element: `point` is a spot in its box as fractions (0.5, 0.5 = centre). */
export interface Attach {
  elementId: string;
  point: { x: number; y: number };
}

export interface LineEnd {
  /** Relative to the line's box top-left, px. */
  x: number;
  y: number;
  marker: LineMarker;
  /** Connector: the end follows this element. */
  attach?: Attach;
}

/** A line or arrow between two points; the box is the bounds of the two ends. */
export interface LineElement extends ElementBase {
  type: 'line';
  start: LineEnd;
  end: LineEnd;
  stroke: Stroke;
  route: LineRoute;
}

export interface TableCell {
  text: string;
  fill?: Color;
  /** Overrides the table's text style for this cell. */
  style?: Partial<TextStyle>;
}

export interface TableElement extends ElementBase {
  type: 'table';
  /** Column widths and row heights as fractions of the box (each list sums to 1). */
  cols: number[];
  rows: number[];
  /** `cells[row][col]`. */
  cells: TableCell[][];
  style: TextStyle;
  border: Stroke | null;
  /** Space inside each cell, px. */
  padding: number;
}

export type ChartKind = 'column' | 'bar' | 'line' | 'area' | 'pie' | 'donut';

export interface ChartSeries {
  name: string;
  /** One value per label. */
  values: number[];
}

export interface ChartElement extends ElementBase {
  type: 'chart';
  chart: ChartKind;
  labels: string[];
  series: ChartSeries[];
  /** Series colours (slice colours for pie and donut); repeated when short. */
  colors: Color[];
  style: { fontFamily: string; fontSize: number; color: Color };
  legend: boolean;
  grid: boolean;
  /** Write each value on its bar, point or slice. */
  values?: boolean;
}

export type Element = ShapeElement | TextElement | ImageElement | VideoElement | PathElement | LineElement | TableElement | ChartElement | GroupElement;
export type ElementType = Element['type'];

/** A ruler guide: a vertical line at `x = pos` (axis 'x') or a horizontal one at `y = pos`, page px. */
export interface Guide {
  axis: 'x' | 'y';
  pos: number;
}

export interface Page {
  id: string;
  name?: string;
  background: Fill;
  hidden?: boolean;
  elements: Element[];
  /** Seconds this page shows in a video or presentation (default 5). */
  duration?: number;
  /** Ruler guides on this page (elements snap to them). */
  guides?: Guide[];
}

/** A sound on the design's timeline (music, voice-over). */
export interface AudioClip {
  id: string;
  /** Key into `Doc.assets` (audio/mpeg, audio/mp4, audio/wav…, or a video file's sound). */
  asset: string;
  /** Where it starts on the timeline, seconds. */
  start: number;
  /** Where in the file it starts, seconds. */
  offset: number;
  /** How long it plays, seconds. */
  duration: number;
  /** 0..1 (default 1). */
  volume?: number;
  name?: string;
}

export interface AssetMeta {
  /** MIME type, e.g. `image/png`. */
  mime: string;
  /** Intrinsic size for images. */
  width?: number;
  height?: number;
  /** Original file name, for the uploads panel. */
  name?: string;
  /** Length of audio and video files, seconds. */
  duration?: number;
}

/** A font face shipped inside the file, so the design looks the same anywhere. */
export interface EmbeddedFont {
  family: string;
  /** Key into `Doc.assets` (mime font/ttf or font/otf). */
  asset: string;
  weight?: number;
  italic?: boolean;
  /**
   * One script subset of the family (e.g. `latin-ext`) when a face is split
   * by script, as Google Fonts does. Characters missing from one subset are
   * looked up in the family's other subsets.
   */
  subset?: string;
  /** Where it came from, e.g. `fontsource:lobster` or `upload`. */
  source?: string;
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
  /** Sounds on the timeline. */
  audio?: AudioClip[];
  createdAt: string;
  updatedAt: string;
}
