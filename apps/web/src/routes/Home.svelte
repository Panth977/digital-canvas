<script lang="ts">
  import { PRESET_CATEGORIES, PRESETS, createDoc, formatLength, newId, searchPresets, walk, type Doc, type Preset, type PresetCategory, type Unit } from '@digital-canvas/scene';
  import { assetId, unpack, type ProjectMeta } from '@digital-canvas/storage';
  import Icon from '../lib/Icon.svelte';
  import { library } from '../lib/library.svelte.ts';
  import { account } from '../lib/account.svelte.ts';
  import { bridgeUi } from '../lib/bridge/bridgeUi.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { tabs } from '../lib/tabs.svelte.ts';
  import { objectUrl, pickFiles, timeAgo } from '../lib/files.ts';
  import { toast } from '../lib/toast.svelte.ts';
  import { copyDesign, downloadDesignFile, renameDesign, trashIsUndoable } from '../lib/designs.ts';
  import { TEMPLATES, fetchFonts, loadTemplate, searchTemplates, thumbUrl, type TemplateEntry } from '../lib/templates.ts';
  import { SHORTCUTS, loadView, popularPresets, previewBox, saveView, searchDesigns, type HomeView, type Shortcut } from '../lib/homeutil.ts';

  let projects = $state<ProjectMeta[]>([]);
  let loading = $state(true);
  let error = $state('');
  let category = $state<PresetCategory | 'All'>('All');
  /** The size grid's own search. */
  let query = $state('');
  /** The big search bar at the top: your designs, sizes and templates. */
  let search = $state('');
  let custom = $state({ w: 1080, h: 1080, unit: 'px' as Unit });
  let menuFor = $state<string | null>(null);
  let renaming = $state<string | null>(null);
  let renameDraft = $state('');
  let view = $state<HomeView>(loadView());
  let showCreate = $state(false);
  let createQuery = $state('');
  let busy = $state('');
  let sizesEl = $state<HTMLElement>();
  let customW = $state<HTMLInputElement>();

  // the tab strip's "+" opens "Create a design" (Canva)
  $effect(() => {
    if (tabs.createRequested) {
      tabs.createRequested = false;
      showCreate = true;
    }
  });

  const categories = ['All', ...PRESET_CATEGORIES] as const;
  const shown = $derived(searchPresets(query, category));
  const q = $derived(search.trim());
  const designs = $derived(searchDesigns(projects, q));
  const sizeHits = $derived(q ? searchPresets(q).slice(0, 12) : []);
  /** Without a search: one template of each kind first (Canva mixes them), then the rest. */
  const mixed = [...TEMPLATES].sort((a, b) => TEMPLATES.filter((t) => t.category === a.category).indexOf(a) - TEMPLATES.filter((t) => t.category === b.category).indexOf(b)).slice(0, 16);
  const templates = $derived(q ? searchTemplates(q) : mixed);
  const createList = $derived(createQuery.trim() ? searchPresets(createQuery).slice(0, 30) : popularPresets(PRESETS));

  async function refresh() {
    loading = true;
    error = '';
    try {
      projects = await library.store.list();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      projects = [];
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void library.store;
    void refresh();
  });

  async function create(opts: { width: number; height: number; unit: Unit; print?: boolean; title?: string; video?: boolean }) {
    let doc = createDoc(opts);
    if (opts.video) doc = { ...doc, pages: doc.pages.map((p) => ({ ...p, duration: 5 })) };
    await library.store.save({ doc, assets: new Map() });
    router.go({ name: 'editor', id: doc.id });
  }
  const createPreset = (p: Preset) => create({ width: p.width, height: p.height, unit: p.unit, print: p.print, title: p.name, video: p.video });

  function shortcut(s: Shortcut): void {
    if (s.preset) {
      const p = PRESETS.find((x) => x.id === s.preset);
      if (p) void createPreset(p);
    } else if (s.size) void create({ ...s.size, unit: 'px', title: s.label.replace(/s$/, '') });
    else if (s.category) {
      category = s.category as PresetCategory;
      query = '';
      sizesEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      showCreate = true;
      setTimeout(() => customW?.focus());
    }
  }

  /** A new design from a template: its pages, with the Google Fonts it uses embedded. */
  async function fromTemplate(t: TemplateEntry) {
    busy = t.title;
    try {
      const tpl = await loadTemplate(t.id);
      const sample = tpl.pages.flatMap((p) => [...walk(p.elements)]).map((e) => (e.type === 'text' ? e.text : '')).join(' ');
      const files = await fetchFonts(t.fonts, sample);
      const assets = new Map<string, Uint8Array>();
      const docAssets = { ...tpl.assets };
      const fonts = [...(tpl.fonts ?? [])];
      for (const f of files) {
        const id = await assetId(f.bytes, f.mime);
        assets.set(id, f.bytes);
        docAssets[id] = { mime: f.mime, name: `${f.family} ${f.weight}${f.italic ? ' italic' : ''}` };
        fonts.push({ family: f.family, asset: id, weight: f.weight, italic: f.italic, subset: f.subset, source: f.source });
      }
      const now = new Date().toISOString();
      const doc: Doc = { ...tpl, id: newId('d_'), title: t.title, assets: docAssets, fonts, createdAt: now, updatedAt: now };
      await library.store.save({ doc, assets });
      router.go({ name: 'editor', id: doc.id });
    } catch (e) {
      toast.show(`Couldn’t open the template: ${e instanceof Error ? e.message : e}`);
    } finally {
      busy = '';
    }
  }

  /** Bring a .dcanvas file from this computer into the current store (Drive when signed in). */
  async function openFile() {
    const [file] = await pickFiles('.dcanvas,application/vnd.digital-canvas+zip', false);
    if (!file) return;
    try {
      const project = unpack(new Uint8Array(await file.arrayBuffer()));
      await library.store.save(project);
      router.go({ name: 'editor', id: project.doc.id });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function trash(p: ProjectMeta) {
    menuFor = null;
    const store = library.store;
    if (!trashIsUndoable(store)) {
      const ok = await toast.ask({ title: `Delete “${p.title}”?`, body: 'It is kept only in this browser or folder, so it will be gone for good.', ok: 'Delete', danger: true });
      if (!ok) return;
    }
    tabs.forget(p.id); // its tab goes, without saving it back
    await store.remove(p.id);
    projects = projects.filter((x) => x.id !== p.id);
    toast.show(trashIsUndoable(store) ? `“${p.title}” moved to trash` : `“${p.title}” deleted`);
  }

  async function copy(p: ProjectMeta) {
    menuFor = null;
    try {
      const doc = await copyDesign(library.store, p.id);
      await refresh();
      toast.show(`Made “${doc.title}”`, { action: { label: 'Open', run: () => router.go({ name: 'editor', id: doc.id }) } });
    } catch (e) {
      toast.show(`Couldn’t copy: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function downloadFile(p: ProjectMeta) {
    menuFor = null;
    try {
      await downloadDesignFile(library.store, p.id);
    } catch (e) {
      toast.show(`Couldn’t download: ${e instanceof Error ? e.message : e}`);
    }
  }

  function startRename(p: ProjectMeta) {
    menuFor = null;
    renaming = p.id;
    renameDraft = p.title;
  }

  async function finishRename(p: ProjectMeta, keep: boolean) {
    if (renaming !== p.id) return;
    renaming = null;
    const t = renameDraft.trim();
    if (!keep || !t || t === p.title) return;
    projects = projects.map((x) => (x.id === p.id ? { ...x, title: t } : x));
    try {
      // open in a tab: rename that editor, so its next save keeps the new name
      const live = tabs.liveEditor(p.id, library.store);
      if (live) { live.rename(t); await live.save(); }
      else await renameDesign(library.store, p.id, t);
      tabs.setTitle(p.id, t);
    } catch (e) {
      toast.show(`Couldn’t rename: ${e instanceof Error ? e.message : e}`);
      await refresh();
    }
  }

  function setView(v: HomeView) {
    view = v;
    saveView(v);
  }

  function focusSelect(el: HTMLInputElement) {
    el.focus();
    el.select();
  }

  const sizeLabel = (p: Preset) => `${p.width} × ${p.height} ${p.unit}`;
</script>

<svelte:window onclick={() => { menuFor = null; showCreate = false; }} onkeydown={(e) => { if (e.key === 'Escape') { menuFor = null; showCreate = false; } }} />

{#snippet card(p: ProjectMeta)}
  <div class="card" class:row={view === 'list'} data-testid="project-card">
    <!-- a plain link: opens in this tab (⌘/Ctrl-click or middle-click still give a new tab) -->
    <a class="thumb" href="#/d/{p.id}" aria-label="Open {p.title}" data-testid="project-open">
      {#if p.thumbnail}
        <img src={objectUrl(p.thumbnail)} alt="" />
      {:else if p.thumbnailUrl}
        <img src={p.thumbnailUrl} alt="" referrerpolicy="no-referrer" />
      {:else}
        <Icon name="image" size={28} />
      {/if}
    </a>
    <div class="meta">
      <div class="names">
        {#if renaming === p.id}
          <input class="input rename" bind:value={renameDraft} aria-label="Design name" data-testid="card-rename-input" use:focusSelect
            onkeydown={(e) => { if (e.key === 'Enter') void finishRename(p, true); else if (e.key === 'Escape') { e.stopPropagation(); void finishRename(p, false); } }}
            onblur={() => void finishRename(p, true)} />
        {:else}
          <b title={p.title}>{p.title}</b>
        {/if}
        <span>{formatLength(p.width, 'px')} × {formatLength(p.height, 'px')} px · Edited {timeAgo(p.updatedAt)}</span>
      </div>
      <div class="menu-wrap">
        <button class="kebab" class:open={menuFor === p.id} aria-label="More actions for {p.title}" title="More" data-testid="card-menu"
          onclick={(e) => { e.stopPropagation(); menuFor = menuFor === p.id ? null : p.id; }}><Icon name="more" /></button>
        {#if menuFor === p.id}
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
          <div class="menu" role="menu" tabindex="-1" data-testid="card-menu-list" onclick={(e) => e.stopPropagation()}>
            <div class="mhead"><b>{p.title}</b><span>{formatLength(p.width, 'px')} × {formatLength(p.height, 'px')} px</span></div>
            <a role="menuitem" href="#/d/{p.id}"><Icon name="expand" size={16} /> Open</a>
            <button role="menuitem" data-testid="card-rename" onclick={() => startRename(p)}><Icon name="pen" size={16} /> Rename</button>
            <button role="menuitem" data-testid="card-copy" onclick={() => copy(p)}><Icon name="copy" size={16} /> Make a copy</button>
            <button role="menuitem" data-testid="card-download" onclick={() => downloadFile(p)}><Icon name="download" size={16} /> Download (.dcanvas)</button>
            <hr />
            <button role="menuitem" class="danger" data-testid="card-trash" onclick={() => trash(p)}><Icon name="trash" size={16} /> Move to trash</button>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/snippet}

{#snippet sizeTile(p: Preset)}
  {@const b = previewBox(p)}
  <button class="preset" data-testid="preset-{p.id}" onclick={() => createPreset(p)}>
    <div class="pv"><div class="pv-page" style="width:{b.w}px;height:{b.h}px"></div></div>
    <b>{p.name}</b>
    <span>{sizeLabel(p)}</span>
  </button>
{/snippet}

<div class="home scroll-y">
  <header>
    <div class="brand">
      <img src="/favicon.svg" alt="" width="30" height="30" />
      <span>Digital Canvas</span>
    </div>
    <div class="where">
      {#if account.user}
        <span class="chip" data-testid="store-label"><Icon name="drive" size={16} /> Saving to Google Drive</span>
        <span class="me" title={account.user.email}>
          {#if account.user.photo}<img src={account.user.photo} alt="" referrerpolicy="no-referrer" />{:else}<span class="init">{account.user.name.slice(0, 1)}</span>{/if}
          <span>{account.user.name}</span>
        </span>
        <button class="btn ghost" onclick={() => (bridgeUi.open = true)} data-testid="home-ai" title="Connect your AI · AI and devices"><Icon name="ai" size={16} /> AI{bridgeUi.status === 'on' ? ' · on' : ''}</button>
        <button class="btn ghost" onclick={() => account.signOut()} data-testid="sign-out">Sign out</button>
      {:else}
        <span class="label">Saving to</span>
        <span class="chip" data-testid="store-label">
          <Icon name={library.store.kind === 'folder' ? 'folder' : 'browser'} size={16} />
          {library.store.label}
        </span>
        {#if library.folderSupported}
          <button class="btn" onclick={() => library.pickFolder().catch(() => {})}>
            <Icon name="folder" size={16} /> {library.store.kind === 'folder' ? 'Change folder' : 'Use a folder'}
          </button>
        {/if}
        {#if library.store.kind === 'folder'}
          <button class="btn ghost" onclick={() => library.useBrowser()}>Use this browser</button>
        {/if}
        <button class="btn google" disabled={account.busy} onclick={() => account.signIn()} data-testid="sign-in">
          <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 2.9-2.2 5.4-4.7 7.1l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.5z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>
          {account.busy ? 'Signing in…' : 'Continue with Google'}
        </button>
      {/if}
      <div class="create-wrap">
        <button class="btn primary create" class:open={showCreate} data-testid="create-design" aria-expanded={showCreate}
          onclick={(e) => { e.stopPropagation(); showCreate = !showCreate; }}><Icon name="plus" size={16} /> Create a design</button>
        {#if showCreate}
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
          <div class="create-pop" role="dialog" tabindex="-1" aria-label="Create a design" data-testid="create-popover" onclick={(e) => e.stopPropagation()}>
            <label class="psearch">
              <Icon name="search" size={16} />
              <!-- svelte-ignore a11y_autofocus -->
              <input type="search" placeholder="What would you like to create?" bind:value={createQuery} autofocus data-testid="create-search" aria-label="Search sizes" />
            </label>
            <h5>{createQuery.trim() ? `${createList.length} sizes` : 'Popular'}</h5>
            <div class="plist scroll-y">
              {#each createList as p (p.id)}
                <button class="pitem" data-testid="create-preset-{p.id}" onclick={() => createPreset(p)}>
                  <span class="mini"><i style="aspect-ratio:{p.width} / {p.height}"></i></span>
                  <span class="pn">{p.name}</span>
                  <span class="ps">{sizeLabel(p)}</span>
                </button>
              {:else}
                <p class="none">No sizes match. Use a custom size below.</p>
              {/each}
            </div>
            <form class="cform" onsubmit={(e) => { e.preventDefault(); void create({ width: custom.w, height: custom.h, unit: custom.unit, print: custom.unit !== 'px' }); }}>
              <h5>Custom size</h5>
              <div class="custom-row">
                <input class="input" type="number" min="0.1" step="any" bind:value={custom.w} bind:this={customW} aria-label="Width" data-testid="custom-w" />
                <span>×</span>
                <input class="input" type="number" min="0.1" step="any" bind:value={custom.h} aria-label="Height" data-testid="custom-h" />
                <select class="input" bind:value={custom.unit} aria-label="Unit" data-testid="custom-unit">
                  <option value="px">px</option><option value="in">in</option><option value="mm">mm</option><option value="cm">cm</option>
                </select>
              </div>
              <button class="btn primary wide" type="submit" data-testid="custom-create">Create new design</button>
            </form>
          </div>
        {/if}
      </div>
    </div>
  </header>

  {#if account.error}
    <div class="banner err-banner"><Icon name="alert" /> {account.error}</div>
  {/if}
  {#if !account.user}
    <div class="banner info">
      <Icon name="drive" /> Sign in with Google to keep your designs in your own Drive and open them on any device.
      Digital Canvas only sees the files it creates.
    </div>
  {/if}

  {#if library.pendingFolder && !account.user}
    <div class="banner">
      <Icon name="folder" />
      Your folder <b>{library.pendingFolder.label}</b> needs permission again.
      <button class="btn primary" onclick={() => library.reconnectFolder()}>Reconnect</button>
      <button class="btn ghost" onclick={() => library.useBrowser()}>Use this browser instead</button>
    </div>
  {/if}

  <!-- phones: Canva's floating create button (the header's popover opens as a bottom sheet) -->
  <button class="fab" aria-label="Create a design" data-testid="m-create" onclick={(e) => { e.stopPropagation(); showCreate = !showCreate; }}><Icon name="plus" size={26} /></button>

  <section class="hero">
    <h1>What will you design today?</h1>
    <label class="bigsearch">
      <Icon name="search" size={20} />
      <input type="search" placeholder="Search your designs, sizes and templates" bind:value={search} data-testid="home-search" aria-label="Search your designs, sizes and templates" />
      {#if search}<button class="clear" aria-label="Clear search" onclick={() => (search = '')}><Icon name="close" size={16} /></button>{/if}
    </label>
    <div class="shortcuts">
      {#each SHORTCUTS as s (s.id)}
        <button class="sc" data-testid="shortcut-{s.id}" onclick={(e) => { e.stopPropagation(); shortcut(s); }}>
          <span class="sci sc-{s.id}"><Icon name={s.icon} size={22} /></span>
          <span>{s.label}</span>
        </button>
      {/each}
    </div>
  </section>

  {#if q}
    <section data-testid="search-results">
      <div class="row-head"><h2>Results for “{q}”</h2></div>
      {#if sizeHits.length}
        <h3>Sizes</h3>
        <div class="hits" data-testid="search-sizes">
          {#each sizeHits as p (p.id)}
            <button class="hit" data-testid="search-size-{p.id}" onclick={() => createPreset(p)}><b>{p.name}</b><span>{sizeLabel(p)}</span></button>
          {/each}
        </div>
      {/if}
      {#if !sizeHits.length && !templates.length && !designs.length}
        <p class="muted">Nothing matches “{q}”. Try another word, or a size like 1200x628.</p>
      {/if}
    </section>
  {/if}

  {#if templates.length}
    <section>
      <div class="row-head"><h2>{q ? 'Templates' : 'Start from a template'}</h2></div>
      <div class="tpls" data-testid="home-templates">
        {#each templates as t (t.id)}
          <button class="tpl" data-testid="home-template-{t.id}" disabled={!!busy} onclick={() => fromTemplate(t)}>
            <span class="tth"><img src={thumbUrl(t.id)} alt="" loading="lazy" /></span>
            <b>{t.title}</b>
            <span>{busy === t.title ? 'Opening…' : `${t.category}${t.pages > 1 ? ` · ${t.pages} pages` : ''}`}</span>
          </button>
        {/each}
      </div>
    </section>
  {/if}

  <section>
    <div class="row-head">
      <h2>{q ? 'Your designs' : 'Recent designs'}</h2>
      <div class="tools">
        <button class="btn" onclick={openFile} data-testid="open-file"><Icon name="upload" size={16} /> Open a .dcanvas file</button>
        <div class="seg" role="group" aria-label="View">
          <button class:on={view === 'grid'} aria-pressed={view === 'grid'} title="Grid view" aria-label="Grid view" data-testid="view-grid" onclick={() => setView('grid')}><Icon name="gridview" size={18} /></button>
          <button class:on={view === 'list'} aria-pressed={view === 'list'} title="List view" aria-label="List view" data-testid="view-list" onclick={() => setView('list')}><Icon name="listb" size={18} /></button>
        </div>
      </div>
    </div>
    {#if loading}
      <p class="muted">Loading…</p>
    {:else if error}
      <p class="err"><Icon name="alert" /> {error}</p>
    {:else if !projects.length}
      <div class="empty">No designs yet. Pick a size or a template to start.</div>
    {:else if !designs.length}
      <div class="empty">None of your designs match “{q}”.</div>
    {:else}
      <div class={view === 'list' ? 'list' : 'grid'} data-testid="designs" data-view={view}>
        {#if view === 'list'}
          <div class="lhead"><span></span><span>Name</span><span></span></div>
        {/if}
        {#each designs as p (p.id)}{@render card(p)}{/each}
      </div>
    {/if}
  </section>

  <section class="create" bind:this={sizesEl}>
    <div class="row-head">
      <h2>Create a design</h2>
      <label class="search">
        <Icon name="search" size={16} />
        <input class="input" type="search" placeholder="Search sizes: Instagram story, A4, business card, 728x90…" bind:value={query} data-testid="preset-search" aria-label="Search sizes" />
      </label>
    </div>
    <div class="tabs">
      {#each categories as c}
        <button class="tab" class:on={category === c} onclick={() => (category = c)} data-testid="category-{c}">{c}</button>
      {/each}
      <span class="count">{shown.length} sizes</span>
    </div>
    <div class="presets scroll-y">
      {#each shown as p (p.id)}{@render sizeTile(p)}{:else}
        <div class="none">No sizes match “{query}”. Try a custom size.</div>
      {/each}
      <form class="preset custom" onsubmit={(e) => { e.preventDefault(); void create({ width: custom.w, height: custom.h, unit: custom.unit, print: custom.unit !== 'px' }); }}>
        <b>Custom size</b>
        <div class="custom-row">
          <input class="input" type="number" min="0.1" step="any" bind:value={custom.w} aria-label="Width" />
          <span>×</span>
          <input class="input" type="number" min="0.1" step="any" bind:value={custom.h} aria-label="Height" />
        </div>
        <div class="custom-row">
          <select class="input" bind:value={custom.unit} aria-label="Unit">
            <option value="px">px</option><option value="in">in</option><option value="mm">mm</option><option value="cm">cm</option>
          </select>
          <button class="btn primary" type="submit">Create</button>
        </div>
      </form>
    </div>
  </section>

  <footer>Digital Canvas · Apache-2.0 · <a href="https://github.com/Panth977/digital-canvas" target="_blank" rel="noreferrer">GitHub</a> · <a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a></footer>
</div>

<style>
  .home { height: 100%; padding: 0 32px 40px; background: var(--stage); }
  header { margin: 0 -32px 18px; padding: 10px 32px !important; background: var(--header); color: #fff; position: relative; z-index: 20; }
  header .label { color: rgba(255,255,255,.85); }
  header .btn:not(.primary):not(.ghost) { color: var(--ink); }
  header .btn.ghost { color: #fff; }
  header .btn.ghost:hover { background: rgba(255,255,255,.15); }
  header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 0; flex-wrap: wrap; }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 18px; letter-spacing: -0.01em; }
  .where { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .label { color: var(--muted); font-size: 13px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; border-radius: 99px; background: var(--field); color: var(--ink); border: 1px solid var(--line); font-weight: 600; font-size: 13px; }
  .me { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; }
  .me img, .me .init { width: 28px; height: 28px; border-radius: 50%; }
  .me .init { display: grid; place-items: center; background: var(--accent); color: #fff; }
  .btn.google { background: var(--field); border-color: #dadce0; }
  .banner.info { background: #f1edff; border-color: #ddd3ff; color: #0d1216; }
  .err-banner { background: #fff0f0; border-color: #ffd0d0; color: var(--danger); }
  .banner { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: #fff7e6; color: #0d1216; border: 1px solid #ffe2a8; border-radius: var(--radius); margin-bottom: 12px; flex-wrap: wrap; }

  /* Create a design */
  .create-wrap { position: relative; margin-left: 4px; }
  .btn.create { height: 40px; padding: 0 16px; gap: 6px; font-weight: 700; box-shadow: 0 0 0 1px rgba(255,255,255,.35); }
  .create-pop { position: absolute; right: 0; top: 48px; width: 380px; max-height: min(620px, calc(100vh - 80px)); display: flex; flex-direction: column; gap: 8px; padding: 14px;
    background: var(--pop); color: var(--ink); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow); }
  .psearch { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--field); color: var(--muted); }
  .psearch:focus-within { border-color: var(--accent); }
  .psearch input { flex: 1; min-width: 0; border: 0; background: none; outline: none; color: var(--ink); font-size: 14px; }
  h5 { margin: 4px 2px 0; font-size: 12px; font-weight: 600; color: var(--muted); }
  .plist { display: flex; flex-direction: column; max-height: 280px; margin: 0 -6px; }
  .pitem { display: grid; grid-template-columns: 28px 1fr auto; align-items: center; gap: 10px; padding: 7px 8px; border: 0; background: none; border-radius: 8px; text-align: left; color: inherit; flex-shrink: 0; }
  .pitem:hover { background: var(--hover); }
  .mini { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 6px; background: var(--chip); }
  .mini i { display: block; max-width: 20px; max-height: 20px; width: 20px; background: var(--muted); border-radius: 2px; opacity: .6; }
  .pn { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ps { font-size: 12px; color: var(--muted); white-space: nowrap; }
  .cform { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--line); padding-top: 8px; }
  .wide { width: 100%; justify-content: center; height: 40px; }

  /* Hero with the big search */
  .hero { border-radius: 18px; padding: 36px 32px 24px; color: #fff; text-align: center; margin-bottom: 8px; background: var(--header); }
  .hero h1 { margin: 0 0 18px; font-size: 34px; letter-spacing: -0.02em; }
  .bigsearch { display: flex; align-items: center; gap: 10px; width: min(680px, 100%); height: 52px; margin: 0 auto; padding: 0 16px; border-radius: 12px; background: var(--field); color: var(--muted); box-shadow: 0 2px 10px rgba(0,0,0,.15); }
  .bigsearch:focus-within { outline: 2px solid rgba(255,255,255,.8); }
  .bigsearch input { flex: 1; min-width: 0; border: 0; background: none; outline: none; color: var(--ink); font-size: 16px; }
  .bigsearch input::-webkit-search-cancel-button { display: none; }
  .clear { width: 30px; height: 30px; display: grid; place-items: center; border: 0; background: none; border-radius: 6px; color: var(--muted); }
  .clear:hover { background: var(--hover); color: var(--ink); }
  .shortcuts { display: flex; justify-content: center; flex-wrap: wrap; gap: 6px 18px; margin-top: 22px; }
  .sc { display: flex; flex-direction: column; align-items: center; gap: 6px; border: 0; background: none; color: #fff; font-size: 13px; font-weight: 600; width: 92px; padding: 0; }
  .sci { width: 52px; height: 52px; border-radius: 50%; display: grid; place-items: center; background: rgba(255,255,255,.95); color: #0d1216; transition: transform .12s; }
  .sc:hover .sci { transform: translateY(-2px) scale(1.04); }
  .sc-doc { color: #13a3b5; } .sc-whiteboard { color: #16a34a; } .sc-presentation { color: #ff8b2c; } .sc-social { color: #ff3d6c; }
  .sc-video { color: #8b3dff; } .sc-print { color: #e5484d; } .sc-website { color: #4f6bff; } .sc-custom { color: #3b4250; }

  section { margin-top: 26px; }
  .row-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
  h2 { margin: 0; font-size: 18px; }
  h3 { margin: 8px 0; font-size: 14px; color: var(--ink-2); }
  .hits { display: flex; flex-wrap: wrap; gap: 8px; }
  .hit { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--pop); color: var(--ink); }
  .hit:hover { border-color: var(--accent); }
  .hit span { font-size: 12px; color: var(--muted); }
  .tpls { display: grid; grid-auto-flow: column; grid-auto-columns: 180px; gap: 14px; overflow-x: auto; padding: 4px 2px 10px; scrollbar-width: thin; }
  .tpl { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; border: 0; background: none; padding: 0; text-align: left; color: var(--ink); }
  .tth { width: 180px; height: 140px; display: grid; place-items: center; border-radius: 10px; background: var(--chip); overflow: hidden; transition: box-shadow .12s; }
  .tth img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .tpl:hover .tth { box-shadow: 0 0 0 2px var(--accent); }
  .tpl b { font-size: 13px; }
  .tpl span:last-child { font-size: 12px; color: var(--muted); }
  .tools { display: flex; align-items: center; gap: 8px; }
  .seg { display: flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  .seg button { width: 36px; height: 34px; display: grid; place-items: center; border: 0; background: none; color: var(--ink-2); }
  .seg button.on { background: var(--accent-soft); color: var(--accent); }

  .tabs { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
  .count { margin-left: auto; color: var(--muted); font-size: 12px; }
  .search { display: flex; align-items: center; gap: 8px; color: var(--muted); width: min(420px, 100%); }
  .none { grid-column: 1 / -1; padding: 16px; color: var(--muted); }
  .tab { border: 0; background: transparent; padding: 6px 12px; border-radius: 99px; font-weight: 600; color: var(--ink-2); }
  .tab.on { background: var(--ink); color: var(--panel); }
  .presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; max-height: 470px; padding: 4px 4px 8px; }
  .preset { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; text-align: left; padding: 12px; background: var(--pop); border: 1px solid var(--line); border-radius: var(--radius); transition: transform .12s, box-shadow .12s; color: var(--ink); }
  .preset:hover { transform: translateY(-2px); box-shadow: var(--shadow); }
  .preset b { font-size: 13px; }
  .preset span { font-size: 12px; color: var(--muted); }
  .pv { width: 100%; height: 84px; display: grid; place-items: center; background: var(--chip); border-radius: 8px; margin-bottom: 6px; }
  .pv-page { background: #fff; border-radius: 3px; box-shadow: 0 2px 8px rgba(80, 60, 200, .18); }
  .custom { gap: 8px; }
  .custom-row { display: flex; gap: 6px; align-items: center; width: 100%; }
  .custom-row .input { min-width: 0; flex: 1; }

  /* Recent designs */
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
  .card { border-radius: var(--radius); overflow: visible; }
  .thumb { box-sizing: border-box; display: grid; place-items: center; width: 100%; aspect-ratio: 4 / 3; border: 0; background: var(--chip); border-radius: var(--radius); overflow: hidden; color: var(--muted); padding: 14px; transition: box-shadow .12s; }
  .thumb:hover { box-shadow: 0 0 0 2px var(--accent); }
  .thumb img { max-width: 100%; max-height: 100%; box-shadow: 0 2px 10px rgba(0,0,0,.12); background: #fff; }
  .meta { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 8px 2px 4px 4px; }
  .names { min-width: 0; flex: 1; display: flex; flex-direction: column; }
  .meta b { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px; }
  .meta span { font-size: 12px; color: var(--muted); }
  .rename { height: 28px; font-weight: 600; }
  .kebab { width: 32px; height: 32px; display: grid; place-items: center; border: 0; border-radius: 8px; background: none; color: var(--ink-2); opacity: 0; }
  .card:hover .kebab, .kebab:focus-visible, .kebab.open, .row .kebab { opacity: 1; }
  .kebab:hover, .kebab.open { background: var(--hover); }
  .list { display: flex; flex-direction: column; gap: 2px; }
  .lhead { display: grid; grid-template-columns: 72px 1fr 40px; gap: 14px; padding: 0 8px 6px; font-size: 12px; color: var(--muted); font-weight: 600; border-bottom: 1px solid var(--line); }
  .card.row { display: grid; grid-template-columns: 72px 1fr; align-items: center; gap: 14px; padding: 6px 8px; border-radius: 8px; }
  .card.row:hover { background: var(--hover); }
  .card.row .thumb { width: 72px; height: 54px; aspect-ratio: auto; padding: 4px; border-radius: 6px; }
  .card.row .meta { padding: 0; }
  .menu-wrap { position: relative; }
  .menu { position: absolute; right: 0; top: 36px; background: var(--pop); color: var(--ink); border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--shadow); padding: 6px; z-index: 15; width: 240px; }
  .mhead { display: flex; flex-direction: column; gap: 2px; padding: 6px 10px 8px; border-bottom: 1px solid var(--line); margin-bottom: 4px; }
  .mhead b { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .menu button, .menu a { display: flex; align-items: center; gap: 10px; box-sizing: border-box; color: inherit; text-decoration: none; font: inherit; font-size: 14px; width: 100%; text-align: left; border: 0; background: none; padding: 8px 10px; border-radius: 6px; }
  .menu button:hover, .menu a:hover { background: var(--hover); }
  .menu hr { border: 0; border-top: 1px solid var(--line); margin: 4px 0; }
  .danger { color: var(--danger) !important; }
  .empty { padding: 40px; text-align: center; color: var(--muted); background: var(--pop); border: 1px dashed var(--line); border-radius: var(--radius); }
  .muted { color: var(--muted); }
  .err { color: var(--danger); display: flex; gap: 6px; align-items: center; }
  footer { margin-top: 40px; color: var(--muted); font-size: 12px; text-align: center; }
  footer a { color: inherit; }
  .fab { display: none; }

  /* ---- phones: Canva mobile's home ---- */
  @media (max-width: 767px) {
    .home { padding: 0 14px calc(96px + env(safe-area-inset-bottom)); }
    header { margin: 0 -14px 12px; padding: calc(8px + env(safe-area-inset-top)) 14px 10px !important; gap: 8px; }
    .where { width: 100%; gap: 6px; }
    .where .label { display: none; }
    .create-wrap > .create { display: none; }
    .create-pop {
      position: fixed; left: 0; right: 0; bottom: 0; top: auto; width: auto; max-height: 82vh; z-index: 60;
      border-radius: 16px 16px 0 0; padding-bottom: calc(14px + env(safe-area-inset-bottom)); box-shadow: 0 -8px 30px rgba(0, 0, 0, .25);
    }
    .fab {
      display: grid; place-items: center; position: fixed; right: 18px; bottom: calc(18px + env(safe-area-inset-bottom)); z-index: 50;
      width: 58px; height: 58px; border-radius: 50%; border: 0; background: var(--accent); color: #fff; box-shadow: 0 6px 18px rgba(139, 61, 255, .45);
    }
    .hero { padding: 20px 14px 14px; border-radius: 14px; }
    .hero h1 { font-size: 22px; margin-bottom: 12px; }
    .shortcuts { flex-wrap: nowrap; justify-content: flex-start; overflow-x: auto; gap: 4px; margin: 14px -14px 0; padding: 0 10px 4px; scrollbar-width: none; }
    .sc { width: 76px; flex-shrink: 0; font-size: 11px; }
    section { margin-top: 18px; }
    .tpls { grid-auto-columns: 140px; gap: 10px; }
    .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .presets { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .row-head { flex-wrap: wrap; gap: 8px; }
  }
</style>
