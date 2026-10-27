<script lang="ts">
  import { onMount } from 'svelte';
  import type { ProjectStore } from '@digital-canvas/storage';
  import { EditorState, LINES } from '../lib/editor.svelte.ts';
  import { textShortcut } from '../lib/shortcuts.ts';
  import { engine } from '../lib/engine.ts';
  import { router } from '../lib/router.svelte.ts';
  import { isImage } from '../lib/files.ts';
  import Icon from '../lib/Icon.svelte';
  import Canvas from './Canvas.svelte';
  import SidePanel from './SidePanel.svelte';
  import ContextToolbar from './ContextToolbar.svelte';
  import BottomBar from './BottomBar.svelte';
  import FileMenu from './FileMenu.svelte';
  import { ui } from '../lib/ui.svelte.ts';
  import Timeline from './Timeline.svelte';
  import ResizeDialog from './ResizeDialog.svelte';
  import { view } from '../lib/view.svelte.ts';
  import { isVideo } from '@digital-canvas/scene';
  import DownloadMenu from './DownloadMenu.svelte';
  import VersionHistory from './VersionHistory.svelte';
  import ShortcutsDialog from './ShortcutsDialog.svelte';

  let { id, store }: { id: string; store: ProjectStore } = $props();

  let ed = $state<EditorState | null>(null);
  let error = $state('');
  let zoom = $state(1);
  let fitRequest = $state(0);
  let canvas = $state<Canvas>();
  let showDownload = $state(false);
  let showResize = $state(false);
  let showFile = $state(false);
  let showVersions = $state(false);
  let showShortcuts = $state(false);

  onMount(() => {
    ui.reset();
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
    if (textShortcut(ed, e)) return;
    if (mod && k === 'z') { stop(); e.shiftKey ? ed.redo() : ed.undo(); }
    else if (mod && k === 'y') { stop(); ed.redo(); }
    else if (mod && k === 'd') { stop(); ed.duplicateSelection(); }
    else if (mod && k === 'c') { ed.copy(); }
    else if (mod && k === 'x') { ed.cut(); }
    else if (mod && k === 'a') { stop(); ed.selectAll(); }
    else if (mod && k === 'g') { stop(); e.shiftKey ? ed.ungroup() : ed.group(); }
    else if (!mod && e.shiftKey && !e.altKey && k === 'r') { stop(); view.toggle('rulers'); }
    else if (!mod && e.key === '?') { stop(); showShortcuts = true; }
    else if (mod && k === 's') { stop(); void ed.save(); }
    else if (mod && (k === '=' || k === '+')) { stop(); canvas?.setZoom(zoom * 1.25); }
    else if (mod && k === '-') { stop(); canvas?.setZoom(zoom / 1.25); }
    else if (mod && k === '0') { stop(); fitRequest++; }
    else if (mod && k === ']') { stop(); ed.arrange(e.altKey ? 'front' : 'forward'); }
    else if (mod && k === '[') { stop(); ed.arrange(e.altKey ? 'back' : 'backward'); }
    else if (mod && k === 'enter') { stop(); ed.addPage(); }
    else if (mod && (k === 'delete' || k === 'backspace') && !ed.selection.length) {
      // ⌘⌫ deletes an empty page (Canva)
      stop();
      if (!ed.page.elements.length && ed.doc.pages.length > 1) ed.removePage(ed.pageId);
    }
    else if (k === 'delete' || k === 'backspace') { stop(); ed.deleteSelection(); }
    else if (k === 'tab' && !mod && !e.altKey && (e.target === document.body || (e.target as HTMLElement).closest?.('[data-testid="stage"]'))) {
      // Tab / Shift+Tab: the next / previous element on the page
      const els = ed.page.elements.filter((x) => !x.hidden);
      if (!els.length) return;
      stop();
      const at = els.findIndex((x) => x.id === ed!.selection[ed!.selection.length - 1]);
      const n = at < 0 ? (e.shiftKey ? els.length - 1 : 0) : (at + (e.shiftKey ? els.length - 1 : 1)) % els.length;
      ed.select([els[n]!.id], ed.pageId);
    }
    else if (ed.croppingId && (k === 'escape' || k === 'enter')) { stop(); ed.stopCrop(); }
    else if (k === 'escape') {
      if (ui.pop) ui.pop = null;
      else if (ed.tool || ed.framePanId) { ed.tool = null; ed.framePanId = null; }
      else ed.select([]);
    }
    else if (k === 'enter' && ed.selected.length === 1 && ed.selected[0]!.type === 'text') { stop(); ed.startEditing(ed.selected[0]!.id); }
    else if (k.startsWith('arrow')) {
      stop();
      const d = e.shiftKey ? 10 : 1;
      ed.nudge(k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0, k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0);
    } else if (!mod && !e.altKey) {
      if (k === 't') { stop(); ed.addText('body'); }
      else if (k === 'r') { stop(); ed.addShape('rect'); }
      else if (k === 'c') { stop(); ed.addShape('ellipse'); }
      else if (k === 'l') { stop(); ed.addLine(LINES[0]!); }
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

  // ---- title: Canva renames in place; Enter or click away keeps it, Esc puts it back ----
  let titleEl = $state<HTMLInputElement>();
  function commitTitle(): void {
    const el = titleEl;
    if (!el || !ed) return;
    const v = el.value.trim();
    if (v && v !== ed.doc.title) ed.rename(v);
    el.value = ed.doc.title;
    el.scrollLeft = 0;
  }
  function titleKey(e: KeyboardEvent): void {
    const el = e.currentTarget as HTMLInputElement;
    if (e.key === 'Enter') el.blur();
    else if (e.key === 'Escape') { e.stopPropagation(); el.value = ed!.doc.title; el.blur(); }
  }

  const SAVE_TEXT = { saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved changes', error: 'Save failed' } as const;
  const SAVE_TIP = { saved: 'All changes saved', saving: 'Saving…', unsaved: 'Unsaved changes', error: 'Save failed' } as const;
</script>

<svelte:window onkeydown={onKeydown} onkeyup={onKeyup} onpaste={onPaste} onclick={() => { showDownload = false; showResize = false; showFile = false; }} />

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
    <header class="top" data-tips>
      <div class="left">
        <button class="hb icon" title="Home" aria-label="Home" onclick={() => router.go({ name: 'home' })} data-testid="home"><Icon name="home" size={22} /></button>
        <div class="dl-wrap">
          <button class="hb" class:open={showFile} aria-haspopup="menu" aria-expanded={showFile} onclick={(e) => { e.stopPropagation(); showResize = false; showDownload = false; showFile = !showFile; }} data-testid="file-menu">File</button>
          {#if showFile}<FileMenu {ed} bleed={ed.doc.bleed} onclose={() => (showFile = false)} ondownload={() => { showFile = false; showDownload = true; }}
            onversions={() => (showVersions = true)} onshortcuts={() => (showShortcuts = true)} />{/if}
        </div>
        <div class="dl-wrap">
          <button class="hb" class:open={showResize} aria-haspopup="dialog" aria-expanded={showResize} onclick={(e) => { e.stopPropagation(); showFile = false; showDownload = false; showResize = !showResize; }} data-testid="resize">Resize</button>
          {#if showResize}<ResizeDialog ed={ed} onclose={() => (showResize = false)} />{/if}
        </div>
        <span class="sep"></span>
        <button class="hb icon" title="Undo (⌘Z)" aria-label="Undo" disabled={!ed.canUndo} onclick={() => ed!.undo()} data-testid="undo"><Icon name="undo" size={20} /></button>
        <button class="hb icon" title="Redo (⇧⌘Z)" aria-label="Redo" disabled={!ed.canRedo} onclick={() => ed!.redo()} data-testid="redo"><Icon name="redo" size={20} /></button>
        <span class="save hb icon" class:err={ed.saveState === 'error'} data-state={ed.saveState} title={ed.saveError ? `Save failed: ${ed.saveError}` : SAVE_TIP[ed.saveState]} data-testid="save-state">
          {#if ed.saveState === 'saving'}<span class="ring" aria-hidden="true"></span>{:else}<Icon name={ed.saveState === 'error' ? 'alert' : ed.saveState === 'saved' ? 'cloudok' : 'cloud'} size={22} />{/if}
          <span class="sr-only">{SAVE_TEXT[ed.saveState]} · {store.label}</span>
        </span>
      </div>
      <div class="right">
        <input class="title" bind:this={titleEl} value={ed.doc.title} aria-label="Design title" data-testid="title" title="Rename" spellcheck="false" maxlength="255"
          onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} onblur={commitTitle} onkeydown={titleKey} />
        <div class="dl-wrap">
          <button class="share" class:open={showDownload} aria-haspopup="dialog" aria-expanded={showDownload} onclick={(e) => { e.stopPropagation(); showFile = false; showResize = false; showDownload = !showDownload; }} data-testid="download"><Icon name="download" size={18} /> Download</button>
          {#if showDownload}<DownloadMenu {ed} onclose={() => (showDownload = false)} />{/if}
        </div>
      </div>
    </header>
    {#if showVersions}<VersionHistory {ed} onclose={() => (showVersions = false)} />{/if}
    {#if showShortcuts}<ShortcutsDialog onclose={() => (showShortcuts = false)} />{/if}

    <div class="body">
      <SidePanel {ed} />
      <main class="work">
        <div class="ctxrow"><ContextToolbar {ed} /></div>
        <Canvas {ed} bind:zoom bind:this={canvas} {fitRequest} />
        {#if isVideo(ed.doc)}<Timeline {ed} />{/if}
        <BottomBar {ed} {zoom} onzoom={(z) => canvas?.setZoom(z)} onfit={() => fitRequest++} />
      </main>
    </div>
  </div>
{/if}

<style>
  .center { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--muted); background: var(--stage); }
  .spinner { width: 28px; height: 28px; border-radius: 50%; border: 3px solid var(--line); border-top-color: var(--accent); animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .editor { height: 100%; display: flex; flex-direction: column; background: var(--rail); }
  .top { height: 57px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 8px 0 12px; background: var(--header); color: #fff; }
  .left, .right { display: flex; align-items: center; gap: 4px; min-width: 0; }
  .hb { height: 40px; padding: 0 12px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 0; border-radius: 12px; background: transparent; color: #fff; font-size: 14px; font-weight: 600; white-space: nowrap; }
  .hb.icon { width: 40px; padding: 0; }
  .hb:hover:not(:disabled), .hb.open { background: rgba(255,255,255,.15); }
  .hb:disabled { opacity: .45; cursor: default; }
  .sep { width: 1px; height: 24px; background: rgba(255,255,255,.35); margin: 0 6px; }
  .save { cursor: default; }
  .save[data-state='unsaved'] { opacity: .75; }
  .save.err { color: #ffd2d2; }
  .ring { width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(255,255,255,.35); border-top-color: #fff; animation: spin .8s linear infinite; }
  .title { height: 40px; width: 360px; max-width: 32vw; min-width: 80px; border-radius: 8px; border: 1px solid transparent; background: transparent; color: #fff; font-weight: 600; font-size: 14px; padding: 0 10px; text-align: right; text-overflow: ellipsis; white-space: nowrap; overflow: hidden; }
  .title:hover { border-color: rgba(255,255,255,.5); }
  .title:focus { background: rgba(0,0,0,.18); outline: none; border-color: #fff; text-align: left; text-overflow: clip; }
  .dl-wrap { position: relative; }
  .share { height: 40px; padding: 0 16px; display: inline-flex; align-items: center; gap: 8px; border: 0; border-radius: 12px; background: rgba(255,255,255,.9); color: #0d1216; font-size: 14px; font-weight: 600; margin-left: 8px; }
  .share:hover, .share.open { background: #fff; }
  .body { flex: 1; display: flex; min-height: 0; }
  .work { position: relative; flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--stage); border-top-left-radius: 16px; overflow: hidden; }
  .ctxrow { position: relative; z-index: 30; height: 64px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
</style>
