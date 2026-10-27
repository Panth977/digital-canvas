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

<button class="tile {item.kind}" class:vector class:busy={p !== undefined} {style} draggable="true"
  title={creditLine(item.credit)} aria-label="Add {item.kind} {item.title}" data-key={item.key}
  onclick={() => insertItem(ed, item)} ondragstart={(e) => dragItem(e, item)}
  onmouseenter={enter} onmouseleave={() => (hover = false)} onfocus={enter} onblur={() => (hover = false)}>
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

<style>
  .tile { position: relative; padding: 0; border: 0; border-radius: 6px; overflow: hidden; background: var(--chip); display: block; flex-shrink: 0; }
  .tile:hover { outline: 2px solid var(--accent); outline-offset: -2px; }
  .tile img, .tile video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .tile video { position: absolute; inset: 0; }
  .tile.vector { background: transparent; padding: 8px; }
  .tile.vector:hover { background: var(--hover); outline: none; }
  .tile.vector img { object-fit: contain; }
  /* single-colour icons are drawn black: give them a light chip in dark mode */
  .tile.icon { background: #f2f3f5; }
  .tile.icon:hover { background: #e8e9ee; }
  .ph { display: grid; place-items: center; width: 100%; height: 100%; color: var(--muted); }
  .badge { position: absolute; left: 6px; bottom: 6px; background: rgba(0, 0, 0, .6); color: #fff; font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 4px; display: flex; align-items: center; }
  .busy { cursor: progress; }
  .busy img { opacity: .55; }
  .progress { position: absolute; left: 8px; right: 8px; bottom: 8px; height: 5px; border-radius: 3px; background: rgba(0, 0, 0, .45); overflow: hidden; }
  .bar { display: block; height: 100%; background: var(--accent); border-radius: 3px; transition: width .15s; }
  .bar.indet { animation: slide 1s ease-in-out infinite alternate; }
  @keyframes slide { from { transform: translateX(-10%); } to { transform: translateX(160%); } }
</style>
