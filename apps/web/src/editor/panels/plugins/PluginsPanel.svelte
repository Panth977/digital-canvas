<script lang="ts">
  /**
   * Plugins: the user's own animations, effects, fonts and mockups. Lists them
   * by kind, opens the creators, imports / exports `.dcplugin` files and shares
   * a plugin by link (Drive). Kept in the current store (plugins.svelte.ts).
   */
  import '../panels.css';
  import { untrack } from 'svelte';
  import { PLUGIN_KINDS, type Plugin, type PluginKind } from '@digital-canvas/scene';
  import { PLUGIN_EXT } from '@digital-canvas/storage';
  import type { EditorState } from '../../../lib/editor.svelte.ts';
  import Icon, { type IconName } from '../../../lib/Icon.svelte';
  import { download, pickFiles } from '../../../lib/files.ts';
  import { library } from '../../../lib/library.svelte.ts';
  import { account } from '../../../lib/account.svelte.ts';
  import { toast } from '../../../lib/toast.svelte.ts';
  import { ui } from '../../../lib/ui.svelte.ts';
  import { plugins } from '../../../lib/plugins/plugins.svelte.ts';
  import { KIND_LABEL, KIND_PLURAL, pluginSummary } from '../../../lib/plugins/pluginutil.ts';
  import { applyAnimation, applyEffect, effectFits } from '../../../lib/plugins/apply.ts';
  import AnimationCreator from './AnimationCreator.svelte';
  import EffectCreator from './EffectCreator.svelte';
  import FontCreator from './FontCreator.svelte';
  import MockupCreator from './MockupCreator.svelte';

  let { ed }: { ed: EditorState } = $props();

  $effect(() => { const s = library.store; untrack(() => void plugins.load(s)); });

  let kind = $state<PluginKind | 'all'>('all');
  let menu = $state<string | null>(null);
  let creating = $state(false);
  let shared = $state<{ id: string; link: string } | null>(null);
  let busy = $state('');
  let dragging = $state(false);

  const ICON: Record<PluginKind, IconName> = { animation: 'animate', effect: 'sparkle', font: 'text', mockup: 'tshirt' };
  const BLURB: Record<PluginKind, string> = {
    animation: 'From CSS @keyframes or a keyframe table',
    effect: 'A look preset and/or an SkSL shader',
    font: 'Upload TTF, OTF, WOFF or WOFF2',
    mockup: 'Your photo with the design on it',
  };
  const shown = $derived(kind === 'all' ? plugins.list : plugins.list.filter((p) => p.kind === kind));
  const editing = $derived(plugins.editing);
  const editingPlugin = $derived(editing?.id ? plugins.get(editing.id) : undefined);

  function create(k: PluginKind): void {
    creating = false;
    plugins.editing = { kind: k };
  }
  const close = () => (plugins.editing = null);

  async function importFiles(files: File[]): Promise<void> {
    for (const f of files) {
      busy = 'import';
      try {
        const p = await plugins.install(new Uint8Array(await f.arrayBuffer()));
        toast.show(`Added “${p.name}” to your plugins`);
        kind = 'all';
      } catch (e) {
        toast.show(`${f.name}: ${e instanceof Error ? e.message : e}`);
      } finally {
        busy = '';
      }
    }
  }
  async function pickImport(): Promise<void> {
    await importFiles(await pickFiles(`${PLUGIN_EXT},.json,application/zip`, true, 'files'));
  }
  function onDrop(e: DragEvent): void {
    dragging = false;
    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => /\.(dcplugin|json)$/i.test(f.name));
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    void importFiles(files);
  }
  function onDragOver(e: DragEvent): void {
    if (![...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file')) return;
    e.preventDefault();
    dragging = true;
  }

  async function exportOne(p: Plugin): Promise<void> {
    menu = null;
    try {
      await download(await plugins.pack(p.id), plugins.fileName(p.id), 'application/zip');
    } catch (e) {
      toast.show(`Couldn't export: ${e instanceof Error ? e.message : e}`);
    }
  }
  async function share(p: Plugin): Promise<void> {
    menu = null;
    if (!account.user) {
      if (!(await account.signIn())) return;
      await plugins.load(library.store);
    }
    busy = `share:${p.id}`;
    try {
      const link = await plugins.share(p.id);
      shared = { id: p.id, link };
      await navigator.clipboard?.writeText(link).catch(() => {});
      toast.show('Link copied: anyone with it can add this plugin');
    } catch (e) {
      toast.show(`Couldn't share: ${e instanceof Error ? e.message : e}`);
    } finally {
      busy = '';
    }
  }
  async function remove(p: Plugin): Promise<void> {
    menu = null;
    if (!(await toast.ask({ title: `Delete “${p.name}”?`, body: 'Designs that use it keep it: they hold their own copy.', ok: 'Delete', danger: true }))) return;
    await plugins.remove(p.id);
  }
  async function duplicate(p: Plugin): Promise<void> {
    menu = null;
    await plugins.duplicate(p.id);
  }

  /** "Use": what each kind does with the selection. */
  async function use(p: Plugin): Promise<void> {
    if (p.kind === 'animation') { applyAnimation(ed, p); ui.open('animate', false); return; }
    if (p.kind === 'effect') {
      const n = applyEffect(ed, p);
      if (!n) toast.show(p.target === 'text' ? 'Select some text to use this effect' : p.target === 'image' ? 'Select a photo or video to use this effect' : 'Select something to use this effect');
      return;
    }
    if (p.kind === 'font') {
      if (!ed.selected.some((e) => e.type === 'text')) { toast.show('Select some text to use this font'); return; }
      try { await plugins.useFont(ed, p); } catch (e) { toast.show(e instanceof Error ? e.message : String(e)); }
      return;
    }
    ui.rail('mockups');
  }
  const useLabel = (p: Plugin) => (p.kind === 'mockup' ? 'Show' : 'Use');
  const canUse = (p: Plugin) => p.kind === 'mockup' || p.kind === 'animation' || (p.kind === 'effect' ? ed.selected.some((e) => effectFits(p, e)) : ed.selected.some((e) => e.type === 'text'));

  $effect(() => { for (const p of plugins.of('font')) void plugins.previewFont(p); });
</script>

<svelte:window onclick={() => { menu = null; creating = false; }} />

{#if editing?.kind === 'animation'}
  <AnimationCreator {ed} plugin={editingPlugin?.kind === 'animation' ? editingPlugin : undefined} onclose={close} />
{:else if editing?.kind === 'effect'}
  <EffectCreator {ed} plugin={editingPlugin?.kind === 'effect' ? editingPlugin : undefined} onclose={close} />
{:else if editing?.kind === 'font'}
  <FontCreator {ed} plugin={editingPlugin?.kind === 'font' ? editingPlugin : undefined} onclose={close} />
{:else}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="dp pl" class:drag={dragging} data-testid="plugins-panel" ondragover={onDragOver} ondragleave={() => (dragging = false)} ondrop={onDrop}>
    <div class="dp-row pl-top">
      <div class="grow pl-new">
        <button class="btn primary dp-cta" data-testid="plugin-create" aria-haspopup="menu" aria-expanded={creating} onclick={(e) => { e.stopPropagation(); creating = !creating; }}><Icon name="plus" size={16} /> Create a plugin</button>
        {#if creating}
          <div class="pl-menu pop" role="menu" data-testid="plugin-create-menu">
            {#each PLUGIN_KINDS as k (k)}
              <button role="menuitem" class="dp-item" data-testid="plugin-new-{k}" onclick={() => create(k)}>
                <span class="dp-ico"><Icon name={ICON[k]} size={20} /></span>
                <span class="dp-tx"><b>{KIND_LABEL[k]}</b><small>{BLURB[k]}</small></span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <button class="btn icon" title="Import a .dcplugin file" aria-label="Import a .dcplugin file" data-testid="plugin-import" disabled={busy === 'import'} onclick={pickImport}><Icon name="upload" size={16} /></button>
    </div>

    <div class="dp-chips" role="tablist" aria-label="Plugin kinds">
      <button class="dp-chip" class:on={kind === 'all'} role="tab" aria-selected={kind === 'all'} onclick={() => (kind = 'all')}>All</button>
      {#each PLUGIN_KINDS as k (k)}
        <button class="dp-chip" class:on={kind === k} role="tab" aria-selected={kind === k} data-testid="plugin-kind-{k}" onclick={() => (kind = k)}>{KIND_PLURAL[k]}</button>
      {/each}
    </div>

    {#if plugins.error}<p class="dp-err">{plugins.error}</p>{/if}
    {#if plugins.status === 'loading'}
      <p class="dp-empty"><span class="dp-spin"></span> Loading your plugins…</p>
    {:else if !shown.length}
      <div class="dp-empty" data-testid="plugins-empty">
        <Icon name="puzzle" size={32} />
        <p>{kind === 'all' ? 'Make your own animations, effects, fonts and mockups, or drop a .dcplugin file here.' : `No ${KIND_PLURAL[kind].toLowerCase()} yet.`}</p>
        {#if kind !== 'all'}<button class="btn" onclick={() => create(kind as PluginKind)}>Create {KIND_LABEL[kind].toLowerCase()}</button>{/if}
      </div>
    {:else}
      <div class="dp-list" data-testid="plugin-list">
        {#each shown as p (p.id)}
          <div class="pl-row" data-testid="plugin-{p.id}" data-kind={p.kind} data-name={p.name}>
            <button class="dp-item" title="Edit {p.name}" onclick={() => (p.kind === 'mockup' ? (plugins.editing = { kind: 'mockup', id: p.id }) : (plugins.editing = { kind: p.kind, id: p.id }))}>
              <span class="dp-ico">
                {#if p.kind === 'mockup' && plugins.photoUrl(p)}
                  <img src={plugins.photoUrl(p)} alt="" />
                {:else if p.kind === 'font'}
                  <span class="pl-aa" style="font-family:'{p.family}', Inter">Aa</span>
                {:else}
                  <Icon name={ICON[p.kind]} size={20} />
                {/if}
              </span>
              <span class="dp-tx"><b>{p.name}</b><small>{KIND_LABEL[p.kind]} · {pluginSummary(p)}</small></span>
            </button>
            <button class="btn pl-use" data-testid="plugin-use-{p.id}" disabled={!canUse(p)} onclick={() => use(p)}>{useLabel(p)}</button>
            <div class="pl-more">
              <button class="btn ghost icon" title="More" aria-label="More for {p.name}" aria-haspopup="menu" data-testid="plugin-more-{p.id}" onclick={(e) => { e.stopPropagation(); menu = menu === p.id ? null : p.id; }}><Icon name="more" size={16} /></button>
              {#if menu === p.id}
                <div class="pl-menu right pop" role="menu">
                  <button role="menuitem" data-testid="plugin-edit" onclick={() => { menu = null; plugins.editing = { kind: p.kind, id: p.id }; }}><Icon name="pen" size={15} /> Edit</button>
                  <button role="menuitem" data-testid="plugin-duplicate" onclick={() => duplicate(p)}><Icon name="copy" size={15} /> Duplicate</button>
                  <button role="menuitem" data-testid="plugin-export" onclick={() => exportOne(p)}><Icon name="download" size={15} /> Download .dcplugin</button>
                  <button role="menuitem" data-testid="plugin-share" disabled={busy.startsWith('share')} onclick={() => share(p)}><Icon name="link" size={15} /> Share link</button>
                  <button role="menuitem" class="danger" data-testid="plugin-delete" onclick={() => remove(p)}><Icon name="trash" size={15} /> Delete</button>
                </div>
              {/if}
            </div>
          </div>
          {#if shared?.id === p.id}
            <div class="dp-box pl-link" data-testid="plugin-share-box">
              <input readonly value={shared.link} data-testid="plugin-share-link" aria-label="Share link" onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
              <button class="btn" onclick={() => navigator.clipboard?.writeText(shared!.link)}>Copy</button>
              <button class="btn ghost icon" aria-label="Close" onclick={() => (shared = null)}><Icon name="close" size={14} /></button>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
    <p class="dp-hint">{library.store.kind === 'drive' ? 'Kept in your Google Drive (Digital Canvas folder).' : library.store.kind === 'folder' ? 'Kept in your designs folder.' : 'Kept in this browser. Sign in to keep them in your Google Drive.'} Designs carry their own copy of what they use, so they open the same anywhere. Drop a .dcplugin file here to add it.</p>
  </div>
{/if}

{#if editing?.kind === 'mockup'}
  <MockupCreator {ed} plugin={editingPlugin?.kind === 'mockup' ? editingPlugin : undefined} onclose={close} />
{/if}

<style>
  .pl { position: relative; }
  .pl.drag::after { content: 'Drop to add the plugin'; position: absolute; inset: 0; display: grid; place-items: center; border: 2px dashed var(--accent); border-radius: 10px; background: color-mix(in srgb, var(--panel) 85%, transparent); color: var(--accent); font-weight: 600; z-index: 4; }
  .pl-top { margin-bottom: 12px; }
  .pl-new, .pl-more { position: relative; }
  .pl-menu { position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 20; background: var(--pop); border-radius: 10px; box-shadow: var(--shadow); padding: 6px; display: flex; flex-direction: column; }
  .pl-menu.right { left: auto; right: 0; width: 200px; }
  .pl-menu > button:not(.dp-item) { display: flex; align-items: center; gap: 8px; border: 0; background: none; padding: 8px 10px; border-radius: 6px; color: var(--ink); text-align: left; font-size: 13px; }
  .pl-menu > button:hover { background: var(--hover); }
  .pl-menu .danger { color: var(--danger); }
  .pl-row { display: flex; align-items: center; gap: 4px; }
  .pl-row > .dp-item { flex: 1; min-width: 0; }
  .pl-use { height: 30px; padding: 0 10px; font-size: 12px; }
  .pl-aa { font-size: 18px; font-weight: 600; }
  .pl-link { display: flex; gap: 6px; align-items: center; padding: 8px; margin: 2px 0 6px; }
  .pl-link input { flex: 1; min-width: 0; height: 32px; border: 1px solid var(--line); border-radius: 6px; background: var(--field); color: var(--ink); padding: 0 8px; font-size: 12px; }
  .dp-empty :global(.svgi) { display: block; margin: 0 auto 8px; color: var(--muted); }
  .dp-empty p { margin: 0 0 12px; }
</style>
