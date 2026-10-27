<script lang="ts">
  /** Canva's question when a template meets a page that already has things on it. */
  import './panels.css';
  import type { InsertMode } from '../../lib/templates.ts';

  let { title, pages = 1, onpick, oncancel }: { title: string; pages?: number; onpick: (m: InsertMode) => void; oncancel: () => void } = $props();
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && oncancel()} />
<div class="dp-modal-bg" role="presentation" onclick={(e) => e.target === e.currentTarget && oncancel()}>
  <div class="dp-modal" role="dialog" aria-modal="true" aria-label="Use {title}" data-testid="insert-dialog">
    <h2>Use “{title}”?</h2>
    <p>Your current page already has a design on it.{pages > 1 ? ` This template has ${pages} pages.` : ''}</p>
    <div class="dp-acts">
      <button class="btn primary dp-cta" data-testid="insert-replace" onclick={() => onpick('replace')}>Replace current page</button>
      <button class="btn dp-cta" data-testid="insert-add" onclick={() => onpick('add')}>Add as new page{pages > 1 ? 's' : ''}</button>
      <button class="btn ghost dp-cta" onclick={oncancel}>Cancel</button>
    </div>
  </div>
</div>
