<script lang="ts" module>
  import type { FeedOptions } from '../../lib/content/search.ts';
  export interface Topic { label: string; query: string }
  export interface Mode { id: string; label: string; opts: FeedOptions; topics: Topic[] }
</script>

<script lang="ts">
  /**
   * The Photos, Videos and Audio panels: search, topic chips, recently used,
   * and an endless grid (or track list) from the open sources.
   */
  import type { EditorState } from '../../lib/editor.svelte.ts';
  import { notice } from '../../lib/content/insert.svelte.ts';
  import { onRecent, recent } from '../../lib/content/recent.ts';
  import type { Item, Kind, SourceId } from '../../lib/content/types.ts';
  import { stopPreview } from '../../lib/content/preview.svelte.ts';
  import Icon from '../../lib/Icon.svelte';
  import AudioRow from './AudioRow.svelte';
  import ContentGrid from './ContentGrid.svelte';
  import MediaTile from './MediaTile.svelte';
  import Row from './Row.svelte';
  import SearchBox from './SearchBox.svelte';

  let { ed, kind, placeholder, searchTestid, resultsTestid, modes, sources, credits }: {
    ed: EditorState; kind: Kind; placeholder: string; searchTestid: string; resultsTestid: string;
    modes: Mode[]; sources?: { id: SourceId | ''; label: string }[]; credits: string;
  } = $props();

  let query = $state('');
  let searched = $state('');
  let modeId = $state('');
  let topic = $state(0);
  let source = $state<SourceId | ''>('');
  const mode = $derived(modes.find((m) => m.id === modeId) ?? modes[0]!);
  const effective = $derived(searched || mode.topics[topic]?.query || '');
  const opts = $derived<FeedOptions>({ ...mode.opts, ...(source ? { only: source } : {}) });

  let recents = $state<Item[]>([]);
  const load = () => (recents = recent(['content']).map((r) => r.data as Item).filter((i) => i.kind === kind).slice(0, 12));
  load();
  $effect(() => onRecent(load));
  $effect(() => () => stopPreview());

  function search(q: string): void {
    searched = q;
  }
</script>

<div class="panel" data-testid="{kind}-panel">
  <SearchBox bind:value={query} {placeholder} label={placeholder} testid={searchTestid} onsearch={search} onclear={() => search('')} />
  {#if modes.length > 1}
    <div class="modes" role="tablist">
      {#each modes as m}
        <button role="tab" aria-selected={mode.id === m.id} class:on={mode.id === m.id} data-testid="mode-{m.id}" onclick={() => { modeId = m.id; topic = 0; }}>{m.label}</button>
      {/each}
    </div>
  {/if}
  {#if !searched}
    <div class="chips" aria-label="Topics">
      {#each mode.topics as t, i}
        <button class:on={topic === i} onclick={() => (topic = i)} data-testid="topic-{t.label.toLowerCase().replace(/\W+/g, '-')}">{t.label}</button>
      {/each}
    </div>
  {:else}
    <div class="searched">
      <span>Results for “{searched}”</span>
      {#if sources}
        <select class="input" bind:value={source} aria-label="Source" data-testid="{kind}-source">
          {#each sources as s}<option value={s.id}>{s.label}</option>{/each}
        </select>
      {/if}
    </div>
  {/if}
  {#if notice.text}<p class="err" role="alert">{notice.text} <button class="x" aria-label="Dismiss" onclick={() => (notice.text = '')}><Icon name="close" size={12} /></button></p>{/if}

  <div class="pbody scroll-y">
    {#if !searched && recents.length}
      <Row title="Recently used" testid="{kind}-recent">
        {#each recents as item (item.key)}
          {#if kind === 'audio'}<AudioRow {ed} {item} card />{:else}<span class="rt"><MediaTile {ed} {item} mode="justified" rowHeight={80} /></span>{/if}
        {/each}
      </Row>
      <h3>{mode.topics[topic]?.label ?? ''}</h3>
    {/if}
    {#key `${effective}|${JSON.stringify(opts)}`}
      <ContentGrid {ed} {kind} query={effective} {opts} testid={resultsTestid} rowHeight={kind === 'video' ? 76 : 92} />
    {/key}
    <p class="credits">{@html credits}</p>
  </div>
</div>

<style>
  .panel { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .pbody { flex: 1; min-height: 0; margin: 0 -16px; padding: 0 16px 24px; }
  .chips { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; margin: 12px -16px 4px; padding: 0 16px 2px; }
  .chips::-webkit-scrollbar { display: none; }
  .chips button { flex-shrink: 0; border: 1px solid var(--line); background: none; border-radius: 99px; padding: 6px 12px; font-size: 13px; color: var(--ink-2); }
  .chips button:hover { background: var(--hover); }
  .chips button.on { background: var(--ink); color: var(--panel); border-color: var(--ink); }
  .modes { display: flex; gap: 4px; margin-top: 12px; border-bottom: 1px solid var(--line); }
  .modes button { border: 0; background: none; padding: 8px 12px; font-weight: 600; font-size: 13px; color: var(--muted); border-bottom: 2px solid transparent; margin-bottom: -1px; }
  .modes button.on { color: var(--ink); border-bottom-color: var(--accent); }
  .searched { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 12px 0 2px; font-size: 13px; font-weight: 600; }
  .searched span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .searched select { width: auto; height: 30px; font-size: 12px; padding: 0 6px; }
  h3 { margin: 20px 0 4px; font-size: 15px; font-weight: 600; }
  .rt { display: flex; height: 80px; }
  .rt :global(.tile) { aspect-ratio: auto !important; height: 100%; }
  .credits { color: var(--muted); font-size: 11px; line-height: 1.5; margin: 20px 0 0; }
  .credits :global(a) { color: inherit; }
  .err { color: var(--danger); font-size: 12px; margin: 8px 0 0; display: flex; gap: 6px; align-items: start; }
  .x { border: 0; background: none; color: inherit; padding: 2px; }
</style>
