<script lang="ts">
  /**
   * `/plugin/<fileId>`: a plugin someone shared by link. The `.dcplugin` is
   * read like a public design (OAuth first, then the API key), shown, and
   * "Add to my plugins" installs it into the current store (Drive when signed
   * in, else this browser / the desktop folder).
   */
  import '../editor/panels/panels.css';
  import { onMount, untrack } from 'svelte';
  import { readSharedPlugin } from '@digital-canvas/storage';
  import type { Plugin } from '@digital-canvas/scene';
  import Icon, { type IconName } from '../lib/Icon.svelte';
  import { account } from '../lib/account.svelte.ts';
  import { library } from '../lib/library.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { driveApiKey } from '../lib/sharing.ts';
  import { addCssFace } from '../lib/fonts.ts';
  import { mimeOfImage, plugins } from '../lib/plugins/plugins.svelte.ts';
  import { KIND_LABEL, pluginSummary } from '../lib/plugins/pluginutil.ts';

  let { fileId }: { fileId: string } = $props();

  let read = $state.raw<{ plugin: Plugin; assets: Map<string, Uint8Array> } | null>(null);
  let error = $state('');
  let installing = $state(false);
  let done = $state(false);
  let photo = $state('');
  const ICON: Record<Plugin['kind'], IconName> = { animation: 'animate', effect: 'sparkle', font: 'text', mockup: 'tshirt' };

  onMount(() => {
    (async () => {
      try {
        const r = await readSharedPlugin(untrack(() => fileId), { token: account.user ? account.driveToken : null, apiKey: driveApiKey() });
        read = r;
        const p = r.plugin;
        if (p.kind === 'mockup') { const b = r.assets.get(p.photo); if (b) photo = URL.createObjectURL(new Blob([b as BlobPart], { type: mimeOfImage(b) })); }
        if (p.kind === 'font') for (const f of p.faces) { const b = r.assets.get(f.asset); if (b) addCssFace(`dcpl-install-${p.id}`, `install:${f.asset}`, b, f.weight, f.italic); }
        await plugins.load(library.store);
      } catch (e) {
        const status = (e as { status?: number }).status;
        error = status === 404 || status === 403
          ? 'This plugin link doesn’t work any more, or it isn’t shared publicly. Ask the person who sent it to share it again.'
          : `Couldn't open the plugin: ${e instanceof Error ? e.message.replace(/^Google Drive: /, '') : e}`;
      }
    })();
    return () => { if (photo) URL.revokeObjectURL(photo); };
  });

  const installed = $derived(read ? plugins.get(read.plugin.id) : undefined);

  async function install(): Promise<void> {
    if (!read) return;
    installing = true;
    try {
      await plugins.load(library.store);
      await plugins.installRead(read.plugin, read.assets);
      done = true;
    } catch (e) {
      error = `Couldn't add it: ${e instanceof Error ? e.message : e}`;
    } finally {
      installing = false;
    }
  }
  async function signIn(): Promise<void> {
    if (await account.signIn()) await plugins.load(library.store, true);
  }
</script>

<div class="pi" data-testid="plugin-install">
  {#if error}
    <div class="card" data-testid="plugin-install-error"><Icon name="alert" size={28} /><p>{error}</p><button class="btn" onclick={() => router.go({ name: 'home' })}>Open Digital Canvas</button></div>
  {:else if !read}
    <div class="card"><span class="dp-spin"></span><p>Opening the plugin…</p></div>
  {:else}
    {@const p = read.plugin}
    <div class="card">
      <div class="pic">
        {#if photo}<img src={photo} alt="" />
        {:else if p.kind === 'font'}<span class="aa" style="font-family:'dcpl-install-{p.id}', Inter">Aa Bb</span>
        {:else}<Icon name={ICON[p.kind]} size={40} />{/if}
      </div>
      <small class="kind">{KIND_LABEL[p.kind]} plugin</small>
      <h1 data-testid="plugin-install-name">{p.name}</h1>
      <p class="sum">{pluginSummary(p)}{p.author ? ` · by ${p.author}` : ''}</p>
      {#if p.description}<p>{p.description}</p>{/if}
      {#if p.kind === 'font' && p.license}<p class="lic">Licence: {p.license}</p>{/if}
      {#if p.kind === 'effect' && p.shader}<p class="lic">Includes shader code that runs when you use the effect.</p>{/if}
      {#if done}
        <p class="ok" data-testid="plugin-installed"><Icon name="check" size={16} /> Added to your plugins.</p>
        <button class="btn primary" data-testid="plugin-install-open" onclick={() => router.go({ name: 'home' })}>Start designing</button>
      {:else}
        <button class="btn primary" data-testid="plugin-install-add" disabled={installing} onclick={install}>{installed ? 'Update my copy' : 'Add to my plugins'}</button>
        <p class="where">{library.store.kind === 'drive' ? 'It goes in your Google Drive (Digital Canvas folder).' : library.store.kind === 'folder' ? 'It goes in your designs folder.' : 'It is kept in this browser.'}
          {#if !account.user && library.store.kind !== 'folder'}<button class="lnk" onclick={signIn}>Sign in</button> to keep it in your Drive.{/if}</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .pi { height: 100%; display: grid; place-items: center; background: var(--stage); padding: 24px; overflow: auto; }
  .card { width: 420px; max-width: 100%; background: var(--panel); border-radius: 16px; box-shadow: var(--shadow); padding: 24px; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; color: var(--ink); }
  .pic { width: 100%; aspect-ratio: 16 / 10; border-radius: 12px; background: var(--chip); display: grid; place-items: center; overflow: hidden; color: var(--accent); }
  .pic img { width: 100%; height: 100%; object-fit: cover; }
  .aa { font-size: 52px; color: var(--ink); }
  .kind { color: var(--muted); text-transform: uppercase; letter-spacing: .06em; font-size: 11px; font-weight: 600; margin-top: 6px; }
  h1 { margin: 0; font-size: 22px; }
  p { margin: 0; color: var(--muted); font-size: 14px; line-height: 1.5; }
  .lic { font-size: 12px; }
  .ok { color: var(--ink); display: flex; align-items: center; gap: 6px; }
  .btn.primary { margin-top: 8px; height: 40px; padding: 0 20px; }
  .where { font-size: 12px; }
  .lnk { border: 0; background: none; padding: 0; color: var(--accent); font: inherit; text-decoration: underline; }
</style>
