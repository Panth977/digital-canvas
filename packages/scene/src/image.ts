import type { BlendMode, BandEdit, ColorBand, Doc, Element, ImageAdjust, ImageAdjustKey, ImageDuotone, ImageEffect, ImageEffectType, ImageElement, ImageLook, ImageShadow, ImageShadowStyle, ImageStylize, ImageStylizeType, VideoElement } from './types.ts';
import { findElement, removeElements } from './doc.ts';
import { rotatePoint, type Point } from './geometry.ts';

/**
 * Image tools as pure data: adjustment ranges, named filters, effect
 * defaults and crop-mode geometry. The renderer turns the numbers into
 * pixels; the editor only edits them.
 */

export interface AdjustSlider {
  key: ImageAdjustKey;
  label: string;
  min: number;
  max: number;
  group: string;
}

/** Sliders in Canva's order, in its sections. */
export const ADJUST_SLIDERS: AdjustSlider[] = [
  { key: 'temperature', label: 'Temperature', min: -100, max: 100, group: 'White balance' },
  { key: 'tint', label: 'Tint', min: -100, max: 100, group: 'White balance' },
  { key: 'brightness', label: 'Brightness', min: -100, max: 100, group: 'Light' },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, group: 'Light' },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100, group: 'Light' },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100, group: 'Light' },
  { key: 'whites', label: 'Whites', min: -100, max: 100, group: 'Light' },
  { key: 'blacks', label: 'Blacks', min: -100, max: 100, group: 'Light' },
  { key: 'vibrance', label: 'Vibrance', min: -100, max: 100, group: 'Colour' },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, group: 'Colour' },
  { key: 'texture', label: 'Texture', min: -100, max: 100, group: 'Texture' },
  { key: 'clarity', label: 'Clarity', min: -100, max: 100, group: 'Texture' },
  { key: 'sharpen', label: 'Sharpen', min: 0, max: 100, group: 'Texture' },
  { key: 'fade', label: 'Fade', min: 0, max: 100, group: 'Texture' },
  { key: 'grain', label: 'Grain', min: 0, max: 100, group: 'Texture' },
  { key: 'vignette', label: 'Vignette', min: -100, max: 100, group: 'Texture' },
  { key: 'blur', label: 'Blur', min: 0, max: 100, group: 'Texture' },
];

export const ADJUST_GROUPS = ['White balance', 'Light', 'Colour', 'Texture'] as const;

const RANGE = new Map(ADJUST_SLIDERS.map((s) => [s.key, s]));

export interface FilterPreset {
  name: string;
  label: string;
  /** Canva's filter families. */
  group: FilterGroup;
  /** Adjustments at 100% intensity. */
  adjust: ImageAdjust;
}

export type FilterGroup = 'Natural' | 'Warm' | 'Cool' | 'Vivid' | 'Soft' | 'Vintage' | 'Mono';
export const FILTER_GROUPS: FilterGroup[] = ['Natural', 'Warm', 'Cool', 'Vivid', 'Soft', 'Vintage', 'Mono'];

/** Named filters: adjustment recipes scaled by the filter's intensity. */
export const IMAGE_FILTERS: FilterPreset[] = [
  { name: 'fresco', label: 'Fresco', group: 'Natural', adjust: { contrast: 8, vibrance: 15, clarity: 8 } },
  { name: 'clear', label: 'Clear', group: 'Natural', adjust: { shadows: 15, highlights: -10, clarity: 15, vibrance: 8 } },
  { name: 'daylight', label: 'Daylight', group: 'Natural', adjust: { brightness: 8, whites: 10, vibrance: 10 } },
  { name: 'crisp', label: 'Crisp', group: 'Natural', adjust: { contrast: 12, texture: 25, sharpen: 15 } },
  { name: 'greenery', label: 'Greenery', group: 'Natural', adjust: { tint: -8, vibrance: 20, shadows: 8 } },
  { name: 'festive', label: 'Festive', group: 'Warm', adjust: { saturation: 40, temperature: 25, tint: 10, brightness: 5, contrast: 10 } },
  { name: 'summer', label: 'Summer', group: 'Warm', adjust: { temperature: 35, saturation: 25, brightness: 10, highlights: 10 } },
  { name: 'warm', label: 'Warm', group: 'Warm', adjust: { temperature: 40, tint: 5, brightness: 3 } },
  { name: 'golden', label: 'Golden hour', group: 'Warm', adjust: { temperature: 55, tint: 8, highlights: -10, shadows: 12, vibrance: 15 } },
  { name: 'ember', label: 'Ember', group: 'Warm', adjust: { temperature: 45, contrast: 18, blacks: -12, vignette: 22 } },
  { name: 'cool', label: 'Cool', group: 'Cool', adjust: { temperature: -40, tint: -5, saturation: -5 } },
  { name: 'nordic', label: 'Nordic', group: 'Cool', adjust: { temperature: -28, saturation: -22, fade: 12, whites: 8 } },
  { name: 'ocean', label: 'Ocean', group: 'Cool', adjust: { temperature: -50, tint: -12, vibrance: 22, contrast: 8 } },
  { name: 'dusk', label: 'Dusk', group: 'Cool', adjust: { temperature: -30, tint: 18, shadows: -12, vignette: 18 } },
  { name: 'frost', label: 'Frost', group: 'Cool', adjust: { temperature: -35, brightness: 10, fade: 18, saturation: -12 } },
  { name: 'epic', label: 'Epic', group: 'Vivid', adjust: { contrast: 30, saturation: 20, highlights: -15, shadows: 15, vignette: 30, sharpen: 20 } },
  { name: 'vivid', label: 'Vivid', group: 'Vivid', adjust: { saturation: 50, contrast: 15, sharpen: 15 } },
  { name: 'pop', label: 'Pop', group: 'Vivid', adjust: { vibrance: 60, contrast: 20, clarity: 12 } },
  { name: 'dramatic', label: 'Dramatic', group: 'Vivid', adjust: { contrast: 45, saturation: -15, highlights: -25, shadows: -10, vignette: 35 } },
  { name: 'punch', label: 'Punch', group: 'Vivid', adjust: { contrast: 28, blacks: -20, whites: 15, vibrance: 30 } },
  { name: 'fade', label: 'Fade', group: 'Soft', adjust: { fade: 50, contrast: -20, saturation: -20 } },
  { name: 'pastel', label: 'Pastel', group: 'Soft', adjust: { fade: 30, brightness: 12, saturation: -12, contrast: -15 } },
  { name: 'dreamy', label: 'Dreamy', group: 'Soft', adjust: { clarity: -35, brightness: 8, fade: 15, temperature: 8 } },
  { name: 'matte', label: 'Matte', group: 'Soft', adjust: { blacks: 30, contrast: -14, saturation: -10 } },
  { name: 'haze', label: 'Haze', group: 'Soft', adjust: { fade: 38, texture: -25, temperature: 10 } },
  { name: 'retro', label: 'Retro', group: 'Vintage', adjust: { fade: 35, saturation: -30, temperature: 30, contrast: -10, vignette: 25 } },
  { name: 'sepia', label: 'Sepia', group: 'Vintage', adjust: { saturation: -100, temperature: 60, tint: 10, fade: 15, contrast: -10 } },
  { name: 'film', label: 'Film', group: 'Vintage', adjust: { fade: 18, grain: 35, temperature: 12, saturation: -10, vignette: 15 } },
  { name: 'polaroid', label: 'Instant', group: 'Vintage', adjust: { fade: 28, temperature: 18, tint: -8, contrast: -8, whites: -10 } },
  { name: 'seventies', label: 'Seventies', group: 'Vintage', adjust: { temperature: 42, tint: 12, saturation: -22, fade: 22, grain: 20 } },
  { name: 'mono', label: 'Mono', group: 'Mono', adjust: { saturation: -100 } },
  { name: 'noir', label: 'Noir', group: 'Mono', adjust: { saturation: -100, contrast: 35, shadows: -20, vignette: 40 } },
  { name: 'silver', label: 'Silver', group: 'Mono', adjust: { saturation: -100, whites: 15, blacks: 12, clarity: 12 } },
  { name: 'ink', label: 'Ink', group: 'Mono', adjust: { saturation: -100, contrast: 60, blacks: -30, grain: 15 } },
  { name: 'ash', label: 'Ash', group: 'Mono', adjust: { saturation: -100, fade: 32, contrast: -12 } },
];

export function filterPreset(name: string): FilterPreset | undefined {
  return IMAGE_FILTERS.find((f) => f.name === name);
}

/** The adjustments to draw with: the element's own plus auto-adjust and its filter at their intensities, clamped. */
export function effectiveAdjust(look: ImageLook): ImageAdjust {
  const out: ImageAdjust = {};
  const preset = look.filter ? filterPreset(look.filter.name) : undefined;
  const k = look.filter ? look.filter.intensity / 100 : 0;
  const a = look.auto ? look.auto.intensity / 100 : 0;
  for (const s of ADJUST_SLIDERS) {
    const v = (look.adjust?.[s.key] ?? 0) + (preset?.adjust[s.key] ?? 0) * k + (look.auto?.adjust[s.key] ?? 0) * a;
    if (v) out[s.key] = Math.max(s.min, Math.min(s.max, v));
  }
  return out;
}

/** Two sets of adjustments added together, clamped (a whole-picture edit plus a selective one). */
export function addAdjust(a: ImageAdjust, b: ImageAdjust | undefined): ImageAdjust {
  const out: ImageAdjust = { ...a };
  for (const s of ADJUST_SLIDERS) {
    const v = (a[s.key] ?? 0) + (b?.[s.key] ?? 0);
    if (v) out[s.key] = Math.max(s.min, Math.min(s.max, v));
    else delete out[s.key];
  }
  return out;
}

/** A 256-bin luminance histogram and the mean saturation of a picture (for Auto-adjust). */
export interface PictureStats {
  /** Tone below which 1% of pixels lie, 0..1. */
  low: number;
  /** Tone above which 1% of pixels lie, 0..1. */
  high: number;
  /** Mean tone, 0..1. */
  mean: number;
  /** Mean saturation, 0..1. */
  saturation: number;
  /** Mean red and blue, 0..1 (to read a colour cast). */
  red: number;
  blue: number;
}

/** Measure unpremultiplied RGBA pixels; fully transparent ones don't count. */
export function pictureStats(rgba: ArrayLike<number>): PictureStats {
  const bins = new Array<number>(256).fill(0);
  let n = 0, sum = 0, sat = 0, red = 0, blue = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3]! < 16) continue;
    const r = rgba[i]!, g = rgba[i + 1]!, b = rgba[i + 2]!;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    bins[Math.round(l)]!++;
    n++; sum += l; red += r; blue += b;
    sat += mx ? (mx - mn) / mx : 0;
  }
  if (!n) return { low: 0, high: 1, mean: 0.5, saturation: 0, red: 0.5, blue: 0.5 };
  let low = 0, high = 255, c = 0;
  for (let i = 0; i < 256; i++) { c += bins[i]!; if (c >= n * 0.01) { low = i; break; } }
  c = 0;
  for (let i = 255; i >= 0; i--) { c += bins[i]!; if (c >= n * 0.01) { high = i; break; } }
  return { low: low / 255, high: high / 255, mean: sum / n / 255, saturation: sat / n, red: red / n / 255, blue: blue / n / 255 };
}

/** Auto-adjust: stretch the tones to the full range, centre the exposure, neutralise a cast, lift flat colour. */
export function autoAdjust(s: PictureStats): ImageAdjust {
  const round = (v: number, lim: number) => Math.round(Math.max(-lim, Math.min(lim, v)));
  const out: ImageAdjust = {
    blacks: round(-s.low * 160, 40),
    whites: round((1 - s.high) * 160, 40),
    brightness: round((0.48 - s.mean) * 70, 30),
    shadows: round((0.42 - s.mean) * 60, 25),
    contrast: round(Math.max(0, 0.75 - (s.high - s.low)) * 40, 25),
    temperature: round((s.blue - s.red) * 90, 25),
    vibrance: round((0.3 - s.saturation) * 60, 25),
  };
  for (const k of Object.keys(out) as ImageAdjustKey[]) if (!out[k]) delete out[k];
  return out;
}

/** The bands of Colour edit, with the hue each one is centred on (degrees). */
export const COLOR_BANDS: { band: ColorBand; label: string; hue: number; swatch: string }[] = [
  { band: 'red', label: 'Red', hue: 0, swatch: '#e5383b' },
  { band: 'orange', label: 'Orange', hue: 30, swatch: '#f48c06' },
  { band: 'yellow', label: 'Yellow', hue: 60, swatch: '#ffd60a' },
  { band: 'green', label: 'Green', hue: 120, swatch: '#38b000' },
  { band: 'aqua', label: 'Aqua', hue: 180, swatch: '#00b4d8' },
  { band: 'blue', label: 'Blue', hue: 240, swatch: '#3a56e8' },
  { band: 'purple', label: 'Purple', hue: 280, swatch: '#8338ec' },
  { band: 'magenta', label: 'Magenta', hue: 320, swatch: '#f72585' },
];

/** How much a hue (degrees) belongs to each band; the weights add up to 1. */
export function bandWeights(hue: number): number[] {
  const h = ((hue % 360) + 360) % 360;
  const out = new Array<number>(COLOR_BANDS.length).fill(0);
  for (let i = 0; i < COLOR_BANDS.length; i++) {
    const a = COLOR_BANDS[i]!.hue, j = (i + 1) % COLOR_BANDS.length;
    const b = j ? COLOR_BANDS[j]!.hue : 360;
    if (h >= a && h < b) {
      const t = (h - a) / (b - a);
      out[i] = 1 - t;
      out[j] = t;
      break;
    }
  }
  return out;
}

/** The colour edit as 8 × (hue, saturation, lightness), each -1..1, for the shader. Null = nothing to do. */
export function colorEditUniforms(edit: ImageLook['colorEdit']): number[] | null {
  if (!edit) return null;
  const out: number[] = [];
  let any = false;
  for (const { band } of COLOR_BANDS) {
    const b: BandEdit = edit[band] ?? {};
    const v = [(b.hue ?? 0) / 100, (b.saturation ?? 0) / 100, (b.lightness ?? 0) / 100];
    if (v.some(Boolean)) any = true;
    out.push(...v);
  }
  return any ? out : null;
}

/** Default settings for each shadow style. */
export function defaultShadow(style: ImageShadowStyle): ImageShadow {
  const base = { style, size: 50, blur: 40, angle: 45, distance: 30, transparency: 50, color: '#000000' };
  switch (style) {
    case 'glow': return { ...base, size: 50, transparency: 30, color: '#ffd84d' };
    case 'drop': return base;
    case 'angle': return { ...base, angle: 135, size: 30, blur: 30, transparency: 60 };
    case 'curved': return { ...base, size: 45, blur: 45, transparency: 45 };
    case 'lift': return { ...base, size: 50, blur: 45, transparency: 45 };
    case 'backdrop': return { ...base, distance: 40, blur: 0, transparency: 0, color: '#8b5cf6' };
    case 'outline': return { ...base, size: 40, transparency: 0, color: '#ffffff' };
  }
}

export const SHADOW_STYLES: { style: ImageShadowStyle; label: string }[] = [
  { style: 'glow', label: 'Glow' },
  { style: 'drop', label: 'Drop' },
  { style: 'angle', label: 'Angle' },
  { style: 'curved', label: 'Curved' },
  { style: 'lift', label: 'Page lift' },
  { style: 'backdrop', label: 'Backdrop' },
  { style: 'outline', label: 'Outline' },
];

/** Which settings each shadow style has. */
export const SHADOW_SLIDERS: Record<ImageShadowStyle, { k: 'size' | 'blur' | 'angle' | 'distance' | 'transparency'; label: string; min: number; max: number }[]> = {
  glow: [{ k: 'size', label: 'Size', min: 0, max: 100 }, { k: 'blur', label: 'Blur', min: 0, max: 100 }, { k: 'transparency', label: 'Transparency', min: 0, max: 100 }],
  drop: [{ k: 'blur', label: 'Blur', min: 0, max: 100 }, { k: 'angle', label: 'Angle', min: -180, max: 180 }, { k: 'distance', label: 'Distance', min: 0, max: 100 }, { k: 'transparency', label: 'Transparency', min: 0, max: 100 }],
  angle: [{ k: 'size', label: 'Length', min: 0, max: 100 }, { k: 'blur', label: 'Blur', min: 0, max: 100 }, { k: 'angle', label: 'Angle', min: 100, max: 170 }, { k: 'transparency', label: 'Transparency', min: 0, max: 100 }],
  curved: [{ k: 'size', label: 'Curve', min: 0, max: 100 }, { k: 'blur', label: 'Blur', min: 0, max: 100 }, { k: 'transparency', label: 'Transparency', min: 0, max: 100 }],
  lift: [{ k: 'size', label: 'Lift', min: 0, max: 100 }, { k: 'blur', label: 'Blur', min: 0, max: 100 }, { k: 'transparency', label: 'Transparency', min: 0, max: 100 }],
  backdrop: [{ k: 'blur', label: 'Blur', min: 0, max: 100 }, { k: 'angle', label: 'Angle', min: -180, max: 180 }, { k: 'distance', label: 'Distance', min: 0, max: 100 }, { k: 'transparency', label: 'Transparency', min: 0, max: 100 }],
  outline: [{ k: 'size', label: 'Thickness', min: 0, max: 100 }],
};

/** The element's shadow, reading the older `effect` field too. */
export function shadowOf(look: ImageLook): ImageShadow | undefined {
  if (look.shadow) return look.shadow;
  const fx = look.effect;
  if (fx?.type === 'shadow') return { ...defaultShadow('drop'), blur: fx.blur, angle: fx.direction, distance: fx.offset, transparency: fx.transparency, color: fx.color };
  if (fx?.type === 'glow') return { ...defaultShadow('glow'), size: fx.size, blur: 50, transparency: fx.transparency, color: fx.color };
  if (fx?.type === 'outline') return { ...defaultShadow('outline'), size: fx.thickness, color: fx.color };
  return undefined;
}

export function duotoneOf(look: ImageLook): ImageDuotone | undefined {
  if (look.duotone) return look.duotone;
  return look.effect?.type === 'duotone' ? { light: look.effect.light, dark: look.effect.dark } : undefined;
}

export function stylizeOf(look: ImageLook): ImageStylize | undefined {
  if (look.stylize) return look.stylize;
  return look.effect?.type === 'pixelate' ? { type: 'pixelate', amount: look.effect.size } : undefined;
}

/** Duotone presets (shadows, highlights). */
export const DUOTONES: { id: string; label: string; dark: string; light: string }[] = [
  { id: 'peach', label: 'Peach', dark: '#3b1c6b', light: '#ffd1dc' },
  { id: 'ocean', label: 'Ocean', dark: '#03045e', light: '#90e0ef' },
  { id: 'citrus', label: 'Citrus', dark: '#14532d', light: '#fef08a' },
  { id: 'flame', label: 'Flame', dark: '#7f1d1d', light: '#fde047' },
  { id: 'grape', label: 'Grape', dark: '#2e1065', light: '#f0abfc' },
  { id: 'teal', label: 'Teal', dark: '#134e4a', light: '#ccfbf1' },
  { id: 'rose', label: 'Rose', dark: '#881337', light: '#ffe4e6' },
  { id: 'sand', label: 'Sand', dark: '#422006', light: '#fef3c7' },
  { id: 'ink', label: 'Ink', dark: '#0f172a', light: '#e2e8f0' },
  { id: 'lime', label: 'Lime', dark: '#1a2e05', light: '#d9f99d' },
  { id: 'sky', label: 'Sky', dark: '#1e3a8a', light: '#fef3c7' },
  { id: 'berry', label: 'Berry', dark: '#4a044e', light: '#fed7aa' },
];

export const STYLIZES: { type: ImageStylizeType; label: string; amount: number }[] = [
  { type: 'pixelate', label: 'Pixelate', amount: 30 },
  { type: 'halftone', label: 'Halftone', amount: 40 },
  { type: 'posterize', label: 'Posterize', amount: 50 },
  { type: 'glitch', label: 'Glitch', amount: 35 },
  { type: 'screen', label: 'Screen', amount: 45 },
  { type: 'sketch', label: 'Sketch', amount: 60 },
];

export const BLEND_MODES: { mode: BlendMode | ''; label: string }[] = [
  { mode: '', label: 'Normal' }, { mode: 'multiply', label: 'Multiply' }, { mode: 'screen', label: 'Screen' }, { mode: 'overlay', label: 'Overlay' },
  { mode: 'darken', label: 'Darken' }, { mode: 'lighten', label: 'Lighten' }, { mode: 'color-dodge', label: 'Colour dodge' }, { mode: 'color-burn', label: 'Colour burn' },
  { mode: 'hard-light', label: 'Hard light' }, { mode: 'soft-light', label: 'Soft light' }, { mode: 'difference', label: 'Difference' }, { mode: 'exclusion', label: 'Exclusion' },
  { mode: 'hue', label: 'Hue' }, { mode: 'saturation', label: 'Saturation' }, { mode: 'color', label: 'Colour' }, { mode: 'luminosity', label: 'Luminosity' },
];

/** Clamp one slider value to its range. */
export function clampAdjust(key: ImageAdjustKey, v: number): number {
  const r = RANGE.get(key);
  return r ? Math.max(r.min, Math.min(r.max, v)) : v;
}

/** Default settings for each image effect. */
export function defaultImageEffect(type: ImageEffectType): ImageEffect {
  switch (type) {
    case 'shadow': return { type, offset: 30, direction: 45, blur: 40, transparency: 50, color: '#000000' };
    case 'glow': return { type, size: 50, transparency: 30, color: '#ffd84d' };
    case 'duotone': return { type, light: '#ffd1dc', dark: '#3b1c6b' };
    case 'pixelate': return { type, size: 30 };
    case 'outline': return { type, thickness: 40, color: '#ffffff' };
  }
}

export const IMAGE_EFFECTS: { type: ImageEffectType; label: string }[] = [
  { type: 'shadow', label: 'Shadow' },
  { type: 'glow', label: 'Glow' },
  { type: 'duotone', label: 'Duotone' },
  { type: 'pixelate', label: 'Pixelate' },
  { type: 'outline', label: 'Outline' },
];

/** True when there is anything to draw beyond the plain picture. */
export function hasLook(look: ImageLook): boolean {
  return !!look.effect || !!look.shadow || !!look.duotone || !!look.stylize || !!look.invert || !!look.retouch || !!look.border
    || !!look.straighten || !!look.tiltX || !!look.tiltY || !!look.blurBrush || !!colorEditUniforms(look.colorEdit)
    || !!(look.matte && (look.autoFocus || selectiveOn(look.selective?.foreground) || selectiveOn(look.selective?.background)))
    || Object.keys(effectiveAdjust(look)).length > 0;
}

function selectiveOn(a: ImageAdjust | undefined): boolean {
  return !!a && Object.values(a).some(Boolean);
}

/** Every asset a picture's look reads, besides the picture itself (for loading and for saving). */
export function lookAssets(look: ImageLook): string[] {
  const out: string[] = [];
  if (look.matte) out.push(look.matte);
  if (look.blurBrush?.asset) out.push(look.blurBrush.asset);
  return out;
}

/** The look with the settings that only make sense for its own picture removed (for Copy style). */
export function portableLook(look: ImageLook): ImageLook {
  const { matte: _m, selective: _s, autoFocus: _a, blurBrush: _b, ...rest } = look;
  return rest;
}

/**
 * Straighten and tilt as a 3×3 matrix on the picture, about the box's centre,
 * scaled up so the picture still covers the box. Null = neither is set.
 */
export function straightenMatrix(box: { x: number; y: number; w: number; h: number }, look: Pick<ImageLook, 'straighten' | 'tiltX' | 'tiltY'>): number[] | null {
  const deg = look.straighten ?? 0, tx = (look.tiltX ?? 0) / 100, ty = (look.tiltY ?? 0) / 100;
  if (!deg && !tx && !ty) return null;
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const ratio = Math.max(box.w / box.h, box.h / box.w);
  const k = (Math.abs(c) + Math.abs(s) * ratio) * (1 + Math.max(Math.abs(tx), Math.abs(ty)) * 0.5);
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const px = (tx * 0.6) / box.w, py = (ty * 0.6) / box.h; // perspective
  // T(c) · P · R · S(k) · T(-c), row-major
  const m00 = k * c, m01 = -k * s, m10 = k * s, m11 = k * c, m20 = px * m00 + py * m10, m21 = px * m01 + py * m11;
  const t = (x: number, y: number, z: number) => [x + cx * z, y + cy * z, z] as const;
  const c0 = t(m00, m10, m20), c1 = t(m01, m11, m21);
  const c2 = t(-(m00 * cx + m01 * cy), -(m10 * cx + m11 * cy), 1 - (m20 * cx + m21 * cy));
  return [c0[0], c1[0], c2[0], c0[1], c1[1], c2[1], c0[2], c1[2], c2[2]];
}

/** Crop ratios offered in crop mode (null = free). */
export const CROP_RATIOS: { id: string; label: string; ratio: number | null }[] = [
  { id: 'free', label: 'Free', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '5:4', label: '5:4', ratio: 5 / 4 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '2:3', label: '2:3', ratio: 2 / 3 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '21:9', label: '21:9', ratio: 21 / 9 },
];

/** The largest frame of `ratio` (w/h) inside the image, centred on the current frame. */
export function ratioFrame(frame: Box, img: Box, ratio: number): Box {
  let w = img.w, h = w / ratio;
  if (h > img.h) { h = img.h; w = h * ratio; }
  const scale = Math.min(1, Math.max(frame.w / w, frame.h / h));
  w *= scale; h *= scale;
  const x = Math.max(img.x, Math.min(img.x + img.w - w, frame.x + frame.w / 2 - w / 2));
  const y = Math.max(img.y, Math.min(img.y + img.h - h, frame.y + frame.h / 2 - h / 2));
  return { x, y, w, h };
}

/** Magic Crop: the crop of an `iw`×`ih` image around a subject box (fractions), with some air, at the element's aspect. */
export function subjectCrop(subject: Crop, iw: number, ih: number, aspect: number, air = 0.08): Crop {
  const sw = subject.w * iw, sh = subject.h * ih;
  let w = sw * (1 + 2 * air), h = sh * (1 + 2 * air);
  if (w / h < aspect) w = h * aspect; else h = w / aspect;
  if (w > iw) { w = iw; h = Math.min(ih, w / aspect); }
  if (h > ih) { h = ih; w = Math.min(iw, h * aspect); }
  const cx = (subject.x + subject.w / 2) * iw, cy = (subject.y + subject.h / 2) * ih;
  const x = Math.max(0, Math.min(iw - w, cx - w / 2)), y = Math.max(0, Math.min(ih - h, cy - h / 2));
  return { x: x / iw, y: y / ih, w: w / iw, h: h / ih };
}

// ---- crop ----

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The centred part of an `iw`×`ih` image that covers a `w`×`h` box. */
export function coverCrop(iw: number, ih: number, w: number, h: number): Crop {
  if (iw <= 0 || ih <= 0 || w <= 0 || h <= 0) return { x: 0, y: 0, w: 1, h: 1 };
  const s = Math.max(w / iw, h / ih);
  const cw = Math.min(1, w / s / iw), ch = Math.min(1, h / s / ih);
  return { x: (1 - cw) / 2, y: (1 - ch) / 2, w: cw, h: ch };
}

/** The element's crop, or the cover-fit it draws with when it has none. */
export function cropOf(el: Pick<ImageElement, 'crop' | 'w' | 'h'>, iw: number, ih: number): Crop {
  return el.crop ?? coverCrop(iw, ih, el.w, el.h);
}

/** Where the whole image lies when `frame` shows its `crop` part (same coordinates as the frame). */
export function imageBox(frame: Box, crop: Crop): Box {
  const w = frame.w / crop.w, h = frame.h / crop.h;
  return { x: frame.x - crop.x * w, y: frame.y - crop.y * h, w, h };
}

/** The crop that shows `frame` out of an image placed at `img`. */
export function cropFromBoxes(frame: Box, img: Box): Crop {
  return { x: (frame.x - img.x) / img.w, y: (frame.y - img.y) / img.h, w: frame.w / img.w, h: frame.h / img.h };
}

/** Slide the image behind the frame; it always keeps covering the frame. */
export function panImage(frame: Box, img: Box, dx: number, dy: number): Box {
  const x = Math.min(frame.x, Math.max(frame.x + frame.w - img.w, img.x + dx));
  const y = Math.min(frame.y, Math.max(frame.y + frame.h - img.h, img.y + dy));
  return { ...img, x, y };
}

export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Drag a frame handle to `p`: the frame stays inside the image and at least `min` big. */
export function resizeFrame(frame: Box, img: Box, handle: CropHandle, p: { x: number; y: number }, min = 8): Box {
  let l = frame.x, t = frame.y, r = frame.x + frame.w, b = frame.y + frame.h;
  if (handle.includes('w')) l = Math.max(img.x, Math.min(r - min, p.x));
  if (handle.includes('e')) r = Math.min(img.x + img.w, Math.max(l + min, p.x));
  if (handle.includes('n')) t = Math.max(img.y, Math.min(b - min, p.y));
  if (handle.includes('s')) b = Math.min(img.y + img.h, Math.max(t + min, p.y));
  return { x: l, y: t, w: r - l, h: b - t };
}

/** Drag an image corner to `p`: the image scales about the opposite corner and keeps covering the frame. */
export function scaleImage(frame: Box, img: Box, corner: 'nw' | 'ne' | 'se' | 'sw', p: { x: number; y: number }): Box {
  const ax = corner.includes('w') ? img.x + img.w : img.x; // anchor = opposite corner
  const ay = corner.includes('n') ? img.y + img.h : img.y;
  const sx = Math.abs(p.x - ax) / img.w, sy = Math.abs(p.y - ay) / img.h;
  // smallest scale that still covers the frame from this anchor
  const need = Math.max(
    corner.includes('w') ? (ax - frame.x) / img.w : (frame.x + frame.w - ax) / img.w,
    corner.includes('n') ? (ay - frame.y) / img.h : (frame.y + frame.h - ay) / img.h,
  );
  const s = Math.max(need, (sx + sy) / 2, 0.01);
  const w = img.w * s, h = img.h * s;
  return { x: corner.includes('w') ? ax - w : ax, y: corner.includes('n') ? ay - h : ay, w, h };
}

type Placed = Box & { rotation: number; flipX?: boolean; flipY?: boolean };

/** Element space (unrotated, unflipped; where `imageBox` lives) → page coordinates. */
export function localToPage(el: Placed, p: Point): Point {
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  const f = { x: el.flipX ? 2 * cx - p.x : p.x, y: el.flipY ? 2 * cy - p.y : p.y };
  return rotatePoint(f, { x: cx, y: cy }, el.rotation);
}

/** Page coordinates → element space. */
export function pageToLocal(el: Placed, p: Point): Point {
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  const r = rotatePoint(p, { x: cx, y: cy }, -el.rotation);
  return { x: el.flipX ? 2 * cx - r.x : r.x, y: el.flipY ? 2 * cy - r.y : r.y };
}

/**
 * The element patch for a new crop frame and image placement, both in the
 * element's current space. A rotated element moves so nothing on the page shifts.
 */
export function cropPatch(el: Placed, frame: Box, img: Box): { x: number; y: number; w: number; h: number; crop: Crop } {
  const c = localToPage(el, { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 });
  return { x: c.x - frame.w / 2, y: c.y - frame.h / 2, w: frame.w, h: frame.h, crop: cropFromBoxes(frame, img) };
}

/**
 * Make an image or video the page's background: it moves to the back, fills
 * the page (cover-fit), loses its rotation and gets locked.
 */
export function setAsBackground(doc: Doc, id: string): Doc {
  const hit = findElement(doc, id);
  if (!hit || (hit.element.type !== 'image' && hit.element.type !== 'video') || !hit.element.asset) return doc;
  const el = hit.element as ImageElement | VideoElement;
  const meta = doc.assets[el.asset];
  const W = doc.width, H = doc.height;
  const crop = meta?.width && meta.height ? coverCrop(meta.width, meta.height, W, H) : undefined;
  const next = { ...el, x: 0, y: 0, w: W, h: H, rotation: 0, radius: 0, locked: true, crop } as Element;
  if (!crop) delete (next as ImageElement).crop;
  if (next.type === 'image') delete next.mask; // a frame's photo fills the whole page
  // out of wherever it was (the page or a group), then to the very back of the page
  const rest = removeElements(doc, [id]);
  const pages = rest.pages.map((p) => (p.id === hit.page.id ? { ...p, elements: [next, ...p.elements] } : p));
  return { ...rest, pages, updatedAt: new Date().toISOString() };
}
