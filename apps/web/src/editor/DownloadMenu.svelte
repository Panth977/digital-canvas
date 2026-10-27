<script lang="ts" module>
  export type DlFormat = 'png' | 'jpeg' | 'pdfv' | 'pdf' | 'svg' | 'mp4' | 'gif';
  /** Canva's file types, in its order, with its one-line hints. */
  export const FORMATS: { id: DlFormat; label: string; hint: string; badge?: string }[] = [
    { id: 'png', label: 'PNG', hint: 'Best for complex images, illustrations', badge: 'Suggested' },
    { id: 'jpeg', label: 'JPG', hint: 'Best for sharing' },
    { id: 'pdfv', label: 'PDF Standard', hint: 'Best for documents (and emailing)' },
    { id: 'pdf', label: 'PDF Print', hint: 'Best for printing' },
    { id: 'svg', label: 'SVG', hint: 'Best for web design and animations' },
    { id: 'mp4', label: 'MP4 Video', hint: 'High quality video' },
    { id: 'gif', label: 'GIF', hint: 'Short clip, no sound' },
  ];
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { zipSync } from 'fflate';
  import { exportPdf } from '@digital-canvas/render';
  import type { EditorState } from '../lib/editor.svelte.ts';
  import { download } from '../lib/files.ts';
  import { exportMp4 } from '../lib/mp4.ts';
  import { toast } from '../lib/toast.svelte.ts';
  import Icon from '../lib/Icon.svelte';

  /** Canva's Download panel: file type, size, transparent background, compress, pages, Download. */
  let { ed, onclose }: { ed: EditorState; onclose: () => void } = $props();

  const KEY = 'dc:download';
  type Saved = { format: DlFormat; scale: number; quality: number; dpi: number; transparent: boolean; compress: boolean };
  const defaults: Saved = { format: 'png', scale: 1, quality: 80, dpi: 300, transparent: false, compress: false };
  function load(): { s: Saved; remembered: boolean } {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return { s: { ...defaults, ...(JSON.parse(raw) as Partial<Saved>) }, remembered: true };
    } catch { /* blocked */ }
    return { s: defaults, remembered: false };
  }
  const init = load();
  let dl = $state<Saved>(init.s);
  let remember = $state(init.remembered);
  /** Selected pages (ids); all pages by default, like Canva. */
  let pages = $state<string[]>(untrack(() => ed.doc.pages.map((p) => p.id)));
  let pagesOpen = $state(false);
  let busy = $state(false);
  let progress = $state(0);

  const video = $derived(ed.doc.pages.some((p) => p.duration !== undefined));
  const shownFormats = $derived(FORMATS.filter((f) => f.id !== 'mp4' || video));
  const fmt = $derived(FORMATS.find((f) => f.id === dl.format) ?? FORMATS[0]!);
  const chosen = $derived(ed.doc.pages.filter((p) => pages.includes(p.id)));
  const allPages = $derived(chosen.length === ed.doc.pages.length);
  const pagesLabel = $derived(allPages ? `All pages (${ed.doc.pages.length})` : chosen.length === 1 ? `Page ${ed.doc.pages.indexOf(chosen[0]!) + 1}` : `${chosen.length} pages`);
  const raster = $derived(dl.format === 'png' || dl.format === 'jpeg' || dl.format === 'gif');

  $effect(() => { if (dl.format === 'mp4' && !video) dl.format = 'png'; });
  $effect(() => {
    const s = $state.snapshot(dl);
    try { if (remember) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* blocked */ }
  });

  function togglePage(id: string): void {
    pages = pages.includes(id) ? pages.filter((x) => x !== id) : ed.doc.pages.map((p) => p.id).filter((x) => x === id || pages.includes(x));
  }

  const title = () => ed.doc.title || 'Design';
  const nameOf = (i: number, ext: string) => (ed.doc.pages.length > 1 ? `${title()} - page ${i + 1}.${ext}` : `${title()}.${ext}`);

  /** Canva's "Compress file": fewer colour levels, so PNG packs much smaller. */
  async function compressPng(bytes: Uint8Array): Promise<Uint8Array> {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d')!;
    g.drawImage(bmp, 0, 0);
    const img = g.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) d[i + k] = Math.min(255, Math.round(d[i + k]! / 17) * 17);
    g.putImageData(img, 0, 0);
    return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
  }

  /** One file per page; several pages come as one zip (Canva). */
  function deliver(files: { name: string; bytes: Uint8Array }[], mime: string): void {
    if (files.length === 1) return download(files[0]!.bytes, files[0]!.name, mime);
    const zip = zipSync(Object.fromEntries(files.map((f) => [f.name, [f.bytes, { level: 0 }]])) as Parameters<typeof zipSync>[0]);
    download(zip, `${title()}.zip`, 'application/zip');
  }

  async function go(): Promise<void> {
    if (!chosen.length) return;
    busy = true;
    progress = 0;
    const ids = chosen.map((p) => p.id);
    try {
      if (dl.format === 'mp4') {
        ed.player.pause();
        download(await exportMp4(ed, { onProgress: (f) => (progress = f) }), `${title()}.mp4`, 'video/mp4');
      } else if (dl.format === 'gif') {
        const { exportGif } = await import('../lib/gif.ts');
        download(await exportGif(ed, { pages: ids, scale: Math.min(1, dl.scale), onProgress: (f: number) => (progress = f) }), `${title()}.gif`, 'image/gif');
      } else if (dl.format === 'pdfv') {
        download(await ed.exportVectorPdf(ids), `${title()}.pdf`, 'application/pdf');
      } else if (dl.format === 'pdf') {
        download(await exportPdf(ed.renderer, ed.doc, { dpi: dl.dpi, pages: ids }), `${title()}.pdf`, 'application/pdf');
      } else if (dl.format === 'svg') {
        deliver(chosen.map((p) => ({ name: nameOf(ed.doc.pages.indexOf(p), 'svg'), bytes: new TextEncoder().encode(ed.exportSvg(p.id)) })), 'image/svg+xml');
      } else {
        const files = [];
        for (const p of chosen) {
          let bytes = dl.format === 'jpeg'
            ? ed.renderer.exportPage(ed.doc, p, { format: 'jpeg', scale: dl.scale, quality: dl.quality })
            : ed.exportPage(p.id, 'png', dl.scale, dl.transparent);
          if (dl.format === 'png' && dl.compress) bytes = await compressPng(bytes);
          files.push({ name: nameOf(ed.doc.pages.indexOf(p), dl.format === 'png' ? 'png' : 'jpg'), bytes });
        }
        deliver(files, dl.format === 'png' ? 'image/png' : 'image/jpeg');
      }
      onclose();
    } catch (e) {
      toast.show(`Couldn't download: ${e instanceof Error ? e.message : e}`);
    } finally {
      busy = false;
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="dl" data-testid="download-menu" onclick={(e) => { e.stopPropagation(); if (!(e.target as HTMLElement).closest('.pw')) pagesOpen = false; }}>
  <header><button class="btn ghost icon" aria-label="Back" onclick={onclose}><Icon name="left" size={18} /></button><h4>Download</h4></header>
  <label class="field">File type
    <select class="input" bind:value={dl.format} data-testid="dl-format">
      {#each shownFormats as f (f.id)}<option value={f.id}>{f.label}{f.badge ? ` · ${f.badge}` : ''}</option>{/each}
    </select>
  </label>
  <span class="dims" data-testid="dl-hint">{fmt.hint}</span>

  {#if dl.format === 'png' || dl.format === 'jpeg' || dl.format === 'gif'}
    <label class="field">
      <span class="lab">Size <b>× {dl.scale}</b></span>
      <input type="range" min="0.5" max={dl.format === 'gif' ? 1 : 4} step="0.125" bind:value={dl.scale} data-testid="dl-scale" />
    </label>
    <span class="dims">{Math.round(ed.doc.width * dl.scale)} × {Math.round(ed.doc.height * dl.scale)} px</span>
  {/if}
  {#if dl.format === 'jpeg'}
    <label class="field"><span class="lab">Quality <b>{dl.quality}</b></span>
      <input type="range" min="10" max="100" step="1" bind:value={dl.quality} data-testid="dl-quality" />
    </label>
  {/if}
  {#if dl.format === 'pdf'}
    <label class="field">Quality
      <select class="input" bind:value={dl.dpi}><option value={150}>Standard (150 dpi)</option><option value={300}>Print (300 dpi)</option></select>
    </label>
    <span class="dims">Each page is one image at that quality: it looks exactly like the editor.</span>
  {:else if dl.format === 'pdfv'}
    <span class="dims">Text stays text and shapes stay sharp; fonts are embedded.</span>
  {:else if dl.format === 'mp4'}
    <span class="dims">{Math.round(ed.doc.width)} × {Math.round(ed.doc.height)} px · 30 fps · all pages · animations play</span>
  {:else if dl.format === 'gif'}
    <span class="dims">Pages play one after another with their animations.</span>
  {/if}
  {#if dl.format === 'png'}
    <label class="check"><input type="checkbox" bind:checked={dl.transparent} data-testid="dl-transparent" /> Transparent background</label>
    <label class="check"><input type="checkbox" bind:checked={dl.compress} data-testid="dl-compress" /> Compress file (lower quality)</label>
  {/if}

  {#if dl.format !== 'mp4'}
    <div class="field pw">
      Select pages
      <button class="input pages" aria-haspopup="listbox" aria-expanded={pagesOpen} data-testid="dl-pages" onclick={() => (pagesOpen = !pagesOpen)}>{pagesLabel}<Icon name="down" size={16} /></button>
      {#if pagesOpen}
        <div class="pagelist" role="listbox" aria-multiselectable="true" data-testid="dl-pages-list">
          <label class="check"><input type="checkbox" checked={allPages} onchange={() => (pages = allPages ? [] : ed.doc.pages.map((p) => p.id))} data-testid="dl-pages-all" /> All pages ({ed.doc.pages.length})</label>
          <hr />
          {#each ed.doc.pages as p, i (p.id)}
            <label class="check"><input type="checkbox" checked={pages.includes(p.id)} onchange={() => togglePage(p.id)} data-testid="dl-page-{i + 1}" /> Page {i + 1}{p.id === ed.pageId ? ' (current)' : ''}</label>
          {/each}
          <button class="btn primary" data-testid="dl-pages-done" onclick={() => (pagesOpen = false)}>Done</button>
        </div>
      {/if}
    </div>
  {/if}

  <label class="check small"><input type="checkbox" bind:checked={remember} data-testid="dl-remember" /> Save download settings</label>
  <button class="btn primary go" onclick={go} disabled={busy || !chosen.length} data-testid="do-download">
    {busy ? (progress ? `Preparing… ${Math.round(progress * 100)}%` : 'Preparing…') : 'Download'}
  </button>
  {#if raster && chosen.length > 1}<p class="note">{chosen.length} pages download as one .zip file.</p>{/if}
</div>

<style>
  .dl { position: absolute; right: 0; top: 48px; width: 340px; background: var(--pop); color: var(--ink); border-radius: 12px; box-shadow: var(--shadow); padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 10px; z-index: 50; border: 1px solid var(--line); }
  header { display: flex; align-items: center; gap: 4px; margin-left: -6px; }
  h4 { margin: 0; font-size: 16px; }
  .lab { display: flex; justify-content: space-between; }
  .dims { font-size: 12px; color: var(--muted); margin-top: -6px; }
  .check { display: flex; gap: 8px; align-items: center; font-size: 13px; cursor: pointer; }
  .check.small { font-size: 12px; color: var(--ink-2); }
  .note { font-size: 12px; color: var(--muted); margin: 0; }
  .pw { position: relative; }
  .pages { display: flex; align-items: center; justify-content: space-between; text-align: left; cursor: pointer; }
  .pagelist { position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 2; max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding: 10px; background: var(--pop); border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--shadow); }
  .pagelist hr { border: 0; border-top: 1px solid var(--line); margin: 2px 0; width: 100%; }
  .go { height: 44px; font-size: 15px; }
  input[type='range'] { width: 100%; }
</style>
