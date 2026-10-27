import type { Doc, Element, ImageAdjust, ImageAdjustKey, ImageEffect, ImageEffectType, ImageElement, ImageLook, VideoElement } from './types.ts';
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
}

/** Sliders in Canva's order. */
export const ADJUST_SLIDERS: AdjustSlider[] = [
  { key: 'brightness', label: 'Brightness', min: -100, max: 100 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
  { key: 'temperature', label: 'Temperature', min: -100, max: 100 },
  { key: 'tint', label: 'Tint', min: -100, max: 100 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100 },
  { key: 'fade', label: 'Fade', min: 0, max: 100 },
  { key: 'vignette', label: 'Vignette', min: -100, max: 100 },
  { key: 'blur', label: 'Blur', min: 0, max: 100 },
  { key: 'sharpen', label: 'Sharpen', min: 0, max: 100 },
];

const RANGE = new Map(ADJUST_SLIDERS.map((s) => [s.key, s]));

export interface FilterPreset {
  name: string;
  label: string;
  /** Adjustments at 100% intensity. */
  adjust: ImageAdjust;
}

/** Named filters: adjustment recipes scaled by the filter's intensity. */
export const IMAGE_FILTERS: FilterPreset[] = [
  { name: 'epic', label: 'Epic', adjust: { contrast: 30, saturation: 20, highlights: -15, shadows: 15, vignette: 30, sharpen: 20 } },
  { name: 'festive', label: 'Festive', adjust: { saturation: 40, temperature: 25, tint: 10, brightness: 5, contrast: 10 } },
  { name: 'summer', label: 'Summer', adjust: { temperature: 35, saturation: 25, brightness: 10, highlights: 10 } },
  { name: 'retro', label: 'Retro', adjust: { fade: 35, saturation: -30, temperature: 30, contrast: -10, vignette: 25 } },
  { name: 'mono', label: 'Mono', adjust: { saturation: -100 } },
  { name: 'sepia', label: 'Sepia', adjust: { saturation: -100, temperature: 60, tint: 10, fade: 15, contrast: -10 } },
  { name: 'noir', label: 'Noir', adjust: { saturation: -100, contrast: 35, shadows: -20, vignette: 40 } },
  { name: 'vivid', label: 'Vivid', adjust: { saturation: 50, contrast: 15, sharpen: 15 } },
  { name: 'cool', label: 'Cool', adjust: { temperature: -40, tint: -5, saturation: -5 } },
  { name: 'warm', label: 'Warm', adjust: { temperature: 40, tint: 5, brightness: 3 } },
  { name: 'fade', label: 'Fade', adjust: { fade: 50, contrast: -20, saturation: -20 } },
  { name: 'dramatic', label: 'Dramatic', adjust: { contrast: 45, saturation: -15, highlights: -25, shadows: -10, vignette: 35 } },
];

export function filterPreset(name: string): FilterPreset | undefined {
  return IMAGE_FILTERS.find((f) => f.name === name);
}

/** The adjustments to draw with: the element's own plus its filter at its intensity, clamped. */
export function effectiveAdjust(look: ImageLook): ImageAdjust {
  const out: ImageAdjust = {};
  const preset = look.filter ? filterPreset(look.filter.name) : undefined;
  const k = look.filter ? look.filter.intensity / 100 : 0;
  for (const s of ADJUST_SLIDERS) {
    const v = (look.adjust?.[s.key] ?? 0) + (preset?.adjust[s.key] ?? 0) * k;
    if (v) out[s.key] = Math.max(s.min, Math.min(s.max, v));
  }
  return out;
}

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

/** True when there is any adjustment, filter or effect to draw (else the plain picture). */
export function hasLook(look: ImageLook): boolean {
  return !!look.effect || Object.keys(effectiveAdjust(look)).length > 0;
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
