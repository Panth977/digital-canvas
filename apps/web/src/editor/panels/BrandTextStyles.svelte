<script lang="ts">
  /** Brand text styles at the top of the Text panel (Canva shows them when a Brand Kit has fonts). */
  import { onMount } from 'svelte';
  import { BRAND_ROLES } from '@digital-canvas/storage';
  import type { EditorState } from '../../lib/editor.svelte.ts';
  import { addBrandText, brand, ROLE_LABELS } from '../../lib/brand.svelte.ts';

  let { ed }: { ed: EditorState } = $props();
  let busy = $state(false);
  onMount(() => void brand.load());
  const roles = $derived(BRAND_ROLES.filter((r) => brand.kit.fonts[r]));
</script>

{#if roles.length}
  <h3 class="bts-h">Brand text styles</h3>
  <div class="bts" data-testid="brand-text-styles">
    {#each roles as r (r)}
      {@const f = brand.kit.fonts[r]!}
      <button class="bt {r}" disabled={busy} data-testid="brand-text-{r}" style="font-family:'{f.fontFamily}', Inter, sans-serif;font-weight:{f.bold ? 700 : 400};font-style:{f.italic ? 'italic' : 'normal'};{f.uppercase ? 'text-transform:uppercase;' : ''}"
        onclick={async () => { busy = true; try { await addBrandText(ed, r); } finally { busy = false; } }}>
        {ROLE_LABELS[r]}
        <small>{f.fontFamily} · {f.fontSize}</small>
      </button>
    {/each}
  </div>
{/if}

<style>
  .bts-h { margin: 22px 0 12px; font-size: 14px; font-weight: 600; }
  .bts { display: flex; flex-direction: column; gap: 8px; }
  .bt { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; text-align: left; padding: 12px 14px; border: 0; border-radius: 8px; background: var(--chip); color: var(--ink); }
  .bt:hover { background: var(--hover); }
  .bt.heading { font-size: 26px; }
  .bt.subheading { font-size: 18px; }
  .bt.body { font-size: 14px; }
  .bt small { font: 500 11px Inter, sans-serif; color: var(--muted); text-transform: none; white-space: nowrap; }
</style>
