<script lang="ts">
  import { CHARTS, chart, decompose, FRAMES, GRIDS, line, type ShapeKind } from '@digital-canvas/scene';
  import { BRUSHES, LINES, SHAPES, TEXT_PRESETS, type EditorState } from '../lib/editor.svelte.ts';
  import type { Brush } from '@digital-canvas/scene';
  import ColorField from './ColorField.svelte';
  import { attribution, fetchIcon, fetchPhoto, iconUrl, searchIcons, searchPhotos, type Photo } from '../lib/stock.ts';
  import Icon, { type IconName } from '../lib/Icon.svelte';
  import { IMAGE_TYPES, objectUrl, pickFiles } from '../lib/files.ts';
  import { AUDIO_TYPES, VIDEO_TYPES, formatTime } from '../lib/media.ts';
  import { ui, type RailTab } from '../lib/ui.svelte.ts';
  import ToolPanels from './ToolPanels.svelte';

  let { ed }: { ed: EditorState } = $props();

  let uploadError = $state('');

  /** Canva's rail, in Canva's order (sections we don't have are left out). */
  const TABS: { id: RailTab; label: string; icon: IconName }[] = [
    { id: 'elements', label: 'Elements', icon: 'elements' },
    { id: 'text', label: 'Text', icon: 'text' },
    { id: 'uploads', label: 'Uploads', icon: 'cloud' },
    { id: 'draw', label: 'Tools', icon: 'pen' },
    { id: 'photos', label: 'Photos', icon: 'image' },
  ];
  /** The rail item lit: the open section, or the one a contextual panel came from. */
  const lit = $derived(ui.panel ? (ui.isRail ? ui.panel : null) : null);

  // the pen is on while the Tools (draw) section is open
  let wasDraw = false;
  $effect(() => {
    const draw = ui.panel === 'draw';
    if (draw && !wasDraw) ed.tool = ed.tool ?? { ...toolFor('pen') };
    else if (!draw && wasDraw) ed.tool = null;
    wasDraw = draw;
  });

  let textQuery = $state('');
  function searchFonts(): void {
    const q = textQuery.trim();
    if (!ed.selected.some((e) => e.type === 'text')) ed.addText('body');
    ui.fontQuery = q;
    ui.open('font', false);
  }

  const SHAPE_SVG: Record<ShapeKind, string> = {
    rect: '<rect x="4" y="4" width="40" height="40" rx="3"/>',
    ellipse: '<circle cx="24" cy="24" r="20"/>',
    triangle: '<path d="M24 4L44 44H4z"/>',
    diamond: '<path d="M24 3L45 24 24 45 3 24z"/>',
    pentagon: '<path d="M24 4l19 14-7 23H12L5 18z"/>',
    hexagon: '<path d="M14 6h20l10 18-10 18H14L4 24z"/>',
    star: '<path d="M24 4l5.9 12.9 14.1 1.6-10.5 9.6 2.9 13.9L24 35l-12.4 7 2.9-13.9L4 18.5l14.1-1.6z"/>',
    arrow: '<path d="M4 17h24V8l16 16-16 16v-9H4z"/>',
  };

  const assets = $derived(Object.entries(ed.doc.assets).filter(([k, m]) => m.mime.startsWith('image/') && !k.endsWith('.poster')));
  const videos = $derived(Object.entries(ed.doc.assets).filter(([, m]) => m.mime.startsWith('video/')));
  const sounds = $derived(Object.entries(ed.doc.assets).filter(([, m]) => m.mime.startsWith('audio/')));

  function dragData(e: DragEvent, data: object): void {
    e.dataTransfer?.setData('application/x-digital-canvas', JSON.stringify(data));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  }

  async function upload(): Promise<void> {
    uploadError = '';
    const files = await pickFiles([...IMAGE_TYPES, ...VIDEO_TYPES, ...AUDIO_TYPES, '.mov', '.m4a', '.mp3'].join(','));
    for (const f of files) if (!(await ed.addMediaFile(f))) uploadError = `Couldn't read ${f.name} (this browser can't open it).`;
  }

  // ---- Elements: previews ----

  /** Little SVG previews of line presets, drawn by the same code as the canvas. */
  function linePreview(p: (typeof LINES)[number]): string {
    const bent = p.route !== 'straight';
    const el = line({ x: 6, y: bent ? 12 : 24 }, { x: 42, y: bent ? 36 : 24 }, { route: p.route, start: p.start, end: p.end, stroke: { color: '#3d4350', width: 2.5, dash: p.dash ?? 'solid' } });
    return decompose(el).paths.map((x) => `<path d="${x.d}" fill="${x.fill?.type === 'solid' ? x.fill.color : 'none'}" stroke="${x.stroke ? x.stroke.color : 'none'}" stroke-width="${x.stroke?.width ?? 0}" stroke-linecap="${x.cap ?? 'butt'}" stroke-linejoin="round"${x.stroke?.dash === 'dashed' ? ' stroke-dasharray="7 5"' : x.stroke?.dash === 'dotted' ? ' stroke-dasharray="0.01 5"' : ''}/>`).join('');
  }

  function framePreview(f: (typeof FRAMES)[number]): string {
    const w = 40 * (f.ratio ?? 1), x = (48 - w) / 2;
    if (f.id === 'polaroid') return `<rect x="${x}" y="4" width="${w}" height="40" fill="#fff" stroke="#c5c9d2"/><rect x="${x + 3}" y="7" width="${w - 6}" height="30" />`;
    if (typeof f.mask === 'string') {
      if (f.mask === 'rect') return `<rect x="${x}" y="4" width="${w}" height="40" rx="${(f.radius ?? 0) * 40}"/>`;
      return `<g transform="translate(${x - 4} 0) scale(${w / 40} 1)">${SHAPE_SVG[f.mask]}</g>`;
    }
    return `<svg x="${x}" y="4" width="${w}" height="40" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${f.mask.d}"/></svg>`;
  }

  const gridPreview = (g: (typeof GRIDS)[number]) =>
    g.cells.map(([x, y, w, h]) => `<rect x="${4 + x * 40 + 1}" y="${4 + y * 40 + 1}" width="${w * 40 - 2}" height="${h * 40 - 2}" rx="1.5"/>`).join('');

  function chartPreview(kind: (typeof CHARTS)[number]['kind']): string {
    const el = { ...chart(kind, { x: 0, y: 0, w: 48, h: 48 }), legend: false, grid: false, style: { fontFamily: 'Inter', fontSize: 1, color: '#000' } };
    return decompose(el).paths.map((x) => `<path d="${x.d}" fill="${x.fill?.type === 'solid' ? x.fill.color : 'none'}" stroke="${x.stroke ? x.stroke.color : 'none'}" stroke-width="${Math.min(x.stroke?.width ?? 0, 1.5)}"/>`).join('');
  }

  let tableRows = $state(3), tableCols = $state(3);
  let qrText = $state('https://');

  // ---- Elements: icon and photo search ----
  let iconQuery = $state('');
  let icons = $state<string[]>([]);
  let iconState = $state<'' | 'loading' | 'error' | 'empty'>('');
  let photoQuery = $state('');
  let photos = $state<Photo[]>([]);
  let photoState = $state<'' | 'loading' | 'error' | 'empty'>('');
  let busyItem = $state<string | null>(null);

  async function findIcons(): Promise<void> {
    if (!iconQuery.trim()) return;
    iconState = 'loading';
    try {
      icons = await searchIcons(iconQuery.trim());
      iconState = icons.length ? '' : 'empty';
    } catch {
      iconState = 'error';
    }
  }

  async function addIcon(name: string): Promise<void> {
    busyItem = name;
    try {
      if (!ed.addSvg(await fetchIcon(name), name)) iconState = 'error';
    } catch {
      iconState = 'error';
    } finally {
      busyItem = null;
    }
  }

  async function findPhotos(): Promise<void> {
    if (!photoQuery.trim()) return;
    photoState = 'loading';
    try {
      photos = await searchPhotos(photoQuery.trim());
      photoState = photos.length ? '' : 'empty';
    } catch {
      photoState = 'error';
    }
  }

  async function addPhoto(p: Photo): Promise<void> {
    busyItem = p.id;
    try {
      const { bytes, mime } = await fetchPhoto(p);
      if (!(await ed.addPhoto(bytes, mime, attribution(p)))) photoState = 'error';
    } catch {
      photoState = 'error';
    } finally {
      busyItem = null;
    }
  }

  // ---- Draw ----
  const toolFor = (b: Brush) => ({ brush: b, color: BRUSHES[b].color, size: BRUSHES[b].size, opacity: BRUSHES[b].opacity });

</script>

<aside class="side">
  <nav class="rail" aria-label="Side panel">
    {#each TABS as t}
      <button class:on={lit === t.id} aria-pressed={lit === t.id} onclick={() => ui.rail(t.id)} data-testid="tab-{t.id}">
        <span class="ri"><Icon name={t.icon} size={24} /></span>
        <span>{t.label}</span>
      </button>
    {/each}
  </nav>

  {#if ui.panel}
    <div class="drawer" class:wide={ui.panel === 'font'} data-testid="side-panel" data-text-tools>
      {#if !ui.isRail}
        <ToolPanels {ed} />
      {:else}
      <div class="sec-body scroll-y">
      {#if ui.panel === 'elements'}
        <form class="search" onsubmit={(e) => { e.preventDefault(); void findIcons(); }}>
          <Icon name="search" size={18} />
          <input placeholder="Search icons and graphics" bind:value={iconQuery} data-testid="icon-search" aria-label="Search elements" />
        </form>
        {#if iconState === 'loading'}<p class="hint">Searching…</p>{:else if iconState === 'error'}<p class="err">Couldn't reach the icon library.</p>{:else if iconState === 'empty'}<p class="hint">No icons found.</p>{/if}
        {#if icons.length}
          <h3 class="sec">Graphics</h3>
          <div class="icons" data-testid="icon-results">
            {#each icons as name (name)}
              <button class="iconbtn" title={name} aria-label="Add icon {name}" disabled={busyItem === name} onclick={() => addIcon(name)}>
                <img src={iconUrl(name)} alt={name} loading="lazy" />
              </button>
            {/each}
          </div>
          <p class="hint small">Icons from <a href="https://iconify.design" target="_blank" rel="noreferrer">Iconify</a> (open-source sets; check each set's licence).</p>
        {/if}
        <h3 class="sec">Lines & arrows</h3>
        <div class="shapes lines">
          {#each LINES as l}
            <button class="shape" title={l.label} aria-label="Add {l.label}" data-testid="line-{l.id}" onclick={() => ed.addLine(l)}>
              <svg viewBox="0 0 48 48" width="44" height="44">{@html linePreview(l)}</svg>
            </button>
          {/each}
        </div>
        <p class="hint small">Drag a line's ends onto shapes to connect them.</p>
        <h3 class="sec">Shapes</h3>
        <div class="shapes">
          {#each SHAPES as s}
            <button class="shape" title={s.label} aria-label="Add {s.label}" data-testid="shape-{s.kind}" draggable="true"
              ondragstart={(e) => dragData(e, { kind: 'shape', shape: s.kind })} onclick={() => ed.addShape(s.kind)}>
              <svg viewBox="0 0 48 48" width="44" height="44">{@html SHAPE_SVG[s.kind]}</svg>
            </button>
          {/each}
        </div>
        <h3 class="sec">Frames</h3>
        <div class="shapes">
          {#each FRAMES as f}
            <button class="shape frame" title={f.label} aria-label="Add {f.label} frame" data-testid="frame-{f.id}" onclick={() => ed.addFrame(f.id)}>
              <svg viewBox="0 0 48 48" width="44" height="44">{@html framePreview(f)}</svg>
            </button>
          {/each}
        </div>
        <p class="hint small">Drop a photo onto a frame to fill it. Double-click to move the photo inside.</p>
        <h3 class="sec">Grids</h3>
        <div class="shapes">
          {#each GRIDS as g}
            <button class="shape grid" title={g.label} aria-label="Add grid {g.label}" data-testid="grid-{g.id}" onclick={() => ed.addGrid(g.id)}>
              <svg viewBox="0 0 48 48" width="44" height="44">{@html gridPreview(g)}</svg>
            </button>
          {/each}
        </div>
        <h3 class="sec">Tables</h3>
        <div class="inline">
          <label>Rows <input class="input" type="number" min="1" max="30" bind:value={tableRows} data-testid="table-rows" /></label>
          <label>Columns <input class="input" type="number" min="1" max="12" bind:value={tableCols} data-testid="table-cols" /></label>
          <button class="btn" data-testid="add-table" onclick={() => ed.addTable(Math.max(1, Math.min(30, tableRows | 0)), Math.max(1, Math.min(12, tableCols | 0)))}><Icon name="table" size={16} /> Add</button>
        </div>
        <h3 class="sec">Charts</h3>
        <div class="shapes">
          {#each CHARTS as c}
            <button class="shape chart" title="{c.label} chart" aria-label="Add {c.label} chart" data-testid="chart-{c.kind}" onclick={() => ed.addChart(c.kind)}>
              <svg viewBox="-2 -2 52 52" width="44" height="44">{@html chartPreview(c.kind)}</svg>
            </button>
          {/each}
        </div>
        <h3 class="sec">QR code</h3>
        <form class="inline" onsubmit={(e) => { e.preventDefault(); if (qrText.trim()) ed.addQr(qrText.trim()); }}>
          <input class="input grow" placeholder="Link or text" bind:value={qrText} data-testid="qr-text" />
          <button class="btn" data-testid="add-qr"><Icon name="qr" size={16} /> Add</button>
        </form>
      {:else if ui.panel === 'photos'}
        <form class="search" onsubmit={(e) => { e.preventDefault(); void findPhotos(); }}>
          <Icon name="search" size={18} />
          <input placeholder="Search free photos" bind:value={photoQuery} data-testid="photo-search" aria-label="Search photos" />
        </form>
        {#if !photos.length && !photoState}<p class="hint">Search millions of CC-licensed photos from Openverse. Click one to add it, or drag it onto the page.</p>{/if}
        {#if photoState === 'loading'}<p class="hint">Searching…</p>{:else if photoState === 'error'}<p class="err">Couldn't get photos right now.</p>{:else if photoState === 'empty'}<p class="hint">No photos found.</p>{/if}
        {#if photos.length}
          <div class="assets photos" data-testid="photo-results">
            {#each photos as p (p.id)}
              <button class="asset" title={attribution(p)} disabled={busyItem === p.id} draggable="true"
                ondragstart={(e) => dragData(e, { kind: 'photo', photo: p })} onclick={() => addPhoto(p)}>
                <img src={p.thumbnail} alt={p.title} loading="lazy" />
              </button>
            {/each}
          </div>
          <p class="hint small">CC-licensed photos via <a href="https://openverse.org" target="_blank" rel="noreferrer">Openverse</a>. The credit is kept with each photo (Uploads, hover).</p>
        {/if}
      {:else if ui.panel === 'draw'}
        <h3>Draw</h3>
        <div class="brushes">
          {#each Object.entries(BRUSHES) as [b, info]}
            <button class="btn" class:on={ed.tool?.brush === b} data-testid="brush-{b}" onclick={() => (ed.tool = toolFor(b as Brush))}>{info.label}</button>
          {/each}
        </div>
        {#if ed.tool}
          <div class="drawopts">
            <ColorField label="Colour" value={ed.tool.color} testid="draw-color" onchange={(hex) => ed.tool && (ed.tool = { ...ed.tool, color: hex })} />
            <label class="field"><span>Size · {ed.tool.size}px</span>
              <input type="range" min="1" max="80" value={ed.tool.size} data-testid="draw-size" oninput={(e) => ed.tool && (ed.tool = { ...ed.tool, size: Number((e.currentTarget as HTMLInputElement).value) })} />
            </label>
            <label class="field"><span>Transparency · {Math.round((1 - ed.tool.opacity) * 100)}%</span>
              <input type="range" min="0" max="90" value={Math.round((1 - ed.tool.opacity) * 100)} oninput={(e) => ed.tool && (ed.tool = { ...ed.tool, opacity: 1 - Number((e.currentTarget as HTMLInputElement).value) / 100 })} />
            </label>
          </div>
        {/if}
        <p class="hint">Draw on the page; each stroke becomes its own element you can move, resize and recolour. Close this panel (or press Esc) to stop drawing.</p>
      {:else if ui.panel === 'text'}
        <form class="search" onsubmit={(e) => { e.preventDefault(); searchFonts(); }}>
          <Icon name="search" size={18} />
          <input placeholder="Search fonts and combinations" bind:value={textQuery} data-testid="text-search" aria-label="Search fonts" />
        </form>
        <button class="btn primary cta" data-testid="add-textbox" onclick={() => ed.addText('body')}><Icon name="text" size={18} /> Add a text box</button>
        <h3 class="sec">Default text styles</h3>
        <div class="texts">
          {#each Object.entries(TEXT_PRESETS) as [key, p]}
            <button class="textbtn {key}" draggable="true" data-testid="text-{key}"
              ondragstart={(e) => dragData(e, { kind: 'text', preset: key })} onclick={() => ed.addText(key as keyof typeof TEXT_PRESETS)}>{p.label}</button>
          {/each}
        </div>
        <p class="hint">Double-click text to edit it. Select some words to style just those. Fonts, effects, curve and lists are in the toolbar above the page.</p>
      {:else if ui.panel === 'uploads'}
        <button class="btn primary cta" onclick={upload} data-testid="upload"><Icon name="upload" size={18} /> Upload files</button>
        <p class="hint">Or drop files onto the page. Images (PNG, JPG, WebP, GIF), videos (MP4, WebM, MOV) and sounds (MP3, M4A, WAV).</p>
        {#if uploadError}<p class="err">{uploadError}</p>{/if}
        {#if videos.length}
          <h3 class="sub">Videos</h3>
          <div class="assets">
            {#each videos as [id, m] (id)}
              {@const poster = ed.assets.get(`${id}.poster`)}
              <button class="asset vid" title={m.name ?? id} onclick={() => ed.addVideoAsset(id)}>
                {#if poster}<img src={objectUrl(poster, 'image/png')} alt={m.name ?? ''} />{/if}
                <span class="dur">{formatTime(m.duration ?? 0)}</span>
              </button>
            {/each}
          </div>
        {/if}
        {#if sounds.length}
          <h3 class="sub">Sounds</h3>
          {#each sounds as [id, m] (id)}
            <div class="sound"><Icon name="music" size={14} /> <span>{m.name ?? id}</span> <em>{formatTime(m.duration ?? 0)}</em></div>
          {/each}
        {/if}
        {#if (videos.length || sounds.length) && assets.length}<h3 class="sub">Images</h3>{/if}
        <div class="assets">
          {#each assets as [id, m] (id)}
            {@const bytes = ed.assets.get(id)}
            <button class="asset" title={m.name ?? id} draggable="true" ondragstart={(e) => dragData(e, { kind: 'asset', id })} onclick={() => ed.addImageAsset(id)}>
              {#if bytes}<img src={objectUrl(bytes, m.mime)} alt={m.name ?? ''} />{/if}
            </button>
          {/each}
        </div>
      {/if}
      </div>
      {/if}
      <button class="collapse" title="Close panel" aria-label="Close panel" data-testid="collapse-panel" onclick={() => (ui.panel = null)}><Icon name="left" size={14} /></button>
    </div>
  {/if}
</aside>

<style>
  .side { display: flex; height: 100%; flex-shrink: 0; background: var(--rail); }
  .rail { width: 72px; display: flex; flex-direction: column; align-items: stretch; padding: 0; overflow-y: auto; scrollbar-width: none; }
  .rail button { display: flex; flex-direction: column; align-items: center; gap: 2px; height: 72px; padding: 0; justify-content: center; border: 0; background: none; color: var(--rail-ink); font-size: 11px; font-weight: 500; }
  .rail .ri { width: 40px; height: 32px; display: grid; place-items: center; border-radius: 8px; }
  .rail button:hover .ri { background: var(--hover); }
  .rail button.on .ri { background: var(--accent-soft); color: var(--accent); }
  .rail button.on { color: var(--rail-ink); font-weight: 600; }
  .drawer { position: relative; width: 360px; background: var(--panel); display: flex; flex-direction: column; padding: 16px 16px 0 16px; min-height: 0; }
  .sec-body { flex: 1; min-height: 0; margin: 0 -16px; padding: 0 16px 16px; }
  .collapse { position: absolute; right: -14px; top: 50%; transform: translateY(-50%); width: 14px; height: 96px; border: 0; border-radius: 0 8px 8px 0; background: var(--panel); color: var(--muted); display: grid; place-items: center; padding: 0; z-index: 5; }
  .collapse:hover { color: var(--ink); }
  .search { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--field); color: var(--muted); margin-bottom: 14px; }
  .search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
  .search input { flex: 1; min-width: 0; border: 0; background: none; outline: none; color: var(--ink); }
  .cta { width: 100%; height: 40px; border-radius: 8px; font-size: 14px; }
  h3 { margin: 0 0 12px; font-size: 14px; font-weight: 600; }
  .shapes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .shape { aspect-ratio: 1; display: grid; place-items: center; border: 1px solid transparent; background: var(--chip); border-radius: 8px; }
  .shape:hover { border-color: var(--accent); }
  .shape svg { fill: #8b3dff; }
  .texts { display: flex; flex-direction: column; gap: 8px; }
  .textbtn { text-align: left; padding: 12px 14px; border: 0; border-radius: 8px; background: var(--chip); color: var(--ink); }
  .textbtn:hover { background: var(--hover); }
  .textbtn.heading { font-size: 26px; font-weight: 800; }
  .textbtn.subheading { font-size: 17px; font-weight: 700; }
  .textbtn.body { font-size: 13px; }
  .hint { color: var(--muted); font-size: 12px; line-height: 1.5; margin: 14px 0 0; }
  .hint.small { margin-top: 8px; }
  .hint a { color: inherit; }
  h3.sec { margin-top: 22px; }
  .lines .shape svg, .shape.chart svg { fill: none; }
  .lines .shape :global(path) { stroke: var(--ink-2); }
  .shape.frame svg, .shape.grid svg { fill: #9aa1ad; }
  .inline { display: flex; gap: 6px; align-items: end; }
  .inline label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); font-weight: 600; width: 72px; }
  .inline .grow { flex: 1; min-width: 0; }
  .icons { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-top: 10px; }
  .iconbtn { aspect-ratio: 1; display: grid; place-items: center; border: 1px solid transparent; background: #f2f3f5; border-radius: 8px; padding: 8px; }
  .iconbtn:hover { border-color: var(--accent); }
  .iconbtn img { width: 100%; height: 100%; }
  .photos { margin-top: 10px; }
  .brushes { display: flex; gap: 6px; }
  .brushes .btn.on { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
  .drawopts { display: flex; flex-direction: column; gap: 12px; margin-top: 14px; }
  .drawopts input[type='range'] { width: 100%; }
  .err { color: var(--danger); font-size: 13px; }
  .assets { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 14px; }
  .asset { aspect-ratio: 1; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; padding: 0; background: var(--chip); }
  .asset img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .asset.vid { position: relative; }
  .dur { position: absolute; right: 4px; bottom: 4px; background: rgba(0,0,0,.65); color: #fff; font-size: 11px; padding: 1px 5px; border-radius: 4px; }
  h3.sub { margin: 16px 0 8px; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
  .sound { display: flex; align-items: center; gap: 6px; font-size: 13px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 8px; margin-bottom: 6px; }
  .sound span { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .sound em { font-style: normal; color: var(--muted); font-size: 12px; }
</style>
