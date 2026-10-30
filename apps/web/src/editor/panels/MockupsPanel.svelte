<script lang="ts">
  /**
   * Canva's Mockups app: every product mockup with the page on it, rendered
   * live. Tiles show the mockup's thumbnail first, then the composite once
   * the worker has it; only tiles in view render, and an edit re-renders
   * them after a pause. A click opens the big preview.
   */
  import './panels.css';
  import { onDestroy } from 'svelte';
  import type { Page } from '@digital-canvas/scene';
  import type { EditorState } from '../../lib/editor.svelte.ts';
  import Icon from '../../lib/Icon.svelte';
  import { MOCKUP_CATEGORIES, designPx, mockupClient, mockupLib, paint, sendPage, thumbUrl, type MockupEntry } from '../../lib/mockups/mockups.svelte.ts';
  import MockupPreview from './MockupPreview.svelte';

  let { ed }: { ed: EditorState } = $props();

  /** '' = follow the current page. */
  let pagePick = $state('');
  let category = $state('All');
  let open = $state<number | null>(null);

  $effect(() => { void mockupLib.load(); });

  const pageId = $derived(pagePick && ed.doc.pages.some((p) => p.id === pagePick) ? pagePick : ed.pageId);
  const shown = $derived(category === 'All' ? mockupLib.list : mockupLib.list.filter((m) => m.category === category));
  /** Categories with something in them (plus All). */
  const cats = $derived(['All', ...MOCKUP_CATEGORIES.filter((c) => mockupLib.list.some((m) => m.category === c))]);

  // ---- live rendering ----
  interface Tile { entry: MockupEntry; canvas: HTMLCanvasElement; visible: boolean; done: number; busy: boolean }
  const tiles = new Map<string, Tile>();
  let version = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last: { page: Page | null; w: number; h: number } = { page: null, w: 0, h: 0 };

  function refresh(t: Tile): void {
    if (!t.visible || t.busy || t.done === version || !version) return;
    t.busy = true;
    const v = version;
    mockupClient.render({ entry: t.entry, size: 'small', design: 'grid' }).then((r) => {
      if (!t.canvas.isConnected) return;
      paint(t.canvas, r);
      t.canvas.dataset.rendered = String(v);
      t.canvas.classList.add('on');
    }, (e) => {
      t.canvas.dataset.error = e instanceof Error ? e.message : String(e);
    }).finally(() => {
      t.done = v;
      t.busy = false;
      refresh(t);
    });
  }

  // the page as the grid's design: drawn again after a pause in edits (only when that page changed)
  $effect(() => {
    const page = ed.doc.pages.find((p) => p.id === pageId) ?? ed.page;
    const w = ed.doc.width, h = ed.doc.height;
    if (page === last.page && w === last.w && h === last.h) return;
    const first = !last.page || page.id !== last.page.id;
    last = { page, w, h };
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      sendPage(ed, page.id, 'grid', designPx(ed, 'small'));
      version++;
      for (const t of tiles.values()) refresh(t);
    }, first ? 0 : 450);
  });

  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((list) => {
      for (const e of list) {
        const t = tiles.get((e.target as HTMLElement).dataset.id!);
        if (!t) continue;
        t.visible = e.isIntersecting;
        refresh(t);
      }
    }, { rootMargin: '200px 0px' })
    : null;

  function tile(canvas: HTMLCanvasElement, entry: MockupEntry) {
    const t: Tile = { entry, canvas, visible: !io, done: 0, busy: false };
    tiles.set(entry.id, t);
    canvas.dataset.id = entry.id;
    io?.observe(canvas);
    refresh(t);
    return {
      destroy() {
        io?.unobserve(canvas);
        if (tiles.get(entry.id) === t) tiles.delete(entry.id);
      },
    };
  }

  onDestroy(() => {
    io?.disconnect();
    if (timer) clearTimeout(timer);
  });

  const pageLabel = (i: number) => `Page ${i + 1}`;
</script>

<div class="dp mk" data-testid="mockups-panel">
  <div class="mk-top">
    <label class="mk-page">
      <span>Show</span>
      <select bind:value={pagePick} data-testid="mockup-page" aria-label="Page to show on the mockups">
        <option value="">Current page ({ed.pageIndex + 1})</option>
        {#each ed.doc.pages as p, i (p.id)}<option value={p.id}>{p.name ? `${pageLabel(i)} · ${p.name}` : pageLabel(i)}</option>{/each}
      </select>
    </label>
  </div>
  <div class="dp-chips" role="tablist" aria-label="Mockup categories">
    {#each cats as c (c)}
      <button class="dp-chip" class:on={category === c} role="tab" aria-selected={category === c} data-testid="mockup-cat-{c}" onclick={() => (category = c)}>{c}</button>
    {/each}
  </div>

  {#if mockupLib.status === 'loading' || mockupLib.status === 'idle'}
    <p class="dp-empty" data-testid="mockups-loading"><span class="dp-spin"></span> Mockups are loading…</p>
  {:else if mockupLib.status === 'error'}
    <div class="dp-empty" data-testid="mockups-error">
      <p>Couldn’t load the mockups ({mockupLib.error}).</p>
      <button class="btn" onclick={() => mockupLib.load(true)}>Try again</button>
    </div>
  {:else if mockupLib.status === 'empty'}
    <div class="dp-empty" data-testid="mockups-empty">
      <Icon name="tshirt" size={32} />
      <p>No mockups yet. The mockup library is on its way: check back soon.</p>
      <button class="btn" onclick={() => mockupLib.load(true)}>Check again</button>
    </div>
  {:else}
    <div class="dp-head"><h3>{category === 'All' ? 'All mockups' : category}</h3><span class="dp-link">{shown.length}</span></div>
    <div class="mk-grid" data-testid="mockup-grid">
      {#each shown as e, i (e.id)}
        <button class="mk-tile" title="Preview on {e.label}" data-testid="mockup-{e.id}" data-category={e.category} onclick={() => (open = i)}>
          <span class="mk-pic" style="aspect-ratio:{e.width} / {e.height}">
            <img src={thumbUrl(e)} alt="" loading="lazy" draggable="false" />
            <canvas use:tile={e} data-testid="mockup-canvas-{e.id}" aria-label="{e.label} with your design"></canvas>
          </span>
          <span class="mk-cap">{e.label}</span>
        </button>
      {/each}
    </div>
    <p class="dp-hint">Your page is fitted to each product’s print area. Click a mockup to see it big, change the product colour and download it.</p>
  {/if}
</div>

{#if open !== null && shown[open]}
  <MockupPreview {ed} list={shown} bind:index={open} {pageId} onclose={() => (open = null)} />
{/if}

<style>
  .mk-top { display: flex; gap: 8px; margin: 0 0 10px; }
  .mk-page { display: flex; align-items: center; gap: 8px; flex: 1; font-size: 13px; color: var(--muted); }
  .mk-page select { flex: 1; height: 36px; border-radius: 8px; border: 1px solid var(--line); background: var(--field); color: var(--ink); padding: 0 8px; font: inherit; font-size: 13px; }
  .mk-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-items: start; }
  .mk-tile { display: flex; flex-direction: column; gap: 4px; border: 0; padding: 0; background: none; color: var(--ink); text-align: left; border-radius: 8px; }
  .mk-pic { position: relative; display: block; width: 100%; border-radius: 8px; overflow: hidden; background: var(--chip); }
  .mk-pic img, .mk-pic canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; object-fit: cover; }
  .mk-pic canvas { opacity: 0; transition: opacity .2s; }
  .mk-pic canvas:global(.on) { opacity: 1; }
  .mk-tile:hover .mk-pic, .mk-tile:focus-visible .mk-pic { box-shadow: 0 0 0 2px var(--accent); }
  .mk-cap { font-size: 12px; font-weight: 500; padding: 0 2px 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dp-empty :global(.svgi) { display: block; margin: 0 auto 8px; color: var(--muted); }
  .dp-empty p { margin: 0 0 12px; }
</style>
