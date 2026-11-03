import type { CanvasKit, RuntimeEffect } from 'canvaskit-wasm';

/**
 * Shader effects (`ElementBase.shader`, effect plugins). The element is drawn
 * to a layer, then the layer is drawn through the SkSL shader: `uniform shader
 * image` is the layer, `uniform float2 resolution` its px size, `uniform float
 * time` seconds, and every other float uniform a param by name (unknown = 0).
 */

/** A uniform the shader declares (besides the child shader). */
export interface ShaderUniform {
  name: string;
  /** Floats it takes (float = 1, float2 = 2, float3x3 = 9…). */
  floats: number;
  isInteger: boolean;
}

export type ShaderCompile =
  | { ok: true; uniforms: ShaderUniform[] }
  | { ok: false; error: string };

const childShaders = (sksl: string) => [...sksl.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').matchAll(/\buniform\s+shader\s+([a-zA-Z_]\w*)\s*;/g)].map((m) => m[1]!);

/** Compile an effect plugin's SkSL (no caching): its uniforms, or the compiler's error. */
export function compileShader(ck: CanvasKit, sksl: string): ShaderCompile {
  const r = make(ck, sksl);
  if (!r.ok) return r;
  const uniforms = uniformsOf(r.effect);
  r.effect.delete();
  return { ok: true, uniforms };
}

function make(ck: CanvasKit, sksl: string): { ok: true; effect: RuntimeEffect } | { ok: false; error: string } {
  if (!ck.RuntimeEffect) return { ok: false, error: 'this CanvasKit build has no runtime effects' };
  const kids = childShaders(sksl);
  if (kids.length !== 1) return { ok: false, error: `the shader needs exactly one \`uniform shader image;\` (it declares ${kids.length})` };
  let error = '';
  let effect: RuntimeEffect | null = null;
  try {
    effect = ck.RuntimeEffect.Make(sksl, (e) => { error = e; });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  if (!effect) return { ok: false, error: (error || 'the shader did not compile').trim() };
  return { ok: true, effect };
}

function uniformsOf(effect: RuntimeEffect): ShaderUniform[] {
  const out: ShaderUniform[] = [];
  for (let i = 0; i < effect.getUniformCount(); i++) {
    const u = effect.getUniform(i);
    out.push({ name: effect.getUniformName(i), floats: u.columns * u.rows, isInteger: u.isInteger });
  }
  return out;
}

/** Compiled effects by source; a source that failed is remembered as failed. */
export class ShaderCache {
  private map = new Map<string, { effect: RuntimeEffect; uniforms: { name: string; slot: number; floats: number; isInteger: boolean }[] } | null>();

  constructor(private readonly ck: CanvasKit, private readonly max = 64) {}

  get(sksl: string) {
    if (this.map.has(sksl)) {
      const hit = this.map.get(sksl)!;
      this.map.delete(sksl); // keep the most recent at the end
      this.map.set(sksl, hit);
      return hit;
    }
    const r = make(this.ck, sksl);
    let entry = null;
    if (r.ok) {
      const uniforms = [];
      for (let i = 0; i < r.effect.getUniformCount(); i++) {
        const u = r.effect.getUniform(i);
        uniforms.push({ name: r.effect.getUniformName(i), slot: u.slot, floats: u.columns * u.rows, isInteger: u.isInteger });
      }
      entry = { effect: r.effect, uniforms };
    }
    this.map.set(sksl, entry);
    while (this.map.size > this.max) {
      const [k, v] = this.map.entries().next().value!;
      v?.effect.delete();
      this.map.delete(k);
    }
    return entry;
  }

  /** The uniform array for one draw. */
  uniforms(entry: NonNullable<ReturnType<ShaderCache['get']>>, values: { resolution: [number, number]; time: number; params?: Record<string, number> }): Float32Array {
    const out = new Float32Array(entry.effect.getUniformFloatCount());
    const ints = new Int32Array(out.buffer);
    for (const u of entry.uniforms) {
      if (u.isInteger) {
        // int uniforms travel as int bits in the same array
        const v = u.name === 'time' ? values.time : values.params?.[u.name];
        if (typeof v === 'number' && Number.isFinite(v)) ints.fill(Math.round(v), u.slot, u.slot + u.floats);
      } else if (u.name === 'resolution') { out[u.slot] = values.resolution[0]; if (u.floats > 1) out[u.slot + 1] = values.resolution[1]; }
      else if (u.name === 'time') out[u.slot] = values.time;
      else {
        const v = values.params?.[u.name];
        if (typeof v === 'number' && Number.isFinite(v)) out.fill(v, u.slot, u.slot + u.floats);
      }
    }
    return out;
  }

  dispose(): void {
    for (const v of this.map.values()) v?.effect.delete();
    this.map.clear();
  }
}
