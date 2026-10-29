<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import Home from './routes/Home.svelte';
  import Editor from './editor/Editor.svelte';
  import SharedOpen from './routes/SharedOpen.svelte';
  import PublicView from './routes/PublicView.svelte';
  import { router } from './lib/router.svelte.ts';
  import { library } from './lib/library.svelte.ts';
  import { account } from './lib/account.svelte.ts';
  import { openWith } from './lib/openwith.svelte.ts';
  import type { DriveStore } from '@digital-canvas/storage';
  import Toasts from './lib/Toasts.svelte';
  import Tooltips from './lib/Tooltips.svelte';
  import TabStrip from './lib/TabStrip.svelte';
  import { tabs } from './lib/tabs.svelte.ts';
  import { stripMode } from './lib/tabmodel.ts';
  import { titlebar } from './lib/titlebar.svelte.ts';
  import { mobile } from './lib/mobile.svelte.ts';
  import { bridgeUi } from './lib/bridge/bridgeUi.svelte.ts';
  import BridgeIndicator from './lib/bridge/BridgeIndicator.svelte';
  import AiDialog from './lib/bridge/AiDialog.svelte';

  onMount(() => void library.init());

  // "Let AI use this device" was left on: start taking requests once signed in.
  $effect(() => {
    if (account.user && bridgeUi.enabled) untrack(() => void bridgeUi.resume());
    // signed out: this device stops taking requests (it was the previous account's)
    else if (account.known && !account.user && untrack(() => bridgeUi.status !== 'off')) void import('./lib/bridge/bridge.svelte.ts').then((m) => m.stopBridge());
  });

  // Drive "Open with" / "New": run once signed in.
  $effect(() => {
    const u = account.user;
    if (library.ready && u && openWith.pending && library.store.kind === 'drive' && openWith.otherAccount !== u.uid) void openWith.run(library.store as DriveStore, u.uid);
  });

  // an editor route opens (or focuses) that design's tab
  $effect(() => {
    const r = router.route;
    if (r.name === 'editor') untrack(() => tabs.ensure(r.id)); // only on route changes, not when tabs change
  });

  const mode = $derived(stripMode({ mobile: mobile.on, wco: titlebar.wco, standalone: titlebar.standalone, count: tabs.list.length }));

  // Windows paints the caption buttons in the theme colour: match the bar under them
  $effect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name=theme-color]');
    if (!meta) return;
    const dark = matchMedia('(prefers-color-scheme: dark)');
    const set = () => (meta.content = titlebar.wco ? (dark.matches ? '#401779' : '#5d1fad') : '#7d2ae8');
    set();
    dark.addEventListener('change', set);
    return () => dark.removeEventListener('change', set);
  });

  /** ⌘T new, ⌘W close, Ctrl+Tab / Ctrl+Shift+Tab switch, ⌘1..⌘9 go to a tab (desktop). */
  function tabKeys(e: KeyboardEvent): void {
    if (mobile.on && !titlebar.wco) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    let done = true;
    if (e.ctrlKey && !e.altKey && !e.metaKey && k === 'tab') tabs.step(e.shiftKey ? -1 : 1);
    else if (mod && !e.altKey && !e.shiftKey && k === 't') tabs.create();
    else if (mod && !e.altKey && !e.shiftKey && k === 'w' && tabs.activeId) tabs.close(tabs.activeId);
    else if (mod && !e.altKey && !e.shiftKey && /^Digit[1-9]$/.test(e.code)) done = tabs.goNth(Number(e.code.slice(5)));
    else done = false;
    if (done) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
</script>

<svelte:window onkeydowncapture={tabKeys} />

{#if openWith.pending && library.ready && !account.user}
  <div class="drive-req" data-testid="drive-signin">Sign in with Google to open the file from Drive.
    <button class="btn primary" disabled={account.busy} onclick={() => void account.signIn()} data-testid="drive-signin-btn">Sign in</button></div>
{/if}
{#if openWith.otherAccount && account.user}
  <div class="drive-req" data-testid="drive-other-account">
    Drive opened this file for another Google account than {account.user.email}.
    <button class="btn primary" onclick={async () => { await account.signOut(); await account.signIn(); }}>Switch account</button>
    <button class="btn ghost" onclick={() => openWith.drop()}>Cancel</button>
  </div>
{/if}
{#if openWith.error}<div class="drive-req err" data-testid="drive-error">{openWith.error} <button class="btn ghost" onclick={() => (openWith.error = '')}>Close</button></div>{/if}
<div class="shell">
  {#if mode !== 'none'}<TabStrip {mode} />{/if}
  <div class="main">
    {#if router.route.name === 'view'}
      {#key router.route.fileId}<PublicView fileId={router.route.fileId} />{/key}
    {:else if !library.ready || openWith.busy}
      <div class="boot">Loading…</div>
    {:else if router.route.name === 'shared' || router.route.name === 'template'}
      {#key `${router.route.name}:${router.route.fileId}`}<SharedOpen fileId={router.route.fileId} template={router.route.name === 'template'} />{/key}
    {:else if router.route.name === 'editor'}
      {#key `${router.route.id}:${library.store.kind}:${library.store.label}`}
        <Editor id={router.route.id} store={library.store} />
      {/key}
    {:else}
      <Home />
    {/if}
  </div>
</div>
<BridgeIndicator />
{#if bridgeUi.open}<AiDialog onclose={() => (bridgeUi.open = false)} />{/if}
<Toasts />
<Tooltips />

<style>
  .shell { height: 100%; display: flex; flex-direction: column; }
  .main { position: relative; flex: 1; min-height: 0; }
  .boot { height: 100%; display: grid; place-items: center; color: var(--muted); }
  .drive-req { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 50; background: var(--pop); border: 1px solid var(--line); border-radius: 10px; padding: 10px 16px; box-shadow: var(--shadow); font-weight: 600; }
  .drive-req.err { color: var(--danger); }
</style>
