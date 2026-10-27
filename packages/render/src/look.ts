import type { Color, ImageAdjust } from '@digital-canvas/scene';

/**
 * Colour math for image adjustments: a 4×5 row-major colour matrix (Skia's
 * layout, offsets in 0..1) built from the linear adjustments, plus the SkSL
 * for the ones a matrix can't do (highlights/shadows, sharpen, pixelate).
 */

export type ColorMatrix = number[]; // 20 numbers

export const IDENTITY: ColorMatrix = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

/** Apply `inner` first, then `outer`. */
export function concat(outer: ColorMatrix, inner: ColorMatrix): ColorMatrix {
  const out: number[] = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      let v = c === 4 ? outer[r * 5 + 4]! : 0;
      for (let k = 0; k < 4; k++) v += outer[r * 5 + k]! * inner[k * 5 + c]!;
      out.push(v);
    }
  }
  return out;
}

/** Per-channel scale and offset. */
function scaleOffset(sr: number, sg: number, sb: number, or = 0, og = 0, ob = 0): ColorMatrix {
  return [sr, 0, 0, 0, or, 0, sg, 0, 0, og, 0, 0, sb, 0, ob, 0, 0, 0, 1, 0];
}

const LR = 0.2126, LG = 0.7152, LB = 0.0722;

function saturation(s: number): ColorMatrix {
  const a = 1 - s;
  return [
    LR * a + s, LG * a, LB * a, 0, 0,
    LR * a, LG * a + s, LB * a, 0, 0,
    LR * a, LG * a, LB * a + s, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

/** `#rrggbb` → 0..1 channels. */
function rgb(hex: Color): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255 || 0) as [number, number, number];
}

/** Luminance mapped onto a dark→light colour ramp. */
export function duotoneMatrix(dark: Color, light: Color): ColorMatrix {
  const d = rgb(dark), l = rgb(light);
  const row = (i: 0 | 1 | 2) => { const k = l[i] - d[i]; return [LR * k, LG * k, LB * k, 0, d[i]]; };
  return [...row(0), ...row(1), ...row(2), 0, 0, 0, 1, 0];
}

/**
 * The matrix for the linear adjustments (brightness, contrast, saturation,
 * temperature, tint, fade), optionally followed by a duotone. Null = no change.
 */
export function colorMatrix(a: ImageAdjust, duotone?: { dark: Color; light: Color }): ColorMatrix | null {
  let m = IDENTITY;
  const k = (v: number | undefined) => (v ?? 0) / 100;
  const b = k(a.brightness), c = k(a.contrast), s = k(a.saturation), t = k(a.temperature), n = k(a.tint), f = k(a.fade);
  if (b) m = concat(scaleOffset(1 + 0.25 * b, 1 + 0.25 * b, 1 + 0.25 * b, 0.12 * b, 0.12 * b, 0.12 * b), m);
  if (c) {
    const g = c >= 0 ? 1 + c : 1 + 0.8 * c;
    const o = 0.5 * (1 - g);
    m = concat(scaleOffset(g, g, g, o, o, o), m);
  }
  // saturation before the colour shifts, so a warm black-and-white (sepia) stays warm
  if (s) m = concat(saturation(1 + s), m);
  if (t) m = concat(scaleOffset(1 + 0.2 * t, 1, 1 - 0.2 * t, 0.03 * t, 0, -0.03 * t), m);
  if (n) m = concat(scaleOffset(1 + 0.05 * n, 1 - 0.15 * n, 1 + 0.05 * n), m);
  if (f) m = concat(scaleOffset(1 - 0.35 * f, 1 - 0.35 * f, 1 - 0.35 * f, 0.2 * f, 0.2 * f, 0.2 * f), m);
  if (duotone) m = concat(duotoneMatrix(duotone.dark, duotone.light), m);
  return m === IDENTITY ? null : m;
}

/** Apply a colour matrix to one unpremultiplied 0..1 colour (for tests and previews). */
export function applyMatrix(m: ColorMatrix, [r, g, b, a]: [number, number, number, number]): [number, number, number, number] {
  const row = (i: number) => Math.max(0, Math.min(1, m[i * 5]! * r + m[i * 5 + 1]! * g + m[i * 5 + 2]! * b + m[i * 5 + 3]! * a + m[i * 5 + 4]!));
  return [row(0), row(1), row(2), row(3)];
}

/**
 * Samples the image (child `img`, premultiplied) with pixelate, sharpen and a
 * highlights/shadows tone curve. Coordinates are the element's page coordinates.
 */
export const LOOK_SKSL = `
uniform shader img;
uniform float2 px;
uniform float sharpen;
uniform float hi;
uniform float sh;
uniform float cell;
uniform float2 origin;

half4 main(float2 p) {
  if (cell > 0) p = origin + (floor((p - origin) / cell) + 0.5) * cell;
  half4 c = img.eval(p);
  if (sharpen > 0) {
    half4 n = img.eval(p + float2(px.x, 0)) + img.eval(p - float2(px.x, 0)) + img.eval(p + float2(0, px.y)) + img.eval(p - float2(0, px.y));
    c.rgb = clamp(c.rgb + half(sharpen) * (4 * c.rgb - n.rgb), 0, c.a);
  }
  if ((hi != 0 || sh != 0) && c.a > 0) {
    half3 u = c.rgb / c.a;
    half L = dot(u, half3(0.2126, 0.7152, 0.0722));
    u += half(sh) * 0.35 * (1 - smoothstep(0.0, 0.6, L)) + half(hi) * 0.35 * smoothstep(0.4, 1.0, L);
    c.rgb = clamp(u, 0, 1) * c.a;
  }
  return c;
}
`;
