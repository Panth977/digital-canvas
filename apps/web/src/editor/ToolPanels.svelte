<script lang="ts">
  import BrandColorRow from './panels/BrandColorRow.svelte';
  import {
    CHARTS, coverCrop, FRAMES, tableAddCol, tableAddRow, tableColWidth, tableRemoveCol, tableRemoveRow, tableSetCell,
    childrenOf, findElement, moveElementTo, walk, defaultEffect, TEXT_EFFECTS,
    type VideoElement, type ChartElement, type LineElement, type TableElement,
    type Element, type TextAlign, type TextEffect, type TextEffectType, type TextElement, type ImageElement,
  } from '@digital-canvas/scene';
  import type { EditorState } from '../lib/editor.svelte.ts';
  import { SHAPES } from '../lib/editor.svelte.ts';
  import Icon, { type IconName } from '../lib/Icon.svelte';
  import { ui } from '../lib/ui.svelte.ts';
  import ColorField from './ColorField.svelte';
  import ImagePanel from './ImagePanel.svelte';
  import NumField from './NumField.svelte';
  import FontPanel from './FontPanel.svelte';
  import AnimatePanel from './AnimatePanel.svelte';
  import { colorFromQuery, colorMatches, DEFAULT_GRADIENTS, paletteOf } from '../lib/uiutil.ts';
  import { countUses, recolorDoc } from '../lib/recolor.ts';
  import { untrack } from 'svelte';

  /** The contextual panels Canva opens in the left side panel from the toolbar. */
  let { ed }: { ed: EditorState } = $props();

  const sel = $derived(ed.selected);
  const one = $derived(sel.length === 1 ? sel[0]! : null);
  const texts = $derived(sel.filter((e): e is TextElement => e.type === 'text'));
  const t0 = $derived(texts[0]);
  const ts = $derived(ed.textStyle ?? {});
  const editingSel = $derived(!!ed.editingTextId && !!ed.textSel && ed.textSel.end > ed.textSel.start);
  const pic = $derived(sel.find((e): e is ImageElement | VideoElement => e.type === 'image' || e.type === 'video'));
  const tb = $derived(one?.type === 'table' ? one : null);
  const ch = $derived(one?.type === 'chart' ? one : null);
  const gr = $derived(one?.type === 'path' ? one : null);
  const fr = $derived(one?.type === 'image' && one.mask ? one : null);
  const owner = $derived(ed.selection.join(','));

  const key = (k: string) => `prop:${k}:${ed.selection.join(',')}`;
  const end = () => ed.seal();

  /** Does the open panel still fit the selection? If not, go back to the rail section. */
  const applies = $derived.by(() => {
    switch (ui.panel) {
      case 'font': return !!t0;
      case 'effects': return !!t0 && !editingSel;
      case 'animate': return true;
      case 'color': return !!ui.color && (ui.color.owner === owner || (ui.color.kind === 'text' && !!t0));
      case 'image': return !!pic && !(fr && !fr.asset);
      case 'table': return !!tb;
      case 'chart': return !!ch;
      case 'qr': return gr?.qr !== undefined;
      case 'frame': return !!fr;
      case 'audio': return !sel.length && !!ed.doc.audio?.length;
      default: return true;
    }
  });
  $effect(() => {
    if (!applies) ui.close();
  });

  const TITLES: Record<string, string> = {
    font: 'Font', color: 'Colour', effects: 'Effects', animate: 'Animate', position: 'Position', image: 'Edit image', table: 'Table', chart: 'Chart', qr: 'QR code', frame: 'Frame', audio: 'Sounds',
  };

  // ---- colour ----
  const DEFAULT_COLORS = [
    '#000000', '#545454', '#737373', '#a6a6a6', '#d9d9d9', '#ffffff',
    '#ff3131', '#ff5757', '#ff66c4', '#cb6ce6', '#8c52ff', '#5e17eb',
    '#0097b2', '#0cc0df', '#5ce1e6', '#38b6ff', '#5170ff', '#004aad',
    '#00bf63', '#7ed957', '#c1ff72', '#ffde59', '#ffbd59', '#ff914d',
  ];
  /** Colours already used in the design (Canva's "Document colours"). */
  const docColors = $derived.by(() => {
    if (ui.panel !== 'color') return [];
    const out = new Set<string>();
    const add = (c: string | undefined) => c && /^#[0-9a-f]{6}/i.test(c) && out.add(c.slice(0, 7).toLowerCase());
    for (const p of ed.doc.pages) {
      if (p.background.type === 'solid') add(p.background.color);
      for (const e of walk(p.elements)) {
        if (e.type === 'text') { add(e.style.color); for (const r of e.runs ?? []) add(r.style?.color); }
        if (e.type === 'shape') { if (e.fill?.type === 'solid') add(e.fill.color); add(e.stroke?.color); }
        if (e.type === 'line') add(e.stroke.color);
        if (e.type === 'path') for (const x of e.paths) { if (x.fill?.type === 'solid') add(x.fill.color); add(x.stroke?.color); }
      }
    }
    return [...out].slice(0, 18);
  });
  function pickSwatch(hex: string): void {
    const c = ui.color;
    if (!c) return;
    // a solid swatch replaces a gradient on text, shapes and pages
    if (c.kind === 'text' && t0?.gradient && !editingSel) ed.updateText({ gradient: undefined });
    c.onchange(hex);
    c.onend();
  }

  // ---- colour search, photo colours, gradients, change all ----
  let colorQuery = $state('');
  let pickerOpen = $state(false);
  const qColor = $derived(colorFromQuery(colorQuery));
  const match = (hex: string) => colorMatches(hex, colorQuery);
  /** Colour when the panel opened for this target: "Change all" swaps it for the new one. */
  let origColor = $state<string | null>(null);
  $effect(() => {
    const c = ui.color;
    untrack(() => { origColor = c ? c.value().slice(0, 7).toLowerCase() : null; colorQuery = ''; pickerOpen = false; });
  });
  const nowColor = $derived(ui.panel === 'color' && ui.color ? ui.color.value().slice(0, 7).toLowerCase() : null);
  const otherUses = $derived(origColor && nowColor && origColor !== nowColor ? countUses(ed.doc, origColor) : 0);
  function changeAll(): void {
    if (!origColor || !nowColor) return;
    ed.commit(recolorDoc(ed.doc, origColor, nowColor));
    ed.seal();
    origColor = nowColor;
  }

  /** Main colours of the photos in the design (Canva's "Photo colours"), cached per picture. */
  const photoCache = new Map<string, string[]>();
  let photoColors = $state<string[]>([]);
  const photoIds = $derived(ui.panel === 'color'
    ? [...new Set(ed.doc.pages.flatMap((p) => [...walk(p.elements)].filter((e): e is ImageElement => e.type === 'image' && !!e.asset).map((e) => e.asset)))].slice(0, 6)
    : []);
  $effect(() => {
    const ids = photoIds;
    if (!ids.length) { photoColors = []; return; }
    let live = true;
    void (async () => {
      const all: string[] = [];
      for (const id of ids) {
        let pal = photoCache.get(id);
        if (!pal) {
          const bytes = ed.assets.get(id);
          if (!bytes) continue;
          try {
            const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: ed.doc.assets[id]?.mime ?? 'image/png' }), { resizeWidth: 48, resizeHeight: 48 });
            const cv = new OffscreenCanvas(48, 48);
            const g = cv.getContext('2d')!;
            g.drawImage(bmp, 0, 0);
            pal = paletteOf(g.getImageData(0, 0, 48, 48).data, 6);
          } catch { pal = []; }
          photoCache.set(id, pal);
        }
        for (const c of pal) if (!all.includes(c)) all.push(c);
      }
      if (live) photoColors = all.slice(0, 18);
    })();
    return () => { live = false; };
  });

  /** Where a gradient can go: text, shape fills, page backgrounds (Canva). */
  const gradTarget = $derived(ui.color?.kind === 'text' ? (t0 && !editingSel ? 'text' : null) : ui.color?.kind === 'fill' ? 'fill' : ui.color?.kind === 'page' ? 'page' : null);
  function pickGradient(g: { from: string; to: string; angle: number }): void {
    const fill = { type: 'linear' as const, angle: g.angle, stops: [{ offset: 0, color: g.from }, { offset: 1, color: g.to }] };
    if (gradTarget === 'text') ed.updateText({ gradient: fill });
    else if (gradTarget === 'fill') ed.update((e) => (e.type === 'shape' ? { fill } : {}));
    else if (gradTarget === 'page') ed.updatePage({ background: fill });
    end();
  }
  function setGradient(on: boolean): void {
    ed.updateText({ gradient: on ? { type: 'linear', angle: 90, stops: [{ offset: 0, color: t0?.style.color ?? '#7c3aed' }, { offset: 1, color: '#0fb5c0' }] } : undefined });
    end();
  }
  function patchGradient(i: number | null, patch: { color?: string; angle?: number }): void {
    const g = t0?.gradient;
    if (!g) return;
    const stops = g.stops.map((s, j) => (j === i && patch.color ? { ...s, color: patch.color } : s));
    ed.updateText({ gradient: { ...g, stops, angle: patch.angle ?? g.angle } }, key('grad'));
  }
  const s0 = $derived(sel.find((e) => e.type === 'shape'));

  // ---- text effects ----
  function setEffect(type: TextEffectType | ''): void {
    ed.updateText({ effect: type ? defaultEffect(type) : undefined });
    end();
  }
  function patchEffect(patch: Record<string, unknown>): void {
    if (!t0?.effect) return;
    ed.updateText({ effect: { ...t0.effect, ...patch } as TextEffect }, key('fx'));
  }
  const fxNum = (fx: TextEffect, k: string) => (fx as unknown as Record<string, number>)[k] ?? 0;
  const FX_SLIDERS: Record<TextEffectType, { k: string; label: string; min: number; max: number }[]> = {
    shadow: [{ k: 'offset', label: 'Offset', min: 0, max: 100 }, { k: 'direction', label: 'Direction', min: -180, max: 180 }, { k: 'blur', label: 'Blur', min: 0, max: 100 }, { k: 'transparency', label: 'Transparency', min: 0, max: 100 }],
    lift: [{ k: 'intensity', label: 'Intensity', min: 0, max: 100 }],
    hollow: [{ k: 'thickness', label: 'Thickness', min: 0, max: 100 }],
    splice: [{ k: 'thickness', label: 'Thickness', min: 0, max: 100 }, { k: 'offset', label: 'Offset', min: 0, max: 100 }, { k: 'direction', label: 'Direction', min: -180, max: 180 }],
    outline: [{ k: 'thickness', label: 'Thickness', min: 0, max: 100 }],
    echo: [{ k: 'offset', label: 'Offset', min: 0, max: 100 }, { k: 'direction', label: 'Direction', min: -180, max: 180 }],
    glitch: [{ k: 'offset', label: 'Offset', min: 0, max: 100 }, { k: 'direction', label: 'Direction', min: -180, max: 180 }],
    neon: [{ k: 'intensity', label: 'Intensity', min: 0, max: 100 }],
    background: [{ k: 'roundness', label: 'Roundness', min: 0, max: 100 }, { k: 'spread', label: 'Spread', min: 0, max: 100 }, { k: 'transparency', label: 'Transparency', min: 0, max: 100 }],
  };

  // ---- position ----
  let ratio = $state(false);
  function setGeom(k: 'x' | 'y' | 'w' | 'h' | 'rotation', v: number): void {
    if (!one) return;
    if ((k === 'w' || k === 'h') && one.type === 'line') {
      const f = k === 'w' ? (one.w ? v / one.w : 1) : (one.h ? v / one.h : 1);
      const end = (e: LineElement['start']) => (k === 'w' ? { ...e, x: e.x * f } : { ...e, y: e.y * f });
      ed.update({ [k]: (k === 'w' ? one.w : one.h) ? v : 0, start: end(one.start), end: end(one.end) }, key(k));
    } else if (k === 'w' && one.type === 'text') {
      ed.update({ w: v, h: ed.renderer.textHeight({ ...one, w: v }) }, key(k));
    } else if (ratio && (k === 'w' || k === 'h') && one.w > 0 && one.h > 0) {
      ed.update(k === 'w' ? { w: v, h: (v * one.h) / one.w } : { h: v, w: (v * one.w) / one.h }, key('wh'));
    } else ed.update({ [k]: k === 'rotation' ? ((v % 360) + 360) % 360 : v } as Partial<Element>, key(k));
  }
  const ARRANGE: { how: 'forward' | 'backward' | 'front' | 'back'; label: string; icon: IconName }[] = [
    { how: 'forward', label: 'Forward', icon: 'up' }, { how: 'backward', label: 'Backward', icon: 'down' },
    { how: 'front', label: 'To front', icon: 'front' }, { how: 'back', label: 'To back', icon: 'back' },
  ];
  const ALIGN_TO: { how: 'top' | 'left' | 'middle' | 'center' | 'bottom' | 'right'; label: string; icon: IconName }[] = [
    { how: 'top', label: 'Top', icon: 'alignt' }, { how: 'left', label: 'Left', icon: 'alignl' },
    { how: 'middle', label: 'Middle', icon: 'alignm' }, { how: 'center', label: 'Centre', icon: 'alignc' },
    { how: 'bottom', label: 'Bottom', icon: 'alignb' }, { how: 'right', label: 'Right', icon: 'alignr' },
  ];

  // ---- layers ----
  const layers = $derived([...ed.page.elements].reverse());
  let dragLayer = $state<string | null>(null);
  let folded = $state<string[]>([]);
  function layerName(e: Element): string {
    if (e.name) return e.name;
    if (e.type === 'group') return `Group (${e.children.length})`;
    if (e.type === 'text') return e.text.split('\n')[0]!.slice(0, 40) || 'Text';
    if (e.type === 'image') return ed.doc.assets[e.asset]?.name ?? 'Image';
    if (e.type === 'video') return ed.doc.assets[e.asset]?.name ?? 'Video';
    if (e.type === 'path') return e.qr !== undefined ? 'QR code' : 'Graphic';
    if (e.type === 'line') return e.start.attach || e.end.attach ? 'Connector' : 'Line';
    if (e.type === 'table') return `Table ${e.rows.length} × ${e.cols.length}`;
    if (e.type === 'chart') return `${CHARTS.find((c) => c.kind === e.chart)?.label ?? ''} chart`;
    return SHAPES.find((s) => s.kind === e.shape)?.label ?? 'Shape';
  }
  function layerIcon(e: Element): IconName {
    if (e.type === 'image') return e.mask ? 'frame' : 'image';
    return ({ text: 'text', video: 'video', line: 'line', table: 'table', chart: 'chart', path: e.type === 'path' && e.qr !== undefined ? 'qr' : 'shapes', shape: 'shapes', group: 'layers' } as const)[e.type];
  }
  function dropLayer(targetId: string): void {
    if (!dragLayer || dragLayer === targetId) return;
    const from = findElement(ed.doc, dragLayer), to = findElement(ed.doc, targetId);
    if (from && to && from.parent?.id === to.parent?.id) {
      ed.commit(moveElementTo(ed.doc, dragLayer, to.index));
      ed.seal();
    }
    dragLayer = null;
  }

  // ---- tables, charts, QR, frames ----
  const ALIGNS: { a: TextAlign; icon: IconName }[] = [{ a: 'left', icon: 'tl' }, { a: 'center', icon: 'tc' }, { a: 'right', icon: 'tr' }];
  const cell = $derived(tb && ed.cell?.id === tb.id && tb.cells[ed.cell.r]?.[ed.cell.c] ? ed.cell : null);
  const tableOp = (fn: (t: TableElement) => Partial<TableElement>, k: string | null = null) => tb && ed.tableOp(tb.id, fn, k);
  const chPie = $derived(ch?.chart === 'pie' || ch?.chart === 'donut');
  const chSeries = $derived(ch ? (chPie ? ch.series.slice(0, 1) : ch.series) : []);
  function chartPatch(fn: (c: ChartElement) => Partial<ChartElement>, k: string | null = null): void {
    ed.update((e) => (e.type === 'chart' ? fn(e) : {}), k);
  }
  let qrDraft = $state('');
  $effect(() => { qrDraft = gr?.qr ?? ''; });
  const frameZoom = $derived.by(() => {
    if (!fr?.asset || !fr.crop) return 1;
    const m = ed.doc.assets[fr.asset];
    return coverCrop(m?.width ?? fr.w, m?.height ?? fr.h, fr.w, fr.h).w / fr.crop.w;
  });
</script>

{#snippet layer(e: Element, depth: number)}
  {@const kids = childrenOf(e)}
  <li class:sel={ed.selection.includes(e.id)} class:hidden={e.hidden} style:margin-left="{depth * 16}px" data-testid="layer-{e.type}" draggable="true"
    ondragstart={(ev) => { ev.stopPropagation(); dragLayer = e.id; }} ondragover={(ev) => ev.preventDefault()} ondrop={() => dropLayer(e.id)}>
    {#if kids}
      <button class="lbtn fold" aria-label={folded.includes(e.id) ? 'Expand group' : 'Collapse group'} onclick={() => (folded = folded.includes(e.id) ? folded.filter((x) => x !== e.id) : [...folded, e.id])}><Icon name={folded.includes(e.id) ? 'down' : 'up'} size={14} /></button>
    {/if}
    <button class="lname" onclick={(ev) => ed.select(ev.shiftKey ? [...ed.selection, e.id] : [e.id])}>
      <Icon name={kids ? 'layers' : layerIcon(e)} size={15} />
      <span>{layerName(e)}</span>
    </button>
    <button class="lbtn" aria-label={e.locked ? 'Unlock' : 'Lock'} onclick={() => { ed.update({ locked: !e.locked }, null, [e.id]); ed.seal(); }}><Icon name={e.locked ? 'lock' : 'unlock'} size={15} /></button>
    <button class="lbtn" aria-label={e.hidden ? 'Show' : 'Hide'} onclick={() => { ed.update({ hidden: !e.hidden }, null, [e.id]); ed.seal(); }}><Icon name={e.hidden ? 'eyeoff' : 'eye'} size={15} /></button>
  </li>
  {#if kids && !folded.includes(e.id)}
    {#each [...kids].reverse() as c (c.id)}{@render layer(c, depth + 1)}{/each}
  {/if}
{/snippet}

{#if ui.panel && applies}
  <div class="tp" data-testid="tool-panel" data-panel={ui.panel} data-text-tools>
    <header>
      <h3>{ui.panel === 'color' ? ui.color?.title ?? 'Colour' : TITLES[ui.panel]}</h3>
      <button class="x" aria-label="Close" data-testid="panel-close" onclick={() => ui.close()}><Icon name="close" size={18} /></button>
    </header>

    {#if ui.panel === 'font'}
      <FontPanel {ed} value={ts.fontFamily} />

    {:else if ui.panel === 'color' && ui.color}
      {@const c = ui.color}
      <div class="scroll-y body" data-testid="color-panel">
        <label class="csearch">
          <Icon name="search" size={16} />
          <input type="search" placeholder="Try &quot;blue&quot; or &quot;#00c4cc&quot;" bind:value={colorQuery} aria-label="Search colours" data-testid="color-search" />
        </label>
        {#if colorQuery && qColor}
          <div class="swatches">
            <button class="swatch" title={qColor} aria-label="Colour {qColor}" data-testid="color-search-hit" style="background:{qColor}" onclick={() => pickSwatch(qColor!)}></button>
          </div>
        {/if}
        <ColorField label="Custom colour" value={c.value()} testid={c.testid} onchange={c.onchange} onend={c.onend} bind:open={pickerOpen} />
        {#if c.kind === 'text' && t0 && !editingSel && t0.gradient}
          <div class="row2">
            <ColorField label="From" value={t0.gradient.stops[0]?.color ?? '#000000'} onchange={(hex) => patchGradient(0, { color: hex })} onend={end} />
            <ColorField label="To" value={t0.gradient.stops[t0.gradient.stops.length - 1]?.color ?? '#000000'} onchange={(hex) => patchGradient(t0!.gradient!.stops.length - 1, { color: hex })} onend={end} />
          </div>
          <NumField label="Gradient angle" value={t0.gradient.angle} min={0} max={360} suffix="°" onchange={(v) => patchGradient(null, { angle: v })} onend={end} />
          <button class="btn" onclick={() => setGradient(false)} data-testid="gradient-off">Use a solid colour</button>
        {:else if c.kind === 'text' && t0 && !editingSel}
          <button class="btn" onclick={() => setGradient(true)} data-testid="gradient-on">Use a gradient</button>
        {/if}
        {#if c.kind === 'fill' && s0?.type === 'shape'}
          <button class="btn" onclick={() => { ed.update((e) => (e.type === 'shape' ? { fill: e.fill ? null : { type: 'solid', color: '#8b5cf6' } } : {})); end(); }}>{s0.fill ? 'No fill (transparent)' : 'Add a fill'}</button>
        {/if}
        {#if otherUses > 0}
          <button class="btn primary" data-testid="change-all" onclick={changeAll}>Change all ({otherUses})</button>
        {/if}
        <h4>Document colours</h4>
        <div class="swatches">
          <button class="swatch add" class:on={pickerOpen} title="Add a new colour" aria-label="Add a new colour" data-testid="color-add" onclick={() => (pickerOpen = !pickerOpen)}><Icon name="plus" size={16} /></button>
          {#each docColors.filter(match) as hex (hex)}
            <button class="swatch" class:on={c.value().slice(0, 7).toLowerCase() === hex} title={hex} aria-label="Colour {hex}" style="background:{hex}" onclick={() => pickSwatch(hex)}></button>
          {/each}
        </div>
        <BrandColorRow current={c.value()} onpick={pickSwatch} />
        {#if photoColors.filter(match).length}
          <h4>Photo colours</h4>
          <div class="swatches" data-testid="photo-colors">
            {#each photoColors.filter(match) as hex (hex)}
              <button class="swatch" class:on={c.value().slice(0, 7).toLowerCase() === hex} title={hex} aria-label="Colour {hex}" style="background:{hex}" onclick={() => pickSwatch(hex)}></button>
            {/each}
          </div>
        {/if}
        {#if DEFAULT_COLORS.filter(match).length}
          <h4>Default solid colours</h4>
          <div class="swatches" data-testid="default-colors">
            {#each DEFAULT_COLORS.filter(match) as hex (hex)}
              <button class="swatch" class:on={c.value().slice(0, 7).toLowerCase() === hex} title={hex} aria-label="Colour {hex}" style="background:{hex}" onclick={() => pickSwatch(hex)}></button>
            {/each}
          </div>
        {/if}
        {#if gradTarget}
          {@const grads = DEFAULT_GRADIENTS.filter((g) => match(g.from) || match(g.to))}
          {#if grads.length}
            <h4>Default gradient colours</h4>
            <div class="swatches" data-testid="default-gradients">
              {#each grads as g, i (i)}
                <button class="swatch" title="{g.from} → {g.to}" aria-label="Gradient {g.from} to {g.to}" data-testid="gradient-{i}" style="background:linear-gradient({g.angle}deg, {g.from}, {g.to})" onclick={() => pickGradient(g)}></button>
              {/each}
            </div>
          {/if}
        {/if}
        {#if colorQuery && !qColor && !docColors.some(match) && !DEFAULT_COLORS.some(match) && !photoColors.some(match)}
          <p class="hint">No colours match “{colorQuery}”. Try a colour name or a hex code.</p>
        {/if}
      </div>

    {:else if ui.panel === 'effects' && t0}
      <div class="scroll-y body">
        <h4>Style</h4>
        <div class="fxgrid">
          {#each [{ type: '', label: 'None' }, ...TEXT_EFFECTS] as fx (fx.type)}
            <button class="fx" class:on={(t0.effect?.type ?? '') === fx.type} data-testid="fx-pick-{fx.type || 'none'}" onclick={() => setEffect(fx.type as TextEffectType | '')}>
              <span class="fxpv fx-{fx.type || 'none'}">Ag</span>
              <span>{fx.label}</span>
            </button>
          {/each}
        </div>
        {#if t0.effect}
          {@const fx = t0.effect}
          {#each FX_SLIDERS[fx.type] as sl (sl.k)}
            <div class="field">
              <span>{sl.label} · {fxNum(fx, sl.k)}</span>
              <input type="range" min={sl.min} max={sl.max} value={fxNum(fx, sl.k)} data-testid="fx-{sl.k}"
                oninput={(e) => patchEffect({ [sl.k]: Number((e.currentTarget as HTMLInputElement).value) })} onchange={end} />
            </div>
          {/each}
          {#if 'color' in fx}
            <ColorField label="Colour" value={fx.color} onchange={(hex) => patchEffect({ color: hex })} onend={end} />
          {/if}
          {#if fx.type === 'glitch'}
            <label class="field"><span>Colours</span>
              <select class="input" value={fx.colors} onchange={(e) => { patchEffect({ colors: (e.currentTarget as HTMLSelectElement).value }); end(); }}>
                <option value="blue-red">Blue / red</option><option value="blue-yellow">Blue / yellow</option>
              </select>
            </label>
          {/if}
        {/if}
        <h4>Shape</h4>
        <div class="fxgrid two">
          <button class="fx" class:on={!t0.curve} onclick={() => { ed.updateText({ curve: undefined }); end(); }}><span class="fxpv">abc</span><span>None</span></button>
          <button class="fx" class:on={!!t0.curve} data-testid="curve-on" onclick={() => { if (!t0!.curve) { ed.updateText({ curve: 50 }); end(); } }}><span class="fxpv"><Icon name="curve" size={22} /></span><span>Curve</span></button>
        </div>
        <div class="field">
          <span><Icon name="curve" size={14} /> Curve · {t0.curve ?? 0}</span>
          <input type="range" min="-100" max="100" value={t0.curve ?? 0} data-testid="curve"
            oninput={(e) => ed.updateText({ curve: Number((e.currentTarget as HTMLInputElement).value) || undefined }, key('curve'))} onchange={end} />
        </div>
      </div>

    {:else if ui.panel === 'animate'}
      <div class="scroll-y body"><AnimatePanel {ed} /></div>

    {:else if ui.panel === 'position'}
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected={ui.positionTab === 'arrange'} class:on={ui.positionTab === 'arrange'} data-testid="postab-arrange" onclick={() => (ui.positionTab = 'arrange')}>Arrange</button>
        <button role="tab" aria-selected={ui.positionTab === 'layers'} class:on={ui.positionTab === 'layers'} data-testid="postab-layers" onclick={() => (ui.positionTab = 'layers')}>Layers</button>
      </div>
      <div class="scroll-y body">
        {#if ui.positionTab === 'layers'}
          {#if !layers.length}<p class="hint">Nothing on this page yet.</p>{/if}
          <ul class="layers" data-testid="layers">
            {#each layers as e (e.id)}{@render layer(e, 0)}{/each}
          </ul>
        {:else if !sel.length}
          <p class="hint">Select an element to arrange it. Layers lists everything on this page.</p>
        {:else}
          <div class="grid2">
            {#each ARRANGE as a (a.how)}
              <button class="pbtn" onclick={() => ed.arrange(a.how)}><Icon name={a.icon} size={16} /> {a.label}</button>
            {/each}
          </div>
          <h4>{sel.length > 1 ? 'Align elements' : 'Align to page'}</h4>
          <div class="grid2">
            {#each ALIGN_TO as a (a.how)}
              <button class="pbtn" aria-label="Align {a.label.toLowerCase()}" onclick={() => ed.align(a.how === 'center' ? 'center' : a.how)}><Icon name={a.icon} size={16} /> {a.label}</button>
            {/each}
          </div>
          {#if sel.length > 1}
            <h4>Space evenly</h4>
            <div class="grid2" data-testid="spacing">
              <button class="pbtn" data-testid="distribute-x" disabled={sel.length < 3} onclick={() => ed.distribute('x')}><Icon name="distx" size={16} /> Horizontally</button>
              <button class="pbtn" data-testid="distribute-y" disabled={sel.length < 3} onclick={() => ed.distribute('y')}><Icon name="disty" size={16} /> Vertically</button>
              <button class="pbtn" data-testid="tidy-up" title="Even spacing in a row, column or grid" onclick={() => ed.tidyUp()}><Icon name="tidy" size={16} /> Tidy up</button>
            </div>
          {/if}
          <h4>Flip</h4>
          <div class="grid2">
            <button class="pbtn" onclick={() => { ed.update((e) => ({ flipX: !e.flipX })); end(); }}><Icon name="flipx" size={16} /> Horizontal</button>
            <button class="pbtn" onclick={() => { ed.update((e) => ({ flipY: !e.flipY })); end(); }}><Icon name="flipy" size={16} /> Vertical</button>
          </div>
          {#if one}
            <h4>Advanced</h4>
            <div class="row3">
              <NumField label="Width" value={one.w} min={1} onchange={(v) => setGeom('w', v)} onend={end} testid="pos-w" />
              <button class="btn icon" class:on={ratio} title={ratio ? 'Unlock aspect ratio' : 'Lock aspect ratio'} aria-label="Lock aspect ratio" aria-pressed={ratio} data-testid="lock-ratio" onclick={() => (ratio = !ratio)}><Icon name={ratio ? 'link' : 'unlink'} size={16} /></button>
              <NumField label="Height" value={one.h} min={1} onchange={(v) => setGeom('h', v)} onend={end} testid="pos-h" />
            </div>
            <div class="row2">
              <NumField label="X" value={one.x} onchange={(v) => setGeom('x', v)} onend={end} testid="pos-x" />
              <NumField label="Y" value={one.y} onchange={(v) => setGeom('y', v)} onend={end} testid="pos-y" />
            </div>
            <NumField label="Rotate" value={one.rotation} suffix="°" onchange={(v) => setGeom('rotation', v)} onend={end} testid="rotation" />
          {/if}
        {/if}
      </div>

    {:else if ui.panel === 'image' && pic}
      <ImagePanel {ed} {pic} />

    {:else if ui.panel === 'table' && tb}
      <div class="scroll-y body" data-testid="table-props">
        <h4>Table · {tb.rows.length} × {tb.cols.length}</h4>
        <div class="grid2">
          <button class="pbtn" data-testid="row-add" onclick={() => { tableOp((t) => tableAddRow(t, cell?.r ?? t.rows.length - 1)); end(); }}>+ Row</button>
          <button class="pbtn" data-testid="row-remove" disabled={tb.rows.length < 2} onclick={() => { tableOp((t) => tableRemoveRow(t, cell?.r ?? t.rows.length - 1)); ed.cell = null; end(); }}>− Row</button>
          <button class="pbtn" data-testid="col-add" onclick={() => { tableOp((t) => tableAddCol(t, cell?.c ?? t.cols.length - 1)); end(); }}>+ Column</button>
          <button class="pbtn" data-testid="col-remove" disabled={tb.cols.length < 2} onclick={() => { tableOp((t) => tableRemoveCol(t, cell?.c ?? t.cols.length - 1)); ed.cell = null; end(); }}>− Column</button>
        </div>
        {#if cell}
          {@const c = tb.cells[cell.r]![cell.c]!}
          <h4>Cell (row {cell.r + 1}, column {cell.c + 1})</h4>
          <div class="row2">
            <ColorField label="Cell colour" value={c.fill ?? '#ffffff'} testid="cell-fill" onchange={(hex) => tableOp((t) => tableSetCell(t, cell!.r, cell!.c, { fill: hex }), key('cf'))} onend={end} />
            <button class="btn" disabled={!c.fill} onclick={() => { tableOp((t) => { const n = tableSetCell(t, cell!.r, cell!.c, {}); delete n.cells![cell!.r]![cell!.c]!.fill; return n; }); end(); }}>No colour</button>
          </div>
          <div class="toggles">
            <button class="btn icon" class:on={c.style?.bold ?? tb.style.bold} aria-label="Bold cell" onclick={() => { tableOp((t) => tableSetCell(t, cell!.r, cell!.c, { style: { ...c.style, bold: !(c.style?.bold ?? t.style.bold) } })); end(); }}><Icon name="bold" /></button>
            {#each ALIGNS as { a, icon }}
              <button class="btn icon" class:on={(c.style?.align ?? tb.style.align) === a} aria-label="Align cell {a}" onclick={() => { tableOp((t) => tableSetCell(t, cell!.r, cell!.c, { style: { ...c.style, align: a } })); end(); }}><Icon name={icon} /></button>
            {/each}
          </div>
          <NumField label="Column width" value={tb.cols[cell.c]! * tb.w} min={12} testid="col-width" onchange={(v) => tableOp((t) => tableColWidth(t, cell!.c, v), key('cw'))} onend={end} />
        {:else}
          <p class="hint">Click a cell to colour it or change its column. Double-click to type; Tab moves on.</p>
        {/if}
        <h4>Text</h4>
        <div class="row2">
          <NumField label="Size" value={tb.style.fontSize} min={4} max={400} testid="table-font-size" onchange={(v) => { tableOp(() => ({ style: { ...tb!.style, fontSize: v } }), key('tfs')); ed.fitTable(tb!.id, key('tfs')); }} onend={end} />
          <ColorField label="Colour" value={tb.style.color} onchange={(hex) => tableOp((t) => ({ style: { ...t.style, color: hex } }), key('tcol'))} onend={end} />
        </div>
        <h4>Borders</h4>
        <div class="row2">
          <ColorField label="Colour" value={tb.border?.color ?? '#c9ced6'} onchange={(hex) => tableOp((t) => ({ border: { width: t.border?.width || 1.5, ...t.border, color: hex } }), key('tbc'))} onend={end} />
          <NumField label="Weight" value={tb.border?.width ?? 0} min={0} max={40} step={0.5} onchange={(v) => tableOp((t) => ({ border: v > 0 ? { color: '#c9ced6', ...t.border, width: v } : null }), key('tbw'))} onend={end} />
        </div>
      </div>

    {:else if ui.panel === 'chart' && ch}
      <div class="scroll-y body" data-testid="chart-props">
        <label class="field"><span>Chart type</span>
          <select class="input" value={ch.chart} data-testid="chart-kind" onchange={(e) => { chartPatch(() => ({ chart: (e.currentTarget as HTMLSelectElement).value as ChartElement['chart'] })); end(); }}>
            {#each CHARTS as c}<option value={c.kind}>{c.label}</option>{/each}
          </select>
        </label>
        <h4>Data</h4>
        <div class="data" style="grid-template-columns: minmax(0, 1.2fr) repeat({chSeries.length}, minmax(0, 1fr)) 22px" data-testid="chart-data">
          <span></span>
          {#each chSeries as sr, si}
            <input class="input" value={sr.name} aria-label="Series {si + 1} name" oninput={(e) => chartPatch((c) => ({ series: c.series.map((x, j) => (j === si ? { ...x, name: (e.currentTarget as HTMLInputElement).value } : x)) }), key(`sn${si}`))} onchange={end} />
          {/each}
          <span></span>
          {#each ch.labels as lab, li}
            <input class="input" value={lab} aria-label="Label {li + 1}" oninput={(e) => chartPatch((c) => ({ labels: c.labels.map((x, j) => (j === li ? (e.currentTarget as HTMLInputElement).value : x)) }), key(`lb${li}`))} onchange={end} />
            {#each chSeries as sr, si}
              <input class="input" type="number" value={sr.values[li] ?? 0} aria-label="{sr.name} {lab}" data-testid="chart-value-{li}-{si}"
                oninput={(e) => { const v = Number((e.currentTarget as HTMLInputElement).value); if (Number.isFinite(v)) chartPatch((c) => ({ series: c.series.map((x, j) => (j === si ? { ...x, values: c.labels.map((_, k) => (k === li ? v : x.values[k] ?? 0)) } : x)) }), key(`v${li}:${si}`)); }} onchange={end} />
            {/each}
            <button class="x" aria-label="Remove row {lab}" disabled={ch.labels.length < 2} onclick={() => { chartPatch((c) => ({ labels: c.labels.filter((_, j) => j !== li), series: c.series.map((x) => ({ ...x, values: x.values.filter((_, j) => j !== li) })) })); end(); }}>×</button>
          {/each}
        </div>
        <div class="toggles">
          <button class="btn" data-testid="chart-add-row" onclick={() => { chartPatch((c) => ({ labels: [...c.labels, `Item ${c.labels.length + 1}`], series: c.series.map((x) => ({ ...x, values: [...c.labels.map((_, k) => x.values[k] ?? 0), 10] })) })); end(); }}>+ Row</button>
          {#if !chPie}
            <button class="btn" onclick={() => { chartPatch((c) => ({ series: [...c.series, { name: `Series ${c.series.length + 1}`, values: c.labels.map(() => 10) }] })); end(); }}>+ Series</button>
            <button class="btn" disabled={ch.series.length < 2} onclick={() => { chartPatch((c) => ({ series: c.series.slice(0, -1) })); end(); }}>− Series</button>
          {/if}
        </div>
        <h4>Colours</h4>
        <div class="two">
          {#each (chPie ? ch.labels : ch.series.map((x) => x.name)) as name, i}
            <ColorField label={name || `#${i + 1}`} value={ch.colors[i % ch.colors.length] ?? '#7c5cff'} onchange={(hex) => chartPatch((c) => { const colors = (chPie ? c.labels : c.series).map((_, k) => c.colors[k % c.colors.length] ?? '#7c5cff'); colors[i] = hex; return { colors }; }, key(`cc${i}`))} onend={end} />
          {/each}
        </div>
        <div class="toggles">
          <button class="btn" class:on={ch.legend} onclick={() => { chartPatch((c) => ({ legend: !c.legend })); end(); }}>Legend</button>
          {#if !chPie}<button class="btn" class:on={ch.grid} onclick={() => { chartPatch((c) => ({ grid: !c.grid })); end(); }}>Grid lines</button>{/if}
          <button class="btn" class:on={ch.values} data-testid="chart-values" onclick={() => { chartPatch((c) => ({ values: !c.values })); end(); }}>Values</button>
        </div>
        <div class="row2">
          <NumField label="Text size" value={ch.style.fontSize} min={4} max={200} onchange={(v) => chartPatch((c) => ({ style: { ...c.style, fontSize: v } }), key('cfs'))} onend={end} />
          <ColorField label="Text colour" value={ch.style.color} onchange={(hex) => chartPatch((c) => ({ style: { ...c.style, color: hex } }), key('ctc'))} onend={end} />
        </div>
      </div>

    {:else if ui.panel === 'qr' && gr}
      <form class="body" data-testid="graphic-props" onsubmit={(e) => { e.preventDefault(); ed.updateQr(gr!.id, qrDraft); }}>
        <label class="field"><span>Link or text</span><input class="input" bind:value={qrDraft} data-testid="qr-edit" /></label>
        <button class="btn primary big">Update QR code</button>
        <p class="hint">Change its colours with the swatches in the toolbar.</p>
      </form>

    {:else if ui.panel === 'frame' && fr}
      <div class="body" data-testid="frame-props">
        <label class="field"><span>Frame shape</span>
          <select class="input" value={FRAMES.find((f) => JSON.stringify(f.mask) === JSON.stringify(fr!.mask) && (!!f.radius === fr!.radius > 0 || typeof f.mask !== 'string' || f.mask !== 'rect'))?.id ?? ''}
            onchange={(e) => { const f = FRAMES.find((x) => x.id === (e.currentTarget as HTMLSelectElement).value); if (f) { ed.update({ mask: f.mask, radius: (f.radius ?? 0) * Math.min(fr!.w, fr!.h) }); end(); } }}>
            {#each FRAMES.filter((f) => f.id !== 'polaroid' && f.id !== 'portrait') as f}<option value={f.id}>{f.label}</option>{/each}
          </select>
        </label>
        {#if fr.asset}
          <button class="btn" class:on={ed.framePanId === fr.id} data-testid="frame-move" onclick={() => (ed.framePanId = ed.framePanId === fr!.id ? null : fr!.id)}>{ed.framePanId === fr.id ? 'Done' : 'Move photo inside'}</button>
          <div class="field">
            <span>Zoom · {Math.round(frameZoom * 100)}%</span>
            <input type="range" min="100" max="400" value={Math.round(frameZoom * 100)} data-testid="frame-zoom"
              oninput={(e) => ed.zoomFrame(fr!.id, Number((e.currentTarget as HTMLInputElement).value) / 100, key('fz'))} onchange={end} />
          </div>
          <button class="btn" onclick={() => { ed.update({ asset: '', crop: undefined }); end(); }}>Remove photo</button>
        {:else}
          <p class="hint">Drop a photo (from Uploads, Photos or your computer) onto the frame, or use “Add a photo” in the toolbar.</p>
        {/if}
      </div>

    {:else if ui.panel === 'audio'}
      <div class="scroll-y body">
        {#each ed.doc.audio ?? [] as a (a.id)}
          <div class="snd">
            <b>{a.name ?? 'Audio'}</b>
            <div class="row2">
              <NumField label="Starts at" value={a.start} min={0} step={0.5} suffix="s" onchange={(v) => ed.updateAudio(a.id, { start: v }, `au-s:${a.id}`)} onend={end} />
              <NumField label="Length" value={a.duration} min={0.1} max={ed.doc.assets[a.asset]?.duration ?? 3600} step={0.5} suffix="s" onchange={(v) => ed.updateAudio(a.id, { duration: v }, `au-d:${a.id}`)} onend={end} />
            </div>
            <div class="field">
              <span>Volume · {Math.round((a.volume ?? 1) * 100)}%</span>
              <input type="range" min="0" max="100" value={Math.round((a.volume ?? 1) * 100)} oninput={(e) => ed.updateAudio(a.id, { volume: Number((e.currentTarget as HTMLInputElement).value) / 100 }, `au-v:${a.id}`)} onchange={end} />
            </div>
            <button class="btn danger" onclick={() => ed.removeAudio(a.id)}>Remove sound</button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .tp { display: flex; flex-direction: column; gap: 12px; height: 100%; min-height: 0; }
  header { display: flex; align-items: center; justify-content: space-between; }
  h3 { margin: 0; font-size: 16px; font-weight: 600; }
  .x { width: 32px; height: 32px; display: grid; place-items: center; border: 0; background: none; border-radius: 8px; color: var(--ink-2); }
  .x:hover { background: var(--hover); }
  .body { display: flex; flex-direction: column; gap: 12px; flex: 1; min-height: 0; padding-bottom: 16px; }
  h4 { margin: 6px 0 0; font-size: 14px; font-weight: 600; }
  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-items: end; }
  .row3 { display: grid; grid-template-columns: 1fr auto 1fr; gap: 6px; align-items: end; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .pbtn { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px; border: 0; background: var(--chip); border-radius: 8px; font-weight: 500; color: var(--ink); }
  .pbtn:hover:not(:disabled) { background: var(--hover); }
  .pbtn:disabled { opacity: .45; }
  .toggles { display: flex; gap: 4px; flex-wrap: wrap; }
  .hint { color: var(--muted); font-size: 12px; line-height: 1.5; margin: 0; }
  .swatches { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
  .swatch { aspect-ratio: 1; border-radius: 50%; border: 0; box-shadow: inset 0 0 0 1px rgba(127,127,127,.35); padding: 0; }
  .swatch:hover { transform: scale(1.06); }
  .swatch.on { outline: 2px solid var(--accent); outline-offset: 2px; }
  .swatch.add { display: grid; place-items: center; color: #fff; background: conic-gradient(#ff3131, #ffde59, #7ed957, #38b6ff, #8c52ff, #ff66c4, #ff3131); }
  .csearch { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--field); color: var(--muted); flex-shrink: 0; }
  .csearch:focus-within { border-color: var(--accent); }
  .csearch input { flex: 1; min-width: 0; border: 0; background: none; outline: none; color: var(--ink); }
  .fxgrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .fxgrid.two { grid-template-columns: repeat(3, 1fr); }
  .fx { display: flex; flex-direction: column; align-items: center; gap: 4px; border: 0; background: none; padding: 0; font-size: 12px; color: var(--ink-2); }
  .fxpv { width: 100%; aspect-ratio: 1; display: grid; place-items: center; border-radius: 8px; background: var(--chip); border: 2px solid transparent; font-size: 26px; font-weight: 700; color: var(--ink); }
  .fx.on .fxpv { border-color: var(--accent); }
  .fx:hover .fxpv { background: var(--hover); }
  .fx-shadow { text-shadow: 3px 3px 2px rgba(0,0,0,.45); }
  .fx-lift { text-shadow: 0 4px 8px rgba(0,0,0,.4); }
  .fx-hollow { color: transparent !important; -webkit-text-stroke: 1.2px var(--ink); }
  .fx-splice { color: transparent !important; -webkit-text-stroke: 1.2px var(--ink); text-shadow: 3px 3px 0 #ff66c4; }
  .fx-outline { -webkit-text-stroke: 1.2px #ff66c4; }
  .fx-echo { text-shadow: 3px 3px 0 rgba(127,127,127,.6), 6px 6px 0 rgba(127,127,127,.3); }
  .fx-glitch { text-shadow: -2px 0 #00e0ff, 2px 0 #ff2e63; }
  .fx-neon { color: #ffd6f6 !important; text-shadow: 0 0 6px #ff4fd8, 0 0 12px #ff4fd8; }
  .fx-background { background-image: linear-gradient(#ffde59, #ffde59); background-size: 70% 40%; background-position: center; background-repeat: no-repeat; }
  .field > span { display: flex; align-items: center; gap: 4px; }
  input[type='range'] { width: 100%; }
  .tabs { display: flex; gap: 2px; padding: 3px; background: var(--chip); border-radius: 9px; flex-shrink: 0; }
  .tabs button { flex: 1; border: 0; background: none; border-radius: 7px; padding: 7px 4px; font-size: 13px; font-weight: 600; color: var(--muted); }
  .tabs button.on { background: var(--panel); color: var(--ink); box-shadow: 0 1px 2px rgba(0,0,0,.18); }
  .big { height: 40px; }
  .data { display: grid; gap: 4px; align-items: center; }
  .data .input { height: 30px; padding: 0 6px; font-size: 12px; min-width: 0; }
  .data .x { width: auto; height: auto; font-size: 16px; color: var(--muted); }
  .snd { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; }
  .layers { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .layers li { display: flex; align-items: center; gap: 2px; border-radius: 8px; border: 1px solid var(--line); background: var(--chip); padding-right: 4px; }
  .layers li.sel { border-color: var(--accent); background: var(--accent-soft); }
  .layers li.hidden .lname { opacity: .45; }
  .lname { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; border: 0; background: none; padding: 9px 10px; text-align: left; }
  .lname span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .lbtn { width: 28px; height: 28px; display: grid; place-items: center; border: 0; background: none; border-radius: 6px; color: var(--muted); }
  .lbtn:hover { background: var(--hover); color: var(--ink); }
  .lbtn.fold { width: 22px; margin-left: 4px; }
</style>
