<script lang="ts">
  import './panels.css';
  import type { Doc } from '@digital-canvas/scene';
  import type { ProjectMeta } from '@digital-canvas/storage';
  import type { EditorState } from '../../lib/editor.svelte.ts';
  import Icon from '../../lib/Icon.svelte';
  import { library } from '../../lib/library.svelte.ts';
  import { objectUrl } from '../../lib/files.ts';
  import { TEMPLATES, TEMPLATE_CATEGORIES, byFit, insertDesign, loadTemplate, pageIsEmpty, searchTemplates, thumbUrl, type InsertMode, type TemplateEntry } from '../../lib/templates.ts';
  import InsertDialog from './InsertDialog.svelte';

  let { ed }: { ed: EditorState } = $props();

  let query = $state('');
  let category = $state('All');
  let busy = $state<string | null>(null);
  let error = $state('');
  let pending = $state.raw<{ title: string; pages: number; doc: Doc; assets: Map<string, Uint8Array> } | null>(null);

  const results = $derived(byFit(searchTemplates(query, category), ed.doc.width, ed.doc.height));
  /** Same shape as the open design: shown first, like Canva's "for this design". */
  const fitting = $derived(TEMPLATES.filter((t) => Math.abs(Math.log(t.width / t.height / (ed.doc.width / ed.doc.height))) < 0.05));
  const browsing = $derived(!query.trim() && category === 'All');

  // ---- your designs ----
  let mine = $state<ProjectMeta[]>([]);
  let mineState = $state<'' | 'loading' | 'error'>('loading');
  $effect(() => {
    const store = library.store;
    mineState = 'loading';
    store.list().then((l) => { mine = l.filter((p) => p.id !== ed.doc.id); mineState = ''; }, () => (mineState = 'error'));
  });
  const thumbOf = (p: ProjectMeta) => (p.thumbnail ? objectUrl(p.thumbnail) : p.thumbnailUrl ?? '');

  async function run(doc: Doc, assets: Map<string, Uint8Array>, title: string, mode?: InsertMode): Promise<void> {
    if (!mode && !pageIsEmpty(ed)) {
      pending = { title, pages: doc.pages.length, doc, assets };
      return;
    }
    busy = title;
    error = '';
    try {
      await insertDesign(ed, doc, mode ?? 'replace', assets);
    } catch (e) {
      error = `Couldn’t use “${title}”: ${e instanceof Error ? e.message : e}`;
    } finally {
      busy = null;
    }
  }

  async function useTemplate(t: TemplateEntry): Promise<void> {
    busy = t.title;
    try {
      const doc = await loadTemplate(t.id);
      busy = null;
      await run(doc, new Map(), t.title);
    } catch (e) {
      busy = null;
      error = `Couldn’t open the template: ${e instanceof Error ? e.message : e}`;
    }
  }

  async function useDesign(p: ProjectMeta): Promise<void> {
    busy = p.title;
    try {
      const file = await library.store.open(p.id);
      busy = null;
      await run(file.doc, file.assets, p.title);
    } catch (e) {
      busy = null;
      error = `Couldn’t open “${p.title}”: ${e instanceof Error ? e.message : e}`;
    }
  }

  function pick(mode: InsertMode): void {
    const p = pending;
    pending = null;
    if (p) void run(p.doc, p.assets, p.title, mode);
  }

  const ratio = (t: TemplateEntry) => `${t.width} / ${t.height}`;
</script>

<div class="dp" data-testid="templates-panel">
  <form class="dp-search" onsubmit={(e) => e.preventDefault()}>
    <Icon name="search" size={18} />
    <input placeholder="Search templates" bind:value={query} data-testid="template-search" aria-label="Search templates" />
    {#if query}<button type="button" class="dp-x" aria-label="Clear search" onclick={() => (query = '')}><Icon name="close" size={14} /></button>{/if}
  </form>
  <div class="dp-chips" role="tablist" aria-label="Template categories">
    {#each ['All', ...TEMPLATE_CATEGORIES] as c (c)}
      <button class="dp-chip" class:on={category === c} role="tab" aria-selected={category === c} data-testid="tpl-cat-{c}" onclick={() => (category = c)}>{c}</button>
    {/each}
  </div>
  {#if busy}<p class="dp-hint"><span class="dp-spin"></span> Adding “{busy}”…</p>{/if}
  {#if error}<p class="dp-err">{error}</p>{/if}

  {#if browsing}
    {#if fitting.length}
      <div class="dp-head"><h3>For this design</h3></div>
      <div class="dp-strip">
        {#each fitting as t (t.id)}
          <button class="dp-card" title={t.title} onclick={() => useTemplate(t)} data-testid="tpl-fit-{t.id}">
            <img src={thumbUrl(t.id)} alt={t.title} loading="lazy" style="aspect-ratio:{ratio(t)}" />
          </button>
        {/each}
      </div>
    {/if}
    <div class="dp-head"><h3>Your designs</h3>{#if mine.length > 6}<span class="dp-link">{mine.length}</span>{/if}</div>
    {#if mineState === 'loading'}<p class="dp-hint"><span class="dp-spin"></span> Loading your designs…</p>
    {:else if mineState === 'error'}<p class="dp-err">Couldn’t list your designs.</p>
    {:else if !mine.length}<p class="dp-hint">Designs you make show up here, so you can reuse any of them as a template.</p>
    {:else}
      <div class="dp-strip" data-testid="your-designs">
        {#each mine as p (p.id)}
          <button class="dp-card" title="Use {p.title}" onclick={() => useDesign(p)} data-testid="your-design-{p.id}">
            {#if thumbOf(p)}<img src={thumbOf(p)} alt={p.title} loading="lazy" />{:else}<span class="dp-cap" style="height:120px;display:grid;place-items:center">{p.title}</span>{/if}
          </button>
        {/each}
      </div>
    {/if}
    {#each TEMPLATE_CATEGORIES as c (c)}
      {@const list = TEMPLATES.filter((t) => t.category === c)}
      <div class="dp-head"><h3>{c}</h3><button class="dp-link" onclick={() => (category = c)} data-testid="tpl-seeall-{c}">See all</button></div>
      <div class="dp-strip">
        {#each list as t (t.id)}
          <button class="dp-card" title={t.title} onclick={() => useTemplate(t)} data-testid="tpl-{t.id}">
            <img src={thumbUrl(t.id)} alt={t.title} loading="lazy" style="aspect-ratio:{ratio(t)}" />
            {#if t.pages > 1}<span class="dp-badge">{t.pages} pages</span>{/if}
          </button>
        {/each}
      </div>
    {/each}
  {:else}
    {#if !results.length}
      <p class="dp-empty">No templates match “{query}”{category !== 'All' ? ` in ${category}` : ''}.</p>
    {:else}
      <div class="dp-head"><h3>{category === 'All' ? 'Templates' : category}</h3><span class="dp-link">{results.length}</span></div>
      <div class="dp-cols" data-testid="template-results">
        {#each results as t (t.id)}
          <button class="dp-card" title={t.title} onclick={() => useTemplate(t)} data-testid="tpl-{t.id}">
            <img src={thumbUrl(t.id)} alt={t.title} loading="lazy" style="aspect-ratio:{ratio(t)}" />
            {#if t.pages > 1}<span class="dp-badge">{t.pages} pages</span>{/if}
            <span class="dp-cap">{t.title}</span>
          </button>
        {/each}
      </div>
    {/if}
  {/if}
  <p class="dp-hint">Templates use free Google Fonts and open-licensed icons (Fluent Emoji, MIT). They resize to your page.</p>
</div>

{#if pending}
  <InsertDialog title={pending.title} pages={pending.pages} onpick={pick} oncancel={() => (pending = null)} />
{/if}
