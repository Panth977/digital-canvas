<script lang="ts">
  import { view } from '../lib/view.svelte.ts';
  import Icon from '../lib/Icon.svelte';

  /** View options: rulers and guides, print bleed, safe margins, snapping. */
  let { bleed }: { bleed: number } = $props();
  let open = $state(false);
</script>

<svelte:window onclick={() => (open = false)} />

<div class="wrap">
  <button class="btn ghost" data-testid="view-menu" aria-expanded={open} onclick={(e) => { e.stopPropagation(); open = !open; }}><Icon name="ruler" size={16} /> View</button>
  {#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="menu" onclick={(e) => e.stopPropagation()}>
      <label><input type="checkbox" checked={view.rulers} onchange={() => view.toggle('rulers')} data-testid="view-rulers" /> Rulers and guides <kbd>⇧R</kbd></label>
      <label class:off={!bleed} title={bleed ? '' : 'This design has no print bleed'}><input type="checkbox" checked={view.bleed} disabled={!bleed} onchange={() => view.toggle('bleed')} data-testid="view-bleed" /> Show print bleed</label>
      <label><input type="checkbox" checked={view.margins} onchange={() => view.toggle('margins')} data-testid="view-margins" /> Show margins</label>
      <label><input type="checkbox" checked={view.snap} onchange={() => view.toggle('snap')} data-testid="view-snap" /> Snap to guides and elements</label>
      <p>Hold Alt or ⌘ while dragging to place freely. Drag from a ruler to add a guide; drag it off the page to remove it.</p>
    </div>
  {/if}
</div>

<style>
  .wrap { position: relative; }
  .menu { position: absolute; bottom: 40px; left: 0; width: 280px; background: #fff; border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow); padding: 10px; display: flex; flex-direction: column; gap: 4px; z-index: 20; }
  label { display: flex; align-items: center; gap: 8px; padding: 6px; border-radius: 6px; cursor: pointer; }
  label:hover { background: #f4f5f8; }
  label.off { opacity: .5; }
  kbd { margin-left: auto; font: inherit; font-size: 11px; color: var(--muted); }
  p { margin: 4px 6px 0; font-size: 12px; color: var(--muted); line-height: 1.4; }
</style>
