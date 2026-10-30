import type { Color, ImageAdjust, ImageDuotone, ImageStylizeType } from '@digital-canvas/scene';

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

const NEGATIVE: ColorMatrix = [-1, 0, 0, 0, 1, 0, -1, 0, 0, 1, 0, 0, -1, 0, 1, 0, 0, 0, 1, 0];

/** `from` at 0, `to` at 1 (a matrix's effect at an intensity). */
function mixMatrix(from: ColorMatrix, to: ColorMatrix, t: number): ColorMatrix {
  return from.map((v, i) => v + (to[i]! - v) * t);
}

/**
 * The matrix for the linear adjustments (brightness, contrast, saturation,
 * temperature, tint, fade), optionally followed by negative colours and a
 * duotone. Null = no change.
 */
export function colorMatrix(a: ImageAdjust, duotone?: Pick<ImageDuotone, 'dark' | 'light' | 'intensity'>, invert = false): ColorMatrix | null {
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
  if (invert) m = concat(NEGATIVE, m);
  if (duotone) m = mixMatrix(m, concat(duotoneMatrix(duotone.dark, duotone.light), m), (duotone.intensity ?? 100) / 100);
  return m === IDENTITY ? null : m;
}

/** Apply a colour matrix to one unpremultiplied 0..1 colour (for tests and previews). */
export function applyMatrix(m: ColorMatrix, [r, g, b, a]: [number, number, number, number]): [number, number, number, number] {
  const row = (i: number) => Math.max(0, Math.min(1, m[i * 5]! * r + m[i * 5 + 1]! * g + m[i * 5 + 2]! * b + m[i * 5 + 3]! * a + m[i * 5 + 4]!));
  return [row(0), row(1), row(2), row(3)];
}

/** Stylize kinds, as the shader numbers them (pixelate is done by `cell`). */
export const STYLE_ID: Record<ImageStylizeType, number> = { pixelate: 0, halftone: 1, posterize: 2, glitch: 3, screen: 4, sketch: 5 };

export interface LookUniforms {
  /** One source pixel, in element units. */
  px: [number, number];
  sharpen: number; hi: number; sh: number;
  /** Pixelate cell size (0 = off). */
  cell: number;
  origin: [number, number];
  whites: number; blacks: number; vibrance: number; texture: number; clarity: number; grain: number; retouch: number;
  /** The picture's short side, in element units: effects scale with it. */
  size: number;
  style: number; amount: number;
  /** 8 × (hue, saturation, lightness), -1..1; null = no colour edit. */
  bands: number[] | null;
}

/** The uniforms in the shader's declaration order. */
export function lookFloats(u: LookUniforms): number[] {
  return [
    u.px[0], u.px[1], u.sharpen, u.hi, u.sh, u.cell, u.origin[0], u.origin[1],
    u.whites, u.blacks, u.vibrance, u.texture, u.clarity, u.grain, u.retouch, u.size, u.style, u.amount, u.bands ? 1 : 0,
    ...(u.bands ?? new Array<number>(24).fill(0)),
  ];
}

/** True when the uniforms need the shader at all. */
export function needsLookShader(u: LookUniforms): boolean {
  return !!(u.sharpen || u.hi || u.sh || u.cell || u.whites || u.blacks || u.vibrance || u.texture || u.clarity || u.grain || u.retouch || u.style || u.bands);
}

/**
 * Samples the image (child `img`, premultiplied): stylize sampling, detail
 * (sharpen, texture, clarity, skin smoothing), tone curves, vibrance, colour
 * bands, then the stylize looks and grain. Coordinates are page coordinates, so
 * a look is the same in the editor at any zoom and in every export.
 */
export const LOOK_SKSL = `
uniform shader img;
uniform float2 px;
uniform float sharpen;
uniform float hi;
uniform float sh;
uniform float cell;
uniform float2 origin;
uniform float whites;
uniform float blacks;
uniform float vibrance;
uniform float texture;
uniform float clarity;
uniform float grain;
uniform float retouch;
uniform float size;
uniform float style;
uniform float amount;
uniform float hasBands;
uniform float3 band[8];

const half3 LUMA = half3(0.2126, 0.7152, 0.0722);

float rand(float2 v) { return fract(sin(dot(v, float2(12.9898, 78.233))) * 43758.5453); }

half4 ring(float2 p, float r) {
  float d = r * 0.7071;
  half4 s = img.eval(p + float2(r, 0)) + img.eval(p - float2(r, 0)) + img.eval(p + float2(0, r)) + img.eval(p - float2(0, r));
  s += img.eval(p + float2(d, d)) + img.eval(p - float2(d, d)) + img.eval(p + float2(d, -d)) + img.eval(p - float2(d, -d));
  return s * 0.125;
}

half3 toHsl(half3 c) {
  half mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  half l = (mx + mn) * 0.5, d = mx - mn;
  if (d < 0.0001) return half3(0, 0, l);
  half s = d / (1 - abs(2 * l - 1) + 0.0001);
  half h = mx == c.r ? mod((c.g - c.b) / d, 6.0) : mx == c.g ? (c.b - c.r) / d + 2 : (c.r - c.g) / d + 4;
  return half3(h / 6, s, l);
}

half3 fromHsl(half3 c) {
  half3 k = mod(half3(0, 8, 4) + c.x * 12, 12.0);
  half a = c.y * min(c.z, 1 - c.z);
  return c.z - a * clamp(min(k - 3, 9 - k), -1.0, 1.0);
}

float hueAt(int i) {
  return i == 0 ? 0 : i == 1 ? 30 : i == 2 ? 60 : i == 3 ? 120 : i == 4 ? 180 : i == 5 ? 240 : i == 6 ? 280 : 320;
}

half3 editBands(half3 u) {
  half3 c = toHsl(u);
  float H = c.x * 360;
  float3 e = float3(0);
  for (int i = 0; i < 8; i++) {
    float a = hueAt(i), b = i == 7 ? 360.0 : hueAt(i + 1);
    if (H >= a && H < b) e = mix(band[i], i == 7 ? band[0] : band[i + 1], (H - a) / (b - a));
  }
  half keep = smoothstep(0.03, 0.2, c.y); // leave greys alone
  c.x = fract(c.x + half(e.x) * 0.083 * keep);
  c.y = clamp(c.y * (1 + half(e.y) * keep), 0, 1);
  c.z = clamp(c.z + half(e.z) * 0.3 * keep * c.y, 0, 1);
  return fromHsl(c);
}

half skin(half3 u) {
  half cb = -0.169 * u.r - 0.331 * u.g + 0.5 * u.b + 0.5, cr = 0.5 * u.r - 0.419 * u.g - 0.081 * u.b + 0.5;
  return smoothstep(0.26, 0.32, cb) * (1 - smoothstep(0.5, 0.55, cb)) * smoothstep(0.51, 0.55, cr) * (1 - smoothstep(0.68, 0.74, cr));
}

half4 main(float2 p) {
  if (cell > 0) p = origin + (floor((p - origin) / cell) + 0.5) * cell;
  if (style == 3) {
    float row = floor((p.y - origin.y) / (size * 0.03));
    if (rand(float2(row, 7)) > 0.8) p.x += (rand(float2(row, 3)) - 0.5) * amount * size * 0.12;
  }
  float2 dot_ = float2(0);
  if (style == 1) {
    float s = size * (0.008 + amount * 0.03);
    float2 q = float2(p.x + p.y, p.x - p.y) * 0.7071 / s;
    float2 centre = (floor(q) + 0.5) * s;
    dot_ = q - floor(q) - 0.5;
    p = float2(centre.x + centre.y, centre.x - centre.y) * 0.7071;
  }
  half4 c = img.eval(p);
  if (style == 3) {
    float d = amount * size * 0.018;
    c.r = img.eval(p + float2(d, 0)).r;
    c.b = img.eval(p - float2(d, 0)).b;
  }
  if (sharpen > 0) {
    half4 n = img.eval(p + float2(px.x, 0)) + img.eval(p - float2(px.x, 0)) + img.eval(p + float2(0, px.y)) + img.eval(p - float2(0, px.y));
    c.rgb = clamp(c.rgb + half(sharpen) * (4 * c.rgb - n.rgb), 0, c.a);
  }
  if (texture != 0) {
    half4 a = ring(p, max(px.x, px.y) * 1.6);
    c.rgb = clamp(texture > 0 ? c.rgb + half(texture) * 1.4 * (c.rgb - a.rgb) : mix(c.rgb, a.rgb, half(-texture)), 0, c.a);
  }
  if (clarity != 0) {
    half4 a = (ring(p, size * 0.012) + ring(p, size * 0.024)) * 0.5;
    half L = dot(c.rgb, LUMA);
    half mid = 4 * L * (1 - L);
    c.rgb = clamp(clarity > 0 ? c.rgb + half(clarity) * 1.5 * mid * (c.rgb - a.rgb) : mix(c.rgb, a.rgb, half(-clarity) * 0.8 * mid), 0, c.a);
  }
  if (retouch > 0 && c.a > 0) {
    half3 u = c.rgb / c.a;
    half3 sum = c.rgb;
    half total = 1;
    for (int i = 1; i <= 3; i++) {
      float r = size * 0.005 * float(i);
      half4 a = ring(p, r);
      half w = 1 - smoothstep(0.04, 0.16, length(a.rgb - c.rgb)); // keeps edges, eyes and lips
      sum += a.rgb * w;
      total += w;
    }
    c.rgb = mix(c.rgb, sum / total, half(retouch) * skin(u));
  }
  if (c.a > 0 && (hi != 0 || sh != 0 || whites != 0 || blacks != 0 || vibrance != 0 || hasBands > 0 || style >= 1)) {
    half3 u = c.rgb / c.a;
    half L = dot(u, LUMA);
    u += half(sh) * 0.35 * (1 - smoothstep(0.0, 0.6, L)) + half(hi) * 0.35 * smoothstep(0.4, 1.0, L);
    u += half(whites) * 0.25 * smoothstep(0.7, 1.0, L) + half(blacks) * 0.25 * (1 - smoothstep(0.0, 0.3, L));
    if (vibrance != 0) {
      half mx = max(u.r, max(u.g, u.b)), mn = min(u.r, min(u.g, u.b));
      half amt = half(vibrance) * (vibrance > 0 ? 1 - (mx - mn) : 1);
      u = mix(half3(dot(u, LUMA)), u, 1 + amt);
    }
    if (hasBands > 0) u = editBands(clamp(u, 0, 1));
    if (style == 1) {
      half ink = 1 - dot(u, LUMA);
      half r = sqrt(ink) * 0.72;
      half d = length(half2(dot_));
      u = mix(u, half3(1), smoothstep(r - 0.06, r + 0.06, d));
    } else if (style == 2) {
      half n = mix(8.0, 2.0, half(amount));
      u = floor(u * n + 0.5) / n;
    } else if (style == 4) {
      float line = sin((p.y - origin.y) / (size * 0.004 * (1 + amount)) * 3.14159);
      u *= 1 - half(amount) * 0.5 * (0.5 - half(line) * 0.5);
      float sub = mod(floor((p.x - origin.x) / (size * 0.003 * (1 + amount))), 3.0);
      half3 tintRgb = sub == 0 ? half3(1, 0.7, 0.7) : sub == 1 ? half3(0.7, 1, 0.7) : half3(0.7, 0.7, 1);
      u *= mix(half3(1), tintRgb, half(amount));
    } else if (style == 5) {
      float r = size * 0.002 + size * 0.004 * amount;
      half a = dot(img.eval(p + float2(r, 0)).rgb - img.eval(p - float2(r, 0)).rgb, LUMA);
      half b = dot(img.eval(p + float2(0, r)).rgb - img.eval(p - float2(0, r)).rgb, LUMA);
      half edge = clamp(length(half2(a, b)) * 6, 0, 1);
      u = mix(u, half3(1 - edge), half(amount) * 0.5 + 0.5);
    }
    c.rgb = clamp(u, 0, 1) * c.a;
  }
  if (grain > 0 && c.a > 0) {
    half n = half(rand(floor((p - origin) / max(size * 0.0015, 0.5)))) - 0.5;
    c.rgb = clamp(c.rgb + n * half(grain) * 0.3 * c.a, 0, c.a);
  }
  return c;
}
`;
