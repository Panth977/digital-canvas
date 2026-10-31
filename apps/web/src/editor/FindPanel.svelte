<script lang="ts">
  /**
   * Find and replace text across all pages (⌘F): text boxes, groups, table
   * cells. Going to a match opens its page and selects it. Replace all is one
   * undo step.
   */
  import { onMount } from 'svelte';
  import { findMatches, replaceMatches, type FindMatch } from '@digital-canvas/scene';
  import type { EditorState } from '../lib/editor.svelte.ts';
  import { view } from '../lib/view.svelte.ts';
  import Icon from '../lib/Icon.svelte';

  let { ed }: { ed: EditorState } = $props();

  let query = $state('');
  let replacement = $state('');
  let matchCase = $state(false);
  let wholeWord = $state(false);
  let index = $state(0);
  let done = $state('');
  let input = $state<HTMLInputElement>();
  const opts = $derived({ matchCase, wholeWord });
  const matches = $derived(findMatches(ed.doc, query, opts));
  const current = $derived(matches[Math.min(index, matches.length - 1)]);
  const pageNo = (m: FindMatch) => ed.doc.pages.findIndex((p) => p.id === m.pageId) + 1;

  onMount(() => input?.focus());

  function go(i: number): void {
    if (!matches.length) return;
    index = (i + matches.length) % matches.length;
    done = '';
    const m = matches[index]!;
    ed.select([m.elementId], m.pageId);
    view.goToPage(pageNo(m) - 1);
  }

  /** One undo step, boxes re-measured inside it. */
  function apply(doc: typeof ed.doc): void {
    ed.seal();
    ed.commit(doc, 'find');
    ed.refitText('find');
    ed.seal();
  }
  function replaceOne(): void {
    if (!current) return;
    const r = replaceMatches(ed.doc, query, replacement, opts, current);
    if (!r.count) return;
    apply(r.doc);
    done = 'Replaced 1';
    // stay at this spot: the list has just moved up
    index = Math.min(index, Math.max(0, matches.length - 1));
    if (matches.length) go(index);
  }
  function replaceAll(): void {
    const r = replaceMatches(ed.doc, query, replacement, opts);
    if (!r.count) return;
    apply(r.doc);
    index = 0;
    done = `Replaced ${r.count}`;
  }
  function key(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? index - 1 : index + 1); }
  }
</script>

<div class="fp" data-testid="find-panel">
  <input bind:this={input} class="input" placeholder="Find text" aria-label="Find" bind:value={query} data-testid="find-query" onkeydown={key} oninput={() => { index = 0; done = ''; }} />
  <input class="input" placeholder="Replace with" aria-label="Replace with" bind:value={replacement} data-testid="find-replace" onkeydown={(e) => e.stopPropagation()} />
  <div class="opts">
    <label><input type="checkbox" bind:checked={matchCase} data-testid="find-case" /> Match case</label>
    <label><input type="checkbox" bind:checked={wholeWord} data-testid="find-word" /> Whole word</label>
  </div>
  <div class="row">
    <span class="count" data-testid="find-count" role="status">{query ? `${matches.length ? `${Math.min(index, matches.length - 1) + 1} of ` : ''}${matches.length} ${matches.length === 1 ? 'match' : 'matches'}` : ''}</span>
    <button class="btn icon" aria-label="Previous match" disabled={!matches.length} data-testid="find-prev" onclick={() => go(index - 1)}><Icon name="up" size={16} /></button>
    <button class="btn icon" aria-label="Next match" disabled={!matches.length} data-testid="find-next" onclick={() => go(index + 1)}><Icon name="down" size={16} /></button>
  </div>
  <div class="row">
    <button class="btn" disabled={!matches.length} data-testid="find-replace-one" onclick={replaceOne}>Replace</button>
    <button class="btn primary" disabled={!matches.length} data-testid="find-replace-all" onclick={replaceAll}>Replace all</button>
  </div>
  {#if done}<p class="hint" data-testid="find-done">{done}</p>{/if}
  <div class="list" data-testid="find-list">
    {#each matches.slice(0, 200) as m, i (`${m.elementId}:${m.cell?.join() ?? ''}:${m.start}`)}
      <button class:on={i === index} data-testid="find-item" onclick={() => go(i)}>
        <small>Page {pageNo(m)}</small>
        <span>{m.before}<mark>{m.match}</mark>{m.after}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .fp { display: flex; flex-direction: column; gap: 8px; }
  .fp .input { width: 100%; height: 36px; padding: 0 10px; box-sizing: border-box; }
  .opts { display: flex; gap: 14px; font-size: 13px; }
  .opts label { display: flex; align-items: center; gap: 6px; }
  .row { display: flex; align-items: center; gap: 6px; }
  .row .btn:not(.icon) { flex: 1; justify-content: center; }
  .count { flex: 1; font-size: 13px; color: var(--muted); }
  .hint { margin: 0; font-size: 12px; color: var(--muted); }
  .list { display: flex; flex-direction: column; gap: 2px; }
  .list button { display: flex; flex-direction: column; gap: 2px; text-align: left; border: 0; background: none; border-radius: 6px; padding: 6px 8px; font-size: 13px; color: var(--ink-2); }
  .list button:hover { background: var(--hover); }
  .list button.on { background: var(--chip); }
  .list small { color: var(--muted); font-size: 11px; }
  .list span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  mark { background: #ffe58a; color: #1a1a1a; border-radius: 2px; }
</style>
