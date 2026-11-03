<script lang="ts">
  /**
   * Make or edit an animation plugin: paste CSS @keyframes or edit a keyframe
   * table; speed, loop / exit. The preview is the real `animateAt` on a sample,
   * so it plays as it will in the design and every export.
   */
  import '../panels.css';
  import { onDestroy } from 'svelte';
  import { parsePlugin, KEYFRAMES_ANIMATION, type AnimationPlugin, type MotionRecipe } from '@digital-canvas/scene';
  import type { EditorState } from '../../../lib/editor.svelte.ts';
  import Icon from '../../../lib/Icon.svelte';
  import { toast } from '../../../lib/toast.svelte.ts';
  import { plugins } from '../../../lib/plugins/plugins.svelte.ts';
  import { EASINGS, SAMPLE_CSS, recipeFromCss, recipeFromRows, recipeToCss, rowsFromRecipe, type KeyRow } from '../../../lib/plugins/pluginutil.ts';
  import { applyAnimation } from '../../../lib/plugins/apply.ts';
  import { paintPage } from '../../../lib/plugins/shaderpreview.ts';
  import { sampleAnimDoc } from '../../../lib/plugins/samples.ts';

  let { ed, plugin, onclose }: { ed: EditorState; plugin?: AnimationPlugin; onclose: () => void } = $props();

  // svelte-ignore state_referenced_locally
  const start = plugin;
  let name = $state(start?.name ?? 'My animation');
  let mode = $state<'css' | 'table'>(start && !start.css ? 'table' : 'css');
  let css = $state(start?.css ?? (start ? recipeToCss(start.recipe, start.name) : SAMPLE_CSS));
  let rows = $state<KeyRow[]>(start ? rowsFromRecipe(start.recipe) : []);
  let duration = $state(start?.recipe.len ?? 0.8);
  let loop = $state(!!start?.recipe.loop);
  let exit = $state(!!start?.recipe.exit);
  let textual = $state(false);
  let cssError = $state('');
  /** The recipe from the CSS (last good one). */
  let fromCss = $state.raw<MotionRecipe | null>(start?.css ? start.recipe : null);

  $effect(() => {
    if (mode !== 'css') return;
    const r = recipeFromCss(css);
    if ('error' in r) { cssError = r.error; return; }
    cssError = '';
    fromCss = r.recipe;
  });
  if (!start) {
    const r = recipeFromCss(SAMPLE_CSS);
    if ('recipe' in r) { fromCss = r.recipe; rows = rowsFromRecipe(r.recipe); }
  }

  const recipe = $derived.by((): MotionRecipe | null => {
    const base = mode === 'css' ? fromCss : rows.length ? recipeFromRows(rows) : null;
    if (!base) return null;
    return { ...base, name, len: duration, ...(loop ? { loop: true } : {}), ...(exit && !loop ? { exit: true } : {}) };
  });

  function toTable(): void {
    if (fromCss) rows = rowsFromRecipe(fromCss);
    mode = 'table';
  }
  function toCss(): void {
    if (rows.length) { css = recipeToCss(recipeFromRows(rows), name); fromCss = recipeFromRows(rows); }
    mode = 'css';
  }
  function addRow(): void {
    const last = rows[rows.length - 1];
    const at = rows.length >= 2 ? Math.round((rows[rows.length - 2]!.at + (last?.at ?? 100)) / 2) : 50;
    rows = [...rows, { at, x: 0, y: 0, scale: 1, rotate: 0, opacity: 1, easing: 'ease' }].sort((a, b) => a.at - b.at);
  }
  const removeRow = (i: number) => (rows = rows.filter((_, j) => j !== i));
  function setRow(i: number, k: keyof KeyRow, v: number | string): void {
    rows = rows.map((r, j) => (j === i ? { ...r, [k]: v } : r));
  }

  // ---- preview: plays over and over ----
  let cv = $state<HTMLCanvasElement>();
  let raf = 0;
  $effect(() => {
    const r = recipe, c = cv, t0 = performance.now(), txt = textual, d = duration;
    cancelAnimationFrame(raf);
    if (!r || !c) return;
    const len = r.exit ? d + 1 : r.loop ? 3 : d + 0.8;
    const doc = sampleAnimDoc({ type: KEYFRAMES_ANIMATION, keyframes: r, duration: d, ...(r.exit ? { phase: 'out' as const } : {}) }, txt, len);
    const page = doc.pages[0]!;
    const span = r.exit ? len : len + 0.4;
    let last = 0;
    const tick = (now: number) => {
      if (now - last >= 1000 / 30) {
        last = now;
        const t = ((now - t0) / 1000) % span;
        try { paintPage(ed, c, doc, page, Math.min(t, len)); } catch { /* a half-typed recipe */ }
        c.dataset.frame = String(Number(c.dataset.frame ?? 0) + 1);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });
  onDestroy(() => cancelAnimationFrame(raf));

  let saving = $state(false);
  async function save(apply = false): Promise<void> {
    if (!recipe) return;
    saving = true;
    try {
      const p = parsePlugin({
        ...(start ?? {}), kind: 'animation', name: name.trim() || 'My animation', recipe,
        ...(mode === 'css' ? { css } : { css: undefined }), duration, loop, exit: exit && !loop,
      }) as AnimationPlugin;
      const saved = await plugins.save(p) as AnimationPlugin;
      if (apply) applyAnimation(ed, saved);
      toast.show(apply ? `“${saved.name}” saved and applied` : `“${saved.name}” saved to your plugins`);
      onclose();
    } catch (e) {
      toast.show(`Couldn't save: ${e instanceof Error ? e.message : e}`);
    } finally {
      saving = false;
    }
  }
</script>

<div class="dp cr" data-testid="animation-creator">
  <button class="dp-back" onclick={onclose}><Icon name="left" size={16} /> {start ? 'Edit animation' : 'New animation'}</button>

  <label class="cr-f"><span>Name</span><input class="cr-in" bind:value={name} maxlength="80" data-testid="anim-plugin-name" /></label>

  <div class="cr-pv">
    <canvas bind:this={cv} width="200" height="200" data-testid="anim-plugin-preview"></canvas>
    <div class="cr-pvopts">
      <button class="btn" class:on={!textual} onclick={() => (textual = false)}>Shape</button>
      <button class="btn" class:on={textual} onclick={() => (textual = true)}>Text</button>
    </div>
  </div>

  <div class="dp-tabs" role="tablist">
    <button role="tab" class:on={mode === 'css'} aria-selected={mode === 'css'} data-testid="anim-mode-css" onclick={toCss}>CSS @keyframes</button>
    <button role="tab" class:on={mode === 'table'} aria-selected={mode === 'table'} data-testid="anim-mode-table" onclick={toTable}>Keyframes</button>
  </div>

  {#if mode === 'css'}
    <textarea class="dp-textarea code" spellcheck="false" bind:value={css} rows="10" data-testid="anim-css" aria-label="CSS @keyframes"></textarea>
    {#if cssError}<p class="dp-err" data-testid="anim-css-error">{cssError}</p>{:else}<p class="dp-hint">transform (translate, scale, rotate, skew), opacity and animation-timing-function per step. The first @keyframes is used.</p>{/if}
  {:else}
    <div class="kt" data-testid="anim-table">
      <div class="kt-h"><span>Time %</span><span>Move X %</span><span>Move Y %</span><span>Scale</span><span>Rotate°</span><span>Opacity</span><span>Easing</span><span></span></div>
      {#each rows as r, i (i)}
        <div class="kt-r" data-testid="anim-row-{i}">
          <input type="number" min="0" max="100" step="1" value={r.at} aria-label="Time" onchange={(e) => setRow(i, 'at', Number((e.currentTarget as HTMLInputElement).value))} />
          <input type="number" step="5" value={r.x} aria-label="Move X" oninput={(e) => setRow(i, 'x', Number((e.currentTarget as HTMLInputElement).value))} />
          <input type="number" step="5" value={r.y} aria-label="Move Y" oninput={(e) => setRow(i, 'y', Number((e.currentTarget as HTMLInputElement).value))} />
          <input type="number" step="0.05" min="0" value={r.scale} aria-label="Scale" oninput={(e) => setRow(i, 'scale', Number((e.currentTarget as HTMLInputElement).value))} />
          <input type="number" step="5" value={r.rotate} aria-label="Rotate" oninput={(e) => setRow(i, 'rotate', Number((e.currentTarget as HTMLInputElement).value))} />
          <input type="number" step="0.1" min="0" max="1" value={r.opacity} aria-label="Opacity" oninput={(e) => setRow(i, 'opacity', Number((e.currentTarget as HTMLInputElement).value))} />
          <select value={r.easing} aria-label="Easing" onchange={(e) => setRow(i, 'easing', (e.currentTarget as HTMLSelectElement).value)}>
            {#each EASINGS as x (x.id)}<option value={x.id}>{x.label}</option>{/each}
            {#if r.easing === 'custom'}<option value="custom">Custom</option>{/if}
          </select>
          <button class="btn ghost icon" aria-label="Remove keyframe" disabled={rows.length <= 2} onclick={() => removeRow(i)}><Icon name="close" size={12} /></button>
        </div>
      {/each}
      <button class="btn" data-testid="anim-row-add" onclick={addRow}><Icon name="plus" size={14} /> Add keyframe</button>
    </div>
    <p class="dp-hint">Move is a share of the element's size. Easing runs from a keyframe to the next.</p>
  {/if}

  <div class="cr-f">
    <span>Length · {duration.toFixed(1)} s</span>
    <input type="range" min="0.2" max="6" step="0.1" bind:value={duration} data-testid="anim-plugin-duration" />
  </div>
  <div class="dp-row">
    <label class="cr-chk"><input type="checkbox" bind:checked={loop} onchange={() => { if (loop) exit = false; }} data-testid="anim-plugin-loop" /> Loops while shown</label>
    <label class="cr-chk"><input type="checkbox" bind:checked={exit} onchange={() => { if (exit) loop = false; }} data-testid="anim-plugin-exit" /> Exit (plays as it leaves)</label>
  </div>

  <div class="cr-acts">
    <button class="btn primary grow" disabled={!recipe || saving || (mode === 'css' && !!cssError)} data-testid="anim-plugin-save" onclick={() => save(false)}>Save</button>
    <button class="btn grow" disabled={!recipe || saving || (mode === 'css' && !!cssError)} data-testid="anim-plugin-save-apply" onclick={() => save(true)}>{ed.selection.length ? 'Save and apply' : 'Save and use on page'}</button>
  </div>
</div>

<style>
  .cr { gap: 10px; }
  .cr-f { display: flex; flex-direction: column; gap: 4px; font-size: 13px; font-weight: 600; }
  .cr-in { height: 36px; border: 1px solid var(--line); border-radius: 8px; background: var(--field); color: var(--ink); padding: 0 10px; font: inherit; font-weight: 400; }
  .cr-pv { display: flex; flex-direction: column; align-items: center; gap: 8px; background: var(--chip); border-radius: 8px; padding: 10px; }
  .cr-pv canvas { width: 160px; height: 160px; border-radius: 4px; box-shadow: var(--page-shadow); background: #fff; }
  .cr-pvopts { display: flex; gap: 6px; }
  .cr-pvopts .btn { height: 28px; font-size: 12px; }
  .code { font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; tab-size: 2; white-space: pre; overflow: auto; }
  .kt { display: flex; flex-direction: column; gap: 4px; font-size: 11px; }
  .kt-h, .kt-r { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr 1fr 1fr 1.6fr 24px; gap: 3px; align-items: center; }
  .kt-h span { color: var(--muted); font-weight: 600; line-height: 1.15; }
  .kt-r input, .kt-r select { width: 100%; min-width: 0; height: 28px; border: 1px solid var(--line); border-radius: 6px; background: var(--field); color: var(--ink); padding: 0 3px; font-size: 12px; }
  .kt-r .btn.icon { width: 24px; height: 24px; }
  .cr-chk { display: flex; align-items: center; gap: 6px; font-size: 12px; }
  .cr-acts { display: flex; gap: 8px; margin-top: 4px; }
  .cr-acts .grow { flex: 1; height: 38px; justify-content: center; }
</style>
