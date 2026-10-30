<script lang="ts">
  /**
   * One result tile (graphic, sticker, icon, photo, video): click adds it,
   * drag drops it on the page. Videos play a small preview on hover (Canva)
   * and show their length; downloads show progress on the tile.
   */
  import type { EditorState } from '../../lib/editor.svelte.ts';
  import { creditLine, dragItem, insertItem, progress } from '../../lib/content/insert.svelte.ts';
  import { resolveNasa } from '../../lib/content/nasa.ts';
  import type { Item } from '../../lib/content/types.ts';
  import { formatTime } from '../../lib/media.ts';
  import Icon from '../../lib/Icon.svelte';

  let { ed, item, mode = 'square', size = 96, rowHeight = 96 }: { ed: EditorState; item: Item; mode?: 'square' | 'justified'; size?: number; rowHeight?: number } = $props();

  const ratio = $derived(item.width && item.height ? Math.max(0.5, Math.min(2.4, item.width / item.height)) : item.kind === 'video' ? 16 / 9 : 1.4);
  const style = $derived(mode === 'justified' ? `flex: ${ratio} 1 ${Math.round(ratio * rowHeight)}px; aspect-ratio: ${ratio};` : `width:${size}px;height:${size}px;`);
  const vector = $derived(!!item.icon);
  const p = $derived(progress[item.key]);

  let hover = $state(false);
  /** Canva's "…" on a hovered tile: add, set as background, who made it. */
  let menu = $state(false);
  async function asBackground(): Promise<void> {
    menu = false;
    const before = ed.selection;
    if (await insertItem(ed, item)) { if (ed.selection.join() !== before.join()) ed.setAsBackground(); }
  }
  /** Drag ghost: the picture itself, not the whole tile. */
  function start(e: DragEvent): void {
    dragItem(e, item);
    const img = (e.currentTarget as HTMLElement).querySelector('img');
    if (img && e.dataTransfer && img.complete) e.dataTransfer.setDragImage(img, img.clientWidth / 2, img.clientHeight / 2);
  }
  let previewSrc = $state<string | undefined>(undefined);
  let failed = $state(false);

  async function enter(): Promise<void> {
    hover = true;
    if (item.kind !== 'video' || previewSrc) return;
    if (item.preview) previewSrc = item.preview;
    else if (item.source === 'nasa') {
      try { previewSrc = (await resolveNasa(item)).preview; } catch { /* no preview */ }
    }
  }
</script>

<svelte:window onpointerdown={(e) => { if (menu && !(e.target as HTMLElement).closest?.('.tmenu, .dots')) menu = false; }} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="tile {item.kind}" class:vector class:busy={p !== undefined} class:open={menu} {style} data-key={item.key} onmouseenter={enter} onmouseleave={() => (hover = false)}>
<button class="hit" draggable="true"
  title={creditLine(item.credit)} aria-label="Add {item.kind} {item.title}"
  onclick={() => insertItem(ed, item)} ondragstart={start}
  onfocus={enter} onblur={() => (hover = false)}>
  {#if item.thumb && !failed}
    <img src={item.thumb} alt={item.title} loading="lazy" draggable="false" onerror={() => (failed = true)} />
  {:else}
    <span class="ph"><Icon name={item.kind === 'video' ? 'video' : item.kind === 'audio' ? 'music' : 'image'} size={22} /></span>
  {/if}
  {#if item.kind === 'video' && hover && previewSrc}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video src={previewSrc} autoplay muted loop playsinline preload="auto"></video>
  {/if}
  {#if item.kind === 'video'}
    <span class="badge">{#if item.duration}{formatTime(item.duration)}{:else}<Icon name="video" size={12} />{/if}</span>
  {/if}
  {#if p !== undefined}
    <span class="progress" role="progressbar" aria-label="Downloading" aria-valuenow={p >= 0 ? Math.round(p * 100) : undefined}>
      <span class="bar" class:indet={p < 0} style="width:{p >= 0 ? Math.max(4, p * 100) : 40}%"></span>
    </span>
  {/if}
</button>
<span class="dots" role="button" tabindex="0" aria-label="More options for {item.title}" aria-expanded={menu} data-testid="tile-more"
  onclick={(e) => { e.stopPropagation(); menu = !menu; }} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); menu = !menu; } }}><Icon name="more" size={16} /></span>
{#if menu}
  <div class="tmenu" role="menu" data-testid="tile-menu">
    <button role="menuitem" onclick={() => { menu = false; void insertItem(ed, item); }}><Icon name="plus" size={15} /> Add to page</button>
    {#if item.kind === 'photo' || item.kind === 'illustration'}
      <button role="menuitem" data-testid="tile-bg" onclick={asBackground}><Icon name="image" size={15} /> Set as background</button>
    {/if}
    <div class="credit"><b>{item.title || 'Untitled'}</b><span>{item.credit.creator ? `by ${item.credit.creator} · ` : ''}{item.credit.license} · {item.credit.source}</span></div>
    {#if item.credit.page}<a role="menuitem" href={item.credit.page} target="_blank" rel="noreferrer">View on {item.credit.source}</a>{/if}
  </div>
{/if}
</div>

<style>
  .tile { position: relative; flex-shrink: 0; border-radius: 6px; background: var(--chip); }
  .hit { position: relative; display: block; width: 100%; height: 100%; padding: 0; border: 0; border-radius: 6px; overflow: hidden; background: none; color: inherit; }
  .tile:hover { outline: 2px solid var(--accent); outline-offset: -2px; }
  .hit img, .hit video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .hit video { position: absolute; inset: 0; }
  .tile.vector { background: transparent; }
  .tile.vector .hit { padding: 8px; }
  .tile.vector:hover { background: var(--hover); outline: none; }
  .tile.vector img { object-fit: contain; }
  /* single-colour icons are drawn black: give them a light chip in dark mode */
  .tile.icon { background: #f2f3f5; }
  .tile.icon:hover { background: #e8e9ee; }
  /* line art is drawn black too: same light chip, and show the whole drawing */
  .tile.illustration { background: #f2f3f5; }
  .tile.illustration img { object-fit: contain; }
  .ph { display: grid; place-items: center; width: 100%; height: 100%; color: var(--muted); }
  .badge { position: absolute; left: 6px; bottom: 6px; background: rgba(0, 0, 0, .6); color: #fff; font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 4px; display: flex; align-items: center; }
  .busy { cursor: progress; }
  .busy img { opacity: .55; }
  .progress { position: absolute; left: 8px; right: 8px; bottom: 8px; height: 5px; border-radius: 3px; background: rgba(0, 0, 0, .45); overflow: hidden; }
  .bar { display: block; height: 100%; background: var(--accent); border-radius: 3px; transition: width .15s; }
  .bar.indet { animation: slide 1s ease-in-out infinite alternate; }
  @keyframes slide { from { transform: translateX(-10%); } to { transform: translateX(160%); } }
  .dots { position: absolute; top: 4px; right: 4px; width: 26px; height: 22px; display: none; place-items: center; border-radius: 5px; background: rgba(255,255,255,.92); color: #0d1216; box-shadow: 0 1px 3px rgba(0,0,0,.3); cursor: pointer; }
  .tile:hover .dots, .tile:focus-within .dots, .tile.open .dots { display: grid; }
  .tmenu { position: absolute; top: 30px; right: 0; z-index: 20; width: 220px; padding: 6px; display: flex; flex-direction: column; background: var(--pop); color: var(--ink); border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--shadow); text-align: left; }
  .tmenu button, .tmenu a { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 8px; border: 0; background: none; border-radius: 6px; color: inherit; font-size: 13px; text-decoration: none; }
  .tmenu button:hover, .tmenu a:hover { background: var(--hover); }
  .credit { display: flex; flex-direction: column; gap: 2px; padding: 8px; margin-top: 4px; border-top: 1px solid var(--line); font-size: 12px; }
  .credit b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .credit span { color: var(--muted); }
</style>
