<script lang="ts">
  import { BRUSHES, type EditorState } from '../lib/editor.svelte.ts';
  import type { Brush } from '@digital-canvas/scene';
  import ColorField from './ColorField.svelte';
  import Icon, { type IconName } from '../lib/Icon.svelte';
  import { IMAGE_TYPES, objectUrl, pickFiles } from '../lib/files.ts';
  import { AUDIO_TYPES, VIDEO_TYPES, formatTime } from '../lib/media.ts';
  import { ui, type RailTab } from '../lib/ui.svelte.ts';
  import ToolPanels from './ToolPanels.svelte';
  import UploadsPanel from './panels/UploadsPanel.svelte';
  import AIPanel from './panels/AIPanel.svelte';
  import TemplatesPanel from './panels/TemplatesPanel.svelte';
  import BrandPanel from './panels/BrandPanel.svelte';
  import ToolsPanel from './panels/ToolsPanel.svelte';
  import ProjectsPanel from './panels/ProjectsPanel.svelte';
  import AppsPanel from './panels/AppsPanel.svelte';
  import ElementsPanel from './panels/ElementsPanel.svelte';
  import TextPanel from './panels/TextPanel.svelte';
  import PhotosPanel from './panels/PhotosPanel.svelte';
  import VideosPanel from './panels/VideosPanel.svelte';
  import AudioPanel from './panels/AudioPanel.svelte';

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


  function dragData(e: DragEvent, data: object): void {
    e.dataTransfer?.setData('application/x-digital-canvas', JSON.stringify(data));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  }

  // ---- Draw ----
  const toolFor = (b: Brush) => ({ brush: b, color: BRUSHES[b].color, size: BRUSHES[b].size, opacity: BRUSHES[b].opacity });

</script>

<aside class="side">
  <nav class="rail" aria-label="Side panel">
    {#each TABS as t}
      <button class:on={lit === t.id} aria-pressed={lit === t.id} onclick={() => ui.rail(t.id)} data-testid="tab-{t.id}">
        <span class="ri"><Icon name={t.icon} size={24} /></span>
        <span>{t.label}</span>
      </button>
    {/each}
  </nav>

  {#if ui.panel}
    <div class="drawer" class:wide={ui.panel === 'font'} data-testid="side-panel" data-text-tools>
      {#if !ui.isRail}
        <ToolPanels {ed} />
      {:else}
      <div class="sec-body scroll-y">
      {#if ui.panel === 'elements'}
        <ElementsPanel {ed} />
      {:else if ui.panel === 'photos'}
        <PhotosPanel {ed} />
      {:else if ui.panel === 'videos'}
        <VideosPanel {ed} />
      {:else if ui.panel === 'sounds'}
        <AudioPanel {ed} />
      {:else if ui.panel === 'draw'}
        <ToolsPanel {ed} />
      {:else if ui.panel === 'ai'}
        <AIPanel {ed} />
      {:else if ui.panel === 'templates'}
        <TemplatesPanel {ed} />
      {:else if ui.panel === 'brand'}
        <BrandPanel {ed} />
      {:else if ui.panel === 'projects'}
        <ProjectsPanel {ed} />
      {:else if ui.panel === 'apps'}
        <AppsPanel {ed} />
      {:else if ui.panel === 'text'}
        <TextPanel {ed} />
      {:else if ui.panel === 'uploads'}
        <UploadsPanel {ed} />
      {/if}
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
