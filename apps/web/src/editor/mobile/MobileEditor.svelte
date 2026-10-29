<script lang="ts">
  import { isVideo } from '@digital-canvas/scene';
  import type { ProjectStore } from '@digital-canvas/storage';
  import { BRUSHES, type EditorState } from '../../lib/editor.svelte.ts';
  import Icon from '../../lib/Icon.svelte';
  import { router } from '../../lib/router.svelte.ts';
  import { ui, RAIL_TABS, type RailTab } from '../../lib/ui.svelte.ts';
  import { mobile } from '../../lib/mobile.svelte.ts';
  import { bridgeUi } from '../../lib/bridge/bridgeUi.svelte.ts';
  import Canvas from '../Canvas.svelte';
  import Timeline from '../Timeline.svelte';
  import PanelBody from '../PanelBody.svelte';
  import ToolPanels from '../ToolPanels.svelte';
  import DownloadMenu from '../DownloadMenu.svelte';
  import SharePopover from '../SharePopover.svelte';
  import Present from '../Present.svelte';
  import ResizeDialog from '../ResizeDialog.svelte';
  import VersionHistory from '../VersionHistory.svelte';
  import MobileSheet from './MobileSheet.svelte';
  import MobileToolbar from './MobileToolbar.svelte';
  import MobileTools from './MobileTools.svelte';

  /**
   * Canva's phone editor: a slim top bar, the canvas filling the screen, a
   * bottom toolbar that follows the selection, and bottom sheets for the
   * side panels and tools. Pinned to the visual viewport so the toolbar and
   * the text being edited stay above the on-screen keyboard.
   */
  let { ed, store }: { ed: EditorState; store: ProjectStore } = $props();

  let zoom = $state(1);
  let showVersions = $state(false);
  let presenting = $state(false);
  let size = $state<'auto' | 'half' | 'full'>('half');

  const RAIL_TITLES: Record<RailTab, string> = {
    ai: 'AI', templates: 'Design', elements: 'Elements', text: 'Text', brand: 'Brand', uploads: 'Uploads', draw: 'Draw',
    projects: 'Projects', apps: 'Apps', photos: 'Photos', videos: 'Videos', sounds: 'Audio',
  };
  const SHEET_TITLES = { size: 'Font size', spacing: 'Spacing', opacity: 'Transparency', format: 'Format', pages: 'Pages', menu: '', download: 'Download', resize: 'Resize', share: 'Share' } as const;

  const isRail = $derived(!!ui.panel && RAIL_TABS.includes(ui.panel as RailTab));
  const open = $derived(!!ui.panel || !!mobile.sheet);
  const TOOL_TITLES: Record<string, string> = { font: 'Font', effects: 'Effects', animate: 'Animate', position: 'Position', image: 'Edit photo', table: 'Table', chart: 'Chart', qr: 'QR code', frame: 'Frame', audio: 'Audio' };
  const title = $derived(ui.panel
    ? isRail ? RAIL_TITLES[ui.panel as RailTab] : ui.panel === 'color' ? ui.color?.title ?? 'Colour' : TOOL_TITLES[ui.panel] ?? ''
    : mobile.sheet ? SHEET_TITLES[mobile.sheet] : '');
  const small = $derived(mobile.sheet === 'size' || mobile.sheet === 'spacing' || mobile.sheet === 'opacity' || mobile.sheet === 'format' || mobile.sheet === 'menu');

  // each new sheet opens at its natural size: small tools fit their content, Draw leaves the page in view
  let lastKey = '';
  $effect(() => {
    const k = `${ui.panel}|${mobile.sheet}`;
    if (k === lastKey) return;
    lastKey = k;
    size = small ? 'auto' : 'half';
  });

  function close(): void {
    ui.panel = null;
    ui.color = null;
    mobile.sheet = null;
  }

  // the pen is on while Draw is open (the desktop rail does the same)
  let wasDraw = false;
  $effect(() => {
    const draw = ui.panel === 'draw';
    if (draw && !wasDraw) ed.tool = ed.tool ?? { brush: 'pen', color: BRUSHES.pen.color, size: BRUSHES.pen.size, opacity: BRUSHES.pen.opacity };
    else if (!draw && wasDraw) ed.tool = null;
    wasDraw = draw;
  });

  // adding something from a content sheet selects it: Canva closes the sheet to show its tools
  let lastSel = '';
  $effect(() => {
    const now = ed.selection.join(',');
    if (now === lastSel) return;
    lastSel = now;
    if (now && isRail && ui.panel !== 'draw') ui.panel = null;
  });

  // ---- title: tap to rename ----
  let titleEl = $state<HTMLInputElement>();
  function commitTitle(): void {
    const el = titleEl;
    if (!el) return;
    const v = el.value.trim();
    if (v && v !== ed.doc.title) ed.rename(v);
    el.value = ed.doc.title;
  }
</script>

<!-- --tb-h: an installed desktop app's title bar (Window Controls Overlay) when the window is narrow; 0 elsewhere -->
<div class="m-editor" style="top:calc({mobile.top}px + var(--tb-h));height:calc({mobile.vh}px - var(--tb-h))" data-testid="mobile-editor" class:kb={mobile.keyboard}>
  <header class="m-top">
    <button class="hb" aria-label="Home" data-testid="home" onclick={() => router.go({ name: 'home' })}><Icon name="left" size={22} /></button>
    <button class="hb" aria-label="Undo" data-testid="undo" disabled={!ed.canUndo} onclick={() => ed.undo()}><Icon name="undo" size={20} /></button>
    <button class="hb" aria-label="Redo" data-testid="redo" disabled={!ed.canRedo} onclick={() => ed.redo()}><Icon name="redo" size={20} /></button>
    <input class="title" bind:this={titleEl} value={ed.doc.title} aria-label="Design title" data-testid="title" spellcheck="false" maxlength="255" enterkeyhint="done"
      onblur={commitTitle} onkeydown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }} />
    <span class="save" data-state={ed.saveState} data-testid="save-state" aria-label={ed.saveState === 'saved' ? `Saved · ${store.label}` : ed.saveState}>
      {#if ed.saveState === 'saving'}<span class="ring"></span>{:else}<Icon name={ed.saveState === 'error' ? 'alert' : ed.saveState === 'saved' ? 'cloudok' : 'cloud'} size={20} />{/if}
    </span>
    <button class="hb" aria-label="Share" data-testid="share" onclick={() => (mobile.sheet = mobile.sheet === 'share' ? null : 'share', ui.panel = null)}><Icon name="share" size={20} /></button>
    <button class="hb" aria-label="Download or share" data-testid="download" onclick={() => (mobile.sheet = mobile.sheet === 'download' ? null : 'download', ui.panel = null)}><Icon name="download" size={20} /></button>
    <button class="hb" aria-label="More" data-testid="m-menu" onclick={() => (mobile.sheet = mobile.sheet === 'menu' ? null : 'menu', ui.panel = null)}><Icon name="more" size={20} /></button>
  </header>

  <main class="m-work">
    <Canvas {ed} bind:zoom />
    {#if isVideo(ed.doc)}<Timeline {ed} />{:else}
    <span class="pageno" data-testid="m-page-counter">{ed.pageIndex + 1} / {ed.doc.pages.length}</span>{/if}
    <!-- sheets sit above the toolbar, which stays in reach (Canva mobile) -->
    {#if open}
      <MobileSheet title={title} bind:size onclose={close} testid="m-sheet">
        {#if ui.panel}
          {#if isRail}<PanelBody {ed} />{:else}<div class="tools"><ToolPanels {ed} /></div>{/if}
        {:else if mobile.sheet === 'download'}
          <div class="host"><DownloadMenu {ed} onclose={close} /></div>
        {:else if mobile.sheet === 'share'}
          <div class="host"><SharePopover {ed} onclose={close} ondownload={() => (mobile.sheet = 'download')} onpresent={() => (presenting = true)} /></div>
        {:else if mobile.sheet === 'resize'}
          <div class="host"><ResizeDialog {ed} onclose={close} /></div>
        {:else if mobile.sheet === 'menu'}
          <div class="menu" data-testid="m-menu-sheet">
            <button onclick={() => (mobile.sheet = 'share')}><Icon name="share" size={20} /> Share</button>
            <button onclick={() => (mobile.sheet = 'download')}><Icon name="download" size={20} /> Download / share</button>
            <button onclick={() => (mobile.sheet = 'resize')}><Icon name="resize" size={20} /> Resize</button>
            <button onclick={() => (mobile.sheet = 'pages')}><Icon name="pages" size={20} /> Pages</button>
            <button onclick={() => { close(); showVersions = true; }}><Icon name="cloud" size={20} /> Version history</button>
            <button onclick={() => { close(); void ed.save(); }}><Icon name="cloudok" size={20} /> Save now</button>
            <button data-testid="m-ai-devices" onclick={() => { close(); bridgeUi.open = true; }}><Icon name="ai" size={20} /> AI and devices</button>
          </div>
        {:else}
          <MobileTools {ed} />
        {/if}
      </MobileSheet>
    {/if}
  </main>

  <MobileToolbar {ed} />

  {#if showVersions}<VersionHistory {ed} onclose={() => (showVersions = false)} />{/if}
  {#if presenting}<Present {ed} start={ed.pageIndex} onclose={() => (presenting = false)} />{/if}
</div>

<style>
  .m-editor { position: fixed; left: 0; right: 0; display: flex; flex-direction: column; background: var(--stage); overflow: hidden; overscroll-behavior: none; }
  .m-top {
    flex-shrink: 0; display: flex; align-items: center; gap: 2px; padding: env(safe-area-inset-top) max(6px, env(safe-area-inset-right)) 0 max(6px, env(safe-area-inset-left));
    min-height: calc(52px + env(safe-area-inset-top)); background: var(--header); color: #fff;
  }
  .hb { width: 40px; height: 40px; flex-shrink: 0; display: grid; place-items: center; border: 0; border-radius: 12px; background: transparent; color: #fff; -webkit-tap-highlight-color: transparent; }
  .hb:active { background: rgba(255, 255, 255, .18); }
  .hb:disabled { opacity: .4; }
  .title { flex: 1; min-width: 0; height: 36px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: #fff; font-weight: 600; font-size: 16px; padding: 0 8px; text-overflow: ellipsis; }
  .title:focus { outline: none; border-color: #fff; background: rgba(0, 0, 0, .18); }
  .save { width: 28px; display: grid; place-items: center; flex-shrink: 0; opacity: .9; }
  .ring { width: 16px; height: 16px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, .35); border-top-color: #fff; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .m-work { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .pageno { position: absolute; right: 10px; bottom: 8px; z-index: 5; padding: 3px 10px; border-radius: 12px; background: rgba(0, 0, 0, .55); color: #fff; font-size: 12px; font-weight: 600; pointer-events: none; }
  .m-editor.kb .pageno { display: none; }
  /* the desktop's pop-overs become sheet contents */
  .host :global(> *) { position: static !important; width: auto !important; max-width: none !important; box-shadow: none !important; border: 0 !important; padding: 0 !important; }
  .tools :global(.tp > header) { display: none; }
  .menu { display: flex; flex-direction: column; padding: 4px 0; }
  .menu button { display: flex; align-items: center; gap: 14px; height: 52px; border: 0; background: transparent; color: var(--ink); font-size: 15px; text-align: left; padding: 0 4px; border-radius: 10px; }
  .menu button:active { background: var(--hover); }
</style>
