<script lang="ts">
  /** A sideways row of results that loads when it scrolls into view ("See all" opens the full grid). */
  import type { EditorState } from '../../lib/editor.svelte.ts';
  import { feedFor, type FeedOptions } from '../../lib/content/search.ts';
  import type { Item, Kind } from '../../lib/content/types.ts';
  import { inview } from './actions.ts';
  import AudioRow from './AudioRow.svelte';
  import MediaTile from './MediaTile.svelte';
  import Row from './Row.svelte';

  let { ed, title, kind, query, opts = {}, seeAll, testid, height = 96 }: {
    ed: EditorState; title: string; kind: Kind; query: string; opts?: FeedOptions; seeAll?: () => void; testid?: string; height?: number;
  } = $props();

  let items = $state<Item[]>([]);
  let status = $state<'' | 'loading' | 'error'>('');
  let started = $state(false);

  async function load(): Promise<void> {
    if (started) return;
    started = true;
    status = 'loading';
    try {
      items = (await feedFor(kind, query, opts).next()).slice(0, 16);
      status = '';
    } catch {
      status = 'error';
    }
  }
</script>

<div use:inview={{ fn: load, once: true }}>
  {#if status === 'error' || (status === '' && started && !items.length)}
    <!-- nothing to show: leave the row out, like Canva -->
  {:else}
    <Row {title} {seeAll} {testid}>
      {#if status === 'loading'}
        {#each { length: 4 } as _}<span class="skel" style="width:{kind === 'photo' || kind === 'video' ? height * 1.4 : height}px;height:{height}px"></span>{/each}
      {/if}
      {#each items as item (item.key)}
        {#if kind === 'audio'}
          <AudioRow {ed} {item} card />
        {:else if kind === 'photo' || kind === 'video' || kind === 'illustration'}
          <span class="fit" style="height:{height}px;width:{Math.round(height * Math.max(0.6, Math.min(2, item.width && item.height ? item.width / item.height : 1.4)))}px"><MediaTile {ed} {item} mode="justified" rowHeight={height} /></span>
        {:else}
          <MediaTile {ed} {item} size={height} />
        {/if}
      {/each}
    </Row>
  {/if}
</div>

<style>
  .skel { border-radius: 6px; background: var(--chip); animation: pulse 1.2s ease-in-out infinite alternate; flex-shrink: 0; }
  @keyframes pulse { from { opacity: .5; } to { opacity: 1; } }
  .fit { display: flex; }
  .fit :global(.tile) { flex: 1 1 auto !important; aspect-ratio: auto !important; height: 100%; }
</style>
