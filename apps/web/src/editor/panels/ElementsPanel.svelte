<script lang="ts">
  /**
   * Canva's Elements panel: one search over every library (graphics,
   * stickers, icons, photos, videos, audio and our built-in shapes, lines,
   * frames, grids, tables and charts) with result tabs; recently used;
   * recommended; browse categories, each opening a full grid.
   */
  import { CHARTS, FRAMES, GRIDS, type ChartKind, type ShapeKind } from '@digital-canvas/scene';
  import { LINES, SHAPES, type EditorState, type LinePreset } from '../../lib/editor.svelte.ts';
  import { iconItems } from '../../lib/content/iconify.ts';
  import { notice } from '../../lib/content/insert.svelte.ts';
  import { onRecent, recent, remember } from '../../lib/content/recent.ts';
  import type { Item, Kind } from '../../lib/content/types.ts';
  import Icon, { type IconName } from '../../lib/Icon.svelte';
  import AudioRow from './AudioRow.svelte';
  import ContentGrid from './ContentGrid.svelte';
  import FeedRow from './FeedRow.svelte';
  import MediaTile from './MediaTile.svelte';
  import { chartPreview, framePreview, gridPreview, linePreview, SHAPE_SVG, tablePreview } from './previews.ts';
  import Row from './Row.svelte';
  import SearchBox from './SearchBox.svelte';

  let { ed }: { ed: EditorState } = $props();

  type Cat = 'shapes' | 'lines' | 'graphics' | 'stickers' | 'icons' | 'illustrations' | 'photos' | 'videos' | 'audio' | 'frames' | 'grids' | 'charts' | 'tables' | 'qr';
  interface CatInfo { id: Cat; label: string; icon: IconName; from: string; to: string; kind?: Kind; words: string }

  /** Browse categories (Canva's tiles), in Canva's order where it has them. */
  const CATS: CatInfo[] = [
    { id: 'tables', label: 'Tables', icon: 'table', from: '#ff8a3d', to: '#e5484d', words: 'table sheet spreadsheet rows columns' },
    { id: 'charts', label: 'Charts', icon: 'chart', from: '#3ec7c0', to: '#7d5cff', words: 'chart graph bar column pie donut line data' },
    { id: 'graphics', label: 'Graphics', icon: 'sparkle', from: '#ffb03b', to: '#ff6b3d', kind: 'graphic', words: 'graphic illustration clipart' },
    { id: 'photos', label: 'Photos', icon: 'image', from: '#4aa8ff', to: '#3b5bdb', kind: 'photo', words: 'photo picture image' },
    { id: 'videos', label: 'Videos', icon: 'video', from: '#d65bff', to: '#8b3dff', kind: 'video', words: 'video clip footage' },
    { id: 'audio', label: 'Audio', icon: 'music', from: '#ff5fa2', to: '#c2185b', kind: 'audio', words: 'audio music sound song' },
    { id: 'stickers', label: 'Stickers', icon: 'elements', from: '#ffd43b', to: '#fab005', kind: 'sticker', words: 'sticker emoji' },
    { id: 'icons', label: 'Icons', icon: 'pen', from: '#69db7c', to: '#2b8a3e', kind: 'icon', words: 'icon symbol' },
    { id: 'illustrations', label: 'Illustrations', icon: 'wand', from: '#a9e34b', to: '#5c940d', kind: 'illustration', words: 'illustration drawing art' },
    { id: 'shapes', label: 'Shapes', icon: 'shapes', from: '#9775fa', to: '#5f3dc4', words: 'shape square rectangle circle triangle star polygon hexagon diamond pentagon arrow' },
    { id: 'lines', label: 'Lines', icon: 'line', from: '#748ffc', to: '#364fc7', words: 'line arrow connector divider' },
    { id: 'frames', label: 'Frames', icon: 'frame', from: '#20c997', to: '#087f5b', words: 'frame mask photo frame polaroid' },
    { id: 'grids', label: 'Grids', icon: 'gridview', from: '#4dabf7', to: '#1864ab', words: 'grid collage layout' },
    { id: 'qr', label: 'QR code', icon: 'qr', from: '#868e96', to: '#343a40', words: 'qr code barcode link' },
  ];
  const catInfo = (id: Cat) => CATS.find((c) => c.id === id)!;
  const REMOTE: Cat[] = ['graphics', 'stickers', 'icons', 'illustrations', 'photos', 'videos', 'audio'];
  /** Search result tabs (Canva: All, Graphics, Stickers, Photos, Videos, Audio, Shapes, Tables, Charts, Frames, Grids, Lines). */
  const TABS: Cat[] = ['graphics', 'stickers', 'photos', 'videos', 'audio', 'shapes', 'tables', 'charts', 'frames', 'grids', 'lines', 'icons', 'illustrations'];

  const SEARCH_TOP: Cat[] = ['graphics', 'stickers'];
  const SEARCH_LOCAL: Cat[] = ['shapes', 'lines', 'frames', 'grids', 'charts', 'tables'];
  const SEARCH_MEDIA: Cat[] = ['photos', 'videos', 'audio', 'icons', 'illustrations'];

  const TABLE_PRESETS = [[2, 2], [3, 3], [4, 3], [5, 4], [3, 2], [6, 3], [4, 4], [8, 4]] as const;

  /** Hand-picked stickers and graphics (Canva's "Recommended for you"). */
  const RECOMMENDED = ['sparkles', 'hibiscus', 'cherry-blossom', 'ribbon', 'star-struck', 'party-popper', 'sun', 'rainbow', 'fire', 'balloon', 'butterfly', 'four-leaf-clover', 'glowing-star', 'rocket', 'birthday-cake', 'wrapped-gift', 'musical-notes', 'sunflower', 'tulip', 'light-bulb']
    .map((n) => `fluent-emoji-flat:${n}`);
  let recommended = $state<Item[]>([]);
  iconItems(RECOMMENDED, 'sticker').then((l) => (recommended = l)).catch(() => {});

  // ---- view state ----
  let query = $state('');
  let searched = $state('');
  let tab = $state<'all' | Cat>('all');
  let cat = $state<Cat | null>(null);
  let catQuery = $state('');
  let catSearched = $state('');
  let scroller = $state<HTMLDivElement>();

  function search(q: string): void {
    searched = q;
    tab = 'all';
    cat = null;
    scroller?.scrollTo({ top: 0 });
  }
  function openCat(c: Cat): void {
    cat = c;
    catQuery = searched;
    catSearched = searched;
    scroller?.scrollTo({ top: 0 });
  }
  function seeTab(c: Cat): void {
    if (searched) tab = c;
    else openCat(c);
    scroller?.scrollTo({ top: 0 });
  }

  // ---- local (built-in) elements and search over them ----
  const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);
  function hits(c: Cat, label: string, q: string): boolean {
    const ws = words(q);
    if (!ws.length) return true;
    const info = catInfo(c);
    return ws.every((w) => label.toLowerCase().includes(w) || info.words.includes(w) || info.label.toLowerCase().includes(w));
  }
  const shapes = $derived(SHAPES.filter((s) => hits('shapes', s.label, searched)));
  const lines = $derived(LINES.filter((l) => hits('lines', l.label, searched)));
  const frames = $derived(FRAMES.filter((f) => hits('frames', f.label, searched)));
  const grids = $derived(GRIDS.filter((g) => hits('grids', g.label, searched)));
  const charts = $derived(CHARTS.filter((c) => hits('charts', c.label, searched)));
  const tablesHit = $derived(hits('tables', 'table', searched));
  const qrHit = $derived(hits('qr', 'qr code', searched));
  const localCount = (c: Cat) => ({ shapes: shapes.length, lines: lines.length, frames: frames.length, grids: grids.length, charts: charts.length, tables: tablesHit ? 1 : 0, qr: qrHit ? 1 : 0 } as Record<string, number>)[c] ?? 0;

  // ---- adding (and remembering) built-ins ----
  function addShape(k: ShapeKind): void { ed.addShape(k); remember('shape', k, k); }
  function addLine(l: LinePreset): void { ed.addLine(l); remember('line', l.id, l.id); }
  function addFrame(id: string): void { ed.addFrame(id); remember('frame', id, id); }
  function addGrid(id: string): void { ed.addGrid(id); remember('grid', id, id); }
  function addChart(k: ChartKind): void { ed.addChart(k); remember('chart', k, k); }
  function addTable(r: number, c: number): void { ed.addTable(Math.max(1, Math.min(30, r | 0)), Math.max(1, Math.min(12, c | 0))); }

  function drag(e: DragEvent, data: object): void {
    e.dataTransfer?.setData('application/x-digital-canvas', JSON.stringify(data));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  }

  let tableRows = $state(3), tableCols = $state(3);
  let qrText = $state('https://');

  // ---- recently used ----
  let recents = $state(recent(['content', 'shape', 'line', 'frame', 'grid', 'chart']).slice(0, 16));
  $effect(() => onRecent(() => (recents = recent(['content', 'shape', 'line', 'frame', 'grid', 'chart']).slice(0, 16))));
</script>

{#snippet shapeBtn(s: (typeof SHAPES)[number], pre = '')}
  <button class="el" title={s.label} aria-label="Add {s.label}" data-testid="{pre}shape-{s.kind}" draggable="true"
    ondragstart={(e) => drag(e, { kind: 'shape', shape: s.kind })} onclick={() => addShape(s.kind)}>
    <svg viewBox="0 0 48 48" class="fillsvg">{@html SHAPE_SVG[s.kind]}</svg>
  </button>
{/snippet}
{#snippet lineBtn(l: LinePreset, pre = '')}
  <button class="el" title={l.label} aria-label="Add {l.label}" data-testid="{pre}line-{l.id}" draggable="true"
    ondragstart={(e) => drag(e, { kind: 'line', id: l.id })} onclick={() => addLine(l)}>
    <svg viewBox="0 0 48 48" class="linesvg">{@html linePreview(l)}</svg>
  </button>
{/snippet}
{#snippet frameBtn(f: (typeof FRAMES)[number], pre = '')}
  <button class="el" title={f.label} aria-label="Add {f.label} frame" data-testid="{pre}frame-{f.id}" draggable="true"
    ondragstart={(e) => drag(e, { kind: 'frame', id: f.id })} onclick={() => addFrame(f.id)}>
    <svg viewBox="0 0 48 48" class="greysvg">{@html framePreview(f)}</svg>
  </button>
{/snippet}
{#snippet gridBtn(g: (typeof GRIDS)[number], pre = '')}
  <button class="el" title={g.label} aria-label="Add grid {g.label}" data-testid="{pre}grid-{g.id}" onclick={() => addGrid(g.id)}>
    <svg viewBox="0 0 48 48" class="greysvg">{@html gridPreview(g)}</svg>
  </button>
{/snippet}
{#snippet chartBtn(c: (typeof CHARTS)[number], pre = '')}
  <button class="el" title="{c.label} chart" aria-label="Add {c.label} chart" data-testid="{pre}chart-{c.kind}" onclick={() => addChart(c.kind)}>
    <svg viewBox="-2 -2 52 52" class="chartsvg">{@html chartPreview(c.kind)}</svg>
  </button>
{/snippet}
{#snippet tableBtn(t: readonly [number, number])}
  <button class="el" title="Table {t[0]} × {t[1]}" aria-label="Add table {t[0]} by {t[1]}" data-testid="table-{t[0]}x{t[1]}" onclick={() => addTable(t[0], t[1])}>
    <svg viewBox="0 0 48 48" class="tablesvg">{@html tablePreview(t[0], t[1])}</svg>
  </button>
{/snippet}
{#snippet tableForm()}
  <div class="inline">
    <label>Rows <input class="input" type="number" min="1" max="30" bind:value={tableRows} data-testid="table-rows" /></label>
    <label>Columns <input class="input" type="number" min="1" max="12" bind:value={tableCols} data-testid="table-cols" /></label>
    <button class="btn" data-testid="add-table" onclick={() => addTable(tableRows, tableCols)}><Icon name="table" size={16} /> Add</button>
  </div>
{/snippet}
{#snippet qrForm()}
  <form class="inline" onsubmit={(e) => { e.preventDefault(); if (qrText.trim()) ed.addQr(qrText.trim()); }}>
    <input class="input grow" placeholder="Link or text" bind:value={qrText} data-testid="qr-text" aria-label="QR code link or text" />
    <button class="btn" data-testid="add-qr"><Icon name="qr" size={16} /> Add</button>
  </form>
{/snippet}
{#snippet localRow(c: Cat)}
  {#if c === 'shapes'}{#each shapes as s}{@render shapeBtn(s)}{/each}
  {:else if c === 'lines'}{#each lines as l}{@render lineBtn(l)}{/each}
  {:else if c === 'frames'}{#each frames as f}{@render frameBtn(f)}{/each}
  {:else if c === 'grids'}{#each grids as g}{@render gridBtn(g)}{/each}
  {:else if c === 'charts'}{#each charts as ch}{@render chartBtn(ch)}{/each}
  {:else if c === 'tables'}{#each TABLE_PRESETS as t}{@render tableBtn(t)}{/each}
  {/if}
{/snippet}
{#snippet localGrid(c: Cat)}
  {#if c === 'tables'}
    <div class="elgrid">{#each TABLE_PRESETS as t}{@render tableBtn(t)}{/each}</div>
    <h4>Custom size</h4>
    {@render tableForm()}
  {:else if c === 'qr'}
    <p class="hint">Type a link or any text; the code is a vector you can recolour and resize.</p>
    {@render qrForm()}
  {:else}
    <div class="elgrid">{@render localRow(c)}</div>
    {#if c === 'lines'}<p class="hint">Drag a line's ends onto shapes to connect them.</p>{/if}
    {#if c === 'frames'}<p class="hint">Drop a photo onto a frame to fill it. Double-click to move the photo inside.</p>{/if}
  {/if}
{/snippet}
{#snippet recentTile(r: (typeof recents)[number])}
  {#if r.type === 'content'}
    {@const item = r.data as Item}
    {#if item.kind === 'audio'}<AudioRow {ed} {item} card />{:else}<MediaTile {ed} {item} size={88} />{/if}
  {:else if r.type === 'shape'}{@const s = SHAPES.find((x) => x.kind === r.data)}{#if s}{@render shapeBtn(s, 'recent-')}{/if}
  {:else if r.type === 'line'}{@const l = LINES.find((x) => x.id === r.data)}{#if l}{@render lineBtn(l, 'recent-')}{/if}
  {:else if r.type === 'frame'}{@const f = FRAMES.find((x) => x.id === r.data)}{#if f}{@render frameBtn(f, 'recent-')}{/if}
  {:else if r.type === 'grid'}{@const g = GRIDS.find((x) => x.id === r.data)}{#if g}{@render gridBtn(g, 'recent-')}{/if}
  {:else if r.type === 'chart'}{@const c = CHARTS.find((x) => x.kind === r.data)}{#if c}{@render chartBtn(c, 'recent-')}{/if}
  {/if}
{/snippet}

<div class="panel" data-testid="elements-panel">
  {#if cat}
    {@const info = catInfo(cat)}
    <header class="cathead">
      <button class="back" aria-label="Back" data-testid="cat-back" onclick={() => (cat = null)}><Icon name="left" size={18} /></button>
      <h2>{info.label}</h2>
    </header>
    {#if info.kind}
      <SearchBox bind:value={catQuery} placeholder="Search {info.label.toLowerCase()}" label="Search {info.label}" testid="cat-search" onsearch={(q) => (catSearched = q)} onclear={() => (catSearched = '')} />
    {/if}
  {:else}
    <SearchBox bind:value={query} placeholder="Search elements" label="Search elements" testid="elements-search" onsearch={search} onclear={() => search('')} />
    {#if searched}
      <div class="tabs" role="tablist" aria-label="Result types">
        <button role="tab" aria-selected={tab === 'all'} class:on={tab === 'all'} data-testid="etab-all" onclick={() => (tab = 'all')}>All</button>
        {#each TABS.filter((t) => REMOTE.includes(t) || localCount(t)) as t}
          <button role="tab" aria-selected={tab === t} class:on={tab === t} data-testid="etab-{t}" onclick={() => (tab = t)}>{catInfo(t).label}</button>
        {/each}
      </div>
    {/if}
  {/if}
  {#if notice.text}<p class="err" role="alert">{notice.text} <button class="x" aria-label="Dismiss" onclick={() => (notice.text = '')}><Icon name="close" size={12} /></button></p>{/if}

  <div class="pbody scroll-y" bind:this={scroller}>
    {#if cat}
      {@const info = catInfo(cat)}
      {#if info.kind}
        <ContentGrid {ed} kind={info.kind} query={catSearched} testid="element-results" cols={info.kind === 'icon' ? 5 : 4} rowHeight={info.kind === 'audio' ? 56 : 100} />
      {:else}
        {@render localGrid(cat)}
      {/if}
    {:else if searched}
      {#if tab === 'all'}
        {#each SEARCH_TOP as c}
          <FeedRow {ed} title={catInfo(c).label} kind={catInfo(c).kind!} query={searched} seeAll={() => seeTab(c)} testid="row-{c}" height={84} />
        {/each}
        {#each SEARCH_LOCAL as c}
          {#if localCount(c)}<Row title={catInfo(c).label} seeAll={() => seeTab(c)} testid="row-{c}">{@render localRow(c)}</Row>{/if}
        {/each}
        {#each SEARCH_MEDIA as c}
          <FeedRow {ed} title={catInfo(c).label} kind={catInfo(c).kind!} query={searched} seeAll={() => seeTab(c)} testid="row-{c}" height={c === 'icons' ? 64 : 96} />
        {/each}
        {#if qrHit}<h3 class="sec">QR code</h3>{@render qrForm()}{/if}
      {:else if REMOTE.includes(tab)}
        {@const k = catInfo(tab).kind!}
        {#key tab}<ContentGrid {ed} kind={k} query={searched} testid="element-results" cols={k === 'icon' ? 5 : 4} rowHeight={100} />{/key}
      {:else}
        {@render localGrid(tab)}
      {/if}
    {:else}
      {#if recents.length}
        <Row title="Recently used" testid="row-recent">{#each recents as r (r.key)}{@render recentTile(r)}{/each}</Row>
      {/if}
      {#if recommended.length}
        <Row title="Recommended for you" seeAll={() => openCat('stickers')} testid="row-recommended">
          {#each recommended as item (item.key)}<MediaTile {ed} {item} size={88} />{/each}
        </Row>
      {/if}
      <h3 class="sec">Browse categories</h3>
      <div class="cats">
        {#each CATS as c}
          <button class="cat" data-testid="cat-{c.id}" onclick={() => openCat(c.id)}>
            <span class="art" style="--from:{c.from};--to:{c.to}"><Icon name={c.icon} size={30} /></span>
            <span>{c.label}</span>
          </button>
        {/each}
      </div>
      <Row title="Shapes" seeAll={() => openCat('shapes')} testid="row-shapes">{@render localRow('shapes')}</Row>
      <Row title="Lines & arrows" seeAll={() => openCat('lines')} testid="row-lines">{@render localRow('lines')}</Row>
      <FeedRow {ed} title="Graphics" kind="graphic" query="" seeAll={() => openCat('graphics')} testid="row-graphics" height={80} />
      <FeedRow {ed} title="Stickers" kind="sticker" query="" seeAll={() => openCat('stickers')} testid="row-stickers" height={80} />
      <FeedRow {ed} title="Photos" kind="photo" query="flowers" seeAll={() => openCat('photos')} testid="row-photos" />
      <FeedRow {ed} title="Videos" kind="video" query="nature" seeAll={() => openCat('videos')} testid="row-videos" />
      <FeedRow {ed} title="Audio" kind="audio" query="upbeat" opts={{ audio: 'music' }} seeAll={() => openCat('audio')} testid="row-audio" />
      <Row title="Frames" seeAll={() => openCat('frames')} testid="row-frames">{@render localRow('frames')}</Row>
      <Row title="Grids" seeAll={() => openCat('grids')} testid="row-grids">{@render localRow('grids')}</Row>
      <Row title="Charts" seeAll={() => openCat('charts')} testid="row-charts">{@render localRow('charts')}</Row>
      <Row title="Tables" seeAll={() => openCat('tables')} testid="row-tables">{@render localRow('tables')}</Row>
      {@render tableForm()}
      <h3 class="sec">QR code</h3>
      {@render qrForm()}
      <p class="credits">Graphics, stickers (Fluent Emoji, Noto, Twemoji, OpenMoji) and icons from open-source sets via <a href="https://iconify.design" target="_blank" rel="noreferrer">Iconify</a>; illustrations from <a href="https://www.opendoodles.com" target="_blank" rel="noreferrer">Open Doodles</a> and Openverse; photos, videos and sounds from <a href="https://openverse.org" target="_blank" rel="noreferrer">Openverse</a>, <a href="https://commons.wikimedia.org" target="_blank" rel="noreferrer">Wikimedia Commons</a> and <a href="https://images.nasa.gov" target="_blank" rel="noreferrer">NASA</a>. Each item's licence and author are kept with it in your design (hover a tile to see them). <a href="/credits.html" target="_blank" rel="noreferrer" data-testid="elements-credits">Credits and licences</a></p>
    {/if}
  </div>
</div>

<style>
  .panel { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .pbody { flex: 1; min-height: 0; margin: 0 -16px; padding: 0 16px 24px; }
  .cathead { display: flex; align-items: center; gap: 6px; margin: -4px 0 10px; }
  .cathead h2 { margin: 0; font-size: 16px; font-weight: 600; }
  .back { width: 32px; height: 32px; border: 0; border-radius: 6px; background: none; color: var(--ink); display: grid; place-items: center; }
  .back:hover { background: var(--hover); }
  .tabs { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; margin: 10px -16px 0; padding: 0 16px 4px; }
  .tabs::-webkit-scrollbar { display: none; }
  .tabs button { flex-shrink: 0; border: 0; background: none; color: var(--ink-2); padding: 7px 10px; border-radius: 6px; font-weight: 500; font-size: 13px; }
  .tabs button:hover { background: var(--hover); }
  .tabs button.on { background: var(--chip); color: var(--ink); box-shadow: inset 0 -2px 0 var(--accent); }
  h3.sec { margin: 22px 0 10px; font-size: 15px; font-weight: 600; }
  h4 { margin: 16px 0 8px; font-size: 13px; font-weight: 600; }
  .cats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px 8px; }
  .cat { display: flex; flex-direction: column; align-items: center; gap: 8px; border: 0; background: none; padding: 0; color: var(--ink); font-size: 13px; }
  .art { width: 72px; height: 72px; border-radius: 18px; display: grid; place-items: center; color: #fff; background: linear-gradient(145deg, var(--from), var(--to)); box-shadow: 0 6px 14px -6px var(--to), inset 0 1px 0 rgba(255,255,255,.35); transform: rotate(-4deg); transition: transform .15s; }
  .cat:hover .art { transform: rotate(0) scale(1.05); }
  .el { width: 80px; height: 80px; display: grid; place-items: center; border: 0; background: var(--chip); border-radius: 8px; padding: 12px; }
  .el:hover { background: var(--hover); outline: 2px solid var(--accent); outline-offset: -2px; }
  .el svg { width: 100%; height: 100%; }
  .fillsvg { fill: #8b3dff; }
  .linesvg { fill: none; }
  .linesvg :global(path) { stroke: var(--ink-2); }
  .greysvg { fill: #9aa1ad; }
  .chartsvg { fill: none; }
  .tablesvg { fill: none; stroke: var(--ink-2); stroke-width: 1; }
  .elgrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 8px; }
  .elgrid .el { width: auto; height: auto; aspect-ratio: 1; }
  .inline { display: flex; gap: 6px; align-items: end; margin-top: 12px; }
  .inline label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); font-weight: 600; width: 72px; }
  .inline .grow { flex: 1; min-width: 0; }
  .hint { color: var(--muted); font-size: 12px; line-height: 1.5; margin: 12px 0 0; }
  .credits { color: var(--muted); font-size: 11px; line-height: 1.5; margin: 24px 0 0; }
  .credits a { color: inherit; }
  .err { color: var(--danger); font-size: 12px; margin: 8px 0 0; display: flex; gap: 6px; align-items: start; }
  .x { border: 0; background: none; color: inherit; padding: 2px; }
</style>
