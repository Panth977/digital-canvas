<script lang="ts">
  import { BRUSHES, type EditorState } from '../lib/editor.svelte.ts';
  import type { Brush } from '@digital-canvas/scene';
  import ColorField from './ColorField.svelte';
  import Icon, { type IconName } from '../lib/Icon.svelte';
  import { IMAGE_TYPES, objectUrl, pickFiles } from '../lib/files.ts';
  import { AUDIO_TYPES, VIDEO_TYPES, formatTime } from '../lib/media.ts';
  import { ui, type RailTab } from '../lib/ui.svelte.ts';
  import ToolPanels from './ToolPanels.svelte';
  import ElementsPanel from './panels/ElementsPanel.svelte';
  import TextPanel from './panels/TextPanel.svelte';
  import PhotosPanel from './panels/PhotosPanel.svelte';
  import VideosPanel from './panels/VideosPanel.svelte';
  import AudioPanel from './panels/AudioPanel.svelte';

  let { ed }: { ed: EditorState } = $props();

  let uploadError = $state('');

  /** Canva's rail, in Canva's order (sections we don't have are left out). */
  const TABS: { id: RailTab; label: string; icon: IconName }[] = [
    { id: 'elements', label: 'Elements', icon: 'elements' },
    { id: 'text', label: 'Text', icon: 'text' },
    { id: 'uploads', label: 'Uploads', icon: 'cloud' },
    { id: 'draw', label: 'Tools', icon: 'pen' },
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

  const assets = $derived(Object.entries(ed.doc.assets).filter(([k, m]) => m.mime.startsWith('image/') && !k.endsWith('.poster')));
  const videos = $derived(Object.entries(ed.doc.assets).filter(([, m]) => m.mime.startsWith('video/')));
  const sounds = $derived(Object.entries(ed.doc.assets).filter(([, m]) => m.mime.startsWith('audio/')));

  function dragData(e: DragEvent, data: object): void {
    e.dataTransfer?.setData('application/x-digital-canvas', JSON.stringify(data));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  }

  async function upload(): Promise<void> {
    uploadError = '';
    const files = await pickFiles([...IMAGE_TYPES, ...VIDEO_TYPES, ...AUDIO_TYPES, '.mov', '.m4a', '.mp3'].join(','));
    for (const f of files) if (!(await ed.addMediaFile(f))) uploadError = `Couldn't read ${f.name} (this browser can't open it).`;
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
        <h3>Draw</h3>
        <div class="brushes">
          {#each Object.entries(BRUSHES) as [b, info]}
            <button class="btn" class:on={ed.tool?.brush === b} data-testid="brush-{b}" onclick={() => (ed.tool = toolFor(b as Brush))}>{info.label}</button>
          {/each}
        </div>
        {#if ed.tool}
          <div class="drawopts">
            <ColorField label="Colour" value={ed.tool.color} testid="draw-color" onchange={(hex) => ed.tool && (ed.tool = { ...ed.tool, color: hex })} />
            <label class="field"><span>Size · {ed.tool.size}px</span>
              <input type="range" min="1" max="80" value={ed.tool.size} data-testid="draw-size" oninput={(e) => ed.tool && (ed.tool = { ...ed.tool, size: Number((e.currentTarget as HTMLInputElement).value) })} />
            </label>
            <label class="field"><span>Transparency · {Math.round((1 - ed.tool.opacity) * 100)}%</span>
              <input type="range" min="0" max="90" value={Math.round((1 - ed.tool.opacity) * 100)} oninput={(e) => ed.tool && (ed.tool = { ...ed.tool, opacity: 1 - Number((e.currentTarget as HTMLInputElement).value) / 100 })} />
            </label>
          </div>
        {/if}
        <p class="hint">Draw on the page; each stroke becomes its own element you can move, resize and recolour. Close this panel (or press Esc) to stop drawing.</p>
      {:else if ui.panel === 'text'}
        <TextPanel {ed} />
      {:else if ui.panel === 'uploads'}
        <button class="btn primary cta" onclick={upload} data-testid="upload"><Icon name="upload" size={18} /> Upload files</button>
        <p class="hint">Or drop files onto the page. Images (PNG, JPG, WebP, GIF), videos (MP4, WebM, MOV) and sounds (MP3, M4A, WAV).</p>
        {#if uploadError}<p class="err">{uploadError}</p>{/if}
        {#if videos.length}
          <h3 class="sub">Videos</h3>
          <div class="assets">
            {#each videos as [id, m] (id)}
              {@const poster = ed.assets.get(`${id}.poster`)}
              <button class="asset vid" title={m.name ?? id} onclick={() => ed.addVideoAsset(id)}>
                {#if poster}<img src={objectUrl(poster, 'image/png')} alt={m.name ?? ''} />{/if}
                <span class="dur">{formatTime(m.duration ?? 0)}</span>
              </button>
            {/each}
          </div>
        {/if}
        {#if sounds.length}
          <h3 class="sub">Sounds</h3>
          {#each sounds as [id, m] (id)}
            <div class="sound"><Icon name="music" size={14} /> <span>{m.name ?? id}</span> <em>{formatTime(m.duration ?? 0)}</em></div>
          {/each}
        {/if}
        {#if (videos.length || sounds.length) && assets.length}<h3 class="sub">Images</h3>{/if}
        <div class="assets">
          {#each assets as [id, m] (id)}
            {@const bytes = ed.assets.get(id)}
            <button class="asset" title={m.name ?? id} draggable="true" ondragstart={(e) => dragData(e, { kind: 'asset', id })} onclick={() => ed.addImageAsset(id)}>
              {#if bytes}<img src={objectUrl(bytes, m.mime)} alt={m.name ?? ''} />{/if}
            </button>
          {/each}
        </div>
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
  .cta { width: 100%; height: 40px; border-radius: 8px; font-size: 14px; }
  h3 { margin: 0 0 12px; font-size: 14px; font-weight: 600; }
  .hint { color: var(--muted); font-size: 12px; line-height: 1.5; margin: 14px 0 0; }
  .brushes { display: flex; gap: 6px; }
  .brushes .btn.on { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
  .drawopts { display: flex; flex-direction: column; gap: 12px; margin-top: 14px; }
  .drawopts input[type='range'] { width: 100%; }
  .err { color: var(--danger); font-size: 13px; }
  .assets { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 14px; }
  .asset { aspect-ratio: 1; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; padding: 0; background: var(--chip); }
  .asset img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .asset.vid { position: relative; }
  .dur { position: absolute; right: 4px; bottom: 4px; background: rgba(0,0,0,.65); color: #fff; font-size: 11px; padding: 1px 5px; border-radius: 4px; }
  h3.sub { margin: 16px 0 8px; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
  .sound { display: flex; align-items: center; gap: 6px; font-size: 13px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 8px; margin-bottom: 6px; }
  .sound span { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .sound em { font-style: normal; color: var(--muted); font-size: 12px; }
</style>
