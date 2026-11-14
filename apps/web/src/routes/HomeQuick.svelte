<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { ProjectStore } from '@digital-canvas/storage';
  import { EditorState } from '../lib/editor.svelte.ts';
  import { engine } from '../lib/engine.ts';
  import { loadAccess } from '../lib/shared.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import SharePopover from '../editor/SharePopover.svelte';
  import DownloadMenu from '../editor/DownloadMenu.svelte';

  /**
   * Home › a design's ⋯ menu › Share / Download: the editor's own Share popover and
   * Download panel, without opening the design. The design is loaded off screen (no
   * canvas), used by the panel, and let go when the dialog closes.
   */
  let { id, title, store, mode: start, onclose }: { id: string; title: string; store: ProjectStore; mode: 'share' | 'download'; onclose: () => void } = $props();

  let mode = $state<'share' | 'download'>(untrack(() => start));
  let ed = $state<EditorState | null>(null);
  let error = $state('');

  onMount(() => {
    let cancelled = false;
    let made: EditorState | null = null;
    (async () => {
      try {
        const [eng, file] = await Promise.all([engine(), store.open(id)]);
        if (cancelled) return;
        made = new EditorState(eng, store, file);
        await loadAccess(made);
        if (cancelled) return;
        ed = made;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    })();
    return () => {
      cancelled = true;
      // finish any save the panel started (sharing writes links.json), then let it go
      const e = made;
      if (e) void (e.saveState === 'saved' ? Promise.resolve() : e.save(true).catch(() => {})).finally(() => e.dispose());
    };
  });

  function key(e: KeyboardEvent): void {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window onkeydown={key} />
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" data-testid="home-quick" data-mode={mode} onclick={onclose}>
  <div class="box" onclick={(e) => e.stopPropagation()}>
    {#if error}
      <div class="msg err" data-testid="home-quick-error">Couldn't open “{title}”: {error}</div>
    {:else if !ed}
      <div class="msg"><div class="spinner"></div> Opening “{title}”…</div>
    {:else if mode === 'share'}
      <SharePopover {ed} {onclose} ondownload={() => (mode = 'download')} onpresent={() => { onclose(); router.go({ name: 'editor', id }); }} />
    {:else}
      <DownloadMenu {ed} {onclose} />
    {/if}
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 200; background: rgba(0, 0, 0, .35); display: grid; place-items: start center; padding: 10vh 16px 16px; }
  .box { position: relative; }
  .box :global(.sh), .box :global(.dl) { position: static; max-height: 80vh; }
  .msg { background: var(--pop); color: var(--ink); border-radius: 12px; box-shadow: var(--shadow); padding: 18px 20px; display: flex; align-items: center; gap: 10px; min-width: 300px; }
  .err { color: var(--danger); }
  .spinner { width: 20px; height: 20px; border-radius: 50%; border: 3px solid var(--line); border-top-color: var(--accent); animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
