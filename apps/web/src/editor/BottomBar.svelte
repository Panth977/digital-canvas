<script lang="ts">
  import type { Page } from '@digital-canvas/scene';
  import type { EditorState } from '../lib/editor.svelte.ts';
  import Icon from '../lib/Icon.svelte';
  import { ui } from '../lib/ui.svelte.ts';
  import { view, ZOOM_MIN, ZOOM_MAX, ZOOM_PRESETS } from '../lib/view.svelte.ts';

  /**
   * Canva's bar under the page: Notes on the left; zoom, Pages (thumbnail
   * strip), page counter, grid view, full screen and help on the right.
   */
  let { ed }: { ed: EditorState } = $props();
  const zoom = $derived(view.zoom);

  let help = $state(false);
  let zoomMenu = $state(false);

  // ---- drag pages to reorder them (strip and grid view, like Canva) ----
  let dragId = $state<string | null>(null);
  /** Where the dragged page would land: before page `at` (0..n). */
  let dropAt = $state<number | null>(null);
  function dragStart(e: DragEvent, id: string): void {
    dragId = id;
    e.dataTransfer?.setData('application/x-dc-page', id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }
  function dragOver(e: DragEvent, i: number, axis: 'x' | 'y' | 'grid'): void {
    if (!dragId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = axis === 'y' ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
    dropAt = i + (after ? 1 : 0);
  }
  function drop(e: DragEvent): void {
    e.preventDefault();
    const id = dragId;
    const at = dropAt;
    dragEnd();
    if (!id || at === null) return;
    const from = ed.doc.pages.findIndex((p) => p.id === id);
    const to = at > from ? at - 1 : at;
    if (from >= 0 && to !== from) ed.movePage(id, to - from);
  }
  function dragEnd(): void {
    dragId = null;
    dropAt = null;
  }

  // ---- page thumbnails (strip and grid) ----
  /** Pages are immutable: an unchanged page keeps its object, so its picture is reused. */
  const cache = new Map<string, { page: Page; w: number; h: number; url: string }>();
  let thumbs = $state<Record<string, string>>({});
  const wanted = $derived(ui.pagesStrip || ui.gridView);
  $effect(() => {
    if (!wanted) return;
    const doc = ed.doc;
    void ed.frame;
    let cancelled = false;
    // throttled: wait for a pause in edits, then render one page per task
    const t = setTimeout(async () => {
      const scale = Math.min(1, 360 / Math.max(doc.width, doc.height));
      for (const p of doc.pages) {
        if (cancelled) return;
        const hit = cache.get(p.id);
        if (hit && hit.page === p && hit.w === doc.width && hit.h === doc.height) continue;
        const bytes = ed.exportPage(p.id, 'png', scale);
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));
        if (hit) URL.revokeObjectURL(hit.url);
        cache.set(p.id, { page: p, w: doc.width, h: doc.height, url });
        thumbs = { ...thumbs, [p.id]: url };
        await new Promise((r) => setTimeout(r, 0));
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  });
  $effect(() => () => { for (const c of cache.values()) URL.revokeObjectURL(c.url); });

  const ratio = $derived(ed.doc.width / ed.doc.height);
  function go(id: string): void {
    ed.select([], id);
    ui.gridView = false;
  }
  function fullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  }
  const SHORTCUTS: [string, string][] = [
    ['T', 'Add a text box'], ['R', 'Add a rectangle'], ['C', 'Add a circle'], ['⌘Z / ⇧⌘Z', 'Undo / redo'], ['⌘D', 'Duplicate'], ['⌘G / ⇧⌘G', 'Group / ungroup'],
    ['⌘] / ⌘[', 'Forward / backward'], ['⌘+ / ⌘−', 'Zoom in / out'], ['⌘0 / ⌥⌘0 / ⇧⌘0', 'Zoom to 100% / fit / fill'], ['Page Up / Down', 'Previous / next page'], ['⇧R', 'Rulers'], ['Space + drag', 'Pan'], ['Enter', 'Edit the selected text'], ['Esc', 'Deselect'],
  ];
</script>

<svelte:window onclick={() => { help = false; zoomMenu = false; }} />

{#if ui.gridView}
  <div class="grid scroll-y" data-testid="grid-view">
    {#each ed.doc.pages as p, i (p.id)}
      <button class="gp" class:on={p.id === ed.pageId} class:dragging={dragId === p.id} class:before={dropAt === i && !!dragId} class:after={dropAt === i + 1 && i === ed.doc.pages.length - 1 && !!dragId}
        draggable="true" ondragstart={(e) => dragStart(e, p.id)} ondragover={(e) => dragOver(e, i, 'grid')} ondrop={drop} ondragend={dragEnd}
        onclick={() => go(p.id)} data-testid="grid-page">
        <span class="th" style="aspect-ratio:{ratio}">{#if thumbs[p.id]}<img src={thumbs[p.id]} alt="Page {i + 1}" />{/if}</span>
        <span class="lab">{i + 1}{p.name ? ` - ${p.name}` : ''}</span>
      </button>
    {/each}
    <button class="gp add" onclick={() => { ed.select([], ed.doc.pages[ed.doc.pages.length - 1]!.id); ed.addPage(); ui.gridView = false; }}>
      <span class="th" style="aspect-ratio:{ratio}"><Icon name="plus" size={28} /></span>
      <span class="lab">Add page</span>
    </button>
  </div>
{/if}

{#if ui.pagesStrip}
  <div class="strip" data-testid="pages-strip">
    {#each ed.doc.pages as p, i (p.id)}
      <button class="sp" class:on={p.id === ed.pageId} class:hid={p.hidden} class:dragging={dragId === p.id} class:before={dropAt === i && !!dragId} class:after={dropAt === i + 1 && i === ed.doc.pages.length - 1 && !!dragId}
        draggable="true" ondragstart={(e) => dragStart(e, p.id)} ondragover={(e) => dragOver(e, i, 'x')} ondrop={drop} ondragend={dragEnd} data-testid="strip-page" title="Page {i + 1}{p.name ? ` - ${p.name}` : ''}" onclick={() => go(p.id)} style="aspect-ratio:{ratio}">
        {#if thumbs[p.id]}<img src={thumbs[p.id]} alt="Page {i + 1}" />{/if}
        <span>{i + 1}</span>
      </button>
    {/each}
    <button class="sp add" title="Add page" aria-label="Add page at the end" style="aspect-ratio:{ratio}" onclick={() => { ed.select([], ed.doc.pages[ed.doc.pages.length - 1]!.id); ed.addPage(); }}><Icon name="plus" size={22} /></button>
  </div>
{/if}

<footer class="bar">
  <div class="l">
    <div class="pw">
      <button class="bb" class:on={ui.notes} data-testid="notes-btn" onclick={(e) => { e.stopPropagation(); ui.notes = !ui.notes; }}><Icon name="notes" size={20} /> Notes</button>
      {#if ui.notes}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="pop notes" onclick={(e) => e.stopPropagation()}>
          <b>Notes · Page {ed.pageIndex + 1}</b>
          <textarea class="input" rows="6" placeholder="Add notes to your design" value={ed.page.notes ?? ''} data-testid="notes"
            oninput={(e) => ed.updatePage({ notes: (e.currentTarget as HTMLTextAreaElement).value || undefined }, `notes:${ed.pageId}`)} onchange={() => ed.seal()}></textarea>
        </div>
      {/if}
    </div>
  </div>
  <div class="r">
    <input class="zr" type="range" min={ZOOM_MIN} max={ZOOM_MAX} step="0.01" value={zoom} aria-label="Zoom"
      oninput={(e) => view.zoomTo(Number((e.currentTarget as HTMLInputElement).value))} />
    <div class="pw">
      <button class="bb pct" class:on={zoomMenu} title="Zoom" aria-haspopup="menu" aria-expanded={zoomMenu} data-testid="zoom-btn" onclick={(e) => { e.stopPropagation(); zoomMenu = !zoomMenu; help = false; }}><span data-testid="zoom">{Math.round(zoom * 100)}%</span></button>
      {#if zoomMenu}
        <div class="pop zmenu" role="menu" data-testid="zoom-menu">
          {#each ZOOM_PRESETS as z (z)}
            <button role="menuitemradio" aria-checked={!view.mode && Math.abs(zoom - z) < 0.005} onclick={() => { zoomMenu = false; view.zoomTo(z); }}>{Math.round(z * 100)}%</button>
          {/each}
          <hr />
          <button role="menuitemradio" aria-checked={view.mode === 'fit'} data-testid="zoom-fit" onclick={() => { zoomMenu = false; view.fit('fit'); }}>Fit</button>
          <button role="menuitemradio" aria-checked={view.mode === 'fill'} data-testid="zoom-fill" onclick={() => { zoomMenu = false; view.fit('fill'); }}>Fill</button>
        </div>
      {/if}
    </div>
    <button class="bb" class:on={ui.pagesStrip} data-testid="pages-btn" onclick={() => { ui.pagesStrip = !ui.pagesStrip; ui.gridView = false; }}><Icon name="pages" size={20} /> Pages</button>
    <button class="bb" title="Page {ed.pageIndex + 1} of {ed.doc.pages.length}" data-testid="page-counter" onclick={() => (ui.gridView = !ui.gridView)}>{ed.pageIndex + 1} / {ed.doc.pages.length}</button>
    <button class="bb icon" class:on={ui.gridView} title="Grid view" aria-label="Grid view" data-testid="grid-btn" onclick={() => { ui.gridView = !ui.gridView; ui.pagesStrip = false; }}><Icon name="gridview" size={20} /></button>
    <button class="bb icon" title="Full screen" aria-label="Full screen" onclick={fullscreen}><Icon name="expand" size={20} /></button>
    <div class="pw">
      <button class="bb icon" class:on={help} title="Help" aria-label="Help" data-testid="help-btn" onclick={(e) => { e.stopPropagation(); help = !help; }}><Icon name="help" size={20} /></button>
      {#if help}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="pop help" onclick={(e) => e.stopPropagation()}>
          <b>Keyboard shortcuts</b>
          <dl>{#each SHORTCUTS as [k, v]}<dt>{k}</dt><dd>{v}</dd>{/each}</dl>
        </div>
      {/if}
    </div>
  </div>
</footer>

<style>
  .bar { height: 48px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; color: var(--bar-ink); font-size: 14px; font-weight: 600; }
  .l, .r { display: flex; align-items: center; gap: 4px; }
  .bb { height: 36px; display: inline-flex; align-items: center; gap: 6px; padding: 0 10px; border: 0; background: none; border-radius: 10px; color: inherit; font-weight: 600; white-space: nowrap; }
  .bb.icon { width: 36px; padding: 0; justify-content: center; }
  .bb:hover, .bb.on { background: var(--hover); color: var(--ink); }
  .pct { min-width: 56px; justify-content: center; font-variant-numeric: tabular-nums; }
  .zmenu { right: 0; width: 140px; padding: 6px; gap: 0; }
  .zmenu button { height: 34px; border: 0; border-radius: 6px; background: none; color: inherit; font: inherit; font-weight: 400; text-align: left; padding: 0 12px; }
  .zmenu button:hover { background: var(--hover); }
  .zmenu button[aria-checked='true'] { font-weight: 700; color: var(--accent); }
  .zmenu hr { width: 100%; margin: 4px 0; border: 0; border-top: 1px solid var(--line); }
  .dragging { opacity: .4; }
  .sp.before { box-shadow: -6px 0 0 -2px var(--accent); }
  .sp.after { box-shadow: 6px 0 0 -2px var(--accent); }
  .gp.before .th { box-shadow: -14px 0 0 -10px var(--accent); }
  .gp.after .th { box-shadow: 14px 0 0 -10px var(--accent); }
  .zr { width: 160px; accent-color: var(--ink); margin-right: 4px; }
  .pw { position: relative; }
  .pop { position: absolute; bottom: 44px; z-index: 40; background: var(--pop); color: var(--ink); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow); padding: 14px; display: flex; flex-direction: column; gap: 10px; font-weight: 400; }
  .notes { left: 0; width: 340px; }
  .notes textarea { height: auto; padding: 8px; resize: vertical; }
  .help { right: 0; width: 320px; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0; font-size: 13px; }
  dt { font-weight: 600; color: var(--ink-2); }
  dd { margin: 0; color: var(--muted); }
  .strip { flex-shrink: 0; height: 112px; display: flex; align-items: center; gap: 10px; padding: 8px 16px; overflow-x: auto; scrollbar-width: thin; border-top: 1px solid var(--line); }
  .sp { position: relative; height: 80px; flex-shrink: 0; padding: 0; border: 2px solid transparent; border-radius: 8px; background: #fff; background-clip: padding-box; overflow: hidden; box-shadow: var(--page-shadow); }
  .sp.on { border-color: var(--accent); }
  .sp.hid { opacity: .45; }
  .sp img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .sp span { position: absolute; left: 4px; bottom: 4px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 4px; background: rgba(0,0,0,.6); color: #fff; font-size: 11px; display: grid; place-items: center; }
  .sp.add { background: var(--chip); color: var(--ink-2); display: grid; place-items: center; }
  .grid { position: absolute; inset: 64px 0 48px 0; z-index: 25; background: var(--stage); display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 24px; padding: 24px 32px; align-content: start; }
  .gp { display: flex; flex-direction: column; align-items: center; gap: 8px; border: 0; background: none; padding: 0; color: var(--bar-ink); font-weight: 600; }
  .gp .th { width: 100%; max-height: 220px; display: grid; place-items: center; background: #fff; background-clip: padding-box; border-radius: 6px; border: 3px solid transparent; overflow: hidden; box-shadow: var(--page-shadow); }
  .gp.on .th { border-color: var(--accent); }
  .gp:hover .th { border-color: var(--line); }
  .gp.on:hover .th { border-color: var(--accent); }
  .gp .th img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .gp.add .th { background: var(--chip); color: var(--ink-2); }
  .lab { font-size: 13px; }
</style>
