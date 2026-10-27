<script lang="ts">
  import { onMount } from 'svelte';
  import type { ProjectStore } from '@digital-canvas/storage';
  import { EditorState, LINES } from '../lib/editor.svelte.ts';
  import { textShortcut } from '../lib/shortcuts.ts';
  import { engine } from '../lib/engine.ts';
  import { router } from '../lib/router.svelte.ts';
  import { download, isImage } from '../lib/files.ts';
  import Icon from '../lib/Icon.svelte';
  import { exportPdf } from '@digital-canvas/render';
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
  import { exportMp4 } from '../lib/mp4.ts';

  let { id, store }: { id: string; store: ProjectStore } = $props();

  let ed = $state<EditorState | null>(null);
  let error = $state('');
  let zoom = $state(1);
  let fitRequest = $state(0);
  let canvas = $state<Canvas>();
  let showDownload = $state(false);
  let showResize = $state(false);
  let showFile = $state(false);
  let dl = $state({ format: 'png' as 'png' | 'jpeg' | 'pdf' | 'pdfv' | 'svg' | 'mp4', dpi: 300, scale: 1, transparent: false, pages: 'current' as 'current' | 'all' });

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

  let busy = $state(false);
  let progress = $state(0);

  async function doDownload(): Promise<void> {
    if (!ed) return;
    const pages = dl.pages === 'all' ? ed.doc.pages : [ed.page];
    if (dl.format === 'mp4') {
      busy = true;
      progress = 0;
      try {
        ed.player.pause();
        const bytes = await exportMp4(ed, { onProgress: (f) => (progress = f) });
        download(bytes, `${ed.doc.title}.mp4`, 'video/mp4');
      } catch (e) {
        alert(`Couldn't make the video: ${e instanceof Error ? e.message : e}`);
      } finally {
        busy = false;
      }
      showDownload = false;
      return;
    }
    if (dl.format === 'pdfv') {
      busy = true;
      try {
        const bytes = await ed.exportVectorPdf(pages.map((p) => p.id));
        download(bytes, `${ed.doc.title}.pdf`, 'application/pdf');
      } catch (e) {
        alert(`Couldn't make the PDF: ${e instanceof Error ? e.message : e}`);
      } finally {
        busy = false;
      }
      showDownload = false;
      return;
    }
    if (dl.format === 'svg') {
      pages.forEach((p) => {
        const i = ed!.doc.pages.indexOf(p);
        const name = ed!.doc.pages.length > 1 ? `${ed!.doc.title} - page ${i + 1}.svg` : `${ed!.doc.title}.svg`;
        download(new Blob([ed!.exportSvg(p.id)], { type: 'image/svg+xml' }), name);
      });
      showDownload = false;
      return;
    }
    if (dl.format === 'pdf') {
      busy = true;
      try {
        const bytes = await exportPdf(ed.renderer, ed.doc, { dpi: dl.dpi, pages: pages.map((p) => p.id) });
        download(bytes, `${ed.doc.title}.pdf`, 'application/pdf');
      } finally {
        busy = false;
      }
      showDownload = false;
      return;
    }
    const format = dl.format;
    const ext = format === 'png' ? 'png' : 'jpg';
    pages.forEach((p) => {
      const i = ed!.doc.pages.indexOf(p);
      const bytes = ed!.exportPage(p.id, format, dl.scale, dl.transparent);
      const name = ed!.doc.pages.length > 1 ? `${ed!.doc.title} - page ${i + 1}.${ext}` : `${ed!.doc.title}.${ext}`;
      download(bytes, name, format === 'png' ? 'image/png' : 'image/jpeg');
    });
    showDownload = false;
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
    <header class="top">
      <div class="left">
        <button class="hb icon" title="Home" aria-label="Home" onclick={() => router.go({ name: 'home' })} data-testid="home"><Icon name="home" size={22} /></button>
        <div class="dl-wrap">
          <button class="hb" class:open={showFile} onclick={(e) => { e.stopPropagation(); showResize = false; showDownload = false; showFile = !showFile; }} data-testid="file-menu">File</button>
          {#if showFile}<FileMenu {ed} bleed={ed.doc.bleed} onclose={() => (showFile = false)} ondownload={() => { showFile = false; showDownload = true; }} />{/if}
        </div>
        <div class="dl-wrap">
          <button class="hb" class:open={showResize} onclick={(e) => { e.stopPropagation(); showFile = false; showResize = !showResize; }} data-testid="resize">Resize</button>
          {#if showResize}<ResizeDialog ed={ed} onclose={() => (showResize = false)} />{/if}
        </div>
        <span class="sep"></span>
        <button class="hb icon" title="Undo (⌘Z)" aria-label="Undo" disabled={!ed.canUndo} onclick={() => ed!.undo()} data-testid="undo"><Icon name="undo" size={20} /></button>
        <button class="hb icon" title="Redo (⇧⌘Z)" aria-label="Redo" disabled={!ed.canRedo} onclick={() => ed!.redo()} data-testid="redo"><Icon name="redo" size={20} /></button>
        <span class="save hb icon" class:err={ed.saveState === 'error'} class:busy={ed.saveState !== 'saved' && ed.saveState !== 'error'} title="{ed.saveError || SAVE_TIP[ed.saveState]} · {store.label}" data-testid="save-state">
          <Icon name={ed.saveState === 'error' ? 'alert' : ed.saveState === 'saved' ? 'cloudok' : 'cloud'} size={22} />
          <span class="sr-only">{SAVE_TEXT[ed.saveState]} · {store.label}</span>
        </span>
      </div>
      <div class="right">
        <input class="title" value={ed.doc.title} aria-label="Design title" data-testid="title" size={Math.max(8, Math.min(40, ed.doc.title.length + 1))}
          onchange={(e) => ed!.rename((e.currentTarget as HTMLInputElement).value)}
          onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} />
        <div class="dl-wrap">
          <button class="share" onclick={(e) => { e.stopPropagation(); showFile = false; showDownload = !showDownload; }} data-testid="download"><Icon name="download" size={18} /> Download</button>
          {#if showDownload}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <div class="dl" onclick={(e) => e.stopPropagation()}>
              <h4>Download</h4>
              <label class="field">File type
                <select class="input" bind:value={dl.format} data-testid="dl-format" onchange={() => { if (dl.format === 'pdf' || dl.format === 'pdfv') dl.pages = 'all'; }}><option value="png">PNG</option><option value="jpeg">JPG</option><option value="pdfv">PDF (vector)</option><option value="pdf">PDF (print, flattened)</option><option value="svg">SVG</option>{#if isVideo(ed.doc)}<option value="mp4">MP4 video</option>{/if}</select>
              </label>
              {#if dl.format === 'mp4'}
                <span class="dims">{Math.round(ed.doc.width)} × {Math.round(ed.doc.height)} px · 30 fps · all pages</span>
              {:else if dl.format === 'pdfv'}
                <span class="dims">Text stays text, shapes stay sharp; fonts are embedded.</span>
              {:else if dl.format === 'svg'}
                <span class="dims">One SVG file per page, fonts and images inside.</span>
              {:else if dl.format === 'pdf'}
                <label class="field">Quality
                  <select class="input" bind:value={dl.dpi}><option value={150}>Standard (150 dpi)</option><option value={300}>Print (300 dpi)</option></select>
                </label>
              {:else}
                <label class="field">Size × {dl.scale}
                  <input type="range" min="0.5" max="4" step="0.5" bind:value={dl.scale} />
                </label>
                <span class="dims">{Math.round(ed.doc.width * dl.scale)} × {Math.round(ed.doc.height * dl.scale)} px</span>
              {/if}
              {#if dl.format === 'png'}
                <label class="check"><input type="checkbox" bind:checked={dl.transparent} /> Transparent background</label>
              {/if}
              <label class="field">Pages
                <select class="input" bind:value={dl.pages} disabled={dl.format === 'mp4'}><option value="current">Current page ({ed.pageIndex + 1})</option><option value="all">All pages ({ed.doc.pages.length})</option></select>
              </label>
              <button class="btn primary" onclick={doDownload} disabled={busy} data-testid="do-download">{busy ? (dl.format === 'mp4' ? `Rendering… ${Math.round(progress * 100)}%` : 'Preparing…') : 'Download'}</button>
              {#if dl.format === 'pdf'}<p class="note">Each page is one image at the chosen quality: looks exactly like the editor.</p>{/if}
            </div>
          {/if}
        </div>
      </div>
    </header>

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
  .save.busy { opacity: .7; }
  .save.err { color: #ffd2d2; }
  .title { height: 40px; max-width: 360px; border-radius: 12px; border: 1px solid transparent; background: transparent; color: #fff; font-weight: 600; font-size: 14px; padding: 0 12px; text-align: right; }
  .title:hover { border-color: rgba(255,255,255,.4); }
  .title:focus { background: rgba(0,0,0,.18); outline: none; border-color: rgba(255,255,255,.7); text-align: left; }
  .dl-wrap { position: relative; }
  .share { height: 40px; padding: 0 16px; display: inline-flex; align-items: center; gap: 8px; border: 0; border-radius: 12px; background: rgba(255,255,255,.9); color: #0d1216; font-size: 14px; font-weight: 600; margin-left: 8px; }
  .share:hover { background: #fff; }
  .dl { position: absolute; right: 0; top: 48px; width: 320px; background: var(--pop); color: var(--ink); border-radius: 12px; box-shadow: var(--shadow); padding: 16px; display: flex; flex-direction: column; gap: 12px; z-index: 50; border: 1px solid var(--line); }
  .dl h4 { margin: 0; font-size: 16px; }
  .dl .btn.primary { height: 40px; }
  .dims { font-size: 12px; color: var(--muted); margin-top: -6px; }
  .check { display: flex; gap: 8px; align-items: center; font-size: 13px; }
  .note { font-size: 12px; color: var(--muted); margin: 0; }
  .body { flex: 1; display: flex; min-height: 0; }
  .work { position: relative; flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--stage); border-top-left-radius: 16px; overflow: hidden; }
  .ctxrow { position: relative; z-index: 30; height: 64px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
</style>
