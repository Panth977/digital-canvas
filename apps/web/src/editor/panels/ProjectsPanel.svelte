<script lang="ts">
  import './panels.css';
  import type { ProjectMeta, ProjectStore } from '@digital-canvas/storage';
  import type { EditorState } from '../../lib/editor.svelte.ts';
  import Icon, { type IconName } from '../../lib/Icon.svelte';
  import { account } from '../../lib/account.svelte.ts';
  import { library } from '../../lib/library.svelte.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { objectUrl, timeAgo } from '../../lib/files.ts';
  import { addMedia, bytesOf, listMedia, registerImage, type MediaItem } from '../../lib/projects.ts';
  import { insertDesign, pageIsEmpty, type InsertMode } from '../../lib/templates.ts';
  import InsertDialog from './InsertDialog.svelte';

  let { ed }: { ed: EditorState } = $props();

  type Tab = 'designs' | 'folders' | 'images' | 'videos';
  let tab = $state<Tab>('designs');
  let query = $state('');
  let folder = $state<{ label: string; store: ProjectStore } | null>(null);

  let designs = $state<ProjectMeta[]>([]);
  let designState = $state<'' | 'loading' | 'error'>('loading');
  let localDesigns = $state<ProjectMeta[]>([]);
  $effect(() => {
    const store = library.store;
    designState = 'loading';
    store.list().then((l) => { designs = l; designState = ''; }, () => (designState = 'error'));
    if (account.user) library.localStore.list().then((l) => (localDesigns = l), () => (localDesigns = []));
  });
  let folderDesigns = $state<ProjectMeta[]>([]);
  const shown = $derived((folder ? folderDesigns : designs).filter((d) => d.title.toLowerCase().includes(query.trim().toLowerCase())));
  const thumb = (p: ProjectMeta) => (p.thumbnail ? objectUrl(p.thumbnail) : p.thumbnailUrl ?? '');

  // ---- open / reuse ----
  async function openDesign(p: ProjectMeta): Promise<void> {
    if (p.id === ed.doc.id) return;
    await ed.save();
    router.go({ name: 'editor', id: p.id });
  }
  let pending = $state.raw<{ title: string; pages: number; run: (m: InsertMode) => Promise<void> } | null>(null);
  let busy = $state('');
  let error = $state('');
  async function reuse(p: ProjectMeta, store: ProjectStore = library.store): Promise<void> {
    error = '';
    busy = `Opening “${p.title}”…`;
    try {
      const f = await store.open(p.id);
      const run = async (m: InsertMode) => { busy = `Adding “${p.title}”…`; try { await insertDesign(ed, f.doc, m, f.assets); } finally { busy = ''; } };
      busy = '';
      if (pageIsEmpty(ed)) await run('replace');
      else pending = { title: p.title, pages: f.doc.pages.length, run };
    } catch (e) {
      busy = '';
      error = `Couldn’t open “${p.title}”: ${e instanceof Error ? e.message : e}`;
    }
  }

  // ---- folders ----
  const folders: { id: string; label: string; icon: IconName; count: number; store: ProjectStore }[] = $derived([
    { id: 'main', label: library.store.kind === 'drive' ? 'Google Drive · Digital Canvas' : library.store.label, icon: (library.store.kind === 'drive' ? 'drive' : library.store.kind === 'folder' ? 'folder' : 'browser') as IconName, count: designs.length, store: library.store },
    ...(account.user && localDesigns.length ? [{ id: 'local', label: `On this computer (${library.localStore.label})`, icon: 'browser' as IconName, count: localDesigns.length, store: library.localStore }] : []),
  ]);
  async function openFolder(f: (typeof folders)[number]): Promise<void> {
    folder = { label: f.label, store: f.store };
    folderDesigns = f.id === 'main' ? designs : localDesigns;
  }

  // ---- images / videos ----
  let media = $state.raw<Record<'image' | 'video', MediaItem[] | null>>({ image: null, video: null });
  let mediaState = $state<'' | 'loading' | 'error'>('');
  let mediaStore: ProjectStore | null = null;
  async function loadMedia(kind: 'image' | 'video'): Promise<void> {
    if (media[kind] && mediaStore === library.store) return;
    mediaStore = library.store;
    mediaState = 'loading';
    try {
      const list = designs.length || designState === '' ? designs : await library.store.list();
      media = { ...media, [kind]: await listMedia(library.store, list, kind) };
      mediaState = '';
      // local items already have bytes; Drive ones load on hover (ready for drag)
    } catch {
      mediaState = 'error';
    }
  }
  $effect(() => { if ((tab === 'images' || tab === 'videos') && designState === '') void loadMedia(tab === 'images' ? 'image' : 'video'); });
  const mediaShown = $derived((media[tab === 'videos' ? 'video' : 'image'] ?? []).filter((m) => `${m.name} ${m.from ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())));
  const mediaSrc = (m: MediaItem) => (m.bytes && m.mime.startsWith('image/') ? objectUrl(m.bytes, m.mime) : m.poster ? objectUrl(m.poster, 'image/png') : m.thumbUrl ?? '');
  let adding = $state<string | null>(null);
  async function addItem(m: MediaItem): Promise<void> {
    adding = m.id;
    error = '';
    try { if (!(await addMedia(ed, m))) error = `Couldn’t add ${m.name}.`; } finally { adding = null; }
  }
  function dragStart(e: DragEvent, m: MediaItem): void {
    // registered now (sync), so the page's drop handler finds the asset
    if (!m.mime.startsWith('image/') || !registerImage(ed, m)) { e.preventDefault(); void bytesOf(m); return; }
    e.dataTransfer?.setData('application/x-digital-canvas', JSON.stringify({ kind: 'asset', id: m.id }));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  }
</script>

<div class="dp" data-testid="projects-panel">
  <form class="dp-search" onsubmit={(e) => e.preventDefault()}>
    <Icon name="search" size={18} />
    <input placeholder="Search your content" bind:value={query} data-testid="projects-search" aria-label="Search your content" />
  </form>
  <div class="dp-tabs" role="tablist">
    {#each [['designs', 'Designs'], ['folders', 'Folders'], ['images', 'Images'], ['videos', 'Videos']] as [id, label] (id)}
      <button role="tab" class:on={tab === id} aria-selected={tab === id} data-testid="projects-tab-{id}" onclick={() => { tab = id as Tab; folder = null; }}>{label}</button>
    {/each}
  </div>
  {#if busy}<p class="dp-hint"><span class="dp-spin"></span> {busy}</p>{/if}
  {#if error}<p class="dp-err">{error}</p>{/if}

  {#if tab === 'designs' || (tab === 'folders' && folder)}
    {#if folder}<button class="dp-back" onclick={() => (folder = null)}><Icon name="left" size={16} /> {folder.label}</button>{/if}
    {#if designState === 'loading'}<p class="dp-hint"><span class="dp-spin"></span> Loading designs…</p>
    {:else if designState === 'error'}<p class="dp-err">Couldn’t list your designs.</p>
    {:else if !shown.length}<p class="dp-empty">{query ? `No designs match “${query}”.` : 'No designs yet.'}</p>
    {:else}
      <div class="dp-cols" data-testid="projects-designs">
        {#each shown as p (p.id)}
          <div class="design" class:cur={p.id === ed.doc.id}>
            <button class="dp-card" title={p.id === ed.doc.id ? 'This design' : `Open ${p.title}`} onclick={() => openDesign(p)} data-testid="project-{p.id}">
              {#if thumb(p)}<img src={thumb(p)} alt={p.title} loading="lazy" />{:else}<span class="ph"><Icon name="templates" size={28} /></span>{/if}
              {#if p.id === ed.doc.id}<span class="dp-badge">Open now</span>{/if}
              <span class="dp-cap">{p.title}<small>{timeAgo(p.updatedAt)}</small></span>
            </button>
            {#if p.id !== ed.doc.id}
              <button class="use" title="Copy its pages into this design" onclick={() => reuse(p, folder?.store ?? library.store)} data-testid="project-use-{p.id}"><Icon name="addpage" size={14} /></button>
            {/if}
          </div>
        {/each}
      </div>
      <p class="dp-hint">Click a design to open it here. Hover it and click <Icon name="addpage" size={12} /> to copy its pages into this design.</p>
    {/if}
  {:else if tab === 'folders'}
    <div class="dp-list">
      {#each folders as f (f.id)}
        <button class="dp-item" onclick={() => openFolder(f)} data-testid="projects-folder-{f.id}">
          <span class="dp-ico"><Icon name={f.icon} size={20} /></span>
          <span class="dp-tx"><b>{f.label}</b><small>{f.count} design{f.count === 1 ? '' : 's'}</small></span>
          <Icon name="right" size={16} />
        </button>
      {/each}
      <button class="dp-item" onclick={() => (tab = 'images')}>
        <span class="dp-ico"><Icon name="image" size={20} /></span>
        <span class="dp-tx"><b>{library.store.kind === 'drive' ? 'assets' : 'Images in your designs'}</b><small>Photos, logos and graphics you used</small></span>
        <Icon name="right" size={16} />
      </button>
    </div>
    {#if !account.user}<p class="dp-hint">Sign in with Google to keep designs in your Drive (folder “Digital Canvas”).</p>{/if}
  {:else}
    {#if mediaState === 'loading'}<p class="dp-hint"><span class="dp-spin"></span> Looking through your designs…</p>
    {:else if mediaState === 'error'}<p class="dp-err">Couldn’t load your {tab}.</p>
    {:else if !mediaShown.length}<p class="dp-empty">No {tab} in your designs yet.</p>
    {:else}
      <div class="dp-grid two" data-testid="projects-media">
        {#each mediaShown as m (m.id)}
          <button class="dp-cell photo" class:vid={tab === 'videos'} title="{m.name}{m.from ? ` — from ${m.from}` : ''}" disabled={adding === m.id}
            draggable={tab === 'images'} ondragstart={(e) => dragStart(e, m)} onpointerenter={() => void bytesOf(m)} onclick={() => addItem(m)} data-testid="projects-media-item">
            {#if mediaSrc(m)}<img src={mediaSrc(m)} alt={m.name} loading="lazy" />{:else}<Icon name={tab === 'videos' ? 'video' : 'image'} size={24} />{/if}
            {#if tab === 'videos'}<span class="dp-badge"><Icon name="play" size={10} /></span>{/if}
          </button>
        {/each}
      </div>
      <p class="dp-hint">Click to add, or drag an image onto the page or into a frame.</p>
    {/if}
  {/if}
</div>

{#if pending}
  <InsertDialog title={pending.title} pages={pending.pages} oncancel={() => (pending = null)} onpick={(m) => { const p = pending; pending = null; void p?.run(m); }} />
{/if}

<style>
  .design { position: relative; break-inside: avoid; }
  .design.cur .dp-card { box-shadow: 0 0 0 2px var(--accent); }
  .dp-cap small { display: block; color: var(--muted); font-size: 11px; font-weight: 400; }
  .ph { display: grid; place-items: center; height: 100px; color: var(--muted); }
  .use { position: absolute; top: 6px; right: 6px; width: 28px; height: 28px; border-radius: 6px; border: 0; background: rgba(0,0,0,.6); color: #fff; display: none; place-items: center; }
  .design:hover .use { display: grid; }
  .vid { position: relative; }
  .design .dp-badge { bottom: auto; top: 6px; }
</style>
