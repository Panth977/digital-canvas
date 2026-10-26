<script lang="ts">
  import { onMount } from 'svelte';
  import type { ProjectStore } from '@digital-canvas/storage';
  import { EditorState } from '../lib/editor.svelte.ts';
  import { engine } from '../lib/engine.ts';
  import { router } from '../lib/router.svelte.ts';
  import { download, isImage } from '../lib/files.ts';
  import Icon from '../lib/Icon.svelte';
  import Canvas from './Canvas.svelte';
  import SidePanel from './SidePanel.svelte';
  import Properties from './Properties.svelte';

  let { id, store }: { id: string; store: ProjectStore } = $props();

  let ed = $state<EditorState | null>(null);
  let error = $state('');
  let zoom = $state(1);
  let fitRequest = $state(0);
  let canvas = $state<Canvas>();
  let showDownload = $state(false);
  let dl = $state({ format: 'png' as 'png' | 'jpeg', scale: 1, transparent: false, pages: 'current' as 'current' | 'all' });

  onMount(() => {
    let cancelled = false;
    (async () => {
      try {
        const [eng, file] = await Promise.all([engine(), store.open(id)]);
        if (cancelled) return;
        ed = new EditorState(eng, store, file);
        (window as unknown as { __dc?: EditorState }).__dc = ed; // for tests and the console
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    })();
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (ed && ed.saveState !== 'saved') {
        void ed.save();
        e.preventDefault();
      }
    };
    addEventListener('beforeunload', beforeUnload);
    return () => {
      cancelled = true;
      removeEventListener('beforeunload', beforeUnload);
      const e = ed;
      if (e) void e.save().finally(() => e.dispose());
    };
  });

  function typing(t: EventTarget | null): boolean {
    return t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable="true"]');
  }

  function onKeydown(e: KeyboardEvent): void {
    if (!ed || typing(e.target)) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    const stop = () => e.preventDefault();
    if (mod && k === 'z') { stop(); e.shiftKey ? ed.redo() : ed.undo(); }
    else if (mod && k === 'y') { stop(); ed.redo(); }
    else if (mod && k === 'd') { stop(); ed.duplicateSelection(); }
    else if (mod && k === 'c') { ed.copy(); }
    else if (mod && k === 'x') { ed.cut(); }
    else if (mod && k === 'a') { stop(); ed.selectAll(); }
    else if (mod && k === 's') { stop(); void ed.save(); }
    else if (mod && (k === '=' || k === '+')) { stop(); canvas?.setZoom(zoom * 1.25); }
    else if (mod && k === '-') { stop(); canvas?.setZoom(zoom / 1.25); }
    else if (mod && k === '0') { stop(); fitRequest++; }
    else if (mod && k === ']') { stop(); ed.arrange(e.altKey ? 'front' : 'forward'); }
    else if (mod && k === '[') { stop(); ed.arrange(e.altKey ? 'back' : 'backward'); }
    else if (k === 'delete' || k === 'backspace') { stop(); ed.deleteSelection(); }
    else if (k === 'escape') { ed.select([]); }
    else if (k === 'enter' && ed.selected.length === 1 && ed.selected[0]!.type === 'text') { stop(); ed.startEditing(ed.selected[0]!.id); }
    else if (k.startsWith('arrow')) {
      stop();
      const d = e.shiftKey ? 10 : 1;
      ed.nudge(k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0, k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0);
    } else if (!mod && !e.altKey) {
      if (k === 't') { stop(); ed.addText('body'); }
      else if (k === 'r') { stop(); ed.addShape('rect'); }
      else if (k === 'c') { stop(); ed.addShape('ellipse'); }
    }
  }

  function onKeyup(e: KeyboardEvent): void {
    if (ed && e.key.startsWith('Arrow')) ed.seal();
  }

  async function onPaste(e: ClipboardEvent): Promise<void> {
    if (!ed || typing(e.target)) return;
    const files = [...(e.clipboardData?.files ?? [])].filter(isImage);
    if (files.length) {
      e.preventDefault();
      for (const f of files) await ed.addImageFile(f);
    } else ed.paste();
  }

  function doDownload(): void {
    if (!ed) return;
    const pages = dl.pages === 'all' ? ed.doc.pages : [ed.page];
    const ext = dl.format === 'png' ? 'png' : 'jpg';
    pages.forEach((p) => {
      const i = ed!.doc.pages.indexOf(p);
      const bytes = ed!.exportPage(p.id, dl.format, dl.scale, dl.transparent);
      const name = ed!.doc.pages.length > 1 ? `${ed!.doc.title} - page ${i + 1}.${ext}` : `${ed!.doc.title}.${ext}`;
      download(bytes, name, dl.format === 'png' ? 'image/png' : 'image/jpeg');
    });
    showDownload = false;
  }

  const SAVE_TEXT = { saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved changes', error: 'Save failed' } as const;
</script>

<svelte:window onkeydown={onKeydown} onkeyup={onKeyup} onpaste={onPaste} onclick={() => (showDownload = false)} />

{#if error}
  <div class="center">
    <Icon name="alert" size={28} />
    <p>{error}</p>
    <button class="btn" onclick={() => router.go({ name: 'home' })}>Back to your designs</button>
  </div>
{:else if !ed}
  <div class="center"><div class="spinner"></div><p>Loading editor…</p></div>
{:else}
  <div class="editor">
    <header class="top">
      <div class="left">
        <button class="btn ghost light" onclick={() => router.go({ name: 'home' })} data-testid="home"><Icon name="home" size={17} /> Home</button>
        <span class="sep"></span>
        <button class="btn ghost light icon" title="Undo (⌘Z)" aria-label="Undo" disabled={!ed.canUndo} onclick={() => ed!.undo()} data-testid="undo"><Icon name="undo" /></button>
        <button class="btn ghost light icon" title="Redo (⇧⌘Z)" aria-label="Redo" disabled={!ed.canRedo} onclick={() => ed!.redo()} data-testid="redo"><Icon name="redo" /></button>
        <span class="save" class:err={ed.saveState === 'error'} title={ed.saveError || `Saving to ${store.label}`} data-testid="save-state">
          <Icon name={ed.saveState === 'error' ? 'alert' : ed.saveState === 'saved' ? 'check' : 'cloud'} size={16} />
          {SAVE_TEXT[ed.saveState]} · {store.label}
        </span>
      </div>
      <input class="title" value={ed.doc.title} aria-label="Design title" data-testid="title"
        onchange={(e) => ed!.rename((e.currentTarget as HTMLInputElement).value)}
        onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} />
      <div class="right">
        <div class="dl-wrap">
          <button class="btn primary" onclick={(e) => { e.stopPropagation(); showDownload = !showDownload; }} data-testid="download"><Icon name="download" size={16} /> Download</button>
          {#if showDownload}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <div class="dl" onclick={(e) => e.stopPropagation()}>
              <label class="field">File type
                <select class="input" bind:value={dl.format}><option value="png">PNG</option><option value="jpeg">JPG</option></select>
              </label>
              <label class="field">Size × {dl.scale}
                <input type="range" min="0.5" max="4" step="0.5" bind:value={dl.scale} />
              </label>
              <span class="dims">{Math.round(ed.doc.width * dl.scale)} × {Math.round(ed.doc.height * dl.scale)} px</span>
              {#if dl.format === 'png'}
                <label class="check"><input type="checkbox" bind:checked={dl.transparent} /> Transparent background</label>
              {/if}
              <label class="field">Pages
                <select class="input" bind:value={dl.pages}><option value="current">Current page ({ed.pageIndex + 1})</option><option value="all">All pages ({ed.doc.pages.length})</option></select>
              </label>
              <button class="btn primary" onclick={doDownload} data-testid="do-download">Download</button>
              <p class="note">PDF and SVG export arrive in milestone 6.</p>
            </div>
          {/if}
        </div>
      </div>
    </header>

    <div class="body">
      <SidePanel {ed} />
      <div class="center-col">
        <Canvas {ed} bind:zoom bind:this={canvas} {fitRequest} />
        <footer class="bottom">
          <span class="pages">Page {ed.pageIndex + 1} / {ed.doc.pages.length}</span>
          <div class="zoom">
            <input type="range" min="0.05" max="4" step="0.01" value={zoom} aria-label="Zoom" oninput={(e) => canvas?.setZoom(Number((e.currentTarget as HTMLInputElement).value))} />
            <span data-testid="zoom">{Math.round(zoom * 100)}%</span>
            <button class="btn ghost icon" title="Fit (⌘0)" aria-label="Fit page" onclick={() => fitRequest++}><Icon name="fit" /></button>
          </div>
        </footer>
      </div>
      <Properties {ed} />
    </div>
  </div>
{/if}

<style>
  .center { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--muted); }
  .spinner { width: 28px; height: 28px; border-radius: 50%; border: 3px solid #ddd; border-top-color: var(--accent); animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .editor { height: 100%; display: flex; flex-direction: column; }
  .top { height: 56px; flex-shrink: 0; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px; padding: 0 12px;
    background: linear-gradient(90deg, #5b3df5, #7c5cff 45%, #0fb5c0); color: #fff; }
  .left, .right { display: flex; align-items: center; gap: 4px; min-width: 0; }
  .right { justify-content: flex-end; }
  .light { color: #fff; }
  .light:hover:not(:disabled) { background: rgba(255,255,255,.16); }
  .sep { width: 1px; height: 22px; background: rgba(255,255,255,.3); margin: 0 6px; }
  .save { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; opacity: .9; margin-left: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .save.err { color: #ffd2d2; opacity: 1; }
  .title { width: min(360px, 34vw); height: 34px; border-radius: 8px; border: 1px solid transparent; background: transparent; color: #fff; text-align: center; font-weight: 700; padding: 0 10px; }
  .title:hover { border-color: rgba(255,255,255,.35); }
  .title:focus { background: rgba(0,0,0,.18); outline: none; border-color: rgba(255,255,255,.6); }
  .dl-wrap { position: relative; }
  .btn.primary { background: #fff; color: var(--accent); }
  .dl { position: absolute; right: 0; top: 42px; width: 280px; background: #fff; color: var(--ink); border-radius: 12px; box-shadow: var(--shadow); padding: 14px; display: flex; flex-direction: column; gap: 10px; z-index: 20; border: 1px solid var(--line); }
  .dl .btn.primary { background: linear-gradient(135deg, var(--accent), #9b7bff); color: #fff; }
  .dims { font-size: 12px; color: var(--muted); margin-top: -6px; }
  .check { display: flex; gap: 8px; align-items: center; font-size: 13px; }
  .note { font-size: 12px; color: var(--muted); margin: 0; }
  .body { flex: 1; display: flex; min-height: 0; }
  .center-col { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .bottom { height: 40px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; background: #fff; border-top: 1px solid var(--line); font-size: 13px; }
  .pages { color: var(--muted); font-weight: 600; }
  .zoom { display: flex; align-items: center; gap: 8px; }
  .zoom input { width: 140px; accent-color: var(--accent); }
  .zoom span { width: 44px; text-align: right; font-variant-numeric: tabular-nums; }
</style>
