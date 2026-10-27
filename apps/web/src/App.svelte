<script lang="ts">
  import { onMount } from 'svelte';
  import Home from './routes/Home.svelte';
  import Editor from './editor/Editor.svelte';
  import { router } from './lib/router.svelte.ts';
  import { library } from './lib/library.svelte.ts';
  import { account } from './lib/account.svelte.ts';
  import { openWith } from './lib/openwith.svelte.ts';
  import type { DriveStore } from '@digital-canvas/storage';

  onMount(() => void library.init());

  // Drive "Open with" / "New": run once signed in.
  $effect(() => {
    if (library.ready && account.user && openWith.pending && library.store.kind === 'drive') void openWith.run(library.store as DriveStore);
  });
</script>

{#if openWith.pending && library.ready && !account.user}
  <div class="drive-req" data-testid="drive-signin">Sign in with Google to open the file from Drive.</div>
{/if}
{#if openWith.error}<div class="drive-req err">{openWith.error}</div>{/if}
{#if !library.ready || openWith.busy}
  <div class="boot">Loading…</div>
{:else if router.route.name === 'editor'}
  {#key `${router.route.id}:${library.store.kind}:${library.store.label}`}
    <Editor id={router.route.id} store={library.store} />
  {/key}
{:else}
  <Home />
{/if}

<style>
  .boot { height: 100%; display: grid; place-items: center; color: var(--muted); }
  .drive-req { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 50; background: var(--pop); border: 1px solid var(--line); border-radius: 10px; padding: 10px 16px; box-shadow: var(--shadow); font-weight: 600; }
  .drive-req.err { color: var(--danger); }
</style>
