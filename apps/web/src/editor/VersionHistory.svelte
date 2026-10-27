<script lang="ts">
  import type { ProjectFile, Version } from '@digital-canvas/storage';
  import type { EditorState } from '../lib/editor.svelte.ts';
  import { objectUrl } from '../lib/files.ts';
  import { toast } from '../lib/toast.svelte.ts';
  import Icon from '../lib/Icon.svelte';

  /**
   * Canva's Version history: earlier saves on the left (from Drive's file
   * revisions), a preview of the one picked, "Restore this version".
   * Restoring is one undoable change in the editor.
   */
  let { ed, onclose }: { ed: EditorState; onclose: () => void } = $props();

  let versions = $state<Version[] | null>(null);
  let error = $state('');
  let picked = $state<string | null>(null);
  let file = $state.raw<ProjectFile | null>(null);
  let loading = $state(false);
  const cache = new Map<string, ProjectFile>();

  $effect(() => {
    void (async () => {
      try {
        await ed.save();
        const all = await ed.store.versions!(ed.doc.id);
        versions = all.slice(1); // the newest is what you see now
        if (versions.length) void pick(versions[0]!.id);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    })();
  });

  async function pick(id: string): Promise<void> {
    picked = id;
    file = cache.get(id) ?? null;
    if (file) return;
    loading = true;
    try {
      const f = await ed.store.openVersion!(ed.doc.id, id);
      cache.set(id, f);
      if (picked === id) file = f;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  function restore(): void {
    if (!file) return;
    ed.loadVersion(file);
    onclose();
    toast.show('Version restored', { action: { label: 'Undo', run: () => ed.undo() } });
  }

  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={onclose}>
  <div class="vh" role="dialog" tabindex="-1" aria-modal="true" aria-label="Version history" data-testid="version-history" onclick={(e) => e.stopPropagation()}>
    <header>
      <button class="btn ghost" onclick={onclose}><Icon name="left" size={16} /> Back to design</button>
      <b>Version history</b>
      <button class="btn primary" disabled={!file} onclick={restore} data-testid="version-restore">Restore this version</button>
    </header>
    <div class="cols">
      <div class="preview">
        {#if file?.thumbnail}
          <img src={objectUrl(file.thumbnail)} alt="Page 1 of this version" data-testid="version-preview" />
          <span>{file.doc.pages.length} page{file.doc.pages.length === 1 ? '' : 's'} · {file.doc.title}</span>
        {:else if loading}
          <div class="spinner"></div>
        {:else if versions && !versions.length}
          <p>No earlier versions yet. Drive keeps one each time the design is saved (for about 30 days).</p>
        {/if}
        {#if error}<p class="err">{error}</p>{/if}
      </div>
      <ol class="list scroll-y" data-testid="version-list">
        {#if !versions && !error}<li class="muted">Loading versions…</li>{/if}
        {#each versions ?? [] as v, i (v.id)}
          {#if i === 0 || day(v.modifiedTime) !== day(versions![i - 1]!.modifiedTime)}<li class="day">{day(v.modifiedTime)}</li>{/if}
          <li>
            <button class:on={picked === v.id} data-testid="version-item" onclick={() => pick(v.id)}>
              <b>{when(v.modifiedTime)}</b>
              <span>Saved to Google Drive{v.size ? ` · ${Math.max(1, Math.round(v.size / 1024))} KB` : ''}</span>
            </button>
          </li>
        {/each}
      </ol>
    </div>
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 900; background: rgba(0,0,0,.5); display: grid; place-items: center; }
  .vh { width: min(1100px, calc(100% - 48px)); height: min(720px, calc(100% - 48px)); display: flex; flex-direction: column; background: var(--panel); color: var(--ink); border-radius: 12px; overflow: hidden; box-shadow: var(--shadow); }
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
  .cols { flex: 1; display: grid; grid-template-columns: 1fr 320px; min-height: 0; }
  .preview { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 24px; background: var(--stage); min-height: 0; }
  .preview img { max-width: 100%; max-height: calc(100% - 30px); object-fit: contain; box-shadow: var(--page-shadow); background: #fff; }
  .preview span, .preview p { color: var(--muted); font-size: 13px; text-align: center; max-width: 360px; }
  .list { list-style: none; margin: 0; padding: 8px; border-left: 1px solid var(--line); }
  .day { font-size: 12px; font-weight: 600; color: var(--muted); padding: 12px 10px 4px; }
  .muted { color: var(--muted); padding: 10px; font-size: 13px; }
  .list button { width: 100%; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 10px; border: 0; background: none; border-radius: 8px; text-align: left; color: inherit; }
  .list button:hover { background: var(--hover); }
  .list button.on { background: var(--accent-soft); }
  .list span { font-size: 12px; color: var(--muted); }
  .err { color: var(--danger) !important; }
  .spinner { width: 28px; height: 28px; border-radius: 50%; border: 3px solid var(--line); border-top-color: var(--accent); animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
