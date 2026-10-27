<script lang="ts">
  import { BRUSHES, type EditorState } from '../lib/editor.svelte.ts';
  import type { Brush } from '@digital-canvas/scene';
  import ColorField from './ColorField.svelte';
  import Icon, { type IconName } from '../lib/Icon.svelte';
  import { IMAGE_TYPES, objectUrl, pickFiles } from '../lib/files.ts';
  import { AUDIO_TYPES, VIDEO_TYPES, formatTime } from '../lib/media.ts';
  import { ui, type RailTab } from '../lib/ui.svelte.ts';
  import ToolPanels from './ToolPanels.svelte';
  import PanelBody from './PanelBody.svelte';

  let { ed }: { ed: EditorState } = $props();

  /** Canva's rail, in Canva's order (sections we don't have are left out). */
  const TABS: { id: RailTab; label: string; icon: IconName }[] = [
    { id: 'ai', label: 'AI', icon: 'ai' },
    { id: 'templates', label: 'Templates', icon: 'templates' },
    { id: 'elements', label: 'Elements', icon: 'elements' },
    { id: 'text', label: 'Text', icon: 'text' },
    { id: 'brand', label: 'Brand', icon: 'brand' },
    { id: 'uploads', label: 'Uploads', icon: 'cloud' },
    { id: 'draw', label: 'Tools', icon: 'pen' },
    { id: 'projects', label: 'Projects', icon: 'projects' },
    { id: 'apps', label: 'Apps', icon: 'apps' },
    { id: 'photos', label: 'Photos', icon: 'image' },
    { id: 'videos', label: 'Videos', icon: 'video' },
    { id: 'sounds', label: 'Audio', icon: 'music' },
  ];
  /** The rail item lit: the open section, or the one a contextual panel came from. */
  const lit = $derived(ui.panel ? (ui.isRail ? ui.panel : null) : null);

  // the pen is on while the Tools (draw) section is open
  let wasDraw = false;
  $effect(() => {
    const draw = ui.panel === 'draw';
    if (draw && !wasDraw) ed.tool = ed.tool ?? { ...toolFor('pen') };
    else if (!draw && wasDraw) ed.tool = null;
    wasDraw = draw;
  });


  // ---- keyboard: arrows move along the rail; Esc in the panel closes it (focus goes back to the rail) ----
  let railEl = $state<HTMLElement>();
  function railKey(e: KeyboardEvent): void {
    const btns = [...(railEl?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const n = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1 : -2;
    if (n === -2) return;
    e.preventDefault();
    btns[(n + btns.length) % btns.length]!.focus();
  }
  function panelKey(e: KeyboardEvent): void {
    // with something selected, Esc deselects first (the window handler)
    if (e.key !== 'Escape' || e.defaultPrevented || ed.selection.length) return;
    const t = e.target as HTMLElement;
    // Esc in a search box with words clears it first (Canva)
    if (t instanceof HTMLInputElement && (t.type === 'search' || t.type === 'text') && t.value) return;
    if ((t as HTMLElement).closest?.('[role=dialog], [role=menu], .pop')) return;
    e.preventDefault();
    e.stopPropagation();
    const back = ui.isRail ? ui.panel : ui.lastRail;
    if (ui.isRail) ui.panel = null; else ui.close();
    railEl?.querySelector<HTMLButtonElement>(`[data-testid="tab-${back}"]`)?.focus();
  }
  /** Opening a section from the keyboard puts the focus in it (its search box first). */
  function openFromKeys(e: KeyboardEvent, id: RailTab): void {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    ui.rail(id);
    if (ui.panel) requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid=side-panel] input, [data-testid=side-panel] button:not(.collapse)')?.focus());
  }

  function dragData(e: DragEvent, data: object): void {
    e.dataTransfer?.setData('application/x-digital-canvas', JSON.stringify(data));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  }

  // ---- Draw ----
  const toolFor = (b: Brush) => ({ brush: b, color: BRUSHES[b].color, size: BRUSHES[b].size, opacity: BRUSHES[b].opacity });

</script>

<aside class="side">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <nav class="rail" aria-label="Side panel" bind:this={railEl} onkeydown={railKey}>
    {#each TABS as t}
      <button class:on={lit === t.id} aria-pressed={lit === t.id} onclick={() => ui.rail(t.id)} onkeydown={(e) => openFromKeys(e, t.id)} data-testid="tab-{t.id}">
        <span class="ri"><Icon name={t.icon} size={24} /></span>
        <span>{t.label}</span>
      </button>
    {/each}
  </nav>

  {#if ui.panel}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="drawer" class:wide={ui.panel === 'font'} data-testid="side-panel" data-text-tools onkeydown={panelKey}>
      {#if !ui.isRail}
        <ToolPanels {ed} />
      {:else}
      <div class="sec-body scroll-y">
      <PanelBody {ed} />
      </div>
      {/if}
      <button class="collapse" title="Close panel" aria-label="Close panel" data-testid="collapse-panel" onclick={() => (ui.panel = null)}><Icon name="left" size={14} /></button>
    </div>
  {/if}
</aside>

<style>
  .side { display: flex; height: 100%; flex-shrink: 0; background: var(--rail); }
  .rail { width: 72px; display: flex; flex-direction: column; align-items: stretch; padding: 0; overflow-y: auto; scrollbar-width: none; }
  .rail button { display: flex; flex-direction: column; align-items: center; gap: 2px; height: 72px; padding: 0; justify-content: center; border: 0; background: none; color: var(--rail-ink); font-size: 11px; font-weight: 500; }
  .rail .ri { width: 40px; height: 32px; display: grid; place-items: center; border-radius: 8px; }
  .rail button:hover .ri { background: var(--hover); }
  .rail button.on .ri { background: var(--accent-soft); color: var(--accent); }
  .rail button.on { color: var(--rail-ink); font-weight: 600; }
  .drawer { position: relative; width: 360px; background: var(--panel); display: flex; flex-direction: column; padding: 16px 16px 0 16px; min-height: 0; }
  .sec-body { flex: 1; min-height: 0; margin: 0 -16px; padding: 0 16px 16px; }
  .collapse { position: absolute; right: -14px; top: 50%; transform: translateY(-50%); width: 14px; height: 96px; border: 0; border-radius: 0 8px 8px 0; background: var(--panel); color: var(--muted); display: grid; place-items: center; padding: 0; z-index: 5; }
  .collapse:hover { color: var(--ink); }
</style>
