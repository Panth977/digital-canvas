/**
 * User plugins: a person's own animations, effects, fonts and mockups.
 *
 * The library is one JSON file (`plugins.json`, next to `brand.json`: in Drive
 * `Digital Canvas/plugins.json`), and the files a plugin needs (font faces,
 * mockup photos) are assets like any other (`assets/<hash>.<ext>`). A plugin
 * travels alone as a `.dcplugin` file (a zip: `plugin.json` + `assets/…`,
 * see storage/plugins.ts) so it can be shared.
 *
 * Designs never depend on the library: using a plugin copies what it needs
 * into the design (an animation's keyframes, a shader's code, a font's faces),
 * so a design opens the same anywhere, plugins installed or not.
 */
import type { Animation, ImageLook, MotionRecipe, ShaderFx, TextEffect } from './types.ts';
import { keyframesFromCss } from './keyframes.ts';

export const PLUGIN_FORMAT = 'digital-canvas-plugin';
export const PLUGINS_FORMAT = 'digital-canvas-plugins';

export type PluginKind = 'animation' | 'effect' | 'font' | 'mockup';
export const PLUGIN_KINDS: readonly PluginKind[] = ['animation', 'effect', 'font', 'mockup'];

export interface PluginBase {
  format: typeof PLUGIN_FORMAT;
  version: 1;
  /** `pl_…`, stable across edits and installs. */
  id: string;
  kind: PluginKind;
  name: string;
  description?: string;
  author?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

/** A keyframe animation: CSS @keyframes or keyframes drawn in the editor. */
export interface AnimationPlugin extends PluginBase {
  kind: 'animation';
  recipe: MotionRecipe;
  /** The CSS it was made from, if any (kept so it can be edited as CSS). */
  css?: string;
}

/** A float uniform of a shader, with its slider. */
export interface ShaderParam {
  name: string;
  label?: string;
  min: number;
  max: number;
  default: number;
}

/**
 * An effect: a preset of looks the app already has (filters, adjustments,
 * shadows, duotone, text effect…) and/or an SkSL shader.
 *
 * The shader is `half4 main(float2 p)` with `uniform shader image;` (the
 * element as drawn), `uniform float2 resolution;`, `uniform float time;` and
 * one `uniform float <name>;` per param. Example (a tint):
 *
 *   uniform shader image; uniform float2 resolution; uniform float time; uniform float amount;
 *   half4 main(float2 p) { half4 c = image.eval(p); return half4(mix(c.rgb, c.rgb * half3(1, .8, .6), amount), c.a); }
 */
export interface EffectPlugin extends PluginBase {
  kind: 'effect';
  /** What it can be used on. */
  target: 'image' | 'text' | 'any';
  preset?: { look?: Partial<ImageLook>; textEffect?: TextEffect };
  shader?: { sksl: string; params: ShaderParam[]; animated?: boolean };
}

export interface FontFace {
  /** Asset id of the font file (ttf / otf / woff2 / woff). */
  asset: string;
  mime: string;
  weight: number;
  italic: boolean;
}

export interface FontPlugin extends PluginBase {
  kind: 'font';
  family: string;
  faces: FontFace[];
  /** Who may use it: the user's own font, or its licence. */
  license?: string;
}

/**
 * A mockup made from a photo: the print area is the quadrilateral `corners`
 * (photo pixels, clockwise from top-left). The compositor warps the design
 * into it and multiplies the photo's shading onto it (render/mockup.ts
 * `quadMockupBuffers`).
 */
export interface MockupPlugin extends PluginBase {
  kind: 'mockup';
  category: string;
  /** Asset id of the photo. */
  photo: string;
  width: number;
  height: number;
  corners: [[number, number], [number, number], [number, number], [number, number]];
  /** 0..1: how much of the photo's light and shade shows on the design (default 0.8). */
  shade?: number;
  /** Optional mask (asset id, white = print area) for curved or partly hidden areas. */
  mask?: string;
}

export type Plugin = AnimationPlugin | EffectPlugin | FontPlugin | MockupPlugin;

/** The library file. */
export interface PluginLibrary {
  format: typeof PLUGINS_FORMAT;
  version: 1;
  plugins: Plugin[];
  updatedAt: string;
}

export const emptyLibrary = (): PluginLibrary => ({ format: PLUGINS_FORMAT, version: 1, plugins: [], updatedAt: new Date().toISOString() });

export class PluginFormatError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : undefined);

export function newPluginId(): string {
  const a = new Uint8Array(8);
  globalThis.crypto.getRandomValues(a);
  return `pl_${[...a].map((b) => (b % 36).toString(36)).join('')}`;
}

/** Asset ids a plugin needs (fonts' faces, a mockup's photo and mask). */
export function pluginAssets(p: Plugin): string[] {
  if (p.kind === 'font') return p.faces.map((f) => f.asset);
  if (p.kind === 'mockup') return [p.photo, ...(p.mask ? [p.mask] : [])];
  return [];
}

/** Check one plugin (from a file, an agent or the library). Throws PluginFormatError with the first problem. */
export function parsePlugin(input: unknown): Plugin {
  if (!isObj(input)) throw new PluginFormatError('plugin is not an object');
  const kind = input.kind as PluginKind;
  if (!PLUGIN_KINDS.includes(kind)) throw new PluginFormatError(`kind must be one of ${PLUGIN_KINDS.join(', ')}`);
  const name = str(input.name, 80)?.trim();
  if (!name) throw new PluginFormatError('plugin needs a name');
  const now = new Date().toISOString();
  const base = {
    format: PLUGIN_FORMAT as typeof PLUGIN_FORMAT, version: 1 as const,
    id: typeof input.id === 'string' && /^pl_[a-z0-9_-]{4,40}$/i.test(input.id) ? input.id : newPluginId(),
    kind, name,
    ...(str(input.description, 500) ? { description: str(input.description, 500) } : {}),
    ...(str(input.author, 120) ? { author: str(input.author, 120) } : {}),
    ...(Array.isArray(input.tags) ? { tags: input.tags.filter((t): t is string => typeof t === 'string').slice(0, 20).map((t) => t.slice(0, 40)) } : {}),
    createdAt: str(input.createdAt, 40) ?? now, updatedAt: str(input.updatedAt, 40) ?? now,
  };
  switch (kind) {
    case 'animation': {
      let recipe = input.recipe as MotionRecipe | undefined;
      const css = str(input.css, 50_000);
      if (!recipe && css) {
        const all = Object.values(keyframesFromCss(css));
        if (!all.length) throw new PluginFormatError('css has no @keyframes');
        recipe = all[0];
      }
      if (!isObj(recipe) || !Array.isArray(recipe.f) || recipe.f.length < 2) throw new PluginFormatError('animation needs `recipe` (keyframes) or `css` with @keyframes');
      for (const f of recipe.f) if (!isObj(f) || typeof f.a !== 'number') throw new PluginFormatError('every keyframe needs `a` (0..1)');
      const extra = isObj(input) ? { loop: input.loop === true || recipe.loop === true, exit: input.exit === true || recipe.exit === true } : {};
      const len = typeof input.duration === 'number' && input.duration > 0 ? Math.min(input.duration, 10) : recipe.len;
      return { ...base, kind, recipe: { ...recipe, name, ...(len ? { len } : {}), ...(extra.loop ? { loop: true } : {}), ...(extra.exit ? { exit: true } : {}) }, ...(css ? { css } : {}) };
    }
    case 'effect': {
      const target = input.target === 'image' || input.target === 'text' ? input.target : 'any';
      const preset = isObj(input.preset) ? input.preset as EffectPlugin['preset'] : undefined;
      let shader: EffectPlugin['shader'];
      if (isObj(input.shader)) {
        const sksl = str(input.shader.sksl, 20_000);
        if (!sksl || !/\bmain\s*\(/.test(sksl)) throw new PluginFormatError('shader.sksl needs a `half4 main(float2 p)` function');
        const params = Array.isArray(input.shader.params) ? (input.shader.params as unknown[]).filter(isObj).slice(0, 16).map((q) => {
          const pname = String(q.name ?? '').replace(/[^a-zA-Z0-9_]/g, '');
          if (!pname) throw new PluginFormatError('every shader param needs a name');
          const min = Number(q.min ?? 0), max = Number(q.max ?? 1);
          return { name: pname, ...(str(q.label, 40) ? { label: str(q.label, 40) } : {}), min, max, default: Math.min(max, Math.max(min, Number(q.default ?? min))) };
        }) : [];
        shader = { sksl, params, ...(input.shader.animated === true ? { animated: true } : {}) };
      }
      if (!preset && !shader) throw new PluginFormatError('effect needs `preset` and/or `shader`');
      return { ...base, kind, target, ...(preset ? { preset } : {}), ...(shader ? { shader } : {}) };
    }
    case 'font': {
      const family = str(input.family, 80)?.trim() || name;
      const faces = Array.isArray(input.faces) ? (input.faces as unknown[]).filter(isObj).map((f) => ({ asset: String(f.asset ?? ''), mime: String(f.mime ?? 'font/ttf'), weight: Number(f.weight ?? 400) || 400, italic: f.italic === true })) : [];
      if (!faces.length || faces.some((f) => !f.asset)) throw new PluginFormatError('font needs `faces` with an asset each');
      return { ...base, kind, family, faces, ...(str(input.license, 200) ? { license: str(input.license, 200) } : {}) };
    }
    case 'mockup': {
      const c = input.corners;
      if (!Array.isArray(c) || c.length !== 4 || c.some((p) => !Array.isArray(p) || p.length !== 2 || p.some((n) => typeof n !== 'number'))) throw new PluginFormatError('mockup needs `corners`: four [x, y] photo points, clockwise from top-left');
      const photo = str(input.photo, 120);
      const width = Number(input.width), height = Number(input.height);
      if (!photo || !(width > 0) || !(height > 0)) throw new PluginFormatError('mockup needs `photo` (asset id), `width` and `height`');
      const shade = typeof input.shade === 'number' ? Math.max(0, Math.min(1, input.shade)) : undefined;
      return { ...base, kind, category: str(input.category, 40) ?? 'My mockups', photo, width, height, corners: c as MockupPlugin['corners'], ...(shade !== undefined ? { shade } : {}), ...(str(input.mask, 120) ? { mask: str(input.mask, 120) } : {}) };
    }
  }
}

export function parseLibrary(input: unknown): PluginLibrary {
  if (!isObj(input) || input.format !== PLUGINS_FORMAT) throw new PluginFormatError('not a plugin library');
  const plugins: Plugin[] = [];
  for (const p of Array.isArray(input.plugins) ? input.plugins : []) { try { plugins.push(parsePlugin(p)); } catch { /* skip a broken entry */ } }
  return { format: PLUGINS_FORMAT, version: 1, plugins, updatedAt: str(input.updatedAt, 40) ?? new Date().toISOString() };
}

/** Add or replace a plugin (by id). */
export function upsertPlugin(lib: PluginLibrary, p: Plugin): PluginLibrary {
  const i = lib.plugins.findIndex((x) => x.id === p.id);
  const next = { ...p, updatedAt: new Date().toISOString() } as Plugin;
  const plugins = i < 0 ? [...lib.plugins, next] : lib.plugins.map((x, j) => (j === i ? { ...next, createdAt: x.createdAt } as Plugin : x));
  return { ...lib, plugins, updatedAt: next.updatedAt };
}

export function removePlugin(lib: PluginLibrary, id: string): PluginLibrary {
  return { ...lib, plugins: lib.plugins.filter((p) => p.id !== id), updatedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------- using a plugin

/** The animation an animation plugin puts on an element (keyframes copied in). */
export function animationFrom(p: AnimationPlugin, more: Partial<Animation> = {}): Animation {
  return { type: 'keyframes', keyframes: p.recipe, plugin: p.id, ...(p.recipe.len ? { duration: p.recipe.len } : {}), ...more };
}

/** The shader an effect plugin puts on an element (code copied in, params at their defaults unless given). */
export function shaderFrom(p: EffectPlugin, params: Record<string, number> = {}): ShaderFx | undefined {
  if (!p.shader) return undefined;
  const values: Record<string, number> = {};
  for (const q of p.shader.params) values[q.name] = Math.min(q.max, Math.max(q.min, params[q.name] ?? q.default));
  return { plugin: p.id, name: p.name, sksl: p.shader.sksl, params: values };
}

/** Uniform names a shader declares (for checks and the params UI). */
export function shaderUniforms(sksl: string): { name: string; type: string }[] {
  return [...sksl.matchAll(/uniform\s+(float[234]?|half[234]?|int|shader)\s+([a-zA-Z_]\w*)\s*;/g)].map((m) => ({ type: m[1]!, name: m[2]! }));
}
