<script lang="ts">
  /**
   * "My effects" in the Effects and Edit image panels: the user's effect
   * plugins that fit the selection (click applies the preset and/or shader),
   * then the sliders of the shader on the selected element, and Remove.
   */
  import '../panels.css';
  import type { EffectPlugin } from '@digital-canvas/scene';
  import type { EditorState } from '../../../lib/editor.svelte.ts';
  import Icon from '../../../lib/Icon.svelte';
  import { library } from '../../../lib/library.svelte.ts';
  import { ui } from '../../../lib/ui.svelte.ts';
  import { plugins } from '../../../lib/plugins/plugins.svelte.ts';
  import { applyEffect, effectFits, removeShader, setShaderParam } from '../../../lib/plugins/apply.ts';

  let { ed }: { ed: EditorState } = $props();

  $effect(() => { void plugins.load(library.store); });

  const sel = $derived(ed.selected);
  const list = $derived(plugins.of('effect').filter((p) => sel.some((e) => effectFits(p, e))));
  const shader = $derived(sel[0]?.shader);
  const source = $derived(shader?.plugin ? plugins.get(shader.plugin) as EffectPlugin | undefined : undefined);
  /** Slider ranges come from the plugin when it is installed; otherwise 0..1 around the value. */
  const sliders = $derived(Object.entries(shader?.params ?? {}).map(([name, v]) => {
    const q = source?.shader?.params.find((x) => x.name === name);
    return { name, label: q?.label ?? name, min: q?.min ?? Math.min(0, v), max: q?.max ?? Math.max(1, v), v };
  }));
  const isOn = (p: EffectPlugin) => !!p.shader && shader?.plugin === p.id;
</script>

<div class="me" data-testid="my-effects">
  <div class="dp-head"><h3>My effects</h3><button class="dp-link" data-testid="my-effects-new" onclick={() => { plugins.editing = { kind: 'effect' }; ui.rail('plugins'); }}>Create</button></div>
  {#if list.length}
    <div class="me-grid">
      {#each list as p (p.id)}
        <button class="me-fx" class:on={isOn(p)} title={p.name} data-testid="my-effect-{p.id}" onclick={() => applyEffect(ed, p)}>
          <span class="me-ic"><Icon name={p.shader ? 'code' : 'sparkle'} size={18} /></span><span class="me-n">{p.name}</span>
        </button>
      {/each}
    </div>
  {:else}
    <p class="dp-hint">Effects you make in Plugins show here: a look preset, an SkSL shader, or both.</p>
  {/if}
  {#if shader}
    <div class="me-on" data-testid="shader-on">
      <div class="me-row"><b>{shader.name}</b><button class="btn ghost" data-testid="shader-remove" onclick={() => removeShader(ed)}>Remove</button></div>
      {#each sliders as s (s.name)}
        <label class="me-sl"><span>{s.label} · {s.v.toFixed(2)}</span>
          <input type="range" min={s.min} max={s.max} step={(s.max - s.min) / 100 || 0.01} value={s.v} data-testid="shader-param-{s.name}"
            oninput={(e) => setShaderParam(ed, s.name, Number((e.currentTarget as HTMLInputElement).value))} onchange={() => ed.seal()} />
        </label>
      {/each}
    </div>
  {/if}
</div>

<style>
  .me { display: flex; flex-direction: column; gap: 8px; }
  .me .dp-head { margin: 12px 0 0; }
  .me .dp-head h3 { font-size: 13px; }
  .me-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .me-fx { display: flex; flex-direction: column; align-items: center; gap: 4px; border: 0; background: none; padding: 0; font-size: 12px; color: var(--ink-2); min-width: 0; }
  .me-ic { width: 100%; aspect-ratio: 1.4; display: grid; place-items: center; border-radius: 8px; background: var(--chip); border: 2px solid transparent; color: var(--accent); }
  .me-fx:hover .me-ic { background: var(--hover); }
  .me-fx.on .me-ic { border-color: var(--accent); }
  .me-n { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .me-on { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 8px; background: var(--chip); }
  .me-row { display: flex; align-items: center; justify-content: space-between; font-size: 13px; }
  .me-sl { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; }
  .me-sl input { width: 100%; }
</style>
