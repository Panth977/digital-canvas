<script lang="ts">
  import type { EditorState } from '../lib/editor.svelte.ts';
  import { catalog, CATEGORIES, FONT_ACCEPT, listUploads, previewFamily, readFontFile, saveUpload, type CatalogFont, type FontFile } from '../lib/fonts.ts';
  import { pickFiles } from '../lib/files.ts';
  import Icon from '../lib/Icon.svelte';

  let { ed, value }: { ed: EditorState; value: string | undefined } = $props();

  let open = $state(false);
  let query = $state('');
  let category = $state('');
  let fonts = $state<CatalogFont[]>([]);
  let error = $state('');
  let shown = $state(60);
  let uploads = $state<FontFile[]>([]);

  async function toggle(): Promise<void> {
    open = !open;
    if (!open) return;
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
      open = false;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  function pickFamily(family: string): void {
    ed.updateTextStyle({ fontFamily: family });
    ed.seal();
    open = false;
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

<div class="fp" data-text-tools>
  <span class="lab">Font</span>
  <button class="input cur" onclick={toggle} data-testid="font-picker" style="font-family:'{value ?? 'Inter'}', Inter, sans-serif">
    {value ?? 'Mixed'}
    {#if ed.fontLoading}<span class="spin"></span>{/if}
  </button>
  {#if open}
    <div class="pop" role="dialog" aria-label="Fonts">
      <div class="search">
        <Icon name="search" size={16} />
        <!-- svelte-ignore a11y_autofocus -->
        <input class="input" placeholder="Search 2,000+ fonts" bind:value={query} autofocus data-testid="font-search" />
      </div>
      <div class="cats">
        <button class:on={!category} onclick={() => (category = '')}>All</button>
        {#each CATEGORIES as c}<button class:on={category === c} onclick={() => (category = c)}>{c}</button>{/each}
      </div>
      <button class="btn wide" onclick={upload} data-testid="font-upload"><Icon name="upload" size={15} /> Upload a font</button>
      {#if error}<p class="err">{error}</p>{/if}
      <div class="list scroll-y" onscroll={onScroll}>
        {#if inDoc.length || uploaded.length}
          <h5>In this design</h5>
          {#each inDoc as f}
            <button class="row" class:on={f === value} style="font-family:'{f}', Inter" onclick={() => pickFamily(f)}>{f}</button>
          {/each}
          {#each uploaded as f}
            <button class="row" onclick={() => useUploaded(f)}>{f} <em>uploaded</em></button>
          {/each}
          <h5>All fonts · {matches.length}</h5>
        {/if}
        {#each matches.slice(0, shown) as f (f.id)}
          <button class="row" class:on={f.family === value} data-family={f.family} style="font-family:'{previewFamily(f)}', Inter" onclick={() => pick(f)} disabled={!!ed.fontLoading}>
            {f.family}
            {#if ed.fontLoading === f.family}<span class="spin"></span>{/if}
          </button>
        {/each}
        {#if !fonts.length && !error}<p class="hint">Loading fonts…</p>{/if}
      </div>
      <p class="hint">Fonts from Google Fonts (via Fontsource), open licences. The faces you use are saved inside the design.</p>
    </div>
  {/if}
</div>

<style>
  .fp { position: relative; display: flex; flex-direction: column; gap: 4px; }
  .lab { font-size: 12px; color: var(--muted); font-weight: 600; }
  .cur { text-align: left; font-size: 15px; display: flex; align-items: center; justify-content: space-between; white-space: nowrap; overflow: hidden; }
  .pop { position: absolute; left: 0; right: 0; top: 58px; max-height: 70vh; display: flex; flex-direction: column; gap: 8px; background: #fff; border: 1px solid var(--line);
    border-radius: 12px; box-shadow: var(--shadow); padding: 10px; z-index: 30; }
  .search { display: flex; align-items: center; gap: 6px; color: var(--muted); }
  .cats { display: flex; flex-wrap: wrap; gap: 4px; }
  .cats button { border: 1px solid var(--line); background: #fff; border-radius: 99px; padding: 2px 9px; font-size: 11px; text-transform: capitalize; }
  .cats button.on { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
  .wide { width: 100%; justify-content: center; }
  .list { flex: 1; min-height: 120px; max-height: 46vh; display: flex; flex-direction: column; }
  .row { text-align: left; border: 0; background: none; padding: 7px 8px; border-radius: 6px; font-size: 17px; display: flex; justify-content: space-between; align-items: center; }
  .row:hover:not(:disabled) { background: #f2f3f7; }
  .row.on { background: var(--accent-soft); }
  .row em { font: 11px Inter; color: var(--muted); }
  h5 { margin: 8px 8px 2px; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
  .hint { color: var(--muted); font-size: 11px; margin: 0; }
  .err { color: var(--danger); font-size: 12px; margin: 0; }
  .spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid #ddd; border-top-color: var(--accent); animation: spin .8s linear infinite; flex-shrink: 0; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
