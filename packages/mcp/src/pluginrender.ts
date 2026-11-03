/** The renderer pieces plugins need (shader compiling, font files, photo mockup maps). */
import { compileShader, fontInfo, quadAspect, quadMockupBuffers, toSfnt, type MockupBuffers, type Rgba } from '@digital-canvas/render';
import type { MockupPlugin } from '@digital-canvas/scene';
import { engine } from './engine.ts';

export async function compileShaderCheck(sksl: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { ck } = await engine();
  const r = compileShader(ck, sksl);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function toSfntBytes(bytes: Uint8Array): Promise<Uint8Array> {
  return toSfnt(bytes);
}

export async function fontFileInfo(bytes: Uint8Array): Promise<{ family?: string; weight?: number; italic?: boolean }> {
  return fontInfo(bytes);
}

export async function quadMockup(photo: Rgba, p: MockupPlugin, mask: Rgba | null): Promise<{ buffers: MockupBuffers; aspect: number }> {
  return { buffers: quadMockupBuffers(photo, p, mask), aspect: quadAspect(p.corners) };
}
