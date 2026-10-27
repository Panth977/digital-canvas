<script lang="ts">
  import type { DriveItem, LibraryAsset, MediaKind } from '@digital-canvas/storage';
  import { folderIdFromLink } from '@digital-canvas/storage';
  import type { EditorState } from '../../lib/editor.svelte.ts';
  import Icon from '../../lib/Icon.svelte';
  import { IMAGE_TYPES, objectUrl, pickFiles } from '../../lib/files.ts';
  import { AUDIO_TYPES, VIDEO_TYPES, formatTime } from '../../lib/media.ts';
  import { account } from '../../lib/account.svelte.ts';
  import { driveLib, SOURCES } from '../../lib/drivelib.svelte.ts';

  let { ed }: { ed: EditorState } = $props();

  /** Our own drag type: the canvas never sees it (we turn it into an asset drop once downloaded). */
  const DRAG_TYPE = 'application/x-dc-library';
  const lib = driveLib;

  let uploadError = $state('');
  let notice = $state('');
  let linkText = $state('');
  let dragOver = $state(false);
  /** Download progress by item key (0..1). */
  let progress = $state<Record<string, number>>({});

  const KINDS: { id: MediaKind; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'image', label: 'Images' },
    { id: 'video', label: 'Videos' },
    { id: 'audio', label: 'Audio' },
  ];

  /** Small icons this panel needs that the shared set doesn't have. */
  const GLYPH: Record<string, string> = {
    'my-drive': 'M8 3h8l6 11-4 7H6l-4-7zM8 3l6 11h8M2 14h12l-4 7',
    computers: 'M3 5h18v11H3zM8 20h8M12 16v4',
    shared: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 19c0-3 3-5 6-5s6 2 6 5M16 5a3 3 0 010 6M18 14c2 .5 3 2.5 3 5',
    'shared-drives': 'M3 6h18v5H3zM3 13h18v5H3zM7 8.5h.01M7 15.5h.01',
    starred: 'M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1L3.2 9.4l6.1-.8z',
    recent: 'M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  };

  // ---------------- Uploads tab ----------------

  interface Entry {
    id: string;
    mime: string;
    name: string;
    duration?: number;
    lib?: LibraryAsset;
  }

  const usable = (mime: string) => /^(image|video|audio)\//.test(mime);
  const matches = (mime: string, k: MediaKind) => k === 'all' || mime.startsWith(`${k}/`);

  /** This design's media plus everything in `Digital Canvas/assets` (your uploads), newest first. */
  const entries = $derived.by(() => {
    const out: Entry[] = [];
    const seen = new Set<string>();
    const inDrive = new Map(lib.uploads.map((a) => [a.id, a]));
    for (const [id, m] of Object.entries(ed.doc.assets)) {
      if (id.endsWith('.poster') || !usable(m.mime) || seen.has(id)) continue;
      seen.add(id);
      const a = inDrive.get(id);
      out.push({ id, mime: m.mime, name: m.name ?? id, ...(m.duration ? { duration: m.duration } : {}), ...(a ? { lib: a } : {}) });
    }
    out.reverse();
    for (const a of lib.uploads) {
      if (seen.has(a.id) || !usable(a.mime)) continue;
      seen.add(a.id);
      out.push({ id: a.id, mime: a.mime, name: a.name ?? a.id, ...(a.duration ? { duration: a.duration } : {}), lib: a });
    }
    return out.filter((e) => matches(e.mime, lib.kind));
  });
  const visuals = $derived(entries.filter((e) => !e.mime.startsWith('audio/')));
  const sounds = $derived(entries.filter((e) => e.mime.startsWith('audio/')));

  $effect(() => {
    void account.user;
    if (lib.tab === 'uploads') void lib.loadUploads();
  });

  async function upload(): Promise<void> {
    const files = await pickFiles([...IMAGE_TYPES, 'image/svg+xml', ...VIDEO_TYPES, ...AUDIO_TYPES, '.mov', '.m4a', '.mp3'].join(','));
    await addFiles(files);
  }

  async function addFiles(files: Iterable<File>): Promise<void> {
    uploadError = '';
    for (const f of files) {
      const ok = f.type === 'image/svg+xml' ? ed.addSvg(await f.text(), f.name) : await ed.addMediaFile(f);
      if (!ok) uploadError = `Couldn't read ${f.name} (this browser can't open it).`;
    }
    lib.stale();
  }

  function onPanelDrop(e: DragEvent): void {
    dragOver = false;
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    void addFiles([...e.dataTransfer.files]);
  }

  function entryThumb(e: Entry): string | undefined {
    if (e.mime.startsWith('image/')) {
      const b = ed.assets.get(e.id);
      if (b) return objectUrl(b, e.mime);
    } else if (e.mime.startsWith('video/')) {
      const p = ed.assets.get(`${e.id}.poster`);
      if (p) return objectUrl(p, 'image/png');
    }
    return e.lib?.thumbnailLink ? sized(e.lib.thumbnailLink) : undefined;
  }

  /** Bytes of an upload: from this design, else from Drive (cached locally). */
  async function entryBytes(e: Entry): Promise<Uint8Array | undefined> {
    return ed.assets.get(e.id) ?? (await lib.store?.getAsset(e.id));
  }

  async function useEntry(e: Entry, drop?: Drop): Promise<void> {
    if (ed.doc.assets[e.id]) {
      if (e.mime.startsWith('image/')) return drop ? dropAsset(e.id, drop) : ed.addImageAsset(e.id);
      if (e.mime.startsWith('video/')) return ed.addVideoAsset(e.id);
    }
    await withProgress(`u:${e.id}`, async () => {
      const bytes = await entryBytes(e);
      if (!bytes) throw new Error('That upload is not in your Drive any more.');
      await place(bytes, e.mime, e.name, drop);
    });
  }

  async function removeEntry(e: Entry): Promise<void> {
    if (!e.lib) return;
    if (!confirm(`Remove “${e.name}” from your uploads? Designs that already use it keep it.`)) return;
    try {
      await lib.removeUpload(e.id);
    } catch (err) {
      uploadError = err instanceof Error ? err.message : String(err);
    }
  }

  /** Thumbnails without a ready image: fetch the bytes once the tile scrolls into view. */
  function lazyBytes(img: HTMLImageElement, e: Entry) {
    if (img.getAttribute('src') || !e.mime.startsWith('image/') || (e.lib?.size ?? 0) > 8e6) return;
    const io = new IntersectionObserver(async ([hit]) => {
      if (!hit?.isIntersecting) return;
      io.disconnect();
      const b = await entryBytes(e).catch(() => undefined);
      if (b) img.src = objectUrl(b, e.mime);
    });
    io.observe(img);
    return { destroy: () => io.disconnect() };
  }

  // ---------------- Google Drive tab ----------------

  let checking = $state(false);
  $effect(() => {
    if (lib.tab !== 'drive' || !account.user || account.scopes) return;
    checking = true;
    account.checkScopes().catch(() => {}).finally(() => (checking = false));
  });

  let loadedFor = '';
  $effect(() => {
    const key = `${account.user?.uid}:${account.wholeDrive}`;
    if (lib.tab === 'drive' && account.wholeDrive && loadedFor !== key) {
      loadedFor = key;
      void lib.load();
    }
  });

  async function connect(): Promise<void> {
    if (await account.connectWholeDrive()) {
      lib.drive?.clear();
      void lib.load(true);
    }
  }

  /** Bigger Drive thumbnails than the default 220 px. */
  const sized = (link: string) => link.replace(/=s\d+$/, '=s400');

  async function useDrive(item: DriveItem, drop?: Drop): Promise<void> {
    if (item.isFolder) return lib.open(item);
    const d = lib.drive;
    if (!d) return;
    await withProgress(`d:${item.id}`, async (onProgress) => {
      const bytes = await d.download(item, onProgress);
      await place(bytes, item.mimeType, item.name, drop);
    });
  }

  function useLink(): void {
    const id = folderIdFromLink(linkText);
    if (!id) {
      lib.error = 'Paste a link to a Google Drive folder.';
      return;
    }
    linkText = '';
    void lib.openLink(id);
  }

  function sentinel(el: HTMLElement) {
    const io = new IntersectionObserver(([hit]) => {
      if (hit?.isIntersecting) void lib.more();
    }, { rootMargin: '400px' });
    io.observe(el);
    return { destroy: () => io.disconnect() };
  }

  /** Thumbnails Google refused (expired links): show a type icon instead. */
  let broken = $state(new Set<string>());

  const folders = $derived(lib.items.filter((i) => i.isFolder));
  const files = $derived(lib.items.filter((i) => !i.isFolder));

  // ---------------- placing bytes on the page ----------------

  interface Drop {
    x: number;
    y: number;
    target: Element;
  }

  async function withProgress(key: string, run: (onProgress: (f: number) => void) => Promise<void>): Promise<void> {
    if (key in progress) return;
    notice = '';
    progress = { ...progress, [key]: 0 };
    try {
      await run((f) => (progress = { ...progress, [key]: f }));
    } catch (e) {
      notice = e instanceof Error ? e.message : String(e);
    } finally {
      const { [key]: _, ...rest } = progress;
      progress = rest;
    }
  }

  /** Add downloaded bytes to the design: stored once as an asset (content hash), then placed. */
  async function place(bytes: Uint8Array, mime: string, name: string, drop?: Drop): Promise<void> {
    if (mime === 'image/svg+xml') {
      if (!ed.addSvg(new TextDecoder().decode(bytes), name)) throw new Error(`Couldn't read ${name}.`);
      return;
    }
    if (mime.startsWith('image/')) {
      const id = await ed.addAsset(bytes, mime, name);
      if (!id) throw new Error(`Couldn't open ${name} (this image format isn't supported).`);
      return drop ? dropAsset(id, drop) : ed.addImageAsset(id);
    }
    const file = new File([bytes as BlobPart], name, { type: mime });
    const ok = mime.startsWith('video/') ? await ed.addVideoFile(file) : mime.startsWith('audio/') ? await ed.addAudioFile(file) : false;
    if (!ok) throw new Error(`Couldn't play ${name} in this browser.`);
  }

  /** Hand an asset to the canvas as an ordinary drop, so it lands where it was dropped (or fills a frame). */
  function dropAsset(id: string, d: Drop): void {
    try {
      const dt = new DataTransfer();
      dt.setData('application/x-digital-canvas', JSON.stringify({ kind: 'asset', id }));
      d.target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: d.x, clientY: d.y, dataTransfer: dt }));
    } catch {
      ed.addImageAsset(id);
    }
  }

  function dragStart(e: DragEvent, data: { from: 'upload'; id: string } | { from: 'drive'; id: string }): void {
    e.dataTransfer?.setData(DRAG_TYPE, JSON.stringify(data));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  }

  // Drops from this panel onto the page: download first, then let the canvas place it.
  $effect(() => {
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return;
      const target = (e.target as Element | null)?.closest('[data-testid="stage"]');
      e.preventDefault();
      e.stopPropagation();
      if (!target) return;
      const data = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as { from: 'upload' | 'drive'; id: string };
      const drop = { x: e.clientX, y: e.clientY, target };
      if (data.from === 'drive') {
        const item = lib.items.find((i) => i.id === data.id);
        if (item) void useDrive(item, drop);
      } else {
        const entry = entries.find((x) => x.id === data.id);
        if (entry) void useEntry(entry, drop);
      }
    };
    window.addEventListener('drop', onDrop, true);
    return () => window.removeEventListener('drop', onDrop, true);
  });

  const pct = (key: string) => `${Math.round((progress[key] ?? 0) * 100)}%`;
</script>

<div class="uploads" data-testid="uploads-panel">
  <div class="tabs" role="tablist">
    <button role="tab" aria-selected={lib.tab === 'uploads'} class:on={lib.tab === 'uploads'} data-testid="uploads-tab-uploads" onclick={() => (lib.tab = 'uploads')}>Uploads</button>
    <button role="tab" aria-selected={lib.tab === 'drive'} class:on={lib.tab === 'drive'} data-testid="uploads-tab-drive" onclick={() => (lib.tab = 'drive')}>Google Drive</button>
  </div>

  {#if lib.tab === 'uploads'}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="dropzone" class:over={dragOver}
      ondragover={(e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); dragOver = true; } }}
      ondragleave={() => (dragOver = false)} ondrop={onPanelDrop}>
      <button class="btn primary cta" onclick={upload} data-testid="upload"><Icon name="upload" size={18} /> Upload files</button>
      <p class="hint">Drop files here or onto the page. Images (PNG, JPG, WebP, GIF, SVG), videos (MP4, WebM, MOV) and sounds (MP3, M4A, WAV).</p>
    </div>
    {#if uploadError}<p class="err">{uploadError}</p>{/if}

    <div class="kinds" role="group" aria-label="Show">
      {#each KINDS as k}
        <button class="chip" class:on={lib.kind === k.id} aria-pressed={lib.kind === k.id} data-testid="kind-{k.id}" onclick={() => lib.setKind(k.id)}>{k.label}</button>
      {/each}
    </div>

    {#if lib.uploadsLoading && !entries.length}<p class="hint">Loading your uploads…</p>{/if}
    {#if lib.uploadsError}<p class="err">{lib.uploadsError}</p>{/if}
    {#if !account.user}<p class="hint small">Sign in to keep your uploads in Google Drive and use them in every design.</p>{/if}

    {#if visuals.length}
      <div class="grid" data-testid="upload-grid">
        {#each visuals as e (e.id)}
          {@const thumb = entryThumb(e)}
          {@const key = `u:${e.id}`}
          <div class="tile">
            <button class="asset" class:vid={e.mime.startsWith('video/')} title={e.name} draggable="true" data-testid="upload-item"
              ondragstart={(ev) => dragStart(ev, { from: 'upload', id: e.id })} onclick={() => useEntry(e)}>
              <img src={thumb} alt={e.name} loading="lazy" referrerpolicy="no-referrer" use:lazyBytes={e} />
              {#if e.mime.startsWith('video/')}<span class="dur">{e.duration ? formatTime(e.duration) : 'Video'}</span>{/if}
              {#if key in progress}<span class="prog" style="--p:{pct(key)}">{pct(key)}</span>{/if}
            </button>
            {#if e.lib}
              <button class="del" title="Remove from uploads" aria-label="Remove {e.name} from uploads" data-testid="upload-remove" onclick={() => removeEntry(e)}><Icon name="trash" size={14} /></button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
    {#if sounds.length}
      <h3 class="sub">Audio</h3>
      {#each sounds as e (e.id)}
        {@const key = `u:${e.id}`}
        <div class="sound">
          <button class="row" title="Add {e.name}" draggable="true" ondragstart={(ev) => dragStart(ev, { from: 'upload', id: e.id })} onclick={() => useEntry(e)}>
            <Icon name="music" size={14} /> <span>{e.name}</span> <em>{key in progress ? pct(key) : e.duration ? formatTime(e.duration) : ''}</em>
          </button>
          {#if e.lib}<button class="del inline" title="Remove from uploads" aria-label="Remove {e.name} from uploads" onclick={() => removeEntry(e)}><Icon name="trash" size={14} /></button>{/if}
        </div>
      {/each}
    {/if}
    {#if !entries.length && !lib.uploadsLoading}<p class="hint">No {lib.kind === 'all' ? 'uploads' : KINDS.find((k) => k.id === lib.kind)?.label.toLowerCase()} yet.</p>{/if}
    {#if notice}<p class="err">{notice}</p>{/if}
  {:else}
    {#if !account.user}
      <div class="connect" data-testid="drive-signin">
        <Icon name="drive" size={28} />
        <p>Sign in with Google to use photos, videos and sounds from your Drive.</p>
        <button class="btn primary cta" disabled={account.busy} onclick={() => account.signIn()}>Sign in with Google</button>
      </div>
    {:else if !account.wholeDrive}
      <div class="connect" data-testid="drive-connect">
        <Icon name="drive" size={28} />
        <p>Browse your whole Google Drive here: My Drive, your computers' backups, files shared with you, starred and recent. Click or drag any image, video or sound onto the page.</p>
        <button class="btn primary cta" disabled={account.busy || checking} data-testid="connect-drive" onclick={connect}>{checking ? 'Checking…' : 'Connect your whole Google Drive'}</button>
        <p class="hint small">Digital Canvas only reads your Drive; it never changes or deletes your files. Google may warn that the app isn't verified yet: choose <b>Advanced → Continue</b>.</p>
        {#if account.error}<p class="err">{account.error}</p>{/if}
      </div>
    {:else}
      <form class="search" onsubmit={(e) => { e.preventDefault(); lib.find(lib.search); }}>
        <Icon name="search" size={18} />
        <input placeholder="Search your Drive" bind:value={lib.search} data-testid="drive-search" aria-label="Search Google Drive" />
      </form>
      <div class="sources" role="group" aria-label="Drive sections">
        {#each SOURCES as s}
          <button class="src" class:on={lib.source === s.id && !lib.loc.search} data-testid="drive-src-{s.id}" onclick={() => lib.go(s.id)}>
            <svg class="svgi" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d={GLYPH[s.id]} /></svg>{s.label}
          </button>
        {/each}
      </div>
      <div class="kinds" role="group" aria-label="Show">
        {#each KINDS as k}
          <button class="chip" class:on={lib.kind === k.id} aria-pressed={lib.kind === k.id} data-testid="drive-kind-{k.id}" onclick={() => lib.setKind(k.id)}>{k.label}</button>
        {/each}
      </div>
      <nav class="crumbs" aria-label="Folder path" data-testid="drive-crumbs">
        {#each lib.crumbs as c, i}
          {#if i}<span class="sep">›</span>{/if}
          <button disabled={i === lib.crumbs.length - 1} onclick={() => lib.back(i)}>{c.name}</button>
        {/each}
        <button class="refresh" title="Refresh" aria-label="Refresh" onclick={() => lib.load(true)}>↻</button>
      </nav>

      {#if lib.error}<p class="err">{lib.error}</p>{/if}
      {#if notice}<p class="err">{notice}</p>{/if}

      {#if folders.length}
        <div class="folders" data-testid="drive-folders">
          {#each folders as f (f.id)}
            <button class="folder" title={f.name} data-testid="drive-folder" onclick={() => lib.open(f)}>
              {#if lib.source === 'computers' && !lib.loc.folderId}
                <svg class="svgi" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d={GLYPH.computers} /></svg>
              {:else}<Icon name="folder" size={16} />{/if}
              <span>{f.name}</span>
            </button>
          {/each}
        </div>
      {/if}
      {#if files.length}
        <div class="grid" data-testid="drive-files">
          {#each files as f (f.id)}
            {@const key = `d:${f.id}`}
            <button class="asset" class:vid={f.mimeType.startsWith('video/')} class:audio={f.mimeType.startsWith('audio/')} title={f.name} draggable="true" data-testid="drive-file"
              ondragstart={(ev) => dragStart(ev, { from: 'drive', id: f.id })} onclick={() => useDrive(f)}>
              {#if f.thumbnailLink && !broken.has(f.id)}
                <img src={sized(f.thumbnailLink)} alt={f.name} loading="lazy" referrerpolicy="no-referrer"
                  onerror={() => (broken = new Set(broken).add(f.id))} />
              {:else}
                <span class="ph"><Icon name={f.mimeType.startsWith('audio/') ? 'music' : f.mimeType.startsWith('video/') ? 'video' : 'image'} size={28} /></span>
              {/if}
              <span class="name">{f.name}</span>
              {#if f.duration}<span class="dur">{formatTime(f.duration)}</span>{/if}
              {#if key in progress}<span class="prog" style="--p:{pct(key)}" data-testid="drive-progress">{pct(key)}</span>{/if}
            </button>
          {/each}
        </div>
      {/if}
      {#if lib.loading}<p class="hint">Loading…</p>
      {:else if !lib.items.length && !lib.error}
        <p class="hint">{lib.source === 'computers' && !lib.loc.folderId ? 'No backed-up computers found.' : 'Nothing here you can add to a design.'}</p>
      {/if}
      {#if lib.next}<div use:sentinel class="sentinel" aria-hidden="true"></div>{/if}
      {#if lib.source === 'computers' && !lib.loc.folderId && !lib.loc.search}
        <form class="link" onsubmit={(e) => { e.preventDefault(); useLink(); }}>
          <p class="hint small">Computers backed up with Google Drive for desktop. Missing one? Open it in Drive and paste the folder link here.</p>
          <div class="inline">
            <input class="input" placeholder="https://drive.google.com/drive/folders/…" bind:value={linkText} data-testid="drive-link" aria-label="Drive folder link" />
            <button class="btn">Open</button>
          </div>
        </form>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .uploads { display: flex; flex-direction: column; }
  .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); margin-bottom: 14px; }
  .tabs button { flex: 1; height: 36px; border: 0; background: none; font-weight: 600; color: var(--muted); border-bottom: 2px solid transparent; margin-bottom: -1px; }
  .tabs button.on { color: var(--ink); border-bottom-color: var(--accent); }
  .tabs button:hover { color: var(--ink); }
  .dropzone { border-radius: 10px; transition: background .15s; }
  .dropzone.over { background: var(--accent-soft); outline: 2px dashed var(--accent); outline-offset: 4px; }
  .cta { width: 100%; height: 40px; border-radius: 8px; font-size: 14px; }
  .hint { color: var(--muted); font-size: 12px; line-height: 1.5; margin: 12px 0 0; }
  .hint.small { margin-top: 8px; }
  .err { color: var(--danger); font-size: 13px; margin: 10px 0 0; }
  .kinds { display: flex; gap: 6px; margin-top: 14px; flex-wrap: wrap; }
  .chip { height: 28px; padding: 0 12px; border-radius: 14px; border: 1px solid var(--line); background: none; font-size: 12px; font-weight: 600; color: var(--ink-2); }
  .chip:hover { background: var(--hover); }
  .chip.on { background: var(--ink); color: var(--panel); border-color: var(--ink); }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 12px; }
  .tile { position: relative; }
  .asset { position: relative; width: 100%; aspect-ratio: 1; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; padding: 0; background: var(--chip); display: block; }
  .asset:hover { border-color: var(--accent); }
  .asset img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .asset img:not([src]) { visibility: hidden; }
  .ph { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted); }
  .name { position: absolute; left: 0; right: 0; bottom: 0; padding: 14px 6px 4px; font-size: 11px; text-align: left; color: #fff; background: linear-gradient(transparent, rgba(0,0,0,.6)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0; transition: opacity .12s; }
  .asset:hover .name, .asset.audio .name, .ph + .name { opacity: 1; }
  .dur { position: absolute; right: 4px; top: 4px; background: rgba(0,0,0,.65); color: #fff; font-size: 11px; padding: 1px 5px; border-radius: 4px; }
  .prog { position: absolute; inset: 0; display: grid; place-items: center; color: #fff; font-weight: 700; font-size: 13px; background: linear-gradient(to right, rgba(139,61,255,.55) var(--p), rgba(0,0,0,.5) var(--p)); }
  .del { position: absolute; top: 4px; right: 4px; width: 26px; height: 26px; border-radius: 6px; border: 0; background: rgba(0,0,0,.6); color: #fff; display: grid; place-items: center; opacity: 0; transition: opacity .12s; padding: 0; }
  .tile:hover .del, .del:focus-visible { opacity: 1; }
  .del.inline { position: static; opacity: .7; background: none; color: var(--muted); }
  h3.sub { margin: 18px 0 8px; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
  .sound { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; }
  .sound .row { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; font-size: 13px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 8px; background: none; text-align: left; }
  .sound .row:hover { border-color: var(--accent); }
  .sound span { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .sound em { font-style: normal; color: var(--muted); font-size: 12px; }
  .connect { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; padding: 18px 4px; color: var(--ink-2); }
  .connect p { margin: 0; line-height: 1.5; font-size: 13px; }
  .connect .hint { font-size: 12px; }
  .search { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--field); color: var(--muted); }
  .search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
  .search input { flex: 1; min-width: 0; border: 0; background: none; outline: none; color: var(--ink); }
  .sources { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
  .src { display: flex; align-items: center; gap: 6px; height: 32px; padding: 0 10px; border: 1px solid var(--line); border-radius: 8px; background: none; font-size: 12px; font-weight: 600; color: var(--ink-2); white-space: nowrap; overflow: hidden; }
  .src:hover { background: var(--hover); }
  .src.on { background: var(--accent-soft); border-color: transparent; color: var(--accent); }
  .src .svgi { flex-shrink: 0; width: 16px; height: 16px; }
  .crumbs { display: flex; align-items: center; flex-wrap: wrap; gap: 2px; margin-top: 12px; font-size: 13px; }
  .crumbs button { border: 0; background: none; padding: 2px 4px; border-radius: 4px; font-weight: 600; color: var(--accent); max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .crumbs button:disabled { color: var(--ink); cursor: default; }
  .crumbs button:not(:disabled):hover { background: var(--hover); }
  .crumbs .sep { color: var(--muted); }
  .crumbs .refresh { margin-left: auto; color: var(--muted); font-size: 15px; }
  .folders { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin-top: 10px; }
  .folder { display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--chip); font-size: 13px; text-align: left; min-width: 0; }
  .folder:hover { border-color: var(--accent); }
  .folder span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .sentinel { height: 1px; }
  .link { margin-top: 14px; }
  .inline { display: flex; gap: 6px; margin-top: 6px; }
</style>
