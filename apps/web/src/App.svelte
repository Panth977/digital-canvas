<script lang="ts">
  import { onMount } from 'svelte';
  import Home from './routes/Home.svelte';
  import Editor from './editor/Editor.svelte';
  import { router } from './lib/router.svelte.ts';
  import { library } from './lib/library.svelte.ts';

  onMount(() => void library.init());
</script>

{#if !library.ready}
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
</style>
