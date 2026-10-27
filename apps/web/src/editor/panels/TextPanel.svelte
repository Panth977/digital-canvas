<script lang="ts">
  import BrandTextStyles from './BrandTextStyles.svelte';
  /**
   * Canva's Text panel: add a text box, default text styles, font
   * combinations (styled groups in Google Fonts pairings), and the font
   * library: every Google Font by category, each name drawn in its own face,
   * recently used, document and uploaded fonts. A font applies to the
   * selected text, or adds a text box in that font.
   */
  import { onMount } from 'svelte';
  import { TEXT_PRESETS, type EditorState } from '../../lib/editor.svelte.ts';
  import { catalog, CATEGORIES, FONT_ACCEPT, listUploads, readFontFile, saveUpload, type CatalogFont, type FontFile } from '../../lib/fonts.ts';
  import { pickFiles } from '../../lib/files.ts';
  import { COMBOS, findCombos, POPULAR_FONTS, type Combo } from '../../lib/content/combos.ts';
  import { onRecent } from '../../lib/content/recent.ts';
  import { insertCombo, pickFamily, pickFont, previewFace, recentFonts } from '../../lib/content/text.ts';
  import Icon from '../../lib/Icon.svelte';
  import { inview } from './actions.ts';
  import SearchBox from './SearchBox.svelte';

  let { ed }: { ed: EditorState } = $props();

  let view = $state<'home' | 'fonts' | 'combos'>('home');
  let query = $state('');
  let libQuery = $state('');
  let category = $state('');
  let fonts = $state<CatalogFont[]>([]);
  let uploads = $state<FontFile[]>([]);
  let error = $state('');
  let shown = $state(60);
  let recents = $state<string[]>(recentFonts());
  let busyCombo = $state<string | null>(null);
  let scroller = $state<HTMLDivElement>();

  onMount(() => {
    catalog().then((l) => (fonts = l)).catch((e) => (error = `Couldn't load the font list (${e instanceof Error ? e.message : e}).`));
    void listUploads().then((u) => (uploads = u));
    return onRecent(() => (recents = recentFonts()));
  });

  const CAT_LABEL: Record<string, string> = { 'sans-serif': 'Sans serif', serif: 'Serif', display: 'Display', handwriting: 'Handwriting', monospace: 'Monospace' };
  const byFamily = $derived(new Map(fonts.map((f) => [f.family, f])));
  const textSelected = $derived(ed.selected.some((e) => e.type === 'text'));
  const current = $derived(ed.textStyle?.fontFamily);

  // ---- search (home) ----
  const q = $derived(query.trim().toLowerCase());
  const comboHits = $derived(q ? findCombos(q) : COMBOS);
  const fontHits = $derived(q ? fonts.filter((f) => f.family.toLowerCase().includes(q) || f.category.includes(q)) : []);

  // ---- library ----
  const lq = $derived(libQuery.trim().toLowerCase());
  const matches = $derived(fonts.filter((f) => (!category || f.category === category) && (!lq || f.family.toLowerCase().includes(lq))));
  const docFamilies = $derived(ed.families.filter((f) => !lq || f.toLowerCase().includes(lq)));
  const uploaded = $derived([...new Set(uploads.map((u) => u.family))].filter((f) => !ed.engine.fonts.families.has(f) && (!lq || f.toLowerCase().includes(lq))));
  const popular = $derived(POPULAR_FONTS.map((f) => byFamily.get(f)).filter((f): f is CatalogFont => !!f && (!category || f.category === category)));
  $effect(() => { void lq; void category; shown = 60; });

  function openFonts(withQuery = ''): void {
    libQuery = withQuery;
    view = 'fonts';
    scroller?.scrollTo({ top: 0 });
  }

  async function choose(f: CatalogFont): Promise<void> {
    error = '';
    try {
      await pickFont(ed, f);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function chooseFamily(family: string): Promise<void> {
    const cat = byFamily.get(family);
    if (!ed.engine.fonts.families.has(family)) {
      const up = uploads.filter((u) => u.family === family);
      if (up.length) await ed.addFonts(up);
      else if (cat) return choose(cat);
    }
    pickFamily(ed, family);
  }

  async function addCombo(c: Combo): Promise<void> {
    error = '';
    busyCombo = c.id;
    try {
      await insertCombo(ed, c);
    } catch (e) {
      error = `Couldn't add "${c.name}" (${e instanceof Error ? e.message : e}).`;
    } finally {
      busyCombo = null;
    }
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
    pickFamily(ed, read[0]!.family);
  }

  function drag(e: DragEvent, data: object): void {
    e.dataTransfer?.setData('application/x-digital-canvas', JSON.stringify(data));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  }

  /** Show a catalogue font's name in its face once the row is on screen. */
  function face(node: HTMLElement, f: CatalogFont) {
    const a = inview(node, { once: true, margin: '300px', fn: () => (node.style.fontFamily = `'${previewFace(f.family, 400, false, f.weights)}', Inter`) });
    return { destroy: a.destroy };
  }

  function onScroll(e: Event): void {
    if (view !== 'fonts') return;
    const el = e.currentTarget as HTMLElement;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 300) shown = Math.min(matches.length, shown + 60);
  }

  const INK = '#1f2328';
</script>

{#snippet fontRow(f: CatalogFont)}
  <button class="font" class:on={f.family === current} data-font={f.family} use:face={f} onclick={() => choose(f)} disabled={!!ed.fontLoading} title="{f.family} · {CAT_LABEL[f.category] ?? f.category}">
    <span>{f.family}</span>
    {#if ed.fontLoading === f.family}<span class="spin"></span>{:else if f.family === current}<Icon name="check" size={16} />{/if}
  </button>
{/snippet}
{#snippet familyRow(family: string, note = '')}
  {@const cat = byFamily.get(family)}
  <button class="font" class:on={family === current} data-font={family} style="font-family:'{family}', {cat ? `'${previewFace(family, 400, false, cat.weights)}', ` : ''}Inter" onclick={() => chooseFamily(family)} disabled={!!ed.fontLoading}>
    <span>{family}</span>
    {#if note}<em>{note}</em>{:else if ed.fontLoading === family}<span class="spin"></span>{:else if family === current}<Icon name="check" size={16} />{/if}
  </button>
{/snippet}
{#snippet comboCard(c: Combo)}
  <button class="combo" data-testid="combo-{c.id}" aria-label="Add font combination {c.name}" title={c.name} draggable="true"
    ondragstart={(e) => drag(e, { kind: 'combo', id: c.id })} onclick={() => addCombo(c)} disabled={busyCombo === c.id}>
    {#each c.lines as l}
      <span style="font-family:'{previewFace(l.family, l.bold ? 700 : 400, !!l.italic, byFamily.get(l.family)?.weights)}', Inter; font-size:{Math.max(7, l.size * 0.2)}px; font-weight:{l.bold ? 700 : 400}; font-style:{l.italic ? 'italic' : 'normal'}; letter-spacing:{(l.spacing ?? 0) * 0.2}px; text-transform:{l.upper ? 'uppercase' : 'none'}; color:{l.color === INK ? 'var(--ink)' : l.color}">{l.text}</span>
    {/each}
    {#if busyCombo === c.id}<span class="cover"><span class="spin"></span></span>{/if}
  </button>
{/snippet}

<div class="panel" data-testid="text-panel">
  {#if view === 'home'}
    <SearchBox bind:value={query} placeholder="Search fonts and combinations" label="Search fonts" testid="text-search" onsearch={() => {}} />
  {:else}
    <header class="head">
      <button class="back" aria-label="Back" data-testid="text-back" onclick={() => (view = 'home')}><Icon name="left" size={18} /></button>
      <h2>{view === 'fonts' ? 'Fonts' : 'Font combinations'}</h2>
    </header>
    {#if view === 'fonts'}
      <SearchBox bind:value={libQuery} placeholder="Try “Calligraphy” or “Open Sans”" label="Search all fonts" testid="fontlib-search" onsearch={() => {}} />
      <div class="chips">
        <button class:on={!category} onclick={() => (category = '')}>All</button>
        {#each CATEGORIES as c}<button class:on={category === c} data-testid="fontcat-{c}" onclick={() => (category = c)}>{CAT_LABEL[c]}</button>{/each}
      </div>
    {/if}
  {/if}
  {#if error}<p class="err" role="alert">{error}</p>{/if}

  <div class="pbody scroll-y" bind:this={scroller} onscroll={onScroll}>
    {#if view === 'home' && q}
      {#if comboHits.length}
        <h3>Font combinations</h3>
        <div class="combos">{#each comboHits.slice(0, 8) as c (c.id)}{@render comboCard(c)}{/each}</div>
      {/if}
      <div class="sechead"><h3>Fonts</h3>{#if fontHits.length > 12}<button class="see" onclick={() => openFonts(query.trim())}>See all</button>{/if}</div>
      <div class="fonts" data-testid="text-font-results">{#each fontHits.slice(0, 12) as f (f.id)}{@render fontRow(f)}{/each}</div>
      {#if !fontHits.length && !comboHits.length}<p class="hint">Nothing matches “{query.trim()}”.</p>{/if}
    {:else if view === 'home'}
      <button class="btn primary cta" data-testid="add-textbox" onclick={() => ed.addText('body')}><Icon name="text" size={18} /> Add a text box</button>
      <BrandTextStyles {ed} />
      <h3>Default text styles</h3>
      <div class="texts">
        {#each Object.entries(TEXT_PRESETS) as [key, p]}
          <button class="textbtn {key}" draggable="true" data-testid="text-{key}"
            ondragstart={(e) => drag(e, { kind: 'text', preset: key })} onclick={() => ed.addText(key as keyof typeof TEXT_PRESETS)}>{p.label}</button>
        {/each}
      </div>
      <div class="sechead"><h3>Fonts</h3><button class="see" data-testid="browse-fonts" onclick={() => openFonts()}>See all</button></div>
      <p class="hint top">{textSelected ? 'Pick a font for the selected text.' : 'Pick a font to add a text box in it.'}</p>
      <div class="fonts">
        {#each recents.slice(0, 4) as fam (fam)}{@render familyRow(fam, 'recent')}{/each}
        {#each POPULAR_FONTS.filter((f) => !recents.includes(f)).slice(0, 8 - Math.min(4, recents.length)) as fam (fam)}
          {@const f = byFamily.get(fam)}{#if f}{@render fontRow(f)}{/if}
        {/each}
      </div>
      <button class="btn wide" data-testid="browse-fonts-all" onclick={() => openFonts()}><Icon name="text" size={15} /> Browse all {fonts.length ? fonts.length.toLocaleString() : ''} fonts</button>
      <div class="sechead"><h3>Font combinations</h3><button class="see" data-testid="see-combos" onclick={() => { view = 'combos'; scroller?.scrollTo({ top: 0 }); }}>See all</button></div>
      <div class="combos" data-testid="combos">{#each COMBOS.slice(0, 12) as c (c.id)}{@render comboCard(c)}{/each}</div>
      <p class="hint">Double-click text to edit it. Select some words to style just those. Effects, curve and lists are in the toolbar above the page.</p>
    {:else if view === 'combos'}
      <div class="combos">{#each COMBOS as c (c.id)}{@render comboCard(c)}{/each}</div>
    {:else}
      <button class="btn wide" onclick={upload} data-testid="fontlib-upload"><Icon name="upload" size={15} /> Upload a font</button>
      {#if !lq && !category && recents.length}
        <h4>Recently used</h4>
        <div class="fonts">{#each recents as fam (fam)}{@render familyRow(fam)}{/each}</div>
      {/if}
      {#if docFamilies.length || uploaded.length}
        <h4>Document fonts</h4>
        <div class="fonts">
          {#each docFamilies as fam (fam)}{@render familyRow(fam)}{/each}
          {#each uploaded as fam (fam)}{@render familyRow(fam, 'uploaded')}{/each}
        </div>
      {/if}
      {#if !lq && popular.length}
        <h4>Popular</h4>
        <div class="fonts">{#each popular as f (f.id)}{@render fontRow(f)}{/each}</div>
      {/if}
      <h4>{category ? CAT_LABEL[category] : 'All fonts'} · {matches.length.toLocaleString()}</h4>
      <div class="fonts" data-testid="fontlib-results">{#each matches.slice(0, shown) as f (f.id)}{@render fontRow(f)}{/each}</div>
      {#if !fonts.length && !error}<p class="hint">Loading fonts…</p>{/if}
      <p class="hint">Google Fonts (via Fontsource), open licences (OFL / Apache). The faces you use are saved inside the design.</p>
    {/if}
  </div>
</div>

<style>
  .panel { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .pbody { flex: 1; min-height: 0; margin: 0 -16px; padding: 0 16px 24px; }
  .head { display: flex; align-items: center; gap: 6px; margin: -4px 0 10px; }
  .head h2 { margin: 0; font-size: 16px; font-weight: 600; }
  .back { width: 32px; height: 32px; border: 0; border-radius: 6px; background: none; color: var(--ink); display: grid; place-items: center; }
  .back:hover { background: var(--hover); }
  .cta { width: 100%; height: 44px; border-radius: 8px; font-size: 14px; margin-top: 14px; }
  h3 { margin: 22px 0 10px; font-size: 15px; font-weight: 600; }
  h4 { margin: 16px 0 6px; font-size: 13px; font-weight: 600; }
  .sechead { display: flex; align-items: center; justify-content: space-between; }
  .see { border: 0; background: none; color: var(--ink-2); font-size: 13px; padding: 2px 4px; margin-top: 12px; }
  .see:hover { text-decoration: underline; }
  .texts { display: flex; flex-direction: column; gap: 8px; }
  .textbtn { text-align: left; padding: 12px 14px; border: 0; border-radius: 8px; background: var(--chip); color: var(--ink); }
  .textbtn:hover { background: var(--hover); }
  .textbtn.heading { font-size: 26px; font-weight: 800; }
  .textbtn.subheading { font-size: 17px; font-weight: 700; }
  .textbtn.body { font-size: 13px; }
  .combos { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .combo { position: relative; aspect-ratio: 1.45; border: 0; border-radius: 8px; background: var(--chip); color: var(--ink); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; padding: 8px; overflow: hidden; text-align: center; line-height: 1.1; }
  .combo:hover { outline: 2px solid var(--accent); outline-offset: -2px; }
  .combo span { max-width: 100%; overflow-wrap: anywhere; }
  .combo .cover { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(0, 0, 0, .35); }
  .fonts { display: flex; flex-direction: column; margin: 0 -8px; }
  .font { text-align: left; border: 0; background: none; padding: 9px 10px; border-radius: 6px; font-size: 18px; display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-shrink: 0; color: var(--ink); min-height: 40px; font-family: Inter; }
  .font span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .font:hover:not(:disabled) { background: var(--hover); }
  .font.on { color: var(--accent); }
  .font em { font: 11px Inter; color: var(--muted); flex-shrink: 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 4px; }
  .chips button { border: 1px solid var(--line); background: none; border-radius: 99px; padding: 4px 11px; font-size: 12px; color: var(--ink-2); }
  .chips button:hover { background: var(--hover); }
  .chips button.on { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
  .wide { width: 100%; margin-top: 10px; }
  .hint { color: var(--muted); font-size: 12px; line-height: 1.5; margin: 14px 0 0; }
  .hint.top { margin: -4px 0 6px; }
  .err { color: var(--danger); font-size: 12px; margin: 8px 0 0; }
  .spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--line); border-top-color: var(--accent); animation: spin .8s linear infinite; flex-shrink: 0; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
