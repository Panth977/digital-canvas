<script lang="ts">
  /**
   * One mockup, big: the page composited at the mockup's full size, product
   * colours, previous/next, download, copy, and "add to design as a new page".
   * Full screen on phones.
   */
  import './panels.css';
  import { untrack } from 'svelte';
  import type { EditorState } from '../../lib/editor.svelte.ts';
  import Icon from '../../lib/Icon.svelte';
  import { download } from '../../lib/files.ts';
  import { mobile } from '../../lib/mobile.svelte.ts';
  import { toast } from '../../lib/toast.svelte.ts';
  import { designPx, mockupClient, paint, sendPage, thumbUrl, type MockupEntry } from '../../lib/mockups/mockups.svelte.ts';
  import { defaultFit, type MockupFit } from '@digital-canvas/render/mockup';

  let { ed, list, index = $bindable(), pageId, onclose }: { ed: EditorState; list: MockupEntry[]; index: number; pageId: string; onclose: () => void } = $props();

  const entry = $derived(list[index]!);
  /** Product colour per mockup (null = as photographed). */
  let colors = $state<Record<string, string | null>>({});
  let fits = $state<Record<string, MockupFit>>({});
  const fit = $derived<MockupFit>(entry.id in fits ? fits[entry.id]! : defaultFit(entry));
  const color = $derived(entry.tint ? (entry.id in colors ? colors[entry.id]! : entry.colors?.[0] ?? null) : null);

  let canvas = $state<HTMLCanvasElement>();
  let ready = $state(false);
  let busy = $state<'' | 'png' | 'jpg' | 'page' | 'copy'>('');
  let error = $state('');
  let renders = $state(0);
  let ms = $state(0);
  let dialog = $state<HTMLElement>();

  // the page at this mockup's size, sent again only when the page or the size changes
  let sent = { page: null as unknown, w: 0, h: 0 };
  let run = 0;
  $effect(() => {
    const e = entry, c = color, f = fit, el = canvas;
    const page = ed.doc.pages.find((p) => p.id === pageId) ?? ed.page;
    if (!el) return;
    const px = designPx(ed, 'full', e);
    untrack(() => {
      if (sent.page !== page || sent.w !== px.w || sent.h !== px.h) {
        sendPage(ed, page.id, 'full', px);
        sent = { page, w: px.w, h: px.h };
      }
      const mine = ++run;
      error = '';
      mockupClient.render({ entry: e, size: 'full', design: 'full', color: c, fit: f }).then((r) => {
        if (mine !== run || !canvas) return;
        paint(canvas, r);
        ms = Math.round(r.ms);
        ready = true;
        renders++;
      }, (err) => { if (mine === run) error = `Couldn’t render this mockup: ${err instanceof Error ? err.message : err}`; });
    });
  });

  // a new mockup shows its thumbnail until its render is in
  let shownId = '';
  $effect(() => {
    if (entry.id !== shownId) { shownId = entry.id; ready = false; }
  });

  $effect(() => { dialog?.focus(); });

  function go(d: number): void {
    index = (index + d + list.length) % list.length;
  }

  function setColor(c: string): void {
    colors = { ...colors, [entry.id]: c };
  }

  const fileName = (ext: string) => `${(ed.doc.title || 'Design').replace(/[\\/:*?"<>|]+/g, '')} - ${entry.label}.${ext}`;

  function blob(type: 'image/png' | 'image/jpeg'): Promise<Blob> {
    return new Promise((res, rej) => canvas!.toBlob((b) => (b ? res(b) : rej(new Error('could not encode'))), type, 0.92));
  }

  async function save(fmt: 'png' | 'jpg'): Promise<void> {
    if (!ready || busy) return;
    busy = fmt;
    try {
      await download(await blob(fmt === 'png' ? 'image/png' : 'image/jpeg'), fileName(fmt));
    } catch (e) {
      toast.show(`Download failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      busy = '';
    }
  }

  async function addPage(): Promise<void> {
    if (!ready || busy) return;
    busy = 'page';
    try {
      const bytes = new Uint8Array(await (await blob('image/png')).arrayBuffer());
      const id = await ed.addImagePage(bytes, 'image/png', `${entry.label} mockup.png`);
      if (!id) throw new Error('the image could not be added');
      toast.show(`Added “${entry.label}” as page ${ed.pageIndex + 1}`);
      onclose();
    } catch (e) {
      toast.show(`Couldn’t add the page: ${e instanceof Error ? e.message : e}`);
    } finally {
      busy = '';
    }
  }

  async function copy(): Promise<void> {
    if (!ready || busy) return;
    busy = 'copy';
    try {
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('this browser can’t copy images');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob('image/png') })]);
      toast.show('Mockup copied');
    } catch (e) {
      toast.show(`Couldn’t copy: ${e instanceof Error ? e.message : e}`);
    } finally {
      busy = '';
    }
  }

  /** Window capture phase: the dialog has the keys while it is open, wherever the focus is (the editor's shortcuts must not nudge or deselect). */
  function key(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onclose(); return; }
    if ((e.target as HTMLElement).closest?.('input, select, textarea')) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      go(e.key === 'ArrowLeft' ? -1 : 1);
    }
  }
</script>

<svelte:window onkeydowncapture={key} />
<div class="dp-modal-bg mkp-bg" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="mkp" class:phone={mobile.on} role="dialog" aria-modal="true" aria-label="{entry.label} mockup" tabindex="-1" bind:this={dialog} data-testid="mockup-preview">
    <header>
      <div class="mkp-title">
        <h2>{entry.label}</h2>
        <span>{list.length > 1 ? `${entry.category} · ${index + 1} of ${list.length}` : entry.category}</span>
      </div>
      <button class="mkp-x" aria-label="Close" data-testid="mockup-close" onclick={onclose}><Icon name="close" size={18} /></button>
    </header>

    <div class="mkp-stage">
      {#if list.length > 1}<button class="mkp-nav prev" aria-label="Previous mockup" data-testid="mockup-prev" onclick={() => go(-1)}><Icon name="left" size={20} /></button>{/if}
      <div class="mkp-pic" style="aspect-ratio:{entry.width} / {entry.height}; --r:{entry.width / entry.height}">
        {#key entry.id}<img src={thumbUrl(entry)} alt="" draggable="false" />{/key}
        <canvas bind:this={canvas} class:on={ready} data-testid="mockup-full" data-mockup={entry.id} data-color={color ?? ''} data-renders={renders} data-ms={ms}></canvas>
        {#if !ready && !error}<span class="mkp-spin"><span class="dp-spin"></span></span>{/if}
      </div>
      {#if list.length > 1}<button class="mkp-nav next" aria-label="Next mockup" data-testid="mockup-next" onclick={() => go(1)}><Icon name="right" size={20} /></button>{/if}
    </div>
    {#if error}<p class="dp-err">{error}</p>{/if}

    <footer>
      {#if entry.tint}
        <div class="mkp-colors" role="radiogroup" aria-label="Product colour">
          {#each entry.colors ?? [] as c (c)}
            <button class="dp-sw" role="radio" aria-checked={color === c} class:on={color === c} style="background:{c}" title={c} aria-label="Colour {c}" data-testid="mockup-color-{c.slice(1)}" onclick={() => setColor(c)}></button>
          {/each}
          <label class="dp-sw add" title="Custom colour" class:on={!!color && !(entry.colors ?? []).includes(color)} style={color && !(entry.colors ?? []).includes(color) ? `background:${color}` : ''}>
            <Icon name="plus" size={14} />
            <input type="color" value={color ?? '#ffffff'} aria-label="Custom product colour" data-testid="mockup-color-custom" oninput={(e) => setColor((e.currentTarget as HTMLInputElement).value)} />
          </label>
        </div>
      {/if}
      <div class="mkp-fit" role="radiogroup" aria-label="How the design fits">
        <button class="dp-chip" role="radio" aria-checked={fit === 'contain'} class:on={fit === 'contain'} data-testid="mockup-fit-contain" onclick={() => (fits = { ...fits, [entry.id]: 'contain' })}>Whole design</button>
        <button class="dp-chip" role="radio" aria-checked={fit === 'cover'} class:on={fit === 'cover'} data-testid="mockup-fit-cover" onclick={() => (fits = { ...fits, [entry.id]: 'cover' })}>Fill</button>
      </div>
      <div class="mkp-acts">
        <button class="btn primary" disabled={!ready || !!busy} data-testid="mockup-download-png" onclick={() => save('png')}><Icon name="download" size={16} /> PNG</button>
        <button class="btn" disabled={!ready || !!busy} data-testid="mockup-download-jpg" onclick={() => save('jpg')}><Icon name="download" size={16} /> JPG</button>
        <button class="btn" disabled={!ready || !!busy} data-testid="mockup-add-page" onclick={addPage}><Icon name="addpage" size={16} /> Add to design as new page</button>
        <button class="btn" disabled={!ready || !!busy} data-testid="mockup-copy" onclick={copy}><Icon name="copy" size={16} /> Copy image</button>
      </div>
      {#if entry.credit}<p class="mkp-credit" data-testid="mockup-credit">{entry.credit}</p>{/if}
    </footer>
  </div>
</div>

<style>
  .mkp-bg { z-index: 200; }
  .mkp { width: min(1040px, calc(100vw - 48px)); max-height: calc(100vh - 48px); display: flex; flex-direction: column; background: var(--pop); color: var(--ink); border-radius: 14px; box-shadow: var(--shadow); padding: 16px 20px; outline: none; }
  header { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 10px; }
  .mkp-title { flex: 1; min-width: 0; }
  .mkp-title h2 { margin: 0; font-size: 17px; }
  .mkp-title span { font-size: 12px; color: var(--muted); }
  .mkp-x { border: 0; background: none; color: var(--ink); width: 36px; height: 36px; border-radius: 8px; display: grid; place-items: center; }
  .mkp-x:hover { background: var(--hover); }
  .mkp-stage { position: relative; flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
  .mkp-pic { position: relative; width: min(100% - 96px, (100vh - 270px) * var(--r)); border-radius: 10px; overflow: hidden; background: var(--chip); }
  .mkp-pic img, .mkp-pic canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .mkp-pic canvas { opacity: 0; transition: opacity .15s; }
  .mkp-pic canvas.on { opacity: 1; }
  .mkp-spin { position: absolute; right: 10px; bottom: 10px; background: var(--pop); border-radius: 50%; padding: 6px; line-height: 0; }
  .mkp-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--line); background: var(--pop); color: var(--ink); display: grid; place-items: center; box-shadow: var(--shadow); z-index: 2; }
  .mkp-nav:hover { background: var(--chip); }
  .mkp-nav.prev { left: 0; }
  .mkp-nav.next { right: 0; }
  footer { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; margin-top: 12px; }
  .mkp-fit { display: flex; gap: 6px; align-items: center; }
  .mkp-colors { display: flex; gap: 6px; align-items: center; }
  .mkp-colors .dp-sw.on { box-shadow: 0 0 0 2px var(--pop), 0 0 0 4px var(--accent); }
  .mkp-colors label.dp-sw { position: relative; cursor: pointer; }
  .mkp-colors input[type=color] { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; border: 0; padding: 0; }
  .mkp-acts { display: flex; flex-wrap: wrap; gap: 8px; margin-left: auto; }
  .mkp-acts .btn { display: inline-flex; align-items: center; gap: 6px; }
  .mkp-credit { flex-basis: 100%; margin: 0; font-size: 11px; color: var(--muted); }

  /* phones: full screen */
  .mkp.phone { width: 100vw; max-width: 100vw; height: 100dvh; max-height: 100dvh; border-radius: 0; padding: 12px 12px calc(12px + env(safe-area-inset-bottom)); }
  .mkp.phone .mkp-pic { width: min(100%, (100dvh - 290px) * var(--r)); }
  .mkp.phone .mkp-nav { width: 34px; height: 34px; }
  .mkp.phone footer { flex-direction: column; align-items: stretch; }
  .mkp.phone .mkp-acts { margin-left: 0; display: grid; grid-template-columns: 1fr 1fr; }
  .mkp.phone .mkp-acts .btn { justify-content: center; }
  .mkp.phone .mkp-colors { justify-content: center; }
</style>
