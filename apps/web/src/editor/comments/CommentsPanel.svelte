<script lang="ts">
  import Icon from '../../lib/Icon.svelte';
  import type { CommentsState } from '../../lib/comments.svelte.ts';
  import CommentThread from './CommentThread.svelte';

  /** Every thread of the design, in reading order (Canva's comments panel). Click one to go to it. */
  let { cs }: { cs: CommentsState } = $props();
  const nums = $derived(cs.numbers);
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside class="panel" data-testid="comments-panel" onkeydown={(e) => e.stopPropagation()}>
  <header>
    <b>Comments</b>
    <span class="count">{cs.open.length} open{cs.pending ? ' · syncing…' : ''}</span>
    <span class="grow"></span>
    <button class="ib" title="Refresh" aria-label="Refresh" onclick={() => void cs.refresh()}><Icon name="rotate" size={16} /></button>
    <button class="ib" title="Close" aria-label="Close comments" onclick={() => (cs.panelOpen = false)} data-testid="comments-close"><Icon name="close" size={18} /></button>
  </header>
  <div class="tools">
    <div class="seg" role="tablist">
      {#each [['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']] as [v, l] (v)}
        <button role="tab" aria-selected={cs.filter === v} class:on={cs.filter === v} onclick={() => (cs.filter = v as typeof cs.filter)} data-testid="comments-filter-{v}">{l}</button>
      {/each}
    </div>
    {#if cs.canComment}
      <button class="add" onclick={() => cs.togglePlacing()} class:on={cs.placing} data-testid="comment-add" title="Click on the design to place a comment (⇧C)"><Icon name="plus" size={16} /> {cs.placing ? 'Click the design…' : 'Add comment'}</button>
    {/if}
  </div>
  {#if cs.error}<p class="err">{cs.error}</p>{/if}
  <div class="list">
    {#each cs.shown as c (c.id)}
      <div class="item" class:active={cs.active === c.id} role="button" tabindex="0" onclick={() => cs.focus(c.id)} onkeydown={(e) => { if (e.key === 'Enter') cs.focus(c.id); }} data-testid="comments-item">
        <CommentThread {cs} comment={c} n={nums.get(c.id) ?? 0} compact />
      </div>
    {:else}
      <p class="empty">{!cs.loaded ? 'Loading…' : cs.filter === 'resolved' ? 'No resolved comments.' : cs.filter === 'open' ? 'No open comments.' : 'No comments yet.'}{#if cs.loaded && cs.canComment && cs.filter !== 'resolved'}<br />Select an element and press Comment, or click "Add comment" and then the design.{/if}</p>
    {/each}
  </div>
</aside>

<style>
  .panel { width: 340px; flex-shrink: 0; display: flex; flex-direction: column; min-height: 0; background: var(--panel); color: var(--ink); border-left: 1px solid var(--line); }
  header { display: flex; align-items: center; gap: 8px; padding: 12px 12px 6px 16px; }
  .count { color: var(--muted); font-size: 12px; }
  .grow { flex: 1; }
  .ib { width: 30px; height: 30px; border: 0; border-radius: 8px; background: transparent; color: var(--ink-2); display: inline-flex; align-items: center; justify-content: center; }
  .ib:hover { background: var(--hover); }
  .tools { display: flex; flex-direction: column; gap: 8px; padding: 6px 16px 10px; }
  .seg { display: flex; background: var(--chip); border-radius: 8px; padding: 2px; }
  .seg button { flex: 1; height: 28px; border: 0; border-radius: 6px; background: transparent; color: var(--ink-2); font-size: 12px; font-weight: 600; }
  .seg button.on { background: var(--pop); color: var(--ink); box-shadow: 0 1px 2px rgba(0,0,0,.15); }
  .add { height: 34px; border: 1px dashed var(--line); border-radius: 8px; background: transparent; color: var(--ink); font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
  .add.on { border-style: solid; border-color: var(--accent); color: var(--accent); }
  .list { flex: 1; overflow: auto; padding: 0 12px 16px; display: flex; flex-direction: column; gap: 8px; }
  .item { border-radius: 12px; border: 1px solid var(--line); cursor: pointer; }
  .item:hover { border-color: var(--ink-2); }
  .item.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .item :global(.thread) { border: 0; background: transparent; }
  .empty { color: var(--muted); font-size: 13px; text-align: center; padding: 24px 8px; line-height: 1.5; }
  .err { color: var(--danger); font-size: 12px; padding: 0 16px; }
</style>
