/** Using plugins on the design: every change goes through EditorState like any other edit. */
import { animationFrom, shaderFrom, type AnimationPlugin, type EffectPlugin, type Element, type ShaderFx } from '@digital-canvas/scene';
import type { EditorState } from '../editor.svelte.ts';
import { presetPatch } from './pluginutil.ts';

/** Put an animation plugin on the selection, or on the page when nothing is selected. */
export function applyAnimation(ed: EditorState, p: AnimationPlugin, onPage = !ed.selection.length): void {
  const a = animationFrom(p, p.recipe.exit ? { phase: 'out' } : {});
  if (onPage) ed.updatePage({ animation: a });
  else ed.update({ animation: a });
  ed.seal();
}

/** Does the effect fit this element? */
export const effectFits = (p: EffectPlugin, e: Element) => p.target === 'any' || (p.target === 'text' ? e.type === 'text' : e.type === 'image' || e.type === 'video');

/** Apply an effect plugin to the selected elements it fits: its preset fields and/or its shader. */
export function applyEffect(ed: EditorState, p: EffectPlugin, params: Record<string, number> = {}): number {
  const ids = ed.selected.filter((e) => effectFits(p, e)).map((e) => e.id);
  if (!ids.length) return 0;
  const shader = shaderFrom(p, params);
  ed.update((e) => ({ ...presetPatch(p.preset, e), ...(shader ? { shader } : {}) }) as never, null, ids);
  ed.seal();
  return ids.length;
}

/** Change one shader param on the selection (a slider: coalesced by key). */
export function setShaderParam(ed: EditorState, name: string, v: number): void {
  ed.update((e) => (e.shader ? { shader: { ...e.shader, params: { ...e.shader.params, [name]: v } } satisfies ShaderFx } : {}) as never, `shader:${name}:${ed.selection.join(',')}`);
}

export function removeShader(ed: EditorState): void {
  ed.update({ shader: undefined } as never);
  ed.seal();
}
