/**
 * The renderer pieces plugins need (shader compiling, font files, photo
 * mockup maps), behind one small seam.
 */
import * as R from '@digital-canvas/render';
import type { MockupBuffers, Rgba } from '@digital-canvas/render';
import type { MockupPlugin } from '@digital-canvas/scene';
import { engine } from './engine.ts';

type Any = Record<string, unknown>;
const r = R as unknown as Any;
const need = <T>(name: string): T => {
  const f = r[name];
  if (typeof f !== 'function') throw new Error(`this build has no ${name} yet`);
  return f as T;
};

export async function compileShaderCheck(sksl: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { ck } = await engine();
  return need<(ck: unknown, s: string) => { ok: true } | { ok: false; error: string }>('compileShader')(ck, sksl);
}

export async function toSfntBytes(bytes: Uint8Array): Promise<Uint8Array> {
  return need<(b: Uint8Array) => Uint8Array>('toSfnt')(bytes);
}

export async function fontFileInfo(bytes: Uint8Array): Promise<{ family?: string; weight?: number; italic?: boolean }> {
  return need<(b: Uint8Array) => { family?: string; weight?: number; italic?: boolean }>('fontInfo')(bytes);
}

export async function quadMockup(photo: Rgba, p: MockupPlugin, mask: Rgba | null): Promise<{ buffers: MockupBuffers; aspect: number }> {
  const out = need<(photo: Rgba, p: Any, mask: Rgba | null) => MockupBuffers | { buffers: MockupBuffers; aspect: number }>('quadMockupBuffers')(photo, p as unknown as Any, mask);
  if ('buffers' in out) return out;
  const c = p.corners;
  const d = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);
  return { buffers: out, aspect: (d(c[0], c[1]) + d(c[3], c[2])) / Math.max(1, d(c[0], c[3]) + d(c[1], c[2])) };
}
