<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { isVideo } from '@digital-canvas/scene';
  import { MemoryStore, browserAssetCache, openPublicDesign, type FileAccess } from '@digital-canvas/storage';
  import Icon from '../lib/Icon.svelte';
  import { EditorState } from '../lib/editor.svelte.ts';
  import { engine } from '../lib/engine.ts';
  import { account } from '../lib/account.svelte.ts';
  import { library } from '../lib/library.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import { driveApiKey } from '../lib/sharing.ts';
  import { makeOwnCopy } from '../lib/shared.svelte.ts';
  import Canvas from '../editor/Canvas.svelte';
  import DownloadMenu from '../editor/DownloadMenu.svelte';
  import Present from '../editor/Present.svelte';

  /**
   * `/view/<fileId>`: a design shared "anyone with the link", without signing
   * in. The file and its assets are read with the API key; the pages show in
   * the editor's own canvas (scroll, zoom, video plays) with editing off.
   */
  let { fileId }: { fileId: string } = $props();

  let ed = $state<EditorState | null>(null);
  let access = $state<FileAccess | null>(null);
  let error = $state('');
  let missing = $state(0);
  let showDownload = $state(false);
  let presenting = $state(false);
  let copying = $state(false);

  onMount(() => {
    let cancelled = false;
    ui.reset();
    ui.panel = null;
    (async () => {
      try {
        const [eng, r] = await Promise.all([engine(), openPublicDesign(untrack(() => fileId), { apiKey: driveApiKey() }, browserAssetCache())]);
        if (cancelled) return;
        const e = new EditorState(eng, new MemoryStore(), r.file);
        e.readOnly = true;
        e.access = r.access;
        access = r.access;
        missing = r.missing.length;
        ed = e;
        (window as unknown as { __dc?: EditorState }).__dc = e;
      } catch (e) {
        const status = (e as { status?: number }).status;
        error = status === 404 || status === 403
          ? 'This design is not shared publicly. Ask its owner to set link access to “Anyone with the link”, or sign in if it was shared with you.'
          : `Couldn't open the design: ${e instanceof Error ? e.message.replace(/^Google Drive: /, '') : e}`;
      }
    })();
    return () => {
      cancelled = true;
      ed?.dispose();
    };
  });

  /** Make a copy needs your Drive: sign in first. */
  async function copy(): Promise<void> {
    if (!ed) return;
    if (!account.user && !(await account.signIn())) return;
    if (library.store.kind !== 'drive') return;
    copying = true;
    try {
      await makeOwnCopy(ed, library.store);
    } finally {
      copying = false;
    }
  }

  const by = $derived(access?.sharedBy?.name ?? access?.owner?.name ?? access?.owner?.email);
</script>

<svelte:window onclick={() => (showDownload = false)} />

{#if error}
  <div class="center" data-testid="view-error">
    <Icon name="lock" size={28} />
    <p>{error}</p>
    <div class="row">
      <button class="btn primary" onclick={() => router.go({ name: 'shared', fileId })}>Sign in and open</button>
      <button class="btn" onclick={() => router.go({ name: 'home' })}>Digital Canvas</button>
    </div>
  </div>
{:else if !ed}
  <div class="center"><div class="spinner"></div><p>Loading design…</p></div>
{:else}
  <div class="viewer" data-testid="public-view">
    <header class="top">
      <div class="left">
        <a class="brand" href="/" onclick={(e) => { e.preventDefault(); router.go({ name: 'home' }); }}>Digital Canvas</a>
        <span class="title" data-testid="view-title">{ed.doc.title}</span>
        {#if by}<span class="by" data-testid="shared-by">by {by}</span>{/if}
        <span class="badge" data-testid="view-only"><Icon name="eye" size={16} /> View only</span>
      </div>
      <div class="right">
        {#if isVideo(ed.doc)}
          <button class="hb" onclick={() => (ed!.player.playing ? ed!.player.pause() : ed!.player.play())} data-testid="view-play">
            <Icon name={ed.player.playing ? 'pause' : 'play'} size={18} /> {ed.player.playing ? 'Pause' : 'Play'}
          </button>
        {/if}
        <button class="hb" onclick={() => (presenting = true)} data-testid="view-present"><Icon name="expand" size={18} /> Present</button>
        <button class="hb" onclick={() => void copy()} disabled={copying} data-testid="make-copy"><Icon name="copy" size={18} /> Make a copy</button>
        <div class="dl-wrap">
          <button class="share" onclick={(e) => { e.stopPropagation(); showDownload = !showDownload; }} data-testid="download"><Icon name="download" size={18} /> Download</button>
          {#if showDownload}<DownloadMenu {ed} onclose={() => (showDownload = false)} />{/if}
        </div>
      </div>
    </header>
    {#if missing}<div class="warn" data-testid="view-missing">{missing} picture{missing === 1 ? '' : 's'} or clip{missing === 1 ? '' : 's'} could not be loaded.</div>{/if}
    <main class="work"><Canvas {ed} /></main>
  </div>
  {#if presenting}<Present {ed} onclose={() => (presenting = false)} />{/if}
{/if}

<style>
  .center { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--muted); background: var(--stage); padding: 24px; text-align: center; }
  .center p { max-width: 460px; margin: 0; }
  .row { display: flex; gap: 8px; }
  .spinner { width: 28px; height: 28px; border-radius: 50%; border: 3px solid var(--line); border-top-color: var(--accent); animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .viewer { height: 100%; display: flex; flex-direction: column; }
  .top { height: 57px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 8px 0 16px; background: var(--header); color: #fff; }
  .left, .right { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .brand { color: #fff; font-weight: 800; text-decoration: none; white-space: nowrap; }
  .title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .by { opacity: .85; font-size: 13px; white-space: nowrap; }
  .badge { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 999px; background: rgba(0,0,0,.22); font-size: 13px; font-weight: 600; white-space: nowrap; }
  .hb { height: 40px; padding: 0 12px; display: inline-flex; align-items: center; gap: 6px; border: 0; border-radius: 12px; background: transparent; color: #fff; font-size: 14px; font-weight: 600; white-space: nowrap; }
  .hb:hover:not(:disabled) { background: rgba(255,255,255,.15); }
  .dl-wrap { position: relative; }
  .share { height: 40px; padding: 0 16px; display: inline-flex; align-items: center; gap: 8px; border: 0; border-radius: 12px; background: rgba(255,255,255,.9); color: #0d1216; font-size: 14px; font-weight: 600; }
  .warn { background: #fff4d6; color: #6b4e00; font-size: 13px; padding: 6px 16px; }
  .work { position: relative; flex: 1; display: flex; flex-direction: column; min-height: 0; background: var(--stage); overflow: hidden; }
  @media (max-width: 767px) {
    .by, .brand { display: none; }
    .top { padding: 0 6px 0 10px; }
  }
</style>
