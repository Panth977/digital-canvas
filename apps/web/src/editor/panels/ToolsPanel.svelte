<script lang="ts">
  import './panels.css';
  import { CHARTS, FRAMES, GRIDS, chart, decompose, type Brush } from '@digital-canvas/scene';
  import { BRUSHES, LINES, type EditorState } from '../../lib/editor.svelte.ts';
  import Icon, { type IconName } from '../../lib/Icon.svelte';
  import ColorField from '../ColorField.svelte';
  import { FLOW_SHAPES, MOCKUPS, STICKY_COLORS, flowShape, mockup, pageSnapshot, place, stickyNote } from '../../lib/tools.ts';

  let { ed }: { ed: EditorState } = $props();

  type View = 'home' | 'sticky' | 'flow' | 'table' | 'chart' | 'qr' | 'frames' | 'mockups' | 'bg';
  let view = $state<View>('home');

  const BRUSH_ICON: Record<Brush, IconName> = { pen: 'pen', marker: 'marker', highlighter: 'highlighter', eraser: 'eraser' };
  const toolFor = (b: Brush) => ({ brush: b, color: BRUSHES[b].color, size: BRUSHES[b].size, opacity: BRUSHES[b].opacity });

  const TILES: { id: View; label: string; icon: IconName; color: string }[] = [
    { id: 'sticky', label: 'Sticky notes', icon: 'sticky', color: '#fbbf24' },
    { id: 'flow', label: 'Whiteboard shapes', icon: 'shapes', color: '#8b5cf6' },
    { id: 'table', label: 'Tables', icon: 'table', color: '#f97316' },
    { id: 'chart', label: 'Charts', icon: 'chart', color: '#06b6d4' },
    { id: 'qr', label: 'QR code', icon: 'qr', color: '#64748b' },
    { id: 'frames', label: 'Frames & grids', icon: 'frame', color: '#22c55e' },
    { id: 'mockups', label: 'Mockups', icon: 'phone', color: '#ec4899' },
    { id: 'bg', label: 'Background remover', icon: 'wand', color: '#6366f1' },
  ];

  function open(v: View): void {
    view = v;
    if (v !== 'home') ed.tool = null; // tools add things; the pen would get in the way
  }

  // ---- previews ----
  function chartPreview(kind: (typeof CHARTS)[number]['kind']): string {
    const el = { ...chart(kind, { x: 0, y: 0, w: 48, h: 48 }), legend: false, grid: false, style: { fontFamily: 'Inter', fontSize: 1, color: '#000' } };
    return decompose(el).paths.map((x) => `<path d="${x.d}" fill="${x.fill?.type === 'solid' ? x.fill.color : 'none'}" stroke="${x.stroke ? x.stroke.color : 'none'}" stroke-width="${Math.min(x.stroke?.width ?? 0, 1.5)}"/>`).join('');
  }
  const FLOW_SVG: Record<string, string> = {
    process: '<rect x="4" y="12" width="40" height="24" rx="4"/>', decision: '<path d="M24 6L44 24 24 42 4 24z"/>', terminal: '<ellipse cx="24" cy="24" rx="20" ry="11"/>',
    data: '<path d="M12 12H44L36 36H4z"/>', document: '<path d="M6 10H42V34C33 29 24 41 15 36S6 34 6 34z"/>', note: '<rect x="4" y="12" width="40" height="24"/>',
  };
  const gridPreview = (g: (typeof GRIDS)[number]) => g.cells.map(([x, y, w, h]) => `<rect x="${4 + x * 40 + 1}" y="${4 + y * 40 + 1}" width="${w * 40 - 2}" height="${h * 40 - 2}" rx="1.5"/>`).join('');

  // ---- table / qr ----
  let rows = $state(3), cols = $state(3);
  let qrText = $state('https://');

  // ---- mockups ----
  let mockPage = $state('');
  let mockDark = $state(true);
  let mockBusy = $state<string | null>(null);
  let mockError = $state('');
  const selImage = $derived(ed.selected.length === 1 && ed.selected[0]!.type === 'image' && ed.selected[0]!.asset ? ed.selected[0]! : null);
  async function makeMockup(id: string): Promise<void> {
    mockBusy = id;
    mockError = '';
    try {
      let shot: { asset: string; ratio: number } | null = null;
      if (mockPage === 'selection' && selImage && selImage.type === 'image') shot = { asset: selImage.asset, ratio: selImage.w / selImage.h };
      else shot = await pageSnapshot(ed, mockPage || ed.pageId);
      if (!shot) throw new Error('couldn’t take a picture of the page');
      place(ed, mockup(ed, id, shot.asset, shot.ratio, mockDark));
    } catch (e) {
      mockError = e instanceof Error ? e.message : String(e);
    } finally {
      mockBusy = null;
    }
  }
</script>

<div class="dp" data-testid="tools-panel">
  {#if view === 'home'}
    <div class="dp-head"><h3>Draw</h3></div>
    <div class="brushes">
      {#each Object.entries(BRUSHES) as [b, info] (b)}
        <button class="brush" class:on={ed.tool?.brush === b} aria-pressed={ed.tool?.brush === b} data-testid="brush-{b}" onclick={() => (ed.tool = toolFor(b as Brush))}>
          <span class="bi" style="color:{b === 'eraser' ? 'var(--ink-2)' : info.color}"><Icon name={BRUSH_ICON[b as Brush]} size={26} /></span>
          <span>{info.label}</span>
        </button>
      {/each}
    </div>
    {#if ed.tool}
      <div class="dp-stack" style="margin-top:12px">
        {#if ed.tool.brush !== 'eraser'}
          <ColorField label="Colour" value={ed.tool.color} testid="draw-color" onchange={(hex) => ed.tool && (ed.tool = { ...ed.tool, color: hex })} />
        {/if}
        <label class="field"><span>{ed.tool.brush === 'eraser' ? 'Eraser size' : 'Size'} · {ed.tool.size}px</span>
          <input type="range" min="1" max="80" value={ed.tool.size} data-testid="draw-size" oninput={(e) => ed.tool && (ed.tool = { ...ed.tool, size: Number((e.currentTarget as HTMLInputElement).value) })} />
        </label>
        {#if ed.tool.brush !== 'eraser'}
          <label class="field"><span>Transparency · {Math.round((1 - ed.tool.opacity) * 100)}%</span>
            <input type="range" min="0" max="90" value={Math.round((1 - ed.tool.opacity) * 100)} oninput={(e) => ed.tool && (ed.tool = { ...ed.tool, opacity: 1 - Number((e.currentTarget as HTMLInputElement).value) / 100 })} />
          </label>
        {/if}
      </div>
      <p class="dp-hint">{ed.tool.brush === 'eraser' ? 'Drag over drawings to erase them (other elements are safe).' : 'Draw on the page; each stroke is its own element you can move and recolour. Press Esc to stop.'}</p>
    {:else}
      <p class="dp-hint">Pick a brush to draw on the page.</p>
    {/if}

    <div class="dp-head"><h3>More tools</h3></div>
    <div class="dp-tiles">
      {#each TILES as t (t.id)}
        <button class="dp-tile" onclick={() => open(t.id)} data-testid="tool-{t.id}">
          <span class="dp-ti" style="background:color-mix(in srgb, {t.color} 18%, var(--chip));color:{t.color}"><Icon name={t.icon} size={30} /></span>
          {t.label}
        </button>
      {/each}
    </div>
  {:else}
    <button class="dp-back" onclick={() => (view = 'home')} data-testid="tools-back"><Icon name="left" size={16} /> {TILES.find((t) => t.id === view)?.label}</button>

    {#if view === 'sticky'}
      <div class="dp-grid">
        {#each STICKY_COLORS as c (c.name)}
          <button class="dp-cell sticky" style="background:{c.fill};color:{c.ink}" onclick={() => place(ed, stickyNote(ed, c))} data-testid="sticky-{c.name.toLowerCase()}" aria-label="Add a {c.name.toLowerCase()} sticky note">
            <span>Idea</span>
          </button>
        {/each}
      </div>
      <p class="dp-hint">Double-click a note’s text to write on it. Notes are groups: drag to move, Ctrl/⌘ + Shift + G to ungroup.</p>
    {:else if view === 'flow'}
      <div class="dp-grid">
        {#each FLOW_SHAPES as f (f.id)}
          <button class="dp-cell flow" title={f.label} onclick={() => place(ed, flowShape(ed, f.id))} data-testid="flow-{f.id}">
            <svg viewBox="0 0 48 48" width="44" height="44">{@html FLOW_SVG[f.id]}</svg>
            <small>{f.label}</small>
          </button>
        {/each}
      </div>
      <div class="dp-head"><h3>Connectors</h3></div>
      <div class="dp-row">
        {#each LINES.filter((l) => ['arrow', 'elbow', 'curved', 'dashed'].includes(l.id)) as l (l.id)}
          <button class="btn grow" onclick={() => ed.addLine(l)} data-testid="flow-line-{l.id}">{l.label.replace(' connector', '')}</button>
        {/each}
      </div>
      <p class="dp-hint">Drag a connector’s ends onto shapes to link them; they follow when shapes move.</p>
    {:else if view === 'table'}
      <div class="dp-row">
        <label class="field grow">Rows<input class="input" type="number" min="1" max="30" bind:value={rows} data-testid="tools-table-rows" /></label>
        <label class="field grow">Columns<input class="input" type="number" min="1" max="12" bind:value={cols} data-testid="tools-table-cols" /></label>
      </div>
      <button class="btn primary dp-cta" style="margin-top:10px" data-testid="tools-add-table" onclick={() => ed.addTable(Math.max(1, Math.min(30, rows | 0)), Math.max(1, Math.min(12, cols | 0)))}><Icon name="table" size={16} /> Add table</button>
      <div class="dp-head"><h3>Quick sizes</h3></div>
      <div class="dp-grid four">
        {#each [[2, 2], [3, 3], [4, 3], [5, 4]] as [r, c]}
          <button class="dp-cell" onclick={() => ed.addTable(r!, c!)}>{r}×{c}</button>
        {/each}
      </div>
    {:else if view === 'chart'}
      <div class="dp-grid">
        {#each CHARTS as c (c.kind)}
          <button class="dp-cell" title="{c.label} chart" onclick={() => ed.addChart(c.kind)} data-testid="tools-chart-{c.kind}">
            <svg viewBox="-2 -2 52 52" width="48" height="48" fill="none">{@html chartPreview(c.kind)}</svg>
          </button>
        {/each}
      </div>
      <p class="dp-hint">Select a chart to edit its numbers and colours in the side panel.</p>
    {:else if view === 'qr'}
      <form class="dp-stack" onsubmit={(e) => { e.preventDefault(); if (qrText.trim()) ed.addQr(qrText.trim()); }}>
        <label class="field">Link or text<input class="input" bind:value={qrText} data-testid="tools-qr-text" /></label>
        <button class="btn primary dp-cta" data-testid="tools-add-qr"><Icon name="qr" size={16} /> Generate QR code</button>
      </form>
      <p class="dp-hint">The code is a vector graphic: it stays sharp at any size and you can recolour it.</p>
    {:else if view === 'frames'}
      <div class="dp-head"><h3>Frames</h3></div>
      <div class="dp-grid four">
        {#each FRAMES as f (f.id)}
          <button class="dp-cell" title={f.label} onclick={() => ed.addFrame(f.id)} data-testid="tools-frame-{f.id}"><Icon name="frame" size={22} /><small class="tiny">{f.label}</small></button>
        {/each}
      </div>
      <div class="dp-head"><h3>Grids</h3></div>
      <div class="dp-grid four">
        {#each GRIDS as g (g.id)}
          <button class="dp-cell grid" title={g.label} onclick={() => ed.addGrid(g.id)} data-testid="tools-grid-{g.id}"><svg viewBox="0 0 48 48" width="40" height="40">{@html gridPreview(g)}</svg></button>
        {/each}
      </div>
      <p class="dp-hint">Drop a photo onto a frame or grid cell to fill it.</p>
    {:else if view === 'mockups'}
      <label class="field">Show
        <select class="input" bind:value={mockPage} data-testid="mockup-source">
          <option value="">This page (page {ed.pageIndex + 1})</option>
          {#each ed.doc.pages as p, i (p.id)}{#if p.id !== ed.pageId}<option value={p.id}>Page {i + 1}{p.name ? ` · ${p.name}` : ''}</option>{/if}{/each}
          {#if selImage}<option value="selection">The selected image</option>{/if}
        </select>
      </label>
      <div class="dp-row" style="margin:10px 0">
        <button class="dp-chip" class:on={mockDark} onclick={() => (mockDark = true)}>Dark device</button>
        <button class="dp-chip" class:on={!mockDark} onclick={() => (mockDark = false)}>Light device</button>
      </div>
      <div class="dp-tiles">
        {#each MOCKUPS as m (m.id)}
          <button class="dp-tile" disabled={!!mockBusy} onclick={() => makeMockup(m.id)} data-testid="mockup-{m.id}">
            <span class="dp-ti"><Icon name={m.id === 'phone' || m.id === 'tablet' ? 'phone' : m.id === 'frame' ? 'frame' : m.id === 'browser' ? 'browser' : 'laptop'} size={30} /></span>
            {m.label}
          </button>
        {/each}
      </div>
      {#if mockBusy}<p class="dp-hint"><span class="dp-spin"></span> Making the mockup…</p>{/if}
      {#if mockError}<p class="dp-err">{mockError}</p>{/if}
      <p class="dp-hint">A picture of the page is put inside a vector device. Good for showing an app screen, a post or a slide.</p>
    {:else if view === 'bg'}
      {#if selImage}
        <button class="btn primary dp-cta" disabled={!!ed.bgStatus} onclick={() => ed.removeBackground()} data-testid="tools-bg-remove"><Icon name="wand" size={16} /> Remove background</button>
        {#if ed.bgStatus}<p class="dp-hint"><span class="dp-spin"></span> {ed.bgStatus.msg}{ed.bgStatus.fraction !== undefined ? ` ${Math.round(ed.bgStatus.fraction * 100)}%` : ''}</p>{/if}
        {#if ed.bgError}<p class="dp-err">{ed.bgError}</p>{/if}
        {#if selImage.type === 'image' && selImage.original}<button class="btn dp-cta" style="margin-top:8px" onclick={() => ed.restoreOriginal()}>Restore original</button>{/if}
      {:else}
        <p class="dp-empty">Select a photo on the page, then remove its background here. It runs on your computer — the photo never leaves it.</p>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .brushes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .brush { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 0 8px; border-radius: 10px; border: 1px solid transparent; background: var(--chip); color: var(--ink); font-size: 12px; font-weight: 500; }
  .brush:hover { border-color: var(--line); }
  .brush.on { border-color: var(--accent); background: var(--accent-soft); }
  .bi { display: grid; place-items: center; }
  .sticky { font: 600 15px Inter, sans-serif; align-items: start; justify-items: start; padding: 10px; box-shadow: 0 2px 4px rgba(0,0,0,.18); }
  .flow { display: flex; flex-direction: column; gap: 2px; }
  .flow svg { fill: #ede9fe; stroke: #6d28d9; stroke-width: 1.5; }
  .flow small, .tiny { font-size: 10px; color: var(--muted); }
  .grid svg { fill: #9aa1ad; }
  .dp-cell { flex-direction: column; }
  select.input { height: 36px; }
</style>
