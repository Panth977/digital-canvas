<script lang="ts">
  import { onMount } from 'svelte';
  import type { EditorState } from '../lib/editor.svelte.ts';
  import { catalog, CATEGORIES, FONT_ACCEPT, listUploads, previewFamily, readFontFile, saveUpload, type CatalogFont, type FontFile } from '../lib/fonts.ts';
  import { pickFiles } from '../lib/files.ts';
  import Icon from '../lib/Icon.svelte';
  import { ui } from '../lib/ui.svelte.ts';

  let { ed, value }: { ed: EditorState; value: string | undefined } = $props();

  let query = $state(ui.fontQuery);
  let category = $state('');
  let fonts = $state<CatalogFont[]>([]);
  let error = $state('');
  let shown = $state(60);
  let uploads = $state<FontFile[]>([]);

  /** Canva's font list in the side panel: loads the catalogue when it opens. */
  onMount(() => { ui.fontQuery = ''; void load(); });
  async function load(): Promise<void> {
    error = '';
    try {
      fonts = await catalog();
    } catch (e) {
      error = `Couldn't load the font list (${e instanceof Error ? e.message : e}).`;
    }
    uploads = await listUploads();
  }

  const q = $derived(query.trim().toLowerCase());
  const matches = $derived(fonts.filter((f) => (!category || f.category === category) && (!q || f.family.toLowerCase().includes(q))));
  const inDoc = $derived(ed.families.filter((f) => !q || f.toLowerCase().includes(q)));
  const uploaded = $derived([...new Set(uploads.map((u) => u.family))].filter((f) => !ed.engine.fonts.families.has(f) && (!q || f.toLowerCase().includes(q))));

  async function pick(f: CatalogFont): Promise<void> {
    error = '';
    try {
      await ed.useFont(f);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  function pickFamily(family: string): void {
    ed.updateTextStyle({ fontFamily: family });
    ed.seal();
  }

  async function useUploaded(family: string): Promise<void> {
    await ed.addFonts(uploads.filter((u) => u.family === family));
    pickFamily(family);
    ed.refitText();
  }

  async function upload(): Promise<void> {
    error = '';
    const files = await pickFiles(FONT_ACCEPT);
    const read: FontFile[] = [];
    for (const file of files) {
      const f = await readFontFile(file, (bytes) => {
        const tf = ed.engine.ck.Typeface.MakeTypefaceFromData(bytes.slice().buffer as ArrayBuffer);
        const name = tf?.getFamilyName() ?? null;
        tf?.delete();
        return name;
      });
      if (!f) { error = `${file.name} is not a font file (TTF, OTF, WOFF, WOFF2).`; continue; }
      read.push(f);
      await saveUpload(f, `${f.family}|${f.weight}|${f.italic}|${file.size}`);
    }
    if (!read.length) return;
    await ed.addFonts(read);
    uploads = await listUploads();
    pickFamily(read[0]!.family);
    ed.refitText();
  }

  /** Load more rows as the list scrolls. */
  function onScroll(e: Event): void {
    const el = e.currentTarget as HTMLElement;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 200) shown = Math.min(matches.length, shown + 60);
  }

  $effect(() => { void q; void category; shown = 60; });
</script>

<div class="fp" data-text-tools role="dialog" aria-label="Fonts">
  <div class="search">
    <Icon name="search" size={18} />
    <!-- svelte-ignore a11y_autofocus -->
    <input placeholder="Try &quot;Calligraphy&quot; or &quot;Open Sans&quot;" bind:value={query} autofocus data-testid="font-search" />
  </div>
  <div class="cats">
    <button class:on={!category} onclick={() => (category = '')}>All</button>
    {#each CATEGORIES as c}<button class:on={category === c} onclick={() => (category = c)}>{c}</button>{/each}
  </div>
  <button class="btn wide" onclick={upload} data-testid="font-upload"><Icon name="upload" size={15} /> Upload a font</button>
  {#if error}<p class="err">{error}</p>{/if}
  <div class="list scroll-y" onscroll={onScroll}>
    {#if inDoc.length || uploaded.length}
      <h5>Document fonts</h5>
      {#each inDoc as f}
        <button class="row" class:on={f === value} style="font-family:'{f}', Inter" onclick={() => pickFamily(f)}>{f}{#if f === value}<Icon name="check" size={16} />{/if}</button>
      {/each}
      {#each uploaded as f}
        <button class="row" onclick={() => useUploaded(f)}>{f} <em>uploaded</em></button>
      {/each}
      <h5>All fonts · {matches.length}</h5>
    {/if}
    {#each matches.slice(0, shown) as f (f.id)}
      <button class="row" class:on={f.family === value} data-family={f.family} style="font-family:'{previewFamily(f)}', Inter" onclick={() => pick(f)} disabled={!!ed.fontLoading}>
        {f.family}
        {#if ed.fontLoading === f.family}<span class="spin"></span>{:else if f.family === value}<Icon name="check" size={16} />{/if}
      </button>
    {/each}
    {#if !fonts.length && !error}<p class="hint">Loading fonts…</p>{/if}
  </div>
  <p class="hint">Fonts from Google Fonts (via Fontsource), open licences. The faces you use are saved inside the design.</p>
</div>

<style>
  .fp { display: flex; flex-direction: column; gap: 10px; height: 100%; min-height: 0; }
  .search { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--field); color: var(--muted); }
  .search:focus-within { border-color: var(--accent); }
  .search input { flex: 1; min-width: 0; border: 0; background: none; outline: none; color: var(--ink); }
  .cats { display: flex; flex-wrap: wrap; gap: 4px; }
  .cats button { border: 1px solid var(--line); background: none; border-radius: 99px; padding: 3px 10px; font-size: 12px; text-transform: capitalize; }
  .cats button.on { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
  .wide { width: 100%; justify-content: center; }
  .list { flex: 1; min-height: 120px; display: flex; flex-direction: column; margin: 0 -8px; }
  .row { text-align: left; border: 0; background: none; padding: 9px 10px; border-radius: 6px; font-size: 17px; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
  .row:hover:not(:disabled) { background: var(--hover); }
  .row.on { color: var(--accent); }
  .row em { font: 11px Inter; color: var(--muted); }
  h5 { margin: 10px 10px 4px; font-size: 13px; font-weight: 600; color: var(--ink); }
  .hint { color: var(--muted); font-size: 11px; margin: 0; }
  .err { color: var(--danger); font-size: 12px; margin: 0; }
  .spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--line); border-top-color: var(--accent); animation: spin .8s linear infinite; flex-shrink: 0; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
