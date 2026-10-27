<script lang="ts">
  import { CHARTS, chart, decompose, FRAMES, GRIDS, line, moveElementTo, type ShapeKind } from '@digital-canvas/scene';
  import { BRUSHES, LINES, SHAPES, TEXT_PRESETS, type EditorState } from '../lib/editor.svelte.ts';
  import type { Brush } from '@digital-canvas/scene';
  import ColorField from './ColorField.svelte';
  import { attribution, fetchIcon, fetchPhoto, iconUrl, searchIcons, searchPhotos, type Photo } from '../lib/stock.ts';
  import Icon, { type IconName } from '../lib/Icon.svelte';
  import { IMAGE_TYPES, objectUrl, pickFiles } from '../lib/files.ts';
  import { AUDIO_TYPES, VIDEO_TYPES, formatTime } from '../lib/media.ts';

  let { ed }: { ed: EditorState } = $props();

  type Tab = 'elements' | 'text' | 'draw' | 'uploads' | 'layers';
  let tab = $state<Tab | null>('elements');
  let uploadError = $state('');
  let dragLayer = $state<string | null>(null);

  const TABS: { id: Tab; label: string; icon: IconName }[] = [
    { id: 'elements', label: 'Elements', icon: 'shapes' },
    { id: 'text', label: 'Text', icon: 'text' },
    { id: 'draw', label: 'Draw', icon: 'pen' },
    { id: 'uploads', label: 'Uploads', icon: 'upload' },
    { id: 'layers', label: 'Layers', icon: 'layers' },
  ];

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
  const layers = $derived([...ed.page.elements].reverse());

  function dragData(e: DragEvent, data: object): void {
    e.dataTransfer?.setData('application/x-digital-canvas', JSON.stringify(data));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  }

  async function upload(): Promise<void> {
    uploadError = '';
    const files = await pickFiles([...IMAGE_TYPES, ...VIDEO_TYPES, ...AUDIO_TYPES, '.mov', '.m4a', '.mp3'].join(','));
    for (const f of files) if (!(await ed.addMediaFile(f))) uploadError = `Couldn't read ${f.name} (this browser can't open it).`;
  }

  function layerName(e: (typeof layers)[number]): string {
    if (e.name) return e.name;
    if (e.type === 'text') return e.text.split('\n')[0]!.slice(0, 40) || 'Text';
    if (e.type === 'image') return ed.doc.assets[e.asset]?.name ?? 'Image';
    if (e.type === 'video') return ed.doc.assets[e.asset]?.name ?? 'Video';
    if (e.type === 'path') return e.qr !== undefined ? 'QR code' : 'Graphic';
    if (e.type === 'line') return e.start.attach || e.end.attach ? 'Connector' : 'Line';
    if (e.type === 'table') return `Table ${e.rows.length} × ${e.cols.length}`;
    if (e.type === 'chart') return `${CHARTS.find((c) => c.kind === e.chart)?.label ?? ''} chart`;
    return SHAPES.find((s) => s.kind === e.shape)?.label ?? 'Shape';
  }

  function layerIcon(e: (typeof layers)[number]): IconName {
    if (e.type === 'image') return e.mask ? 'frame' : 'image';
    return ({ text: 'text', video: 'video', line: 'line', table: 'table', chart: 'chart', path: e.type === 'path' && e.qr !== undefined ? 'qr' : 'shapes', shape: 'shapes' } as const)[e.type];
  }

  function openTab(t: Tab): void {
    tab = tab === t ? null : t;
    // the pen is on while the Draw tab is open
    ed.tool = tab === 'draw' ? (ed.tool ?? { ...toolFor('pen') }) : null;
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

  function dropLayer(targetId: string): void {
    if (!dragLayer || dragLayer === targetId) return;
    const els = ed.page.elements;
    const to = els.findIndex((e) => e.id === targetId);
    ed.commit(moveElementTo(ed.doc, dragLayer, to));
    ed.seal();
    dragLayer = null;
  }
</script>

<aside class="side">
  <nav class="rail">
    {#each TABS as t}
      <button class:on={tab === t.id} onclick={() => openTab(t.id)} data-testid="tab-{t.id}">
        <Icon name={t.icon} size={22} />
        <span>{t.label}</span>
      </button>
    {/each}
  </nav>

  {#if tab}
    <div class="drawer scroll-y">
      {#if tab === 'elements'}
        <h3>Lines & arrows</h3>
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
        <h3 class="sec">Icons</h3>
        <form class="inline" onsubmit={(e) => { e.preventDefault(); void findIcons(); }}>
          <input class="input grow" placeholder="Search icons (e.g. coffee)" bind:value={iconQuery} data-testid="icon-search" />
          <button class="btn icon" aria-label="Search icons"><Icon name="search" size={16} /></button>
        </form>
        {#if iconState === 'loading'}<p class="hint">Searching…</p>{:else if iconState === 'error'}<p class="err">Couldn't reach the icon library.</p>{:else if iconState === 'empty'}<p class="hint">No icons found.</p>{/if}
        {#if icons.length}
          <div class="icons" data-testid="icon-results">
            {#each icons as name (name)}
              <button class="iconbtn" title={name} aria-label="Add icon {name}" disabled={busyItem === name} onclick={() => addIcon(name)}>
                <img src={iconUrl(name)} alt={name} loading="lazy" />
              </button>
            {/each}
          </div>
          <p class="hint small">Icons from <a href="https://iconify.design" target="_blank" rel="noreferrer">Iconify</a> (open-source sets; check each set's licence).</p>
        {/if}
        <h3 class="sec">Photos</h3>
        <form class="inline" onsubmit={(e) => { e.preventDefault(); void findPhotos(); }}>
          <input class="input grow" placeholder="Search free photos" bind:value={photoQuery} data-testid="photo-search" />
          <button class="btn icon" aria-label="Search photos"><Icon name="search" size={16} /></button>
        </form>
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
      {:else if tab === 'draw'}
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
        <p class="hint">Draw on the page; each stroke becomes its own element you can move, resize and recolour. Close this tab (or press Esc) to stop drawing.</p>
      {:else if tab === 'text'}
        <h3>Text</h3>
        <div class="texts">
          {#each Object.entries(TEXT_PRESETS) as [key, p]}
            <button class="textbtn {key}" draggable="true" data-testid="text-{key}"
              ondragstart={(e) => dragData(e, { kind: 'text', preset: key })} onclick={() => ed.addText(key as keyof typeof TEXT_PRESETS)}>{p.label}</button>
          {/each}
        </div>
        <p class="hint">Double-click text to edit it. Select some words to style just those. Fonts, effects, curve and lists are in the panel on the right.</p>
      {:else if tab === 'uploads'}
        <button class="btn primary wide" onclick={upload} data-testid="upload"><Icon name="upload" size={16} /> Upload media</button>
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
      {:else}
        <h3>Layers · Page {ed.pageIndex + 1}</h3>
        {#if !layers.length}
          <p class="hint">Nothing on this page yet.</p>
        {/if}
        <ul class="layers" data-testid="layers">
          {#each layers as e (e.id)}
            <li
              class:sel={ed.selection.includes(e.id)}
              class:hidden={e.hidden}
              draggable="true"
              ondragstart={() => (dragLayer = e.id)}
              ondragover={(ev) => ev.preventDefault()}
              ondrop={() => dropLayer(e.id)}
            >
              <button class="lname" onclick={(ev) => ed.select(ev.shiftKey ? [...ed.selection, e.id] : [e.id])}>
                <Icon name={layerIcon(e)} size={15} />
                <span>{layerName(e)}</span>
              </button>
              <button class="lbtn" aria-label={e.locked ? 'Unlock' : 'Lock'} onclick={() => { ed.update({ locked: !e.locked }, null, [e.id]); ed.seal(); }}><Icon name={e.locked ? 'lock' : 'unlock'} size={15} /></button>
              <button class="lbtn" aria-label={e.hidden ? 'Show' : 'Hide'} onclick={() => { ed.update({ hidden: !e.hidden }, null, [e.id]); ed.seal(); }}><Icon name={e.hidden ? 'eyeoff' : 'eye'} size={15} /></button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</aside>

<style>
  .side { display: flex; height: 100%; flex-shrink: 0; }
  .rail { width: 72px; background: var(--rail); display: flex; flex-direction: column; align-items: stretch; padding: 8px 0; gap: 2px; }
  .rail button { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 0; border: 0; background: none; color: var(--rail-ink); font-size: 11px; font-weight: 600; }
  .rail button:hover { color: #fff; }
  .rail button.on { color: #fff; background: rgba(255,255,255,.08); box-shadow: inset 3px 0 0 var(--accent); }
  .drawer { width: 300px; background: var(--panel); border-right: 1px solid var(--line); padding: 16px; }
  h3 { margin: 0 0 12px; font-size: 14px; }
  .shapes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .shape { aspect-ratio: 1; display: grid; place-items: center; border: 1px solid transparent; background: #f4f5f8; border-radius: 10px; }
  .shape:hover { border-color: var(--accent); background: var(--accent-soft); }
  .shape svg { fill: #7c5cff; }
  .texts { display: flex; flex-direction: column; gap: 8px; }
  .textbtn { text-align: left; padding: 14px; border: 1px solid var(--line); border-radius: 10px; background: #fff; }
  .textbtn:hover { border-color: var(--accent); }
  .textbtn.heading { font-size: 24px; font-weight: 800; }
  .textbtn.subheading { font-size: 17px; font-weight: 700; }
  .textbtn.body { font-size: 13px; }
  .hint { color: var(--muted); font-size: 12px; line-height: 1.5; margin: 14px 0 0; }
  .hint.small { margin-top: 8px; }
  h3.sec { margin-top: 22px; }
  .lines .shape svg, .shape.chart svg { fill: none; }
  .shape.frame svg, .shape.grid svg { fill: #b9bfca; }
  .inline { display: flex; gap: 6px; align-items: end; }
  .inline label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); font-weight: 600; width: 72px; }
  .inline .grow { flex: 1; min-width: 0; }
  .icons { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-top: 10px; }
  .iconbtn { aspect-ratio: 1; display: grid; place-items: center; border: 1px solid transparent; background: #f4f5f8; border-radius: 8px; padding: 8px; }
  .iconbtn:hover { border-color: var(--accent); }
  .iconbtn img { width: 100%; height: 100%; }
  .photos { margin-top: 10px; }
  .brushes { display: flex; gap: 6px; }
  .brushes .btn.on { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
  .drawopts { display: flex; flex-direction: column; gap: 12px; margin-top: 14px; }
  .drawopts input[type='range'] { width: 100%; accent-color: var(--accent); }
  .err { color: var(--danger); font-size: 13px; }
  .wide { width: 100%; height: 40px; }
  .assets { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 14px; }
  .asset { aspect-ratio: 1; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; padding: 0; background: #f4f5f8; }
  .asset img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .asset.vid { position: relative; }
  .dur { position: absolute; right: 4px; bottom: 4px; background: rgba(0,0,0,.65); color: #fff; font-size: 11px; padding: 1px 5px; border-radius: 4px; }
  h3.sub { margin: 16px 0 8px; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
  .sound { display: flex; align-items: center; gap: 6px; font-size: 13px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 8px; margin-bottom: 6px; }
  .sound span { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .sound em { font-style: normal; color: var(--muted); font-size: 12px; }
  .layers { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .layers li { display: flex; align-items: center; gap: 2px; border-radius: 8px; border: 1px solid var(--line); background: #fff; padding-right: 4px; }
  .layers li.sel { border-color: var(--accent); background: var(--accent-soft); }
  .layers li.hidden .lname { opacity: .45; }
  .lname { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; border: 0; background: none; padding: 9px 10px; text-align: left; }
  .lname span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .lbtn { width: 28px; height: 28px; display: grid; place-items: center; border: 0; background: none; border-radius: 6px; color: var(--muted); }
  .lbtn:hover { background: rgba(0,0,0,.06); color: var(--ink); }
</style>
