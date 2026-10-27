<script lang="ts">
  /** Results from the open sources for a kind and search words, loading more as you scroll (Canva's grids). */
  import { untrack } from 'svelte';
  import type { EditorState } from '../../lib/editor.svelte.ts';
  import { feedFor, SOURCE_LABEL, type Feed, type FeedOptions } from '../../lib/content/search.ts';
  import type { Item, Kind } from '../../lib/content/types.ts';
  import { inview } from './actions.ts';
  import AudioRow from './AudioRow.svelte';
  import MediaTile from './MediaTile.svelte';

  let { ed, kind, query, opts = {}, testid, rowHeight = 96, cols = 4 }: {
    ed: EditorState; kind: Kind; query: string; opts?: FeedOptions; testid?: string; rowHeight?: number; cols?: number;
  } = $props();

  let items = $state<Item[]>([]);
  let status = $state<'idle' | 'loading' | 'error' | 'done'>('idle');
  let error = $state('');
  let failed = $state<string[]>([]);
  let feed: Feed | null = null;

  const layout = $derived(kind === 'audio' ? 'list' : kind === 'photo' || kind === 'video' || kind === 'illustration' ? 'justified' : 'squares');

  $effect(() => {
    void kind; void query; void JSON.stringify(opts);
    untrack(reset);
  });

  function reset(): void {
    feed = feedFor(kind, query, opts);
    items = [];
    status = 'idle';
    failed = [];
    void more();
  }

  async function more(): Promise<void> {
    const f = feed;
    if (!f || status === 'loading' || status === 'done') return;
    status = 'loading';
    try {
      const got = await f.next();
      if (f !== feed) return;
      items = [...items, ...got];
      failed = f.failed.map((s) => SOURCE_LABEL[s]);
      status = f.done ? 'done' : 'idle';
    } catch (e) {
      if (f !== feed) return;
      error = e instanceof Error ? e.message : String(e);
      status = 'error';
    }
  }
</script>

<div class="grid {layout}" style="--cols:{cols}" data-testid={testid} data-count={items.length}>
  {#each items as item (item.key)}
    {#if layout === 'list'}
      <AudioRow {ed} {item} />
    {:else if layout === 'justified'}
      <MediaTile {ed} {item} mode="justified" {rowHeight} />
    {:else}
      <MediaTile {ed} {item} mode="square" size={0} />
    {/if}
  {/each}
  {#if layout === 'justified'}<span class="filler"></span>{/if}
</div>

{#if status === 'loading'}
  <div class="loading" aria-live="polite"><span class="spin"></span> Loading…</div>
{:else if status === 'error' && !items.length}
  <p class="msg">Couldn't reach the library ({error}). <button class="link" onclick={reset}>Try again</button></p>
{:else if status === 'error'}
  <p class="msg"><button class="link" onclick={() => { status = 'idle'; void more(); }}>Load more</button></p>
{:else if status === 'done' && !items.length}
  <p class="msg">No results{query ? ` for “${query}”` : ''}. Try other words.</p>
{/if}
{#if failed.length && items.length}<p class="msg small">{failed.join(', ')} didn't answer; showing the rest.</p>{/if}
{#if status === 'idle'}
  {#key items.length}<div class="sentinel" use:inview={{ fn: more, once: true }}></div>{/key}
{/if}

<style>
  .grid { margin-top: 8px; }
  .squares { display: grid; grid-template-columns: repeat(var(--cols), 1fr); gap: 6px; }
  .squares :global(.tile) { width: 100% !important; height: auto !important; aspect-ratio: 1; }
  .justified { display: flex; flex-wrap: wrap; gap: 6px; }
  .filler { flex-grow: 1000; }
  .list { display: flex; flex-direction: column; gap: 2px; }
  .loading { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 18px 0; color: var(--muted); font-size: 13px; }
  .spin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--line); border-top-color: var(--accent); animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .msg { color: var(--muted); font-size: 13px; text-align: center; margin: 16px 0; }
  .msg.small { font-size: 11px; margin: 8px 0; }
  .link { border: 0; background: none; color: var(--accent); font-weight: 600; padding: 0; }
  .sentinel { height: 1px; }
</style>
