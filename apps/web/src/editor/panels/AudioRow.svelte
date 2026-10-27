<script lang="ts">
  /** A track in the Audio panel: play/pause preview, title, artist, length; click (or drag) adds it to the design. */
  import type { EditorState } from '../../lib/editor.svelte.ts';
  import { creditLine, dragItem, insertItem, progress } from '../../lib/content/insert.svelte.ts';
  import { listening, togglePreview } from '../../lib/content/preview.svelte.ts';
  import type { Item } from '../../lib/content/types.ts';
  import { formatTime } from '../../lib/media.ts';
  import Icon from '../../lib/Icon.svelte';

  let { ed, item, card = false }: { ed: EditorState; item: Item; card?: boolean } = $props();
  const playing = $derived(listening.key === item.key);
  const p = $derived(progress[item.key]);
  // a stable colour per track for the cover
  const hue = $derived([...item.key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));
</script>

<div class="track" class:card class:playing role="group" aria-label={item.title} draggable="true" ondragstart={(e) => dragItem(e, item)} title={creditLine(item.credit)} data-key={item.key}>
  <button class="cover" style="--h:{hue}" aria-label="{playing ? 'Pause' : 'Play'} {item.title}" onclick={() => togglePreview(item)}>
    {#if item.thumb}<img src={item.thumb} alt="" loading="lazy" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />{/if}
    <span class="pp">{#if playing && listening.loading}<span class="spin"></span>{:else}<Icon name={playing ? 'pause' : 'play'} size={card ? 22 : 16} />{/if}</span>
  </button>
  <button class="info" onclick={() => insertItem(ed, item)} aria-label="Add audio {item.title}">
    <span class="t">{item.title}</span>
    <span class="s">{item.credit.creator ?? item.credit.source}{#if item.duration}{' · '}{formatTime(item.duration)}{/if}</span>
    {#if playing && item.duration}<span class="pos" style="width:{Math.min(100, (listening.time / item.duration) * 100)}%"></span>{/if}
  </button>
  {#if !card}
    <button class="add" aria-label="Add {item.title} to design" onclick={() => insertItem(ed, item)} disabled={p !== undefined}><Icon name="plus" size={16} /></button>
  {/if}
  {#if p !== undefined}
    <span class="progress" role="progressbar" aria-label="Downloading"><span class="bar" class:indet={p < 0} style="width:{p >= 0 ? Math.max(4, p * 100) : 40}%"></span></span>
  {/if}
</div>

<style>
  .track { position: relative; display: flex; align-items: center; gap: 10px; padding: 6px; border-radius: 8px; }
  .track:hover, .track.playing { background: var(--hover); }
  .cover { position: relative; width: 48px; height: 48px; border-radius: 6px; border: 0; padding: 0; overflow: hidden; flex-shrink: 0; color: #fff;
    background: linear-gradient(135deg, hsl(var(--h) 70% 55%), hsl(calc(var(--h) + 50) 70% 40%)); }
  .cover img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .pp { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(0, 0, 0, .25); }
  .info { flex: 1; min-width: 0; border: 0; background: none; text-align: left; padding: 0; display: flex; flex-direction: column; gap: 2px; position: relative; }
  .t { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .s { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pos { position: absolute; left: 0; bottom: -4px; height: 2px; background: var(--accent); border-radius: 1px; }
  .add { width: 32px; height: 32px; border-radius: 6px; border: 0; background: none; color: var(--ink-2); display: grid; place-items: center; opacity: 0; }
  .track:hover .add, .add:focus-visible { opacity: 1; }
  .add:hover { background: var(--hover); }
  .card { flex-direction: column; align-items: stretch; width: 112px; padding: 0; gap: 6px; }
  .card .cover { width: 112px; height: 112px; border-radius: 8px; }
  .card .info { padding: 0 2px 4px; }
  .progress { position: absolute; left: 6px; right: 6px; bottom: 2px; height: 3px; border-radius: 2px; background: rgba(0, 0, 0, .3); overflow: hidden; }
  .bar { display: block; height: 100%; background: var(--accent); }
  .bar.indet { animation: slide 1s ease-in-out infinite alternate; }
  @keyframes slide { from { transform: translateX(-10%); } to { transform: translateX(160%); } }
  .spin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid rgba(255,255,255,.4); border-top-color: #fff; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
