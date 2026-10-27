<script lang="ts">
  /** "Brand Kit" swatches in the colour panel. */
  import { onMount } from 'svelte';
  import { brand } from '../../lib/brand.svelte.ts';
  import { ui } from '../../lib/ui.svelte.ts';

  let { current, onpick }: { current: string; onpick: (hex: string) => void } = $props();
  onMount(() => void brand.load());
</script>

<div class="brandrow" data-testid="brand-colors">
  <h4>{brand.kit.name}</h4>
  {#if brand.kit.palettes.some((p) => p.colors.length)}
    {#each brand.kit.palettes.filter((p) => p.colors.length) as p (p.id)}
      {#if brand.kit.palettes.length > 1}<div class="pn">{p.name}</div>{/if}
      <div class="swatches">
        {#each p.colors as hex (hex)}
          <button class="swatch" class:on={current.slice(0, 7).toLowerCase() === hex} title="{p.name}: {hex}" aria-label="Brand colour {hex}" style="background:{hex}" onclick={() => onpick(hex)}></button>
        {/each}
      </div>
    {/each}
  {:else}
    <button class="setup" onclick={() => ui.rail('brand')}>Add your brand colours</button>
  {/if}
</div>

<style>
  h4 { margin: 16px 0 8px; font-size: 13px; font-weight: 600; }
  .pn { font-size: 12px; color: var(--muted); margin: 6px 0 4px; }
  .swatches { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
  .swatch { aspect-ratio: 1; border-radius: 50%; border: 1px solid rgba(127,127,127,.35); padding: 0; }
  .swatch.on { box-shadow: 0 0 0 2px var(--panel), 0 0 0 4px var(--accent); }
  .setup { border: 1px dashed var(--line); background: none; color: var(--muted); border-radius: 8px; padding: 8px 10px; width: 100%; font-size: 13px; }
  .setup:hover { color: var(--ink); border-color: var(--accent); }
</style>
