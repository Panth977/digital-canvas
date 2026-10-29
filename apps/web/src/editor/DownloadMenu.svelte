<script lang="ts" module>
  export type DlFormat = 'png' | 'jpeg' | 'pdfv' | 'pdf' | 'svg' | 'mp4' | 'gif' | 'pptx' | 'mp3' | 'dcanvas';
  /** Canva's file types, in its order, with its one-line hints; then our own .dcanvas. */
  export const FORMATS: { id: DlFormat; label: string; hint: string }[] = [
    { id: 'png', label: 'PNG', hint: 'Best for complex images, illustrations' },
    { id: 'jpeg', label: 'JPG', hint: 'Best for sharing' },
    { id: 'pdfv', label: 'PDF Standard', hint: 'Best for documents (and emailing)' },
    { id: 'pdf', label: 'PDF Print', hint: 'Best for printing' },
    { id: 'svg', label: 'SVG', hint: 'Best for web design and animations' },
    { id: 'mp4', label: 'MP4 Video', hint: 'High quality video' },
    { id: 'gif', label: 'GIF', hint: 'Short clip, no sound' },
    { id: 'pptx', label: 'PPTX', hint: 'Microsoft PowerPoint document' },
    { id: 'mp3', label: 'MP3', hint: 'Audio only' },
    { id: 'dcanvas', label: 'Digital Canvas file', hint: 'Editable copy of this design (.dcanvas)' },
  ];
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { zipSync } from 'fflate';
  import { isVideo, totalDuration } from '@digital-canvas/scene';
  import { fileName, MIME as DCANVAS_MIME } from '@digital-canvas/storage';
  import type { EditorState } from '../lib/editor.svelte.ts';
  import { download, shareAll } from '../lib/files.ts';
  import { isNative } from '../lib/native/platform.ts';
  import { exportMp4 } from '../lib/mp4.ts';
  import { GIF_SIZES, hasSound, pageDoc, pageFileName, soundDuration, VIDEO_QUALITIES, videoSize } from '../lib/exportutil.ts';
  import { toast } from '../lib/toast.svelte.ts';
  import Icon from '../lib/Icon.svelte';

  /** Canva's Download panel: file type, its options, pages, Download. */
  let { ed, onclose }: { ed: EditorState; onclose: () => void } = $props();

  const KEY = 'dc:download';
  type Saved = {
    format: DlFormat; scale: number; quality: number; transparent: boolean; compress: boolean;
    /** PDF Print */ marks: boolean; flatten: boolean; profile: 'rgb' | 'cmyk'; notes: boolean;
    /** MP4 short side (480, 720, 1080, 2160). */ vq: number;
    /** "Download pages as separate files" (PDF, MP4, GIF). */ separate: boolean;
  };
  const defaults: Saved = { format: 'png', scale: 1, quality: 80, transparent: false, compress: false, marks: false, flatten: false, profile: 'rgb', notes: true, vq: 1080, separate: false };
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

  const video = $derived(isVideo(ed.doc));
  const sound = $derived(hasSound(ed.doc));
  /** Canva puts its Suggested badge on the type that fits the design. */
  const suggested = $derived<DlFormat>(video ? 'mp4' : 'png');
  const shownFormats = $derived(FORMATS.filter((f) => (f.id !== 'mp4' || video) && (f.id !== 'mp3' || sound)));
  const fmt = $derived(FORMATS.find((f) => f.id === dl.format) ?? FORMATS[0]!);
  const chosen = $derived(ed.doc.pages.filter((p) => pages.includes(p.id)));
  const allPages = $derived(chosen.length === ed.doc.pages.length);
  const pagesLabel = $derived(allPages ? `All pages (${ed.doc.pages.length})` : chosen.length === 1 ? `Page ${ed.doc.pages.indexOf(chosen[0]!) + 1}` : `${chosen.length} pages`);
  const raster = $derived(dl.format === 'png' || dl.format === 'jpeg');
  const visiblePages = $derived(ed.doc.pages.filter((p) => !p.hidden));
  /** Formats where the user picks pages (MP4 and MP3 are the whole timeline, .dcanvas the whole design). */
  const pickPages = $derived(dl.format !== 'mp4' && dl.format !== 'mp3' && dl.format !== 'dcanvas');
  const canSeparate = $derived((dl.format === 'pdfv' || dl.format === 'pdf' || dl.format === 'gif') ? chosen.length > 1 : dl.format === 'mp4' && visiblePages.length > 1);
  const hasNotes = $derived(chosen.some((p) => !!p.notes?.trim()));
  const vsize = $derived(videoSize(ed.doc, dl.vq));
  const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;

  $effect(() => { if (!shownFormats.some((f) => f.id === dl.format)) dl.format = 'png'; });
  $effect(() => {
    const s = $state.snapshot(dl);
    try { if (remember) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* blocked */ }
  });

  function togglePage(id: string): void {
    pages = pages.includes(id) ? pages.filter((x) => x !== id) : ed.doc.pages.map((p) => p.id).filter((x) => x === id || pages.includes(x));
  }

  const title = () => ed.doc.title || 'Design';
  const nameOf = (i: number, ext: string) => pageFileName(title(), i, ed.doc.pages.length, ext);

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

  /** In the app, exports open the share sheet (Save to Photos/Files, AirDrop…). */
  const native = isNative();

  /** One file per page; several pages come as one zip (Canva), or all at once to the share sheet in the app. */
  async function deliver(files: { name: string; bytes: Uint8Array }[], mime: string): Promise<void> {
    if (files.length === 1) return download(files[0]!.bytes, files[0]!.name, mime);
    if (native) return shareAll(files.map((f) => ({ bytes: f.bytes, name: f.name, mime })));
    const zip = zipSync(Object.fromEntries(files.map((f) => [f.name, [f.bytes, { level: 0 }]])) as Parameters<typeof zipSync>[0]);
    await download(zip, `${title()}.zip`, 'application/zip');
  }

  /** The PDF options of the chosen type (Standard: flatten only). */
  const pdfOpts = () => (dl.format === 'pdf'
    ? { print: dl.marks ? { bleed: ed.doc.bleed > 0 ? ed.doc.bleed : 96 / 25.4 * 3, marks: true } : undefined, flatten: dl.flatten ? { dpi: 300 } : undefined, colorProfile: dl.profile, notes: dl.notes && hasNotes }
    : { flatten: dl.flatten ? { dpi: 300 } : undefined });

  async function go(): Promise<void> {
    if (!chosen.length) return;
    busy = true;
    progress = 0;
    const ids = chosen.map((p) => p.id);
    const separate = canSeparate && dl.separate;
    try {
      if (dl.format === 'mp4') {
        ed.player.pause();
        if (separate) {
          const files = [];
          for (const [i, p] of visiblePages.entries()) {
            const bytes = await exportMp4(ed, { quality: dl.vq, doc: pageDoc(ed.doc, p.id), onProgress: (f) => (progress = (i + f) / visiblePages.length) });
            files.push({ name: nameOf(ed.doc.pages.indexOf(p), 'mp4'), bytes });
          }
          await deliver(files, 'video/mp4');
        } else await download(await exportMp4(ed, { quality: dl.vq, onProgress: (f) => (progress = f) }), `${title()}.mp4`, 'video/mp4');
      } else if (dl.format === 'mp3') {
        ed.player.pause();
        const { exportMp3 } = await import('../lib/mp4.ts');
        await download(await exportMp3(ed, { onProgress: (f) => (progress = f) }), `${title()}.mp3`, 'audio/mpeg');
      } else if (dl.format === 'gif') {
        const { exportGif } = await import('../lib/gif.ts');
        const scale = Math.min(1, dl.scale);
        const groups = separate ? ids.map((id) => [id]) : [ids];
        const files = [];
        for (const [i, g] of groups.entries()) {
          const bytes = await exportGif(ed, { pages: g, scale, transparent: dl.transparent, onProgress: (f: number) => (progress = (i + f) / groups.length) });
          files.push({ name: separate ? nameOf(ed.doc.pages.findIndex((p) => p.id === g[0]), 'gif') : `${title()}.gif`, bytes });
        }
        await deliver(files, 'image/gif');
      } else if (dl.format === 'pdfv' || dl.format === 'pdf') {
        const opts = pdfOpts();
        if (separate) {
          const files = [];
          for (const p of chosen) files.push({ name: nameOf(ed.doc.pages.indexOf(p), 'pdf'), bytes: await ed.exportVectorPdf([p.id], opts) });
          await deliver(files, 'application/pdf');
        } else await download(await ed.exportVectorPdf(ids, opts), `${title()}.pdf`, 'application/pdf');
      } else if (dl.format === 'pptx') {
        await download(ed.exportPptx(ids, dl.notes), `${title()}.pptx`, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      } else if (dl.format === 'dcanvas') {
        await download(ed.exportDcanvas(), fileName(title()), DCANVAS_MIME);
      } else if (dl.format === 'svg') {
        await deliver(chosen.map((p) => ({ name: nameOf(ed.doc.pages.indexOf(p), 'svg'), bytes: new TextEncoder().encode(ed.exportSvg(p.id)) })), 'image/svg+xml');
      } else {
        const files = [];
        for (const p of chosen) {
          let bytes = dl.format === 'jpeg'
            ? ed.renderer.exportPage(ed.doc, p, { format: 'jpeg', scale: dl.scale, quality: dl.quality })
            : ed.exportPage(p.id, 'png', dl.scale, dl.transparent);
          if (dl.format === 'png' && dl.compress) bytes = await compressPng(bytes);
          files.push({ name: nameOf(ed.doc.pages.indexOf(p), dl.format === 'png' ? 'png' : 'jpg'), bytes });
        }
        await deliver(files, dl.format === 'png' ? 'image/png' : 'image/jpeg');
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
      {#each shownFormats as f (f.id)}<option value={f.id}>{f.label}{f.id === suggested ? ' · Suggested' : ''}</option>{/each}
    </select>
  </label>
  <span class="dims" data-testid="dl-hint">{fmt.hint}</span>

  {#if dl.format === 'png' || dl.format === 'jpeg'}
    <label class="field">
      <span class="lab">Size <b>× {dl.scale}</b></span>
      <input type="range" min="0.5" max="4" step="0.125" bind:value={dl.scale} data-testid="dl-scale" />
    </label>
    <span class="dims">{Math.round(ed.doc.width * dl.scale)} × {Math.round(ed.doc.height * dl.scale)} px</span>
  {:else if dl.format === 'gif'}
    <div class="field">
      <span class="lab">Size <b>× {Math.min(1, dl.scale)}</b></span>
      <div class="chips" role="group" aria-label="GIF size">
        {#each GIF_SIZES as g (g)}<button class="chip" class:on={Math.abs(Math.min(1, dl.scale) - g) < 1e-6} data-testid="dl-gif-{g}" onclick={() => (dl.scale = g)}>{g}x</button>{/each}
      </div>
      <input type="range" min="0.2" max="1" step="0.05" value={Math.min(1, dl.scale)} oninput={(e) => (dl.scale = Number((e.currentTarget as HTMLInputElement).value))} data-testid="dl-scale" aria-label="Custom size" />
    </div>
    <span class="dims">{Math.round(ed.doc.width * Math.min(1, dl.scale))} × {Math.round(ed.doc.height * Math.min(1, dl.scale))} px · pages play one after another with their animations</span>
  {/if}
  {#if dl.format === 'jpeg'}
    <label class="field"><span class="lab">Quality <b>{dl.quality}</b></span>
      <input type="range" min="10" max="100" step="1" bind:value={dl.quality} data-testid="dl-quality" />
    </label>
  {/if}
  {#if dl.format === 'pdf'}
    <label class="check"><input type="checkbox" bind:checked={dl.marks} data-testid="dl-marks" /> Crop marks and bleed</label>
    {#if dl.marks}<span class="dims">{ed.doc.bleed > 0 ? 'The design\'s bleed' : 'A 3 mm bleed'} prints past the trim; marks show where to cut.</span>{/if}
    <label class="check"><input type="checkbox" bind:checked={dl.flatten} data-testid="dl-flatten" /> Flatten PDF</label>
    {#if hasNotes}<label class="check"><input type="checkbox" bind:checked={dl.notes} data-testid="dl-notes" /> Include notes</label>{/if}
    <label class="field">Color profile
      <select class="input" bind:value={dl.profile} data-testid="dl-profile">
        <option value="rgb">RGB (best for digital use)</option>
        <option value="cmyk">CMYK (best for professional printing)</option>
      </select>
    </label>
    {#if dl.profile === 'cmyk'}<span class="dims" data-testid="dl-cmyk-note">Best effort: colours are converted to CMYK without a printer's ICC profile, so ask for a proof.</span>{/if}
  {:else if dl.format === 'pdfv'}
    <label class="check"><input type="checkbox" bind:checked={dl.flatten} data-testid="dl-flatten" /> Flatten PDF</label>
    <span class="dims">{dl.flatten ? 'Each page is one picture (300 dpi).' : 'Text stays text and shapes stay sharp; fonts are embedded.'}</span>
  {:else if dl.format === 'mp4'}
    <label class="field">Quality
      <select class="input" bind:value={dl.vq} data-testid="dl-video-quality">
        {#each VIDEO_QUALITIES as q (q.id)}<option value={q.id}>{q.label}</option>{/each}
      </select>
    </label>
    <span class="dims" data-testid="dl-video-size">{vsize.W} × {vsize.H} px · 30 fps · {mmss(totalDuration(ed.doc))}</span>
  {:else if dl.format === 'pptx'}
    {#if hasNotes}<label class="check"><input type="checkbox" bind:checked={dl.notes} data-testid="dl-notes" /> Include notes</label>{/if}
    <span class="dims">Each page is a slide. Text stays editable; other elements come as pictures. PowerPoint needs the fonts installed.</span>
  {:else if dl.format === 'mp3'}
    <span class="dims">The design's sound only · {mmss(soundDuration(ed.doc))}</span>
  {:else if dl.format === 'dcanvas'}
    <span class="dims">Open it in Digital Canvas to keep editing; fonts and pictures are inside.</span>
  {/if}
  {#if dl.format === 'png' || dl.format === 'gif'}
    <label class="check"><input type="checkbox" bind:checked={dl.transparent} data-testid="dl-transparent" /> Transparent background</label>
  {/if}
  {#if dl.format === 'png'}
    <label class="check"><input type="checkbox" bind:checked={dl.compress} data-testid="dl-compress" /> Compress file (lower quality)</label>
  {/if}

  {#if pickPages}
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
  {#if canSeparate}
    <label class="check"><input type="checkbox" bind:checked={dl.separate} data-testid="dl-separate" /> Download pages as separate files</label>
  {/if}

  <label class="check small"><input type="checkbox" bind:checked={remember} data-testid="dl-remember" /> Save download settings</label>
  <button class="btn primary go" onclick={go} disabled={busy || !chosen.length} data-testid="do-download">
    {busy ? (progress ? `Preparing… ${Math.round(progress * 100)}%` : 'Preparing…') : native ? 'Share' : 'Download'}
  </button>
  {#if (raster || (canSeparate && dl.separate)) && chosen.length > 1}<p class="note">{chosen.length} pages {native ? 'are shared together' : 'download as one .zip file'}.</p>{/if}
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
  .chips { display: flex; gap: 6px; }
  .chip { flex: 1; height: 30px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: var(--ink); font-size: 12px; cursor: pointer; }
  .chip.on { border-color: var(--accent); background: var(--accent-soft); font-weight: 600; }
</style>
