<script lang="ts">
  import { PRESET_CATEGORIES, PRESETS, searchPresets, type Doc, type PresetCategory, type ResizeTarget, type Unit } from '@digital-canvas/scene';
  import type { EditorState } from '../lib/editor.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import Icon from '../lib/Icon.svelte';

  /**
   * "Resize" (Canva's Magic Resize): pick sizes, get a copy of this design at
   * each, layout scaled to fit and centred. The copies are new designs in the
   * same place this one is saved.
   */
  let { ed, onclose }: { ed: EditorState; onclose: () => void } = $props();

  let query = $state('');
  let category = $state<PresetCategory | 'All'>('All');
  let picked = $state<string[]>([]);
  let useCustom = $state(false);
  let custom = $state({ w: 1080, h: 1080, unit: 'px' as Unit });
  let busy = $state(false);
  let error = $state('');
  let made = $state<Doc[]>([]);

  const shown = $derived(searchPresets(query, category));
  const count = $derived(picked.length + (useCustom ? 1 : 0));

  function toggle(id: string): void {
    picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
  }

  async function go(): Promise<void> {
    const targets: ResizeTarget[] = picked.map((id) => {
      const p = PRESETS.find((x) => x.id === id)!;
      return { width: p.width, height: p.height, unit: p.unit, print: p.print, title: `${ed.doc.title} (${p.name})` };
    });
    if (useCustom) targets.push({ width: custom.w, height: custom.h, unit: custom.unit, print: custom.unit !== 'px', title: `${ed.doc.title} (${custom.w}×${custom.h} ${custom.unit})` });
    busy = true;
    error = '';
    try {
      made = await ed.resizeCopies(targets);
      picked = [];
      useCustom = false;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="resize" data-testid="resize-dialog" onclick={(e) => e.stopPropagation()}>
  <div class="head">
    <b>Resize a copy</b>
    <button class="btn ghost icon" aria-label="Close" onclick={onclose}><Icon name="close" size={16} /></button>
  </div>
  <div class="search">
    <Icon name="search" size={16} />
    <input class="input" placeholder="Search sizes (e.g. story, A4, 728x90)" bind:value={query} data-testid="resize-search" />
  </div>
  <select class="input" bind:value={category} aria-label="Category">
    <option value="All">All categories</option>
    {#each PRESET_CATEGORIES as c}<option value={c}>{c}</option>{/each}
  </select>
  <ul class="list scroll-y">
    {#each shown as p (p.id)}
      <li>
        <label>
          <input type="checkbox" checked={picked.includes(p.id)} onchange={() => toggle(p.id)} data-testid="resize-preset-{p.id}" />
          <span class="n">{p.name}</span>
          <span class="s">{p.width} × {p.height} {p.unit}</span>
        </label>
      </li>
    {:else}
      <li class="none">No sizes match.</li>
    {/each}
  </ul>
  <label class="custom">
    <input type="checkbox" bind:checked={useCustom} />
    <span>Custom</span>
    <input class="input" type="number" min="0.1" step="any" bind:value={custom.w} aria-label="Width" />
    <span>×</span>
    <input class="input" type="number" min="0.1" step="any" bind:value={custom.h} aria-label="Height" />
    <select class="input" bind:value={custom.unit} aria-label="Unit"><option value="px">px</option><option value="in">in</option><option value="mm">mm</option><option value="cm">cm</option></select>
  </label>
  <button class="btn primary" disabled={!count || busy} onclick={go} data-testid="resize-go">
    {busy ? 'Making copies…' : count > 1 ? `Copy & resize (${count})` : 'Copy & resize'}
  </button>
  {#if error}<p class="err">{error}</p>{/if}
  {#if made.length}
    <div class="made" data-testid="resize-made">
      <span>Made {made.length === 1 ? 'a copy' : `${made.length} copies`}:</span>
      {#each made as d (d.id)}
        <button class="btn" data-testid="resize-open" onclick={() => router.go({ name: 'editor', id: d.id })}>Open {d.title}</button>
      {/each}
    </div>
  {/if}
  <p class="note">Everything is scaled to fit the new size and centred; backgrounds still cover the page. This design stays as it is.</p>
</div>

<style>
  .resize { position: absolute; left: 0; top: 42px; width: 360px; background: #fff; color: var(--ink); border-radius: 12px; box-shadow: var(--shadow); padding: 14px; display: flex; flex-direction: column; gap: 10px; z-index: 20; border: 1px solid var(--line); }
  .head { display: flex; align-items: center; justify-content: space-between; }
  .search { display: flex; align-items: center; gap: 6px; color: var(--muted); }
  .list { list-style: none; margin: 0; padding: 0; max-height: 280px; border: 1px solid var(--line); border-radius: 8px; }
  .list li label { display: flex; align-items: center; gap: 8px; padding: 6px 8px; cursor: pointer; font-size: 13px; }
  .list li label:hover { background: #f4f5f8; }
  .list .n { flex: 1; }
  .list .s { color: var(--muted); font-size: 12px; white-space: nowrap; }
  .none { padding: 10px; color: var(--muted); font-size: 13px; }
  .custom { display: grid; grid-template-columns: auto auto 1fr auto 1fr 64px; gap: 6px; align-items: center; font-size: 13px; }
  .made { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
  .made .btn { justify-content: flex-start; overflow: hidden; text-overflow: ellipsis; }
  .note { font-size: 12px; color: var(--muted); margin: 0; }
  .err { color: var(--danger); font-size: 13px; margin: 0; }
</style>
