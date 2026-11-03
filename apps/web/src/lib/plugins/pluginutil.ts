/**
 * Pure helpers for the plugin creators (tested in apps/web/test/plugins.test.ts):
 * the keyframe table ⇄ motion recipe, a recipe → CSS, an effect preset from an
 * element's look, shader params from SkSL, labels.
 */
import {
  keyframesFromCss, shaderUniforms,
  type Element, type ImageLook, type MotionFrame, type MotionRecipe, type Plugin, type PluginKind, type ShaderParam, type TextEffect,
} from '@digital-canvas/scene';

// ---------------------------------------------------------------- keyframe table

export const EASINGS: { id: string; label: string; e: number[] }[] = [
  { id: 'ease', label: 'Ease', e: [0.25, 0.1, 0.25, 1] },
  { id: 'linear', label: 'Linear', e: [0, 0, 1, 1] },
  { id: 'ease-in', label: 'Ease in', e: [0.42, 0, 1, 1] },
  { id: 'ease-out', label: 'Ease out', e: [0, 0, 0.58, 1] },
  { id: 'ease-in-out', label: 'Ease in-out', e: [0.42, 0, 0.58, 1] },
  { id: 'back', label: 'Overshoot', e: [0.34, 1.56, 0.64, 1] },
];

/** One row of the keyframe table. Move is % of the element's box (CSS translate %); other frame fields ride along untouched. */
export interface KeyRow {
  at: number; // 0..100 %
  x: number; // % of the box width
  y: number;
  scale: number; // 1 = as designed
  rotate: number; // degrees
  opacity: number; // 0..1
  easing: string; // EASINGS id, or 'custom' (keeps `rest.e`)
  /** Fields the table doesn't show (px moves, skew, blur, custom easing). */
  rest?: Partial<MotionFrame>;
}

const R4 = (n: number) => Math.round(n * 10000) / 10000;

function easingId(e: number[] | undefined): string {
  if (!e) return 'ease';
  const hit = EASINGS.find((x) => x.e.every((v, i) => Math.abs(v - (e[i] ?? NaN)) < 1e-6));
  return hit?.id ?? 'custom';
}

export function rowsFromRecipe(r: MotionRecipe): KeyRow[] {
  return r.f.map((f) => {
    const { a, tx, ty, sx, sy, r: rot, o, e, ...rest } = f;
    const row: KeyRow = { at: R4(a * 100), x: R4((tx ?? 0) * 100), y: R4((ty ?? 0) * 100), scale: R4(sx ?? sy ?? 1), rotate: rot ?? 0, opacity: o ?? 1, easing: easingId(e) };
    const keep: Partial<MotionFrame> = { ...rest };
    if (sx !== undefined && sy !== undefined && Math.abs(sx - sy) > 1e-6) { keep.sx = sx; keep.sy = sy; }
    if (row.easing === 'custom' && e) keep.e = e;
    if (Object.keys(keep).length) row.rest = keep;
    return row;
  });
}

/** Rows → a recipe (sorted by time, 0 % and 100 % always there). */
export function recipeFromRows(rows: KeyRow[], base: Omit<MotionRecipe, 'f'> = {}): MotionRecipe {
  const sorted = [...rows].map((r) => ({ ...r, at: Math.max(0, Math.min(100, Number(r.at) || 0)) })).sort((a, b) => a.at - b.at);
  if (!sorted.length || sorted[0]!.at > 0) sorted.unshift({ at: 0, x: 0, y: 0, scale: 1, rotate: 0, opacity: 1, easing: 'ease' });
  if (sorted[sorted.length - 1]!.at < 100) sorted.push({ at: 100, x: 0, y: 0, scale: 1, rotate: 0, opacity: 1, easing: 'ease' });
  const f: MotionFrame[] = sorted.map((r) => {
    const frame: MotionFrame = { a: R4(r.at / 100) };
    if (r.x) frame.tx = R4(r.x / 100);
    if (r.y) frame.ty = R4(r.y / 100);
    if (r.scale !== 1) { frame.sx = r.scale; frame.sy = r.scale; }
    if (r.rotate) frame.r = r.rotate;
    if (r.opacity !== 1) frame.o = Math.max(0, Math.min(1, r.opacity));
    Object.assign(frame, r.rest ?? {});
    const ease = EASINGS.find((x) => x.id === r.easing);
    if (ease && r.easing !== 'ease') frame.e = ease.e;
    return frame;
  });
  return { ...base, f };
}

/** A recipe as CSS @keyframes (what the CSS tab shows for a table-made animation). */
export function recipeToCss(r: MotionRecipe, name = 'my-animation'): string {
  const id = name.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'my-animation';
  const lines = r.f.map((f) => {
    const t: string[] = [];
    if (f.tx || f.ty) t.push(`translate(${R4((f.tx ?? 0) * 100)}%, ${R4((f.ty ?? 0) * 100)}%)`);
    if (f.px || f.py) t.push(`translate(${f.px ?? 0}px, ${f.py ?? 0}px)`);
    if (f.sx !== undefined || f.sy !== undefined) t.push(f.sx === f.sy ? `scale(${f.sx})` : `scale(${f.sx ?? 1}, ${f.sy ?? 1})`);
    if (f.r) t.push(`rotate(${f.r}deg)`);
    if (f.kx || f.ky) t.push(`skew(${f.kx ?? 0}deg, ${f.ky ?? 0}deg)`);
    const props = [`transform: ${t.length ? t.join(' ') : 'none'};`, `opacity: ${f.o ?? 1};`];
    if (f.e) props.push(`animation-timing-function: cubic-bezier(${f.e.join(', ')});`);
    return `  ${R4(f.a * 100)}% { ${props.join(' ')} }`;
  });
  return `@keyframes ${id} {\n${lines.join('\n')}\n}\n`;
}

/** CSS → the first @keyframes as a recipe, or an error to show. */
export function recipeFromCss(css: string): { recipe: MotionRecipe; name: string } | { error: string } {
  let all: Record<string, MotionRecipe>;
  try { all = keyframesFromCss(css); } catch (e) { return { error: `Couldn't read the CSS: ${e instanceof Error ? e.message : e}` }; }
  const first = Object.entries(all)[0];
  if (!first) return { error: 'No @keyframes found. Paste a block like “@keyframes pop { from { … } to { … } }”.' };
  const [name, recipe] = first;
  if (recipe.f.length < 2) return { error: `@keyframes ${name} needs at least two steps.` };
  return { recipe, name };
}

/** A sample CSS to start from. */
export const SAMPLE_CSS = `@keyframes pop-in {
  0% { transform: scale(0.3) rotate(-12deg); opacity: 0; }
  60% { transform: scale(1.12) rotate(3deg); opacity: 1; }
  100% { transform: scale(1) rotate(0deg); }
}
`;

// ---------------------------------------------------------------- effects

/** Look fields an effect preset may carry (no asset-bound ones: matte, selective, blur brush, auto focus). */
export const PRESET_LOOK_KEYS = ['adjust', 'filter', 'colorEdit', 'invert', 'shadow', 'duotone', 'stylize', 'retouch', 'border', 'effect'] as const satisfies readonly (keyof ImageLook)[];

/** What "preset from selection" takes from an element: its look (pictures) or text effect (text). */
export function presetFromElement(e: Element): { look?: Partial<ImageLook>; textEffect?: TextEffect } | null {
  if (e.type === 'text') return e.effect ? { textEffect: structuredClone(e.effect) } : null;
  if (e.type !== 'image' && e.type !== 'video') return null;
  const look: Partial<ImageLook> = {};
  const src = e as unknown as Record<string, unknown>;
  for (const k of PRESET_LOOK_KEYS) if (src[k] !== undefined) (look as Record<string, unknown>)[k] = structuredClone(src[k]);
  return Object.keys(look).length ? { look } : null;
}

/** What applying a preset sets on an element (undefined clears look fields the preset doesn't have, so presets don't stack). */
export function presetPatch(preset: { look?: Partial<ImageLook>; textEffect?: TextEffect } | undefined, e: Element): Record<string, unknown> {
  if (!preset) return {};
  if (e.type === 'text') return preset.textEffect ? { effect: structuredClone(preset.textEffect) } : {};
  if ((e.type === 'image' || e.type === 'video') && preset.look) {
    const out: Record<string, unknown> = {};
    for (const k of PRESET_LOOK_KEYS) out[k] = preset.look[k] !== undefined ? structuredClone(preset.look[k]) : undefined;
    return out;
  }
  return {};
}

/** Float uniforms a shader declares beyond the built-ins (`resolution`, `time`): each needs a param. */
export function shaderFloatUniforms(sksl: string): string[] {
  return shaderUniforms(sksl).filter((u) => (u.type === 'float' || u.type === 'half') && u.name !== 'time').map((u) => u.name);
}

/** Params kept in step with the code: one per float uniform, existing ones keep their settings. */
export function syncParams(sksl: string, params: ShaderParam[]): ShaderParam[] {
  return shaderFloatUniforms(sksl).map((name) => params.find((p) => p.name === name) ?? { name, label: labelOf(name), min: 0, max: 1, default: 0.5 });
}

const labelOf = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export const SAMPLE_SKSL = `uniform shader image;
uniform float2 resolution;
uniform float time;
uniform float amount;

half4 main(float2 p) {
  half4 c = image.eval(p);
  half3 warm = c.rgb * half3(1.0, 0.82, 0.6);
  return half4(mix(c.rgb, warm, amount), c.a);
}
`;

// ---------------------------------------------------------------- labels

export const KIND_LABEL: Record<PluginKind, string> = { animation: 'Animation', effect: 'Effect', font: 'Font', mockup: 'Mockup' };
export const KIND_PLURAL: Record<PluginKind, string> = { animation: 'Animations', effect: 'Effects', font: 'Fonts', mockup: 'Mockups' };

/** One line about a plugin, for lists. */
export function pluginSummary(p: Plugin): string {
  switch (p.kind) {
    case 'animation': return `${p.recipe.f.length} keyframes · ${(p.recipe.len ?? 0.8).toFixed(1)} s${p.recipe.loop ? ' · loops' : p.recipe.exit ? ' · exit' : ''}`;
    case 'effect': return [p.preset ? 'Preset' : '', p.shader ? `Shader${p.shader.params.length ? ` · ${p.shader.params.length} sliders` : ''}` : ''].filter(Boolean).join(' + ');
    case 'font': return `${p.family} · ${p.faces.length} face${p.faces.length === 1 ? '' : 's'}`;
    case 'mockup': return p.category;
  }
}

/** A copy's name: "Name copy", "Name copy 2", … */
export function copyName(name: string, taken: string[]): string {
  const base = name.replace(/ copy( \d+)?$/, '');
  for (let i = 1; ; i++) {
    const n = i === 1 ? `${base} copy` : `${base} copy ${i}`;
    if (!taken.includes(n)) return n;
  }
}
