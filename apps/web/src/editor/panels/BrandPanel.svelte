<script lang="ts">
  import './panels.css';
  import { onMount } from 'svelte';
  import { BRAND_ROLES, type BrandFont, type BrandRole } from '@digital-canvas/storage';
  import { walk } from '@digital-canvas/scene';
  import type { EditorState } from '../../lib/editor.svelte.ts';
  import Icon from '../../lib/Icon.svelte';
  import { account } from '../../lib/account.svelte.ts';
  import { library } from '../../lib/library.svelte.ts';
  import { objectUrl, pickFiles } from '../../lib/files.ts';
  import { catalog, previewFamily, type CatalogFont } from '../../lib/fonts.ts';
  import { addBrandText, brand, placeLogo, ROLE_LABELS, styleSelection } from '../../lib/brand.svelte.ts';

  let { ed }: { ed: EditorState } = $props();

  onMount(() => void brand.load(library.store));
  $effect(() => void brand.load(library.store));

  let error = $state('');
  const where = $derived(account.user ? 'Google Drive · Digital Canvas/brand.json' : library.store.kind === 'folder' ? `${library.store.label}/brand.json` : 'this browser');

  // ---- logos ----
  async function uploadLogo(): Promise<void> {
    error = '';
    for (const f of await pickFiles('image/png,image/jpeg,image/webp,image/svg+xml,.svg')) {
      const mime = f.type || (f.name.endsWith('.svg') ? 'image/svg+xml' : '');
      if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(mime)) { error = `${f.name} isn’t a PNG, JPG, WebP or SVG.`; continue; }
      await brand.addLogo(new Uint8Array(await f.arrayBuffer()), mime, f.name);
    }
  }

  // ---- colours ----
  let colorInput = $state<HTMLInputElement>();
  let editing = $state<{ palette: string; index: number } | null>(null);
  function addColor(paletteId: string): void {
    editing = { palette: paletteId, index: -1 };
    colorInput!.value = '#8b3dff';
    colorInput!.click();
  }
  function editColor(paletteId: string, index: number, hex: string): void {
    editing = { palette: paletteId, index };
    colorInput!.value = hex;
    colorInput!.click();
  }
  function colorChosen(hex: string): void {
    const e = editing;
    if (!e) return;
    const p = brand.kit.palettes.find((x) => x.id === e.palette);
    if (!p) return;
    const colors = e.index < 0 ? [...p.colors, hex.toLowerCase()] : p.colors.map((c, i) => (i === e.index ? hex.toLowerCase() : c));
    void brand.setPalette(p.id, { colors: [...new Set(colors)] });
    editing = null;
  }
  function removeColor(paletteId: string, hex: string): void {
    const p = brand.kit.palettes.find((x) => x.id === paletteId);
    if (p) void brand.setPalette(p.id, { colors: p.colors.filter((c) => c !== hex) });
  }
  /** Canva's "add the design's colours". */
  function fromDesign(): void {
    const out = new Set<string>();
    const add = (c?: string) => c && /^#[0-9a-f]{6}/i.test(c) && out.add(c.slice(0, 7).toLowerCase());
    for (const p of ed.doc.pages) {
      if (p.background.type === 'solid') add(p.background.color); else p.background.stops.forEach((s) => add(s.color));
      for (const e of walk(p.elements)) {
        if (e.type === 'text') add(e.style.color);
        if (e.type === 'shape' && e.fill?.type === 'solid') add(e.fill.color);
        if (e.type === 'path') e.paths.forEach((x) => x.fill?.type === 'solid' && add(x.fill.color));
      }
    }
    void brand.addPalette([...out].slice(0, 12), 'From this design');
  }
  /** Click a brand colour: colour the selection (or the page). */
  function applyColor(hex: string): void {
    const sel = ed.selected;
    if (!sel.length) { ed.updatePage({ background: { type: 'solid', color: hex } }); ed.seal(); return; }
    if (sel.some((e) => e.type === 'text')) ed.updateTextStyle({ color: hex });
    ed.update((e) => (e.type === 'shape' ? { fill: { type: 'solid', color: hex } } : e.type === 'path' ? { paths: e.paths.map((p) => ({ ...p, fill: p.fill ? { type: 'solid', color: hex } : null, stroke: p.stroke && !p.fill ? { ...p.stroke, color: hex } : p.stroke })) } : e.type === 'line' ? { stroke: { ...e.stroke, color: hex } } : {}));
    ed.seal();
  }

  // ---- fonts ----
  let fontRole = $state<BrandRole | null>(null);
  let fontQuery = $state('');
  let fonts = $state<CatalogFont[]>([]);
  let fontState = $state<'' | 'loading' | 'error'>('');
  async function openFonts(r: BrandRole): Promise<void> {
    fontRole = r;
    fontQuery = '';
    if (fonts.length) return;
    fontState = 'loading';
    try { fonts = await catalog(); fontState = ''; } catch { fontState = 'error'; }
  }
  const fontHits = $derived(fontQuery.trim() ? fonts.filter((f) => f.family.toLowerCase().includes(fontQuery.trim().toLowerCase())).slice(0, 40) : fonts.filter((f) => POPULAR.includes(f.family)));
  const POPULAR = ['Montserrat', 'Poppins', 'Playfair Display', 'Inter', 'Lato', 'Oswald', 'Bebas Neue', 'Anton', 'DM Serif Display', 'Raleway', 'Roboto', 'Open Sans', 'Pacifico', 'Lobster', 'Fraunces', 'Space Grotesk', 'Cormorant Garamond', 'Archivo Black', 'Great Vibes', 'Syne'];
  const DEFAULTS: Record<BrandRole, Pick<BrandFont, 'fontSize' | 'bold'>> = { heading: { fontSize: 64, bold: true }, subheading: { fontSize: 36, bold: true }, body: { fontSize: 22, bold: false } };
  function chooseFont(f: CatalogFont): void {
    const r = fontRole!;
    const cur = brand.kit.fonts[r];
    void brand.setFont(r, { fontFamily: f.family, fontSize: cur?.fontSize ?? DEFAULTS[r].fontSize, bold: cur?.bold ?? DEFAULTS[r].bold, italic: cur?.italic ?? false, uppercase: cur?.uppercase ?? false, letterSpacing: cur?.letterSpacing ?? 0, ...(cur?.color ? { color: cur.color } : {}) });
    fontRole = null;
  }
  function patchFont(r: BrandRole, patch: Partial<BrandFont>): void {
    const cur = brand.kit.fonts[r];
    if (cur) void brand.setFont(r, { ...cur, ...patch });
  }
  const hasTextSel = $derived(ed.selected.some((e) => e.type === 'text'));

  let renaming = $state(false);
</script>

<input type="color" class="sr-only" bind:this={colorInput} onchange={(e) => colorChosen((e.currentTarget as HTMLInputElement).value)} data-testid="brand-color-input" tabindex="-1" aria-hidden="true" />

<div class="dp" data-testid="brand-panel">
  {#if fontRole}
    <button class="dp-back" onclick={() => (fontRole = null)}><Icon name="left" size={16} /> {ROLE_LABELS[fontRole]} font</button>
    <form class="dp-search" onsubmit={(e) => e.preventDefault()}>
      <Icon name="search" size={18} />
      <input placeholder="Search Google Fonts" bind:value={fontQuery} data-testid="brand-font-search" aria-label="Search fonts" />
    </form>
    {#if fontState === 'loading'}<p class="dp-hint"><span class="dp-spin"></span> Loading fonts…</p>{:else if fontState === 'error'}<p class="dp-err">Couldn’t load the font list.</p>{/if}
    <div class="dp-list">
      {#each fontHits as f (f.id)}
        <button class="dp-item" onclick={() => chooseFont(f)} data-testid="brand-font-{f.id}">
          <span class="dp-tx"><b style="font-family:'{previewFamily(f)}';font-size:17px;font-weight:400">{f.family}</b><small>{f.category}</small></span>
        </button>
      {/each}
    </div>
  {:else}
    <div class="kit">
      <div class="kit-ico"><Icon name="brand" size={22} /></div>
      {#if renaming}
        <input class="input" value={brand.kit.name} aria-label="Brand Kit name" onblur={(e) => { renaming = false; void brand.rename((e.currentTarget as HTMLInputElement).value); }} onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} />
      {:else}
        <button class="kit-name" title="Rename" onclick={() => (renaming = true)} data-testid="brand-name">{brand.kit.name}</button>
      {/if}
      {#if brand.saving}<span class="dp-spin" title="Saving"></span>{/if}
    </div>
    <p class="dp-hint" style="margin-top:2px">Saved in {where}. Your colours and fonts show up in every design’s colour and text panels.</p>
    {#if brand.status === 'loading'}<p class="dp-hint"><span class="dp-spin"></span> Loading your Brand Kit…</p>{/if}
    {#if brand.error}<p class="dp-err">{brand.error}</p>{/if}
    {#if error}<p class="dp-err">{error}</p>{/if}

    <div class="dp-head"><h3>Logos</h3><button class="dp-link" onclick={uploadLogo} data-testid="brand-logo-upload">Upload</button></div>
    {#if brand.kit.logos.length}
      <div class="dp-grid" data-testid="brand-logos">
        {#each brand.kit.logos as l (l.id)}
          {@const b = brand.assets.get(l.asset)}
          <div class="logo">
            <button class="dp-cell" title="Add {l.name}" onclick={() => placeLogo(ed, l)} data-testid="brand-logo">{#if b}<img src={objectUrl(b, l.mime)} alt={l.name} />{:else}<Icon name="image" />{/if}</button>
            <button class="rm" title="Remove logo" aria-label="Remove {l.name}" onclick={() => brand.removeLogo(l.id)}><Icon name="close" size={12} /></button>
          </div>
        {/each}
      </div>
    {:else}
      <button class="drop" onclick={uploadLogo}><Icon name="upload" size={20} /> Add your logos (PNG, SVG, JPG)</button>
    {/if}

    <div class="dp-head"><h3>Colours</h3><button class="dp-link" onclick={() => brand.addPalette()} data-testid="brand-add-palette">Add palette</button></div>
    {#each brand.kit.palettes as p (p.id)}
      <div class="pal" data-testid="brand-palette">
        <div class="pal-h">
          <input class="pal-name" value={p.name} aria-label="Palette name" onchange={(e) => brand.setPalette(p.id, { name: (e.currentTarget as HTMLInputElement).value })} />
          <button class="dp-link" title="Delete palette" aria-label="Delete palette {p.name}" onclick={() => brand.removePalette(p.id)}><Icon name="trash" size={14} /></button>
        </div>
        <div class="dp-swatches">
          {#each p.colors as hex, i (hex)}
            <span class="swc">
              <button class="dp-sw big" style="background:{hex}" title="{hex} — click to use, double-click to edit" aria-label="Brand colour {hex}" onclick={() => applyColor(hex)} ondblclick={() => editColor(p.id, i, hex)} data-testid="brand-swatch"></button>
              <button class="rm" aria-label="Remove {hex}" onclick={() => removeColor(p.id, hex)}><Icon name="close" size={10} /></button>
            </span>
          {/each}
          <button class="dp-sw big add" title="Add a colour" aria-label="Add a colour to {p.name}" onclick={() => addColor(p.id)} data-testid="brand-add-color"><Icon name="plus" size={16} /></button>
        </div>
      </div>
    {:else}
      <p class="dp-hint">No brand colours yet.</p>
    {/each}
    <button class="btn dp-cta" style="margin-top:10px" onclick={fromDesign} data-testid="brand-from-design"><Icon name="picker" size={16} /> Add this design’s colours</button>
    <p class="dp-hint">Click a colour to apply it to the selection (or the page). Double-click to edit.</p>

    <div class="dp-head"><h3>Fonts</h3></div>
    <div class="dp-stack">
      {#each BRAND_ROLES as r (r)}
        {@const f = brand.kit.fonts[r]}
        <div class="font" data-testid="brand-font-{r}">
          <div class="font-top">
            <span class="role">{ROLE_LABELS[r]}</span>
            <button class="dp-link" onclick={() => openFonts(r)} data-testid="brand-font-pick-{r}">{f ? 'Change' : 'Set font'}</button>
          </div>
          {#if f}
            <button class="sample {r}" style="font-family:'{f.fontFamily}', Inter, sans-serif;font-weight:{f.bold ? 700 : 400};font-style:{f.italic ? 'italic' : 'normal'};{f.uppercase ? 'text-transform:uppercase;' : ''}" onclick={() => addBrandText(ed, r)} title="Add to page">{f.fontFamily}</button>
            <div class="dp-row">
              <label class="field grow">Size<input class="input" type="number" min="6" max="400" value={f.fontSize} onchange={(e) => patchFont(r, { fontSize: Number((e.currentTarget as HTMLInputElement).value) || f.fontSize })} /></label>
              <button class="btn icon" class:on={f.bold} aria-pressed={f.bold} title="Bold" onclick={() => patchFont(r, { bold: !f.bold })}><Icon name="bold" /></button>
              <button class="btn icon" class:on={f.italic} aria-pressed={f.italic} title="Italic" onclick={() => patchFont(r, { italic: !f.italic })}><Icon name="italic" /></button>
              <button class="btn icon" class:on={f.uppercase} aria-pressed={f.uppercase} title="Uppercase" onclick={() => patchFont(r, { uppercase: !f.uppercase })}><Icon name="caps" /></button>
              <button class="btn icon" title="Remove" aria-label="Remove {ROLE_LABELS[r]} font" onclick={() => brand.setFont(r, null)}><Icon name="trash" /></button>
            </div>
            {#if hasTextSel}<button class="btn" onclick={() => styleSelection(ed, r)} data-testid="brand-apply-{r}">Apply to selected text</button>{/if}
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .kit { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  .kit-ico { width: 40px; height: 40px; border-radius: 10px; background: linear-gradient(135deg, #00c4cc, #7d2ae8); color: #fff; display: grid; place-items: center; flex-shrink: 0; }
  .kit-name { flex: 1; text-align: left; border: 0; background: none; color: var(--ink); font-size: 17px; font-weight: 700; padding: 4px 6px; border-radius: 6px; }
  .kit-name:hover { background: var(--hover); }
  .logo { position: relative; }
  .logo .rm, .swc .rm { position: absolute; top: -5px; right: -5px; width: 18px; height: 18px; border-radius: 50%; border: 0; background: var(--pop); color: var(--ink); box-shadow: var(--shadow); display: none; place-items: center; padding: 0; }
  .logo:hover .rm, .swc:hover .rm { display: grid; }
  .swc { position: relative; display: inline-block; }
  .drop { width: 100%; height: 72px; border: 1px dashed var(--line); border-radius: 10px; background: none; color: var(--muted); display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px; }
  .drop:hover { border-color: var(--accent); color: var(--ink); }
  .pal { margin-bottom: 12px; }
  .pal-h { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
  .pal-name { border: 0; background: none; color: var(--ink); font-size: 13px; font-weight: 600; padding: 2px 4px; border-radius: 6px; min-width: 0; flex: 1; }
  .pal-name:hover, .pal-name:focus { background: var(--hover); outline: none; }
  .font { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
  .font-top { display: flex; justify-content: space-between; align-items: center; }
  .role { font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
  .sample { border: 0; background: none; color: var(--ink); text-align: left; padding: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sample.heading { font-size: 28px; }
  .sample.subheading { font-size: 20px; }
  .sample.body { font-size: 15px; }
  .field.grow { flex: 1; }
</style>
