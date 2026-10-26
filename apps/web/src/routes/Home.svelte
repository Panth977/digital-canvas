<script lang="ts">
  import { PRESETS, createDoc, formatLength, type Preset, type Unit } from '@digital-canvas/scene';
  import { unpack, type ProjectMeta } from '@digital-canvas/storage';
  import Icon from '../lib/Icon.svelte';
  import { library } from '../lib/library.svelte.ts';
  import { account } from '../lib/account.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { objectUrl, pickFiles, timeAgo } from '../lib/files.ts';

  let projects = $state<ProjectMeta[]>([]);
  let loading = $state(true);
  let error = $state('');
  let category = $state<Preset['category'] | 'All'>('All');
  let custom = $state({ w: 1080, h: 1080, unit: 'px' as Unit });
  let menuFor = $state<string | null>(null);

  const categories = ['All', ...new Set(PRESETS.map((p) => p.category))] as const;
  const shown = $derived(category === 'All' ? PRESETS : PRESETS.filter((p) => p.category === category));

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

  async function create(opts: { width: number; height: number; unit: Unit; print?: boolean; title?: string }) {
    const doc = createDoc(opts);
    await library.store.save({ doc, assets: new Map() });
    router.go({ name: 'editor', id: doc.id });
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

  async function remove(p: ProjectMeta) {
    menuFor = null;
    if (!confirm(`Delete “${p.title}”? This can't be undone.`)) return;
    await library.store.remove(p.id);
    await refresh();
  }

  function previewBox(p: { width: number; height: number; unit: Unit }) {
    const r = p.width / p.height;
    return r >= 1 ? { w: 64, h: Math.max(10, 64 / r) } : { w: Math.max(10, 64 * r), h: 64 };
  }

  const sizeLabel = (p: Preset) => `${p.width} × ${p.height} ${p.unit}`;
</script>

<svelte:window onclick={() => (menuFor = null)} />

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

  <section class="hero">
    <h1>What will you design today?</h1>
    <p>Free and open source. Your designs are files you own.</p>
  </section>

  <section class="create">
    <div class="row-head">
      <h2>Create a design</h2>
      <div class="tabs">
        {#each categories as c}
          <button class="tab" class:on={category === c} onclick={() => (category = c)}>{c}</button>
        {/each}
      </div>
    </div>
    <div class="presets">
      {#each shown as p (p.id)}
        {@const b = previewBox(p)}
        <button class="preset" data-testid="preset-{p.id}" onclick={() => create({ width: p.width, height: p.height, unit: p.unit, print: p.print, title: p.name })}>
          <div class="pv"><div class="pv-page" style="width:{b.w}px;height:{b.h}px"></div></div>
          <b>{p.name}</b>
          <span>{sizeLabel(p)}</span>
        </button>
      {/each}
      <form class="preset custom" onsubmit={(e) => { e.preventDefault(); create({ width: custom.w, height: custom.h, unit: custom.unit, print: custom.unit !== 'px' }); }}>
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

  <section>
    <div class="row-head">
      <h2>Your designs</h2>
      <button class="btn" onclick={openFile} data-testid="open-file"><Icon name="upload" size={16} /> Open a .dcanvas file</button>
    </div>
    {#if loading}
      <p class="muted">Loading…</p>
    {:else if error}
      <p class="err"><Icon name="alert" /> {error}</p>
    {:else if !projects.length}
      <div class="empty">No designs yet. Pick a size above to start.</div>
    {:else}
      <div class="grid">
        {#each projects as p (p.id)}
          <div class="card" data-testid="project-card">
            <button class="thumb" onclick={() => router.go({ name: 'editor', id: p.id })} aria-label="Open {p.title}">
              {#if p.thumbnail}
                <img src={objectUrl(p.thumbnail)} alt="" />
              {:else if p.thumbnailUrl}
                <img src={p.thumbnailUrl} alt="" referrerpolicy="no-referrer" />
              {:else}
                <Icon name="image" size={28} />
              {/if}
            </button>
            <div class="meta">
              <div>
                <b title={p.title}>{p.title}</b>
                <span>{formatLength(p.width, 'px')} × {formatLength(p.height, 'px')} px · {timeAgo(p.updatedAt)}</span>
              </div>
              <div class="menu-wrap">
                <button class="btn ghost icon" aria-label="More" onclick={(e) => { e.stopPropagation(); menuFor = menuFor === p.id ? null : p.id; }}><Icon name="more" /></button>
                {#if menuFor === p.id}
                  <div class="menu">
                    <button onclick={() => router.go({ name: 'editor', id: p.id })}>Open</button>
                    <button class="danger" onclick={() => remove(p)}>Delete</button>
                  </div>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <footer>Digital Canvas · Apache-2.0 · <a href="https://github.com/Panth977/digital-canvas" target="_blank" rel="noreferrer">GitHub</a></footer>
</div>

<style>
  .home { height: 100%; padding: 0 32px 40px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 0; flex-wrap: wrap; }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 18px; letter-spacing: -0.01em; }
  .where { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .label { color: var(--muted); font-size: 13px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; border-radius: 99px; background: #fff; border: 1px solid var(--line); font-weight: 600; font-size: 13px; }
  .me { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; }
  .me img, .me .init { width: 28px; height: 28px; border-radius: 50%; }
  .me .init { display: grid; place-items: center; background: var(--accent); color: #fff; }
  .btn.google { background: #fff; border-color: #dadce0; }
  .banner.info { background: #f1edff; border-color: #ddd3ff; }
  .err-banner { background: #fff0f0; border-color: #ffd0d0; color: var(--danger); }
  .banner { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: #fff7e6; border: 1px solid #ffe2a8; border-radius: var(--radius); margin-bottom: 12px; flex-wrap: wrap; }
  .hero {
    border-radius: 18px; padding: 44px 32px; color: #fff; text-align: center; margin-bottom: 8px;
    background: radial-gradient(1200px 300px at 20% -20%, rgba(255,255,255,.25), transparent), linear-gradient(120deg, #6d4bff, #8f6bff 40%, #00c4cc);
  }
  .hero h1 { margin: 0 0 8px; font-size: 34px; letter-spacing: -0.02em; }
  .hero p { margin: 0; opacity: .9; }
  section { margin-top: 26px; }
  .row-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
  h2 { margin: 0; font-size: 18px; }
  .tabs { display: flex; gap: 4px; flex-wrap: wrap; }
  .tab { border: 0; background: transparent; padding: 6px 12px; border-radius: 99px; font-weight: 600; color: var(--ink-2); }
  .tab.on { background: var(--ink); color: #fff; }
  .presets { display: grid; grid-auto-flow: column; grid-auto-columns: 168px; gap: 12px; overflow-x: auto; padding-bottom: 8px; scrollbar-width: thin; }
  .preset { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; text-align: left; padding: 12px; background: #fff; border: 1px solid var(--line); border-radius: var(--radius); transition: transform .12s, box-shadow .12s; }
  .preset:hover { transform: translateY(-2px); box-shadow: var(--shadow); }
  .preset b { font-size: 13px; }
  .preset span { font-size: 12px; color: var(--muted); }
  .pv { width: 100%; height: 84px; display: grid; place-items: center; background: linear-gradient(135deg, #f1edff, #e6fbfb); border-radius: 8px; margin-bottom: 6px; }
  .pv-page { background: #fff; border-radius: 3px; box-shadow: 0 2px 8px rgba(80, 60, 200, .18); }
  .custom { gap: 8px; }
  .custom-row { display: flex; gap: 6px; align-items: center; width: 100%; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
  .card { background: #fff; border: 1px solid var(--line); border-radius: var(--radius); overflow: visible; }
  .thumb { display: grid; place-items: center; width: 100%; aspect-ratio: 4 / 3; border: 0; background: #f1f2f6; border-radius: var(--radius) var(--radius) 0 0; overflow: hidden; color: var(--muted); padding: 10px; }
  .thumb img { max-width: 100%; max-height: 100%; box-shadow: 0 2px 10px rgba(0,0,0,.12); background: #fff; }
  .meta { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 10px 8px 10px 12px; }
  .meta > div:first-child { min-width: 0; display: flex; flex-direction: column; }
  .meta b { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta span { font-size: 12px; color: var(--muted); }
  .menu-wrap { position: relative; }
  .menu { position: absolute; right: 0; top: 36px; background: #fff; border: 1px solid var(--line); border-radius: 8px; box-shadow: var(--shadow); padding: 4px; z-index: 5; min-width: 120px; }
  .menu button { display: block; width: 100%; text-align: left; border: 0; background: none; padding: 8px 10px; border-radius: 6px; }
  .menu button:hover { background: #f4f5f8; }
  .danger { color: var(--danger); }
  .empty { padding: 40px; text-align: center; color: var(--muted); background: #fff; border: 1px dashed var(--line); border-radius: var(--radius); }
  .muted { color: var(--muted); }
  .err { color: var(--danger); display: flex; gap: 6px; align-items: center; }
  footer { margin-top: 40px; color: var(--muted); font-size: 12px; text-align: center; }
  footer a { color: inherit; }
</style>
