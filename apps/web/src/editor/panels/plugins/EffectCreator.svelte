<script lang="ts">
  /**
   * Make or edit an effect plugin: a preset taken from the selection's look
   * (filters, adjustments, shadow, duotone, text effect…) and/or an SkSL
   * shader with sliders. The preview runs on the selected element or a sample
   * picture; compile errors show under the code.
   */
  import '../panels.css';
  import { onDestroy } from 'svelte';
  import { parsePlugin, type EffectPlugin, type ShaderParam } from '@digital-canvas/scene';
  import type { EditorState } from '../../../lib/editor.svelte.ts';
  import Icon from '../../../lib/Icon.svelte';
  import { toast } from '../../../lib/toast.svelte.ts';
  import { plugins } from '../../../lib/plugins/plugins.svelte.ts';
  import { SAMPLE_SKSL, presetFromElement, presetPatch, syncParams } from '../../../lib/plugins/pluginutil.ts';
  import { applyEffect } from '../../../lib/plugins/apply.ts';
  import { compileShader } from '../../../lib/plugins/render-bridge.ts';
  import { paintShaded } from '../../../lib/plugins/shaderpreview.ts';
  import { sampleEffectDoc } from '../../../lib/plugins/samples.ts';

  let { ed, plugin, onclose }: { ed: EditorState; plugin?: EffectPlugin; onclose: () => void } = $props();

  // svelte-ignore state_referenced_locally
  const start = plugin;
  let name = $state(start?.name ?? 'My effect');
  let target = $state<EffectPlugin['target']>(start?.target ?? 'any');
  let preset = $state.raw<EffectPlugin['preset']>(start?.preset);
  let useShader = $state(start ? !!start.shader : true);
  let sksl = $state(start?.shader?.sksl ?? SAMPLE_SKSL);
  let params = $state<ShaderParam[]>(start?.shader?.params ?? syncParams(SAMPLE_SKSL, []));
  let animated = $state(!!start?.shader?.animated);
  /** Slider values in the preview (start at each default). */
  let values = $state<Record<string, number>>({});

  const one = $derived(ed.selected.length === 1 ? ed.selected[0]! : null);
  const fromSel = $derived(one ? presetFromElement(one) : null);
  const presetKeys = $derived(preset ? [...Object.keys(preset.look ?? {}), ...(preset.textEffect ? [`text ${preset.textEffect.type}`] : [])] : []);

  // ---- compile (debounced) and params in step with the code ----
  let compiled = $state<{ ok: boolean; error?: string }>({ ok: true });
  let timer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const code = sksl, on = useShader;
    if (timer) clearTimeout(timer);
    if (!on) { compiled = { ok: true }; return; }
    timer = setTimeout(() => {
      compiled = compileShader(ed.engine.ck, code);
      if (compiled.ok) params = syncParams(code, params);
    }, 250);
  });
  function setParam(i: number, k: keyof ShaderParam, v: string): void {
    params = params.map((p, j) => (j === i ? { ...p, [k]: k === 'name' || k === 'label' ? v : Number(v) } : p));
  }
  const valueOf = (p: ShaderParam) => values[p.name] ?? p.default;

  /** Tab inserts two spaces in the code. */
  function codeKey(e: KeyboardEvent): void {
    if (e.key !== 'Tab' || e.shiftKey) return;
    e.preventDefault();
    const t = e.currentTarget as HTMLTextAreaElement;
    const s = t.selectionStart, end = t.selectionEnd;
    sksl = `${sksl.slice(0, s)}  ${sksl.slice(end)}`;
    queueMicrotask(() => { t.selectionStart = t.selectionEnd = s + 2; });
  }

  // ---- preview ----
  let cv = $state<HTMLCanvasElement>();
  let previewError = $state<string | null>(null);
  let raf = 0;
  $effect(() => {
    const c = cv, el = one, pre = preset, code = useShader && compiled.ok ? sksl : null, anim = animated;
    const vals: Record<string, number> = {};
    for (const p of params) vals[p.name] = valueOf(p);
    void ed.frame;
    cancelAnimationFrame(raf);
    if (!c) return;
    const doc = sampleEffectDoc(el, el && pre ? presetPatch(pre, el) : {});
    const W = 280, H = Math.max(40, Math.min(280, Math.round((W * doc.height) / doc.width)));
    c.width = W; c.height = H;
    const t0 = performance.now();
    const draw = (now: number) => {
      previewError = paintShaded(ed, c, doc, doc.pages[0]!, code, vals, (now - t0) / 1000);
      c.dataset.frame = String(Number(c.dataset.frame ?? 0) + 1);
      if (anim && code) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  });
  onDestroy(() => { cancelAnimationFrame(raf); if (timer) clearTimeout(timer); });

  const canSave = $derived((!!preset || useShader) && (!useShader || compiled.ok));
  let saving = $state(false);
  async function save(apply = false): Promise<void> {
    saving = true;
    try {
      const shader = useShader ? { sksl, params: params.map((p) => ({ ...p, default: valueOf(p) })), ...(animated ? { animated: true } : {}) } : undefined;
      const p = parsePlugin({ ...(start ?? {}), kind: 'effect', name: name.trim() || 'My effect', target, preset, shader }) as EffectPlugin;
      const saved = await plugins.save(p) as EffectPlugin;
      const n = apply ? applyEffect(ed, saved) : 0;
      toast.show(n ? `“${saved.name}” saved and applied` : `“${saved.name}” saved to your plugins`);
      onclose();
    } catch (e) {
      toast.show(`Couldn't save: ${e instanceof Error ? e.message : e}`);
    } finally {
      saving = false;
    }
  }
</script>

<div class="dp cr" data-testid="effect-creator">
  <button class="dp-back" onclick={onclose}><Icon name="left" size={16} /> {start ? 'Edit effect' : 'New effect'}</button>
  <label class="cr-f"><span>Name</span><input class="cr-in" bind:value={name} maxlength="80" data-testid="effect-plugin-name" /></label>

  <div class="cr-pv">
    <canvas bind:this={cv} width="280" height="186" data-testid="effect-plugin-preview" data-error={previewError ?? ''}></canvas>
    <small>{one ? 'On the selected element' : 'On a sample picture: select something to try it on your design'}</small>
  </div>

  <label class="cr-f"><span>Works on</span>
    <select class="cr-in" bind:value={target} data-testid="effect-plugin-target">
      <option value="any">Anything</option><option value="image">Photos and videos</option><option value="text">Text</option>
    </select>
  </label>

  <div class="dp-head"><h3>Preset</h3>{#if preset}<button class="dp-link" onclick={() => (preset = undefined)}>Clear</button>{/if}</div>
  {#if preset}
    <p class="dp-hint" data-testid="effect-preset">Keeps: {presetKeys.join(', ')}</p>
  {/if}
  <button class="btn" disabled={!fromSel} data-testid="effect-from-selection" onclick={() => (preset = fromSel ?? undefined)}><Icon name="picker" size={15} /> {preset ? 'Take the look again from the selection' : 'Take the look from the selection'}</button>
  {#if !fromSel}<p class="dp-hint">Select a photo with filters, adjustments, a shadow or duotone, or text with an effect, to keep its look.</p>{/if}

  <div class="dp-head"><h3>Shader</h3><label class="cr-chk"><input type="checkbox" bind:checked={useShader} data-testid="effect-use-shader" /> Use SkSL</label></div>
  {#if useShader}
    <textarea class="dp-textarea code" spellcheck="false" bind:value={sksl} rows="12" onkeydown={codeKey} data-testid="effect-sksl" aria-label="SkSL shader code"></textarea>
    {#if !compiled.ok}<pre class="dp-err cr-err" data-testid="effect-compile-error">{compiled.error}</pre>{:else}<p class="dp-hint" data-testid="effect-compiled"><Icon name="check" size={12} /> Compiles. <code>image</code> is the element, <code>resolution</code> its size in pixels, <code>time</code> seconds; every other <code>uniform float</code> gets a slider.</p>{/if}
    {#each params as p, i (p.name)}
      <div class="pp" data-testid="effect-param-{p.name}">
        <div class="pp-top">
          <input class="pp-label" value={p.label ?? p.name} aria-label="Label of {p.name}" oninput={(e) => setParam(i, 'label', (e.currentTarget as HTMLInputElement).value)} />
          <code>{p.name}</code>
        </div>
        <input type="range" min={p.min} max={p.max} step={(p.max - p.min) / 100 || 0.01} value={valueOf(p)} aria-label={p.label ?? p.name} data-testid="effect-param-slider-{p.name}" oninput={(e) => (values = { ...values, [p.name]: Number((e.currentTarget as HTMLInputElement).value) })} />
        <div class="pp-range">
          <label>Min <input type="number" value={p.min} onchange={(e) => setParam(i, 'min', (e.currentTarget as HTMLInputElement).value)} /></label>
          <label>Max <input type="number" value={p.max} onchange={(e) => setParam(i, 'max', (e.currentTarget as HTMLInputElement).value)} /></label>
          <span>Default {valueOf(p).toFixed(2)}</span>
        </div>
      </div>
    {/each}
    <label class="cr-chk"><input type="checkbox" bind:checked={animated} data-testid="effect-animated" /> Moves with time (videos, presentations)</label>
  {/if}

  <div class="cr-acts">
    <button class="btn primary grow" disabled={!canSave || saving} data-testid="effect-plugin-save" onclick={() => save(false)}>Save</button>
    <button class="btn grow" disabled={!canSave || saving || !ed.selection.length} data-testid="effect-plugin-save-apply" onclick={() => save(true)}>Save and apply</button>
  </div>
</div>

<style>
  .cr { gap: 10px; }
  .cr-f { display: flex; flex-direction: column; gap: 4px; font-size: 13px; font-weight: 600; }
  .cr-in { height: 36px; border: 1px solid var(--line); border-radius: 8px; background: var(--field); color: var(--ink); padding: 0 10px; font: inherit; font-weight: 400; }
  .cr-pv { display: flex; flex-direction: column; align-items: center; gap: 6px; background: var(--chip) repeating-conic-gradient(#0000 0 25%, #8881 0 50%) 0 0 / 16px 16px; border-radius: 8px; padding: 10px; }
  .cr-pv canvas { max-width: 100%; max-height: 220px; border-radius: 3px; }
  .cr-pv small { color: var(--muted); font-size: 11px; text-align: center; }
  .code { font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; tab-size: 2; white-space: pre; overflow: auto; min-height: 180px; }
  .cr-err { white-space: pre-wrap; font: 12px/1.4 ui-monospace, Menlo, monospace; margin: 0; }
  .cr-chk { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; }
  .pp { display: flex; flex-direction: column; gap: 4px; padding: 8px; border-radius: 8px; background: var(--chip); }
  .pp-top { display: flex; align-items: center; gap: 6px; }
  .pp-label { flex: 1; min-width: 0; height: 28px; border: 1px solid var(--line); border-radius: 6px; background: var(--field); color: var(--ink); padding: 0 6px; font-size: 13px; font-weight: 600; }
  .pp code { font-size: 11px; color: var(--muted); }
  .pp-range { display: flex; gap: 8px; align-items: center; font-size: 11px; color: var(--muted); }
  .pp-range input { width: 56px; height: 24px; border: 1px solid var(--line); border-radius: 5px; background: var(--field); color: var(--ink); padding: 0 4px; font-size: 11px; }
  .pp-range span { margin-left: auto; }
  .cr-acts { display: flex; gap: 8px; margin-top: 4px; }
  .cr-acts .grow { flex: 1; height: 38px; justify-content: center; }
</style>
