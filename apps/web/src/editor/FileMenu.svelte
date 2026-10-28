<script lang="ts">
  import { createDoc, PRESETS, isVideo, formatLength } from '@digital-canvas/scene';
  import { view } from '../lib/view.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import type { EditorState } from '../lib/editor.svelte.ts';
  import { toast } from '../lib/toast.svelte.ts';
  import { copyDesign, trashIsUndoable } from '../lib/designs.ts';
  import { IMAGE_TYPES, pickFiles } from '../lib/files.ts';
  import { AUDIO_TYPES, VIDEO_TYPES } from '../lib/media.ts';
  import Icon from '../lib/Icon.svelte';
  import { bridgeUi } from '../lib/bridge/bridgeUi.svelte.ts';

  /**
   * Canva's File menu: the design's name and size, Create new design ▸,
   * Upload files, Settings ▸, Save, Make a copy, Download, Version history,
   * Move to trash, Help ▸.
   */
  let { ed, bleed, onclose, ondownload, onversions, onshortcuts }: {
    ed: EditorState; bleed: number; onclose: () => void; ondownload: () => void; onversions: () => void; onshortcuts: () => void;
  } = $props();

  let sub = $state<'new' | 'settings' | 'help' | null>(null);
  const NEW_SIZES = ['presentation', 'instagram-post', 'instagram-story', 'a4', 'facebook-post', 'youtube-thumbnail']
    .map((id) => PRESETS.find((p) => p.id === id)).filter((p) => !!p);
  const hasVersions = $derived(!!ed.store.versions);

  async function create(opts: { width: number; height: number; unit: (typeof PRESETS)[number]['unit']; title?: string; print?: boolean; video?: boolean }): Promise<void> {
    onclose();
    let doc = createDoc(opts);
    if (opts.video) doc = { ...doc, pages: doc.pages.map((p) => ({ ...p, duration: 5 })) };
    await ed.store.save({ doc, assets: new Map() });
    router.go({ name: 'editor', id: doc.id });
  }

  async function upload(): Promise<void> {
    onclose();
    const files = await pickFiles([...IMAGE_TYPES, ...VIDEO_TYPES, ...AUDIO_TYPES].join(','));
    let n = 0;
    for (const f of files) if (await ed.addMediaFile(f)) n++;
    if (files.length) toast.show(n === files.length ? `Uploaded ${n} file${n === 1 ? '' : 's'}` : `${files.length - n} file${files.length - n === 1 ? ' is' : 's are'} not a picture, video or sound`);
  }

  async function copy(): Promise<void> {
    onclose();
    await ed.save();
    try {
      const d = await copyDesign(ed.store, ed.doc.id);
      toast.show(`Made “${d.title}”`, { action: { label: 'Open', run: () => router.go({ name: 'editor', id: d.id }) } });
    } catch (e) {
      toast.show(`Couldn't make a copy: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function trash(): Promise<void> {
    onclose();
    const store = ed.store, id = ed.doc.id, title = ed.doc.title;
    const undoable = trashIsUndoable(store);
    const ok = await toast.ask(undoable
      ? { title: 'Move this design to trash?', body: `“${title}” goes to the bin in your Google Drive, where it stays for 30 days.`, ok: 'Move to trash', danger: true }
      : { title: 'Delete this design?', body: `“${title}” is saved in ${store.label}, which has no trash: it will be deleted for good.`, ok: 'Delete', danger: true });
    if (!ok) return;
    await ed.save();
    try {
      await store.remove(id);
    } catch (e) {
      toast.show(`Couldn't remove it: ${e instanceof Error ? e.message : e}`);
      return;
    }
    router.go({ name: 'home' });
    toast.show(undoable ? 'Design moved to trash' : 'Design deleted', undoable && store.restore
      ? { action: { label: 'Undo', run: () => void store.restore!(id).then(() => router.go({ name: 'editor', id })) } }
      : {});
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="menu" role="menu" tabindex="-1" data-testid="file-dropdown" onclick={(e) => e.stopPropagation()}>
  <div class="doc">
    <b title={ed.doc.title}>{ed.doc.title}</b>
    <span>{formatLength(ed.doc.width, ed.doc.unit)} × {formatLength(ed.doc.height, ed.doc.unit)} {ed.doc.unit} · {ed.doc.pages.length} page{ed.doc.pages.length === 1 ? '' : 's'}{isVideo(ed.doc) ? ' · video' : ''}</span>
  </div>
  <hr />
  <div class="has-sub" role="none" onmouseenter={() => (sub = 'new')} onmouseleave={() => (sub = null)}>
    <button role="menuitem" aria-haspopup="menu" aria-expanded={sub === 'new'} data-testid="file-new" onclick={() => (sub = 'new')}><Icon name="plus" size={18} /> Create new design <Icon name="right" size={16} /></button>
    {#if sub === 'new'}
      <div class="menu sub" role="menu" data-testid="file-new-menu">
        <button role="menuitem" data-testid="file-new-same" onclick={() => create({ width: ed.doc.width, height: ed.doc.height, unit: ed.doc.unit, print: ed.doc.unit !== 'px', video: isVideo(ed.doc) })}>
          Same size <kbd>{formatLength(ed.doc.width, ed.doc.unit)} × {formatLength(ed.doc.height, ed.doc.unit)} {ed.doc.unit}</kbd></button>
        <hr />
        {#each NEW_SIZES as p (p.id)}
          <button role="menuitem" data-testid="file-new-{p.id}" onclick={() => create({ width: p.width, height: p.height, unit: p.unit, print: p.print, title: p.name, video: p.video })}>{p.name} <kbd>{p.width} × {p.height} {p.unit}</kbd></button>
        {/each}
        <hr />
        <button role="menuitem" onclick={() => router.go({ name: 'home' })}>More sizes and custom size…</button>
      </div>
    {/if}
  </div>
  <button role="menuitem" data-testid="file-upload" onclick={upload}><Icon name="upload" size={18} /> Upload files</button>
  <div class="has-sub" role="none" onmouseenter={() => (sub = 'settings')} onmouseleave={() => (sub = null)}>
    <button role="menuitem" aria-haspopup="menu" aria-expanded={sub === 'settings'} data-testid="file-settings" onclick={() => (sub = 'settings')}><Icon name="sliders" size={18} /> Settings <Icon name="right" size={16} /></button>
    {#if sub === 'settings'}
      <div class="menu sub" role="menu" data-testid="file-settings-menu">
        <label><input type="checkbox" checked={view.rulers} onchange={() => view.toggle('rulers')} data-testid="view-rulers" /> Show rulers and guides <kbd>⇧R</kbd></label>
        <label><input type="checkbox" checked={view.margins} onchange={() => view.toggle('margins')} data-testid="view-margins" /> Show margins</label>
        <label class:off={!bleed} title={bleed ? '' : 'This design has no print bleed'}><input type="checkbox" checked={view.bleed} disabled={!bleed} onchange={() => view.toggle('bleed')} data-testid="view-bleed" /> Show print bleed</label>
        <label><input type="checkbox" checked={view.snap} onchange={() => view.toggle('snap')} data-testid="view-snap" /> Snap to guides and elements</label>
        <p>Hold ⌘/Ctrl while dragging to place freely; Alt-drag moves a copy. Drag from a ruler to add a guide; drag it off the page to remove it.</p>
        <hr />
        <button role="menuitem" data-testid="file-ai-devices" onclick={() => { onclose(); bridgeUi.open = true; }}><Icon name="ai" size={18} /> AI and devices… <kbd>{bridgeUi.status === 'on' ? 'AI can use this device' : ''}</kbd></button>
      </div>
    {/if}
  </div>
  <hr />
  <button role="menuitem" data-testid="file-save" onclick={() => { void ed.save(); onclose(); }}><Icon name="cloud" size={18} /> Save <kbd>{ed.saveState === 'saved' ? 'All changes saved' : '⌘S'}</kbd></button>
  <button role="menuitem" data-testid="file-copy" onclick={copy}><Icon name="copy" size={18} /> Make a copy</button>
  <button role="menuitem" data-testid="file-download" onclick={ondownload}><Icon name="download" size={18} /> Download</button>
  <button role="menuitem" data-testid="file-versions" disabled={!hasVersions} title={hasVersions ? '' : 'Sign in with Google: Drive keeps earlier versions of your designs'} onclick={() => { onclose(); onversions(); }}><Icon name="undo" size={18} /> Version history</button>
  <hr />
  <button role="menuitem" class="danger" data-testid="file-trash" onclick={trash}><Icon name="trash" size={18} /> Move to trash</button>
  <div class="has-sub" role="none" onmouseenter={() => (sub = 'help')} onmouseleave={() => (sub = null)}>
    <button role="menuitem" aria-haspopup="menu" aria-expanded={sub === 'help'} data-testid="file-help" onclick={() => (sub = 'help')}><Icon name="help" size={18} /> Help <Icon name="right" size={16} /></button>
    {#if sub === 'help'}
      <div class="menu sub up" role="menu">
        <button role="menuitem" data-testid="file-shortcuts" onclick={() => { onclose(); onshortcuts(); }}>Keyboard shortcuts <kbd>?</kbd></button>
        <a role="menuitem" href="https://github.com/Panth977/digital-canvas#readme" target="_blank" rel="noreferrer">Help centre</a>
        <button role="menuitem" data-testid="file-connect-ai" onclick={() => { onclose(); bridgeUi.open = true; }}>Connect your AI (Claude, MCP)</button>
        <a role="menuitem" href="https://github.com/Panth977/digital-canvas/issues/new" target="_blank" rel="noreferrer">Report a problem</a>
      </div>
    {/if}
  </div>
  <hr />
  <button role="menuitem" onclick={() => router.go({ name: 'home' })}><Icon name="home" size={18} /> Go to home</button>
</div>

<style>
  .menu { position: absolute; top: 48px; left: 0; width: 320px; background: var(--pop); color: var(--ink); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow); padding: 8px; display: flex; flex-direction: column; gap: 2px; z-index: 50; }
  .menu.sub { top: -9px; left: calc(100% + 4px); width: 300px; }
  .menu.sub.up { top: auto; bottom: -9px; }
  .has-sub { position: relative; }
  .has-sub > button { width: 100%; }
  .has-sub > button :global(svg:last-child) { margin-left: auto; color: var(--muted); }
  .doc { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; min-width: 0; }
  .doc b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .doc span { font-size: 12px; color: var(--muted); }
  hr { border: 0; border-top: 1px solid var(--line); margin: 4px 0; width: 100%; }
  button, label, a { display: flex; align-items: center; gap: 10px; min-height: 36px; padding: 6px 10px; border: 0; background: none; border-radius: 8px; text-align: left; cursor: pointer; color: inherit; font-size: 14px; text-decoration: none; }
  button:hover:not(:disabled), label:hover, a:hover, .has-sub > button[aria-expanded='true'] { background: var(--hover); }
  button:disabled { opacity: .45; cursor: default; }
  label.off { opacity: .5; }
  .danger { color: var(--danger); }
  kbd { margin-left: auto; font: inherit; font-size: 12px; color: var(--muted); white-space: nowrap; }
  p { margin: 2px 10px 4px; font-size: 12px; color: var(--muted); line-height: 1.4; }
</style>
