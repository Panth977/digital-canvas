<script lang="ts">
  import Icon from '../Icon.svelte';
  import { bridgeUi } from './bridgeUi.svelte.ts';

  /** "AI is working on this device" while the device worker runs a request. Click: the AI and devices panel. */
  const LABELS: Record<string, string> = {
    render_page: 'looking at a page', render_thumbnail_grid: 'looking at the pages', export_image: 'exporting', export_pdf: 'exporting a PDF', export_gif: 'making a GIF',
    export_video: 'rendering a video', create_design: 'creating a design', add_elements: 'adding elements', update_elements: 'editing', check_design: 'checking the design',
  };
</script>

{#if bridgeUi.busy > 0}
  <button class="pill" data-testid="ai-working" onclick={() => (bridgeUi.open = true)} title="An AI is using Digital Canvas on this device">
    <span class="spin"><Icon name="sparkle" size={14} /></span> AI is working on this device{bridgeUi.tool ? ` · ${LABELS[bridgeUi.tool] ?? bridgeUi.tool.replace(/_/g, ' ')}` : ''}
  </button>
{/if}

<style>
  .pill { position: fixed; left: 50%; bottom: calc(14px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); z-index: 800; display: flex; align-items: center; gap: 6px;
    padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--pop); color: var(--ink); box-shadow: var(--shadow); font: 600 12.5px system-ui, sans-serif; cursor: pointer; }
  .spin { display: inline-flex; color: var(--accent); animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .35; } }
  @media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style>
