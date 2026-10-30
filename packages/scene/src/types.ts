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
  /** How the element mixes with what is under it (absent = normal). */
  blend?: BlendMode;
  /** Enter animation (presentations, video and GIF export). See anim.ts. */
  animation?: Animation;
  /**
   * Shown only during this part of its page, in seconds from the page's start
   * (captions, timed call-outs). Absent = the whole page. Still views show it.
   */
  timing?: { start?: number; end?: number };
}

export type BlendMode = 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light' | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';

export type AnimationType = 'rise' | 'pan' | 'fade' | 'pop' | 'wipe' | 'typewriter' | 'baseline' | 'drift' | 'tumble';
export type AnimationDirection = 'left' | 'right' | 'up' | 'down';

/** Canva's basic animations; they play when the page starts. */
export interface Animation {
  type: AnimationType;
  /** Seconds (default 0.8). */
  duration?: number;
  /** Where it comes from (pan, wipe, drift). */
  direction?: AnimationDirection;
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
  /**
   * Which edge stays put when the text grows or shrinks (Canva's "Anchor text
   * box"). Absent = top.
   */
  anchor?: 'top' | 'middle' | 'bottom';
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
  /** Saturation that spares colours which are already strong. */
  vibrance?: number;
  /** The brightest tones. */
  whites?: number;
  /** The darkest tones. */
  blacks?: number;
  /** Fine detail: + crisper, - smoother. */
  texture?: number;
  /** Local contrast in the midtones. */
  clarity?: number;
  /** Film grain, 0..100. */
  grain?: number;
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

/** The colour bands of Colour edit, around the hue wheel. */
export type ColorBand = 'red' | 'orange' | 'yellow' | 'green' | 'aqua' | 'blue' | 'purple' | 'magenta';

/** One band's shifts, each -100..100. */
export interface BandEdit {
  hue?: number;
  saturation?: number;
  lightness?: number;
}

export type ColorEdit = Partial<Record<ColorBand, BandEdit>>;

export type ImageShadowStyle = 'glow' | 'drop' | 'angle' | 'curved' | 'lift' | 'backdrop' | 'outline';

/**
 * Canva's Shadows: amounts are 0..100 and scale with the picture; `angle` is in
 * degrees (0 = right, 90 = down). A style reads only the settings it has
 * (`SHADOW_SLIDERS`).
 */
export interface ImageShadow {
  style: ImageShadowStyle;
  size: number;
  blur: number;
  angle: number;
  distance: number;
  transparency: number;
  color: Color;
}

export interface ImageDuotone {
  light: Color;
  dark: Color;
  /** 0..100 (absent = 100). */
  intensity?: number;
}

export type ImageStylizeType = 'pixelate' | 'halftone' | 'posterize' | 'glitch' | 'screen' | 'sketch';

/** A pixel-level look on top of everything else; `amount` is 0..100. */
export interface ImageStylize {
  type: ImageStylizeType;
  amount: number;
}

/** A mask painted over a picture (an image asset; its alpha is the mask, stretched over the whole image). */
export interface BlurBrush {
  asset: string;
  /** 0..100. */
  intensity: number;
}

/** Look settings shared by images and video clips. */
export interface ImageLook {
  adjust?: ImageAdjust;
  filter?: ImageFilter;
  /** Older single effect; new designs use `shadow`, `duotone` and `stylize`, which can be combined. */
  effect?: ImageEffect;
  /** Auto-adjust: the values worked out from the picture, at 0..100 intensity. */
  auto?: { adjust: ImageAdjust; intensity: number };
  /** Hue, saturation and lightness per colour band. */
  colorEdit?: ColorEdit;
  /** Negative colours. */
  invert?: boolean;
  shadow?: ImageShadow;
  duotone?: ImageDuotone;
  stylize?: ImageStylize;
  /** Face retouch: skin smoothing, 0..100. */
  retouch?: number;
  /** Border along the picture's outline (its frame or rounded corners). */
  border?: Stroke;
  /** Rotate the picture inside its box, degrees (-45..45). */
  straighten?: number;
  /** Perspective inside the box, -100..100. */
  tiltX?: number;
  tiltY?: number;
  /** An image asset whose alpha is the subject (the same picture, any size): selective edits read it. */
  matte?: string;
  /** Extra adjustments for the subject or everything behind it (need `matte`). */
  selective?: { foreground?: ImageAdjust; background?: ImageAdjust };
  /** Auto Focus: blur everything but the subject, 0..100 (needs `matte`). */
  autoFocus?: number;
  /** Blur painted with a brush. */
  blurBrush?: BlurBrush;
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
  /** Image asset shown before the clip plays (and in still exports). Absent = `<asset>.poster`. */
  poster?: string;
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
  /** Speaker / designer notes for this page (not drawn). */
  notes?: string;
  /** Seconds this page shows in a video or presentation (default 5). */
  duration?: number;
  /** Ruler guides on this page (elements snap to them). */
  guides?: Guide[];
  /** Animate the whole page: every element without its own animation, staggered. */
  animation?: Animation;
  /** How this page comes in after the previous one (video). See anim.ts `transitionAt`. */
  transition?: Transition;
}

export type TransitionType = 'dissolve' | 'fade' | 'slide' | 'wipe' | 'zoom';

/** A page transition: plays over the first `duration` seconds of the page, over the end of the previous one. */
export interface Transition {
  type: TransitionType;
  /** Seconds (default 0.5). */
  duration?: number;
  /** Where the new page comes from (slide, wipe). Default 'right'. */
  direction?: AnimationDirection;
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
  /** Seconds to fade in from silence / out to silence (default 0). */
  fadeIn?: number;
  fadeOut?: number;
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
  /** Made by an AI model (AI panel ▸ Generate image / video). */
  ai?: AssetAI;
}

/** Where a generated asset came from. */
export interface AssetAI {
  /** Provider kind, e.g. `openai`, `gemini`, `kie`. */
  provider: string;
  model: string;
  prompt: string;
  /** ISO time. */
  at?: string;
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
