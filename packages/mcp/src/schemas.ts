/**
 * Input shapes the agent fills in. Kept flat and forgiving (like the "loose"
 * document format): every field is optional except what an element can't do
 * without, unknown fields are reported back as warnings, never fatal.
 */
import { z } from 'zod';

export const color = z.string().describe('Colour: "#rrggbb", "#rrggbbaa" (alpha), "#rgb" or a basic name ("white", "black", "navy", "gold", "transparent").');

export const fill = z.union([
  color,
  z.object({
    type: z.literal('linear').optional(),
    angle: z.number().optional().describe('CSS degrees: 180 = top→bottom, 90 = left→right (default), 0 = bottom→top, 135 = diagonal top-left→bottom-right.'),
    colors: z.array(color).min(2).describe('Gradient colours, evenly spaced.'),
  }),
]).describe('A colour, or a linear gradient { angle, colors: [..] }.');

export const ANIMATION_TYPES = ['rise', 'pan', 'fade', 'pop', 'wipe', 'typewriter', 'baseline', 'drift', 'tumble'] as const;
export const animation = z.object({
  type: z.enum(ANIMATION_TYPES).describe('rise (slides up + fades), pan, fade, pop (scales up), wipe, typewriter (text appears letter by letter), baseline (text rises from its baseline), drift, tumble.'),
  duration: z.number().positive().optional().describe('Seconds (default 0.8).'),
  direction: z.enum(['left', 'right', 'up', 'down']).optional().describe('Where it comes from (pan, wipe, drift).'),
}).describe('Enter animation, plays when the page starts (or when the element\'s timing window opens). Shown in video/GIF exports.');

export const timing = z.object({
  start: z.number().min(0).optional().describe('Seconds from the page start when it appears.'),
  end: z.number().min(0).optional().describe('Seconds from the page start when it disappears.'),
}).describe('Video only: show the element only during this window of its page (captions, timed call-outs).');

const TEXT_EFFECT_TYPES = ['shadow', 'lift', 'hollow', 'splice', 'outline', 'echo', 'glitch', 'neon', 'background'] as const;
export const textEffect = z.object({
  type: z.enum(TEXT_EFFECT_TYPES).describe('shadow, lift (soft shadow), hollow (outline only), splice, outline, echo, glitch, neon (glow), background (a highlight box behind the text: great for legibility on photos).'),
  color: color.optional(),
  offset: z.number().optional(), direction: z.number().optional(), blur: z.number().optional(), transparency: z.number().optional(),
  intensity: z.number().optional(), thickness: z.number().optional(), roundness: z.number().optional(), spread: z.number().optional(),
}).passthrough().describe('A text effect; amounts are 0..100 like Canva\'s sliders, missing ones use good defaults.');

export const imageEffect = z.object({
  type: z.enum(['shadow', 'glow', 'duotone', 'pixelate', 'outline']),
}).passthrough().describe('Image effect: shadow { offset, direction, blur, transparency, color }, glow { size, transparency, color }, duotone { light, dark }, pixelate { size }, outline { thickness, color }.');

export const adjust = z.object({
  brightness: z.number(), contrast: z.number(), saturation: z.number(), temperature: z.number(), tint: z.number(),
  highlights: z.number(), shadows: z.number(), fade: z.number(), vignette: z.number(), blur: z.number(), sharpen: z.number(),
}).partial().describe('Photo adjustments, each -100..100 (blur/sharpen 0..100).');

const SHAPES = ['rect', 'ellipse', 'circle', 'square', 'triangle', 'diamond', 'pentagon', 'hexagon', 'star', 'arrow'] as const;

/** Fields shared by add and update. */
const props = {
  name: z.string().optional().describe('A label for the layer (handy to find it again).'),
  x: z.number().optional().describe('Left edge, px from the page\'s left (default: centred).'),
  y: z.number().optional().describe('Top edge, px from the page\'s top (default: centred).'),
  w: z.number().positive().optional().describe('Width, px.'),
  h: z.number().positive().optional().describe('Height, px. Text: measured automatically when left out.'),
  rotation: z.number().optional().describe('Degrees clockwise.'),
  opacity: z.number().min(0).max(1).optional(),
  locked: z.boolean().optional(),
  hidden: z.boolean().optional(),
  animation: animation.nullable().optional(),
  timing: timing.nullable().optional(),
  // text
  text: z.string().optional().describe('text: the words ("\\n" = new line). qr: the data to encode.'),
  fontFamily: z.string().optional().describe('Any Google Fonts family (e.g. "Montserrat", "Playfair Display", "Anton", "Bebas Neue", "Poppins"); embedded automatically. Default Inter.'),
  fontSize: z.number().positive().optional().describe('px. On a 1080 px wide post: headlines 90–200, subheads 44–70, body 28–40.'),
  color: color.optional().describe('Text colour (text), icon colour (icon), line colour (line), dark modules (qr).'),
  bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional(), strike: z.boolean().optional(),
  uppercase: z.boolean().optional(),
  align: z.enum(['left', 'center', 'right', 'justify']).optional(),
  lineHeight: z.number().positive().optional().describe('Multiple of the font size (default 1.25; 0.9–1.05 for big headlines).'),
  letterSpacing: z.number().optional().describe('Extra px between letters.'),
  list: z.enum(['bullet', 'number']).nullable().optional(),
  curve: z.number().min(-100).max(100).optional().describe('Bend text along a circle (-100..100).'),
  gradient: fill.nullable().optional().describe('Gradient fill for the letters.'),
  effect: z.union([textEffect, imageEffect]).nullable().optional().describe('Text: shadow/lift/hollow/splice/outline/echo/glitch/neon/background. Image/video: shadow/glow/duotone/pixelate/outline.'),
  anchor: z.enum(['top', 'middle', 'bottom']).optional().describe('Which edge of a text box stays put when the text grows.'),
  runs: z.array(z.object({ text: z.string(), color: color.optional(), bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional(), fontFamily: z.string().optional(), fontSize: z.number().optional() }))
    .optional().describe('Mixed styles inside one text box: pieces whose texts join to `text` (e.g. one word in another colour).'),
  autoFit: z.enum(['grow', 'shrink']).optional().describe('Text: "grow" (default) sets the box height to the text; "shrink" keeps w×h and lowers the font size until the text fits.'),
  // shape
  shape: z.enum(SHAPES).optional().describe('Shape kind (type "shape").'),
  fill: fill.nullable().optional().describe('Shape fill (null = none).'),
  stroke: z.object({ color, width: z.number().positive().optional(), dash: z.enum(['solid', 'dashed', 'dotted']).optional() }).nullable().optional().describe('Shape border / line style.'),
  radius: z.number().min(0).optional().describe('Corner radius px (rect, image, video).'),
  // line
  x1: z.number().optional(), y1: z.number().optional(), x2: z.number().optional(), y2: z.number().optional(),
  strokeWidth: z.number().positive().optional().describe('Line thickness px.'),
  startMarker: z.enum(['none', 'arrow', 'triangle', 'circle', 'square', 'bar']).optional(),
  endMarker: z.enum(['none', 'arrow', 'triangle', 'circle', 'square', 'bar']).optional(),
  route: z.enum(['straight', 'elbow', 'curved']).optional(),
  // media
  asset: z.string().optional().describe('image/video: an asset id from list_assets / import_* / search results already imported.'),
  url: z.string().optional().describe('image/video: a public URL to download instead of `asset`.'),
  driveFileId: z.string().optional().describe('image/video: a Google Drive file id (from search_drive) instead of `asset`.'),
  fit: z.enum(['cover', 'contain']).optional().describe('image/video: "cover" (default) fills the box, cropping; "contain" sizes the box to the picture\'s shape inside w×h.'),
  focus: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional().describe('image/video with fit "cover": which point of the picture to keep in view (0..1; default centre 0.5,0.5). E.g. {x:0.5,y:0.3} keeps faces near the top.'),
  mask: z.enum(SHAPES).optional().describe('image/video: show it only inside this shape (circle photo = "ellipse").'),
  filter: z.object({ name: z.string(), intensity: z.number().min(0).max(100).optional() }).optional().describe('image filter preset by name (see the design guide resource), intensity 0..100.'),
  adjust: adjust.optional(),
  trimStart: z.number().min(0).optional().describe('video: start of the part to use, seconds into the file.'),
  trimEnd: z.number().min(0).optional().describe('video: end of the part to use, seconds into the file.'),
  loop: z.boolean().optional().describe('video: start again when the clip ends before the page does.'),
  muted: z.boolean().optional(),
  volume: z.number().min(0).max(1).optional(),
  // icon / qr
  icon: z.string().optional().describe('Iconify name "prefix:name" (e.g. "mdi:instagram", "ph:coffee-bold", "fluent-emoji-flat:party-popper"); find them with search_stock kind "icon"/"graphic"/"sticker".'),
  background: color.nullable().optional().describe('qr: light modules colour (null = transparent).'),
  // chart / table / path / group
  chart: z.enum(['column', 'bar', 'line', 'area', 'pie', 'donut']).optional(),
  labels: z.array(z.string()).optional(),
  series: z.array(z.object({ name: z.string(), values: z.array(z.number()) })).optional(),
  colors: z.array(color).optional(),
  legend: z.boolean().optional(), grid: z.boolean().optional(),
  rows: z.array(z.array(z.string())).optional().describe('table: cell texts, row by row (first row = header).'),
  headerFill: color.optional(),
  d: z.string().optional().describe('path: SVG path data.'),
  viewBox: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
};

export const ELEMENT_TYPES = ['text', 'shape', 'line', 'arrow', 'image', 'video', 'icon', 'qr', 'chart', 'table', 'path', 'group'] as const;

export const elementSpec = z.object({
  type: z.enum(ELEMENT_TYPES).describe('What to add.'),
  ...props,
  children: z.array(z.record(z.unknown())).optional().describe('group: the elements inside (same format), in page coordinates.'),
}).passthrough();

export type ElementSpec = z.infer<typeof elementSpec>;

export const elementPatch = z.object({
  id: z.string().describe('Element id (from open_design / add_elements).'),
  ...props,
}).passthrough();

export type ElementPatch = z.infer<typeof elementPatch>;

export const pageRef = z.union([z.string(), z.number().int()]).describe('Page id, or page number (1 = first).');
