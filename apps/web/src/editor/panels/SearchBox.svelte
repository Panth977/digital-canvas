<script lang="ts">
  /** Canva's panel search field: search icon, text, clear button. Enter searches. */
  import Icon from '../../lib/Icon.svelte';

  let { value = $bindable(''), placeholder, testid, label, onsearch, onclear, oninput }: {
    value?: string; placeholder: string; testid: string; label: string;
    onsearch: (q: string) => void; onclear?: () => void; oninput?: (q: string) => void;
  } = $props();
</script>

<form class="search" role="search" onsubmit={(e) => { e.preventDefault(); onsearch(value.trim()); }}>
  <Icon name="search" size={18} />
  <input {placeholder} bind:value aria-label={label} data-testid={testid} oninput={() => oninput?.(value)} enterkeyhint="search" />
  {#if value}
    <button type="button" class="clear" aria-label="Clear search" onclick={() => { value = ''; onclear?.(); }}><Icon name="close" size={14} /></button>
  {/if}
</form>

<style>
  .search { display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 8px 0 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--field); color: var(--muted); }
  .search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
  input { flex: 1; min-width: 0; border: 0; background: none; outline: none; color: var(--ink); font-size: 14px; }
  .clear { width: 26px; height: 26px; border: 0; border-radius: 6px; background: none; color: var(--muted); display: grid; place-items: center; padding: 0; }
  .clear:hover { background: var(--hover); color: var(--ink); }
</style>
