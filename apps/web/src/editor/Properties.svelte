<script lang="ts">
  import { isVideo, pageDuration, type VideoElement } from '@digital-canvas/scene';
  import { formatTime } from '../lib/media.ts';
  import { defaultEffect, formatLength, TEXT_EFFECTS, type Element, type ShapeElement, type Stroke, type TextAlign, type TextEffect, type TextEffectType, type TextElement, type ImageElement } from '@digital-canvas/scene';
  import FontPicker from './FontPicker.svelte';
  import type { EditorState } from '../lib/editor.svelte.ts';
  import Icon, { type IconName } from '../lib/Icon.svelte';
  import ColorField from './ColorField.svelte';
  import NumField from './NumField.svelte';
  import {
    CHARTS, coverCrop, FRAMES, tableAddCol, tableAddRow, tableColWidth, tableRemoveCol, tableRemoveRow, tableSetCell,
    type ChartElement, type LineElement, type LineMarker, type LineRoute, type PathElement, type TableElement,
  } from '@digital-canvas/scene';
  import { pickFiles, IMAGE_TYPES } from '../lib/files.ts';

  let { ed }: { ed: EditorState } = $props();


  const sel = $derived(ed.selected);
  const one = $derived(sel.length === 1 ? sel[0]! : null);
  const texts = $derived(sel.filter((e): e is TextElement => e.type === 'text'));
  const shapes = $derived(sel.filter((e): e is ShapeElement => e.type === 'shape'));
  const images = $derived(sel.filter((e): e is ImageElement => e.type === 'image'));
  const v0 = $derived(sel.find((e): e is VideoElement => e.type === 'video'));
  const v0dur = $derived(v0 ? ed.doc.assets[v0.asset]?.duration ?? 0 : 0);
  const t0 = $derived(texts[0]);
  /** Style of the selected characters while editing, else of the first text box. */
  const ts = $derived(ed.textStyle ?? {});
  const editingSel = $derived(!!ed.editingTextId && !!ed.textSel && ed.textSel.end > ed.textSel.start);

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
  const s0 = $derived(shapes[0]);
  const locked = $derived(sel.some((e) => e.locked));

  const key = (k: string) => `prop:${k}:${ed.selection.join(',')}`;
  const end = () => ed.seal();

  function setGeom(k: 'x' | 'y' | 'w' | 'h' | 'rotation', v: number): void {
    if (!one) return;
    if ((k === 'w' || k === 'h') && one.type === 'line') {
      // a line's ends stretch with its box (a flat side has nothing to stretch)
      const f = k === 'w' ? (one.w ? v / one.w : 1) : (one.h ? v / one.h : 1);
      const end = (e: LineElement['start']) => (k === 'w' ? { ...e, x: e.x * f } : { ...e, y: e.y * f });
      ed.update({ [k]: (k === 'w' ? one.w : one.h) ? v : 0, start: end(one.start), end: end(one.end) }, key(k));
    } else if (k === 'w' && one.type === 'text') {
      ed.update({ w: v, h: ed.renderer.textHeight({ ...one, w: v }) }, key(k));
    } else ed.update({ [k]: k === 'rotation' ? ((v % 360) + 360) % 360 : v } as Partial<Element>, key(k));
  }

  function setShapeFill(hex: string): void {
    ed.update((e) => (e.type === 'shape' ? { fill: { type: 'solid', color: hex } } : {}), key('fill'));
  }

  function setStroke(patch: Partial<Stroke> | null): void {
    ed.update((e) => {
      if (e.type !== 'shape') return {};
      if (patch === null) return { stroke: null };
      return { stroke: { color: '#1f2328', width: 4, dash: 'solid' as const, ...(e.stroke ?? {}), ...patch } };
    }, key('stroke'));
  }

  const ALIGNS: { a: TextAlign; icon: IconName }[] = [
    { a: 'left', icon: 'tl' }, { a: 'center', icon: 'tc' }, { a: 'right', icon: 'tr' }, { a: 'justify', icon: 'tj' },
  ];
  const fillHex = (s: ShapeElement) => (s.fill?.type === 'solid' ? s.fill.color : s.fill?.type === 'linear' ? s.fill.stops[0]?.color ?? '#000000' : '#ffffff');
  const pageBg = $derived(ed.page.background.type === 'solid' ? ed.page.background.color : '#ffffff');

  // ---- M6: lines, tables, charts, graphics, frames ----
  const l0 = $derived(sel.find((e): e is LineElement => e.type === 'line'));
  const tb = $derived(one?.type === 'table' ? one : null);
  const ch = $derived(one?.type === 'chart' ? one : null);
  const gr = $derived(one?.type === 'path' ? one : null);
  const fr = $derived(one?.type === 'image' && one.mask ? one : null);
  const chPie = $derived(ch?.chart === 'pie' || ch?.chart === 'donut');
  const chSeries = $derived(ch ? (chPie ? ch.series.slice(0, 1) : ch.series) : []);
  const MARKERS: { m: LineMarker; label: string }[] = [
    { m: 'none', label: 'None' }, { m: 'arrow', label: 'Arrow' }, { m: 'triangle', label: 'Triangle' }, { m: 'circle', label: 'Circle' }, { m: 'square', label: 'Square' }, { m: 'bar', label: 'Bar' },
  ];
  /** The picked cell when it belongs to the selected table. */
  const cell = $derived(tb && ed.cell?.id === tb.id && tb.cells[ed.cell.r]?.[ed.cell.c] ? ed.cell : null);
  const tableOp = (fn: (t: TableElement) => Partial<TableElement>, k: string | null = null) => tb && ed.tableOp(tb.id, fn, k);
  function chartPatch(fn: (c: ChartElement) => Partial<ChartElement>, k: string | null = null): void {
    ed.update((e) => (e.type === 'chart' ? fn(e) : {}), k);
  }
  /** Distinct solid colours of a graphic (for recolouring). */
  function colorsOf(p: PathElement): string[] {
    const out = new Set<string>();
    for (const part of p.paths) {
      if (part.fill?.type === 'solid') out.add(part.fill.color.slice(0, 7).toLowerCase());
      if (part.stroke) out.add(part.stroke.color.slice(0, 7).toLowerCase());
    }
    return [...out].slice(0, 8);
  }
  let qrDraft = $state('');
  $effect(() => { qrDraft = gr?.qr ?? ''; });
  const frameZoom = $derived.by(() => {
    if (!fr?.asset || !fr.crop) return 1;
    const m = ed.doc.assets[fr.asset];
    return coverCrop(m?.width ?? fr.w, m?.height ?? fr.h, fr.w, fr.h).w / fr.crop.w;
  });
  async function uploadToFrame(id: string): Promise<void> {
    const [f] = await pickFiles(IMAGE_TYPES.join(','), false);
    if (!f) return;
    const asset = await ed.addAsset(new Uint8Array(await f.arrayBuffer()), f.type, f.name);
    if (asset) ed.fillFrame(id, asset);
  }
  const TITLES: Record<string, string> = { text: 'Text', image: 'Image', video: 'Video', shape: 'Shape', path: 'Graphic', line: 'Line', table: 'Table', chart: 'Chart' };
</script>

<aside class="props scroll-y" data-testid="properties" data-text-tools>
  {#if !sel.length}
    <h3>Page {ed.pageIndex + 1}</h3>
    <ColorField label="Background" value={pageBg} testid="page-bg"
      onchange={(hex) => ed.updatePage({ background: { type: 'solid', color: hex } }, 'page-bg')} onend={end} />
    <div class="info">
      <span>Size</span>
      <b>{formatLength(ed.doc.width, ed.doc.unit)} × {formatLength(ed.doc.height, ed.doc.unit)} {ed.doc.unit}</b>
      {#if ed.doc.bleed}<span>Print bleed {formatLength(ed.doc.bleed, 'mm')} mm</span>{/if}
    </div>
    {#if isVideo(ed.doc)}
      <NumField label="Page duration" value={pageDuration(ed.page)} min={0.1} max={3600} step={0.5} suffix="s" testid="page-duration"
        onchange={(v) => ed.updatePage({ duration: v }, 'page-dur')} onend={end} />
      {#if ed.doc.audio?.length}
        <section>
          <h4>Sounds</h4>
          {#each ed.doc.audio as a (a.id)}
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
        </section>
      {/if}
    {:else}
      <button class="btn" data-testid="make-video" onclick={() => { ed.updatePage({ duration: pageDuration(ed.page) }); end(); }}><Icon name="video" size={16} /> Make it a video</button>
    {/if}
    <p class="hint">Click an element to edit it. Drag on empty space to select several. Hold Space and drag to pan, ⌘/Ctrl + scroll to zoom.</p>
  {:else}
    <h3>{one ? (fr ? 'Frame' : gr?.qr !== undefined ? 'QR code' : TITLES[one.type]) : `${sel.length} elements`}</h3>

    {#if t0}
      <section data-text-tools>
        {#if editingSel}<p class="hint sel">Styling the selected text only.</p>{/if}
        <FontPicker {ed} value={ts.fontFamily} />
        <div class="row2">
          <NumField label="Size" value={ts.fontSize ?? t0.style.fontSize} min={4} max={800} step={1} testid="font-size"
            onchange={(v) => ed.updateTextStyle({ fontSize: v }, key('fs'))} onend={end} />
          {#if t0.gradient && !editingSel}
            <button class="btn" onclick={() => setGradient(false)} data-testid="gradient-off">Solid colour</button>
          {:else}
            <ColorField label="Colour" value={ts.color ?? '#000000'} testid="text-color"
              onchange={(hex) => ed.updateTextStyle({ color: hex }, key('tc'))} onend={end} />
          {/if}
        </div>
        {#if t0.gradient && !editingSel}
          <div class="row2">
            <ColorField label="From" value={t0.gradient.stops[0]?.color ?? '#000000'} onchange={(hex) => patchGradient(0, { color: hex })} onend={end} />
            <ColorField label="To" value={t0.gradient.stops[t0.gradient.stops.length - 1]?.color ?? '#000000'} onchange={(hex) => patchGradient(t0!.gradient!.stops.length - 1, { color: hex })} onend={end} />
          </div>
          <NumField label="Gradient angle" value={t0.gradient.angle} min={0} max={360} suffix="°" onchange={(v) => patchGradient(null, { angle: v })} onend={end} />
        {:else if !editingSel}
          <button class="btn link" onclick={() => setGradient(true)} data-testid="gradient-on">Use a gradient</button>
        {/if}
        <div class="toggles">
          <button class="btn icon" class:on={ts.bold} aria-label="Bold" data-testid="bold" onclick={() => { ed.updateTextStyle({ bold: !ts.bold }); end(); }}><Icon name="bold" /></button>
          <button class="btn icon" class:on={ts.italic} aria-label="Italic" data-testid="italic" onclick={() => { ed.updateTextStyle({ italic: !ts.italic }); end(); }}><Icon name="italic" /></button>
          <button class="btn icon" class:on={ts.underline} aria-label="Underline" onclick={() => { ed.updateTextStyle({ underline: !ts.underline }); end(); }}><Icon name="underline" /></button>
          <button class="btn icon" class:on={ts.strike} aria-label="Strikethrough" onclick={() => { ed.updateTextStyle({ strike: !ts.strike }); end(); }}><Icon name="strike" /></button>
          <button class="btn icon" class:on={ts.uppercase} aria-label="Uppercase" onclick={() => { ed.updateTextStyle({ uppercase: !ts.uppercase }); end(); }}><Icon name="caps" /></button>
        </div>
        <div class="toggles">
          {#each ALIGNS as { a, icon }}
            <button class="btn icon" class:on={t0.style.align === a} aria-label="Align {a}" onclick={() => { ed.updateTextStyle({ align: a }); end(); }}><Icon name={icon} /></button>
          {/each}
          <button class="btn icon" class:on={t0.list === 'bullet'} aria-label="Bulleted list" data-testid="list-bullet" onclick={() => { ed.updateText({ list: t0!.list === 'bullet' ? undefined : 'bullet' }); end(); }}><Icon name="listb" /></button>
          <button class="btn icon" class:on={t0.list === 'number'} aria-label="Numbered list" data-testid="list-number" onclick={() => { ed.updateText({ list: t0!.list === 'number' ? undefined : 'number' }); end(); }}><Icon name="listn" /></button>
        </div>
        <div class="row2">
          <NumField label="Line height" value={ts.lineHeight ?? t0.style.lineHeight} min={0.5} max={4} step={0.05}
            onchange={(v) => ed.updateTextStyle({ lineHeight: v }, key('lh'))} onend={end} />
          <NumField label="Letter spacing" value={ts.letterSpacing ?? 0} min={-20} max={200} step={0.5}
            onchange={(v) => ed.updateTextStyle({ letterSpacing: v }, key('ls'))} onend={end} />
        </div>
      </section>
      {#if !editingSel}
        <section data-text-tools>
          <h4>Effects</h4>
          <div class="field">
            <span>Style</span>
            <select class="input" value={t0.effect?.type ?? ''} data-testid="effect" onchange={(e) => setEffect((e.currentTarget as HTMLSelectElement).value as TextEffectType | '')}>
              <option value="">None</option>
              {#each TEXT_EFFECTS as fx}<option value={fx.type}>{fx.label}</option>{/each}
            </select>
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
              <div class="field">
                <span>Colours</span>
                <select class="input" value={fx.colors} onchange={(e) => { patchEffect({ colors: (e.currentTarget as HTMLSelectElement).value }); end(); }}>
                  <option value="blue-red">Blue / red</option><option value="blue-yellow">Blue / yellow</option>
                </select>
              </div>
            {/if}
          {/if}
          <div class="field">
            <span><Icon name="curve" size={14} /> Curve · {t0.curve ?? 0}</span>
            <input type="range" min="-100" max="100" value={t0.curve ?? 0} data-testid="curve"
              oninput={(e) => ed.updateText({ curve: Number((e.currentTarget as HTMLInputElement).value) || undefined }, key('curve'))} onchange={end} />
          </div>
        </section>
      {/if}
    {/if}

    {#if s0}
      <section>
        <div class="row2 end">
          <ColorField label="Fill" value={s0.fill ? fillHex(s0) : '#ffffff'} testid="fill" onchange={setShapeFill} onend={end} />
          <button class="btn" class:on={!s0.fill} onclick={() => { ed.update((e) => (e.type === 'shape' ? { fill: e.fill ? null : { type: 'solid', color: '#8b5cf6' } } : {})); end(); }}>{s0.fill ? 'No fill' : 'Add fill'}</button>
        </div>
        {#if s0.stroke}
          <div class="row2">
            <ColorField label="Border" value={s0.stroke.color} onchange={(hex) => setStroke({ color: hex })} onend={end} />
            <NumField label="Weight" value={s0.stroke.width} min={0} max={200} onchange={(v) => setStroke({ width: v })} onend={end} />
          </div>
          <div class="row2">
            <div class="field">
              <span>Style</span>
              <select class="input" value={s0.stroke.dash ?? 'solid'} onchange={(e) => { setStroke({ dash: (e.currentTarget as HTMLSelectElement).value as Stroke['dash'] }); end(); }}>
                <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
              </select>
            </div>
            <button class="btn danger" onclick={() => { setStroke(null); end(); }}>Remove border</button>
          </div>
        {:else}
          <button class="btn" onclick={() => { setStroke({}); end(); }}>Add border</button>
        {/if}
        {#if s0.shape === 'rect'}
          <NumField label="Corner radius" value={s0.radius} min={0} max={2000} onchange={(v) => ed.update((e) => (e.type === 'shape' ? { radius: v } : {}), key('r'))} onend={end} />
        {/if}
      </section>
    {/if}

    {#if v0}
      <section>
        <div class="toggles">
          <button class="btn" class:on={v0.muted} data-testid="video-mute" onclick={() => { ed.update((e) => (e.type === 'video' ? { muted: !e.muted } : {})); end(); }}>{v0.muted ? 'Unmute' : 'Mute'}</button>
          <button class="btn" class:on={v0.loop} onclick={() => { ed.update((e) => (e.type === 'video' ? { loop: !e.loop } : {})); end(); }}>Loop</button>
        </div>
        <div class="row2">
          <NumField label="Trim start" value={v0.trimStart ?? 0} min={0} max={v0dur} step={0.1} suffix="s" testid="trim-start"
            onchange={(v) => ed.update((e) => (e.type === 'video' ? { trimStart: v } : {}), key('ts'))} onend={end} />
          <NumField label="Trim end" value={v0.trimEnd ?? v0dur} min={0} max={v0dur} step={0.1} suffix="s"
            onchange={(v) => ed.update((e) => (e.type === 'video' ? { trimEnd: v } : {}), key('te'))} onend={end} />
        </div>
        <div class="field">
          <span>Volume · {Math.round((v0.volume ?? 1) * 100)}%</span>
          <input type="range" min="0" max="100" value={Math.round((v0.volume ?? 1) * 100)} oninput={(e) => ed.update((x) => (x.type === 'video' ? { volume: Number((e.currentTarget as HTMLInputElement).value) / 100 } : {}), key('vol'))} onchange={end} />
        </div>
        <p class="hint">Clip length {formatTime(v0dur, true)}. It plays from the start of its page.</p>
      </section>
    {/if}

    {#if l0}
      <section data-testid="line-props">
        <div class="row2">
          <ColorField label="Colour" value={l0.stroke.color} testid="line-color" onchange={(hex) => ed.updateLine({ stroke: { ...l0!.stroke, color: hex } }, key('lc'))} onend={end} />
          <NumField label="Weight" value={l0.stroke.width} min={0.5} max={100} step={0.5} testid="line-width" onchange={(v) => ed.updateLine({ stroke: { ...l0!.stroke, width: v } }, key('lw'))} onend={end} />
        </div>
        <div class="row2">
          <label class="field"><span>Style</span>
            <select class="input" value={l0.stroke.dash ?? 'solid'} onchange={(e) => { ed.updateLine({ stroke: { ...l0!.stroke, dash: (e.currentTarget as HTMLSelectElement).value as Stroke['dash'] } }); end(); }}>
              <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
            </select>
          </label>
          <label class="field"><span>Type</span>
            <select class="input" value={l0.route} data-testid="line-route" onchange={(e) => { ed.updateLine({ route: (e.currentTarget as HTMLSelectElement).value as LineRoute }); end(); }}>
              <option value="straight">Straight</option><option value="elbow">Elbow</option><option value="curved">Curved</option>
            </select>
          </label>
        </div>
        <div class="row2">
          <label class="field"><span>Start</span>
            <select class="input" value={l0.start.marker} data-testid="line-start" onchange={(e) => { ed.updateLine({ startMarker: (e.currentTarget as HTMLSelectElement).value as LineMarker }); end(); }}>
              {#each MARKERS as m}<option value={m.m}>{m.label}</option>{/each}
            </select>
          </label>
          <label class="field"><span>End</span>
            <select class="input" value={l0.end.marker} data-testid="line-end" onchange={(e) => { ed.updateLine({ endMarker: (e.currentTarget as HTMLSelectElement).value as LineMarker }); end(); }}>
              {#each MARKERS as m}<option value={m.m}>{m.label}</option>{/each}
            </select>
          </label>
        </div>
        <p class="hint">{l0.start.attach || l0.end.attach ? 'Connected: it follows the elements it is stuck to.' : 'Drag an end onto a shape to connect it.'}</p>
      </section>
    {/if}

    {#if tb}
      <section data-testid="table-props">
        <h4>Table · {tb.rows.length} × {tb.cols.length}</h4>
        <div class="toggles">
          <button class="btn" data-testid="row-add" onclick={() => { tableOp((t) => tableAddRow(t, cell?.r ?? t.rows.length - 1)); end(); }}>+ Row</button>
          <button class="btn" data-testid="row-remove" disabled={tb.rows.length < 2} onclick={() => { tableOp((t) => tableRemoveRow(t, cell?.r ?? t.rows.length - 1)); ed.cell = null; end(); }}>− Row</button>
          <button class="btn" data-testid="col-add" onclick={() => { tableOp((t) => tableAddCol(t, cell?.c ?? t.cols.length - 1)); end(); }}>+ Column</button>
          <button class="btn" data-testid="col-remove" disabled={tb.cols.length < 2} onclick={() => { tableOp((t) => tableRemoveCol(t, cell?.c ?? t.cols.length - 1)); ed.cell = null; end(); }}>− Column</button>
        </div>
        {#if cell}
          {@const c = tb.cells[cell.r]![cell.c]!}
          <h4>Cell (row {cell.r + 1}, column {cell.c + 1})</h4>
          <div class="row2 end">
            <ColorField label="Cell colour" value={c.fill ?? '#ffffff'} testid="cell-fill" onchange={(hex) => tableOp((t) => tableSetCell(t, cell!.r, cell!.c, { fill: hex }), key('cf'))} onend={end} />
            <button class="btn" disabled={!c.fill} onclick={() => { tableOp((t) => { const n = tableSetCell(t, cell!.r, cell!.c, {}); delete n.cells![cell!.r]![cell!.c]!.fill; return n; }); end(); }}>No colour</button>
          </div>
          <div class="toggles">
            <button class="btn icon" class:on={c.style?.bold ?? tb.style.bold} aria-label="Bold cell" onclick={() => { tableOp((t) => tableSetCell(t, cell!.r, cell!.c, { style: { ...c.style, bold: !(c.style?.bold ?? t.style.bold) } })); end(); }}><Icon name="bold" /></button>
            {#each ALIGNS.slice(0, 3) as { a, icon }}
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
      </section>
    {/if}

    {#if ch}
      <section data-testid="chart-props">
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
        <div class="swatches">
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
      </section>
    {/if}

    {#if gr}
      <section data-testid="graphic-props">
        {#if gr.qr !== undefined}
          <form class="field" onsubmit={(e) => { e.preventDefault(); ed.updateQr(gr!.id, qrDraft); }}>
            <span>Link or text</span>
            <input class="input" bind:value={qrDraft} data-testid="qr-edit" />
            <button class="btn">Update QR code</button>
          </form>
        {/if}
        <h4>Colours</h4>
        <div class="swatches">
          {#each colorsOf(gr) as c, i (i)}
            <ColorField label="Colour {i + 1}" value={c} testid="graphic-color-{i}" onchange={(hex) => ed.recolor(c, hex, key(`rc${i}`))} onend={end} />
          {/each}
        </div>
      </section>
    {/if}

    {#if fr}
      <section data-testid="frame-props">
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
          <button class="btn primary" data-testid="frame-upload" onclick={() => uploadToFrame(fr!.id)}><Icon name="upload" size={16} /> Add a photo</button>
          <p class="hint">Or drop a photo (from Uploads, Photos or your computer) onto the frame.</p>
        {/if}
      </section>
    {/if}

    {#if images.length && images[0] && !fr}
      <section>
        <NumField label="Corner radius" value={images[0].radius} min={0} max={2000} onchange={(v) => ed.update((e) => (e.type === 'image' ? { radius: v } : {}), key('ir'))} onend={end} />
        <p class="hint">Crop, filters, adjustments and background remover arrive in milestone 4.</p>
      </section>
    {/if}

    <section>
      <h4>Position</h4>
      {#if one}
        <div class="row2">
          <NumField label="X" value={one.x} onchange={(v) => setGeom('x', v)} onend={end} testid="pos-x" />
          <NumField label="Y" value={one.y} onchange={(v) => setGeom('y', v)} onend={end} testid="pos-y" />
        </div>
        <div class="row2">
          <NumField label="Width" value={one.w} min={1} onchange={(v) => setGeom('w', v)} onend={end} testid="pos-w" />
          <NumField label="Height" value={one.h} min={1} onchange={(v) => setGeom('h', v)} onend={end} testid="pos-h" />
        </div>
        <NumField label="Rotation" value={one.rotation} suffix="°" onchange={(v) => setGeom('rotation', v)} onend={end} testid="rotation" />
      {/if}
      <div class="field">
        <span>Transparency · {Math.round((one?.opacity ?? 1) * 100)}%</span>
        <input type="range" min="0" max="100" value={Math.round((sel[0]?.opacity ?? 1) * 100)} data-testid="opacity"
          oninput={(e) => ed.update({ opacity: Number((e.currentTarget as HTMLInputElement).value) / 100 }, key('op'))} onchange={end} />
      </div>
      <div class="toggles">
        <button class="btn icon" title="Align left" aria-label="Align left" onclick={() => ed.align('left')}><Icon name="alignl" /></button>
        <button class="btn icon" title="Align centre" aria-label="Align centre" onclick={() => ed.align('center')}><Icon name="alignc" /></button>
        <button class="btn icon" title="Align right" aria-label="Align right" onclick={() => ed.align('right')}><Icon name="alignr" /></button>
        <button class="btn icon" title="Align top" aria-label="Align top" onclick={() => ed.align('top')}><Icon name="alignt" /></button>
        <button class="btn icon" title="Align middle" aria-label="Align middle" onclick={() => ed.align('middle')}><Icon name="alignm" /></button>
        <button class="btn icon" title="Align bottom" aria-label="Align bottom" onclick={() => ed.align('bottom')}><Icon name="alignb" /></button>
      </div>
      <div class="toggles">
        <button class="btn icon" title="Bring to front" aria-label="Bring to front" onclick={() => ed.arrange('front')}><Icon name="front" /></button>
        <button class="btn icon" title="Forward" aria-label="Forward" onclick={() => ed.arrange('forward')}><Icon name="up" /></button>
        <button class="btn icon" title="Backward" aria-label="Backward" onclick={() => ed.arrange('backward')}><Icon name="down" /></button>
        <button class="btn icon" title="Send to back" aria-label="Send to back" onclick={() => ed.arrange('back')}><Icon name="back" /></button>
        <button class="btn icon" title="Flip horizontal" aria-label="Flip horizontal" onclick={() => { ed.update((e) => ({ flipX: !e.flipX })); end(); }}><Icon name="flipx" /></button>
        <button class="btn icon" title="Flip vertical" aria-label="Flip vertical" onclick={() => { ed.update((e) => ({ flipY: !e.flipY })); end(); }}><Icon name="flipy" /></button>
      </div>
    </section>

    <section class="actions">
      <button class="btn" class:on={locked} onclick={() => { ed.update({ locked: !locked }); end(); }}><Icon name={locked ? 'lock' : 'unlock'} size={16} /> {locked ? 'Unlock' : 'Lock'}</button>
      <button class="btn" onclick={() => ed.duplicateSelection()}><Icon name="copy" size={16} /> Duplicate</button>
      <button class="btn danger" onclick={() => ed.deleteSelection()} data-testid="delete"><Icon name="trash" size={16} /> Delete</button>
    </section>
  {/if}
</aside>

<style>
  .props { width: 288px; flex-shrink: 0; background: var(--panel); border-left: 1px solid var(--line); padding: 16px; display: flex; flex-direction: column; gap: 14px; }
  h3 { margin: 0; font-size: 15px; }
  h4 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
  section { display: flex; flex-direction: column; gap: 10px; padding-top: 14px; border-top: 1px solid var(--line); }
  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-items: end; }
  .row2.end { align-items: end; }
  .toggles { display: flex; gap: 4px; flex-wrap: wrap; }
  .actions { flex-direction: row; flex-wrap: wrap; gap: 6px; }
  .info { display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
  .info span { color: var(--muted); font-size: 12px; }
  .hint { color: var(--muted); font-size: 12px; line-height: 1.5; margin: 0; }
  .snd { display: flex; flex-direction: column; gap: 8px; padding: 8px; border: 1px solid var(--line); border-radius: 8px; }
  .hint.sel { color: var(--accent); font-weight: 600; }
  .data { display: grid; gap: 4px; align-items: center; }
  .data .input { height: 30px; padding: 0 6px; font-size: 12px; min-width: 0; }
  .data .x { border: 0; background: none; color: var(--muted); font-size: 16px; padding: 0; }
  .data .x:hover:not(:disabled) { color: var(--danger); }
  .swatches { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .btn.link { border: 0; background: none; color: var(--accent); padding: 0; height: auto; justify-content: flex-start; font-size: 12px; }
  .field > span { display: flex; align-items: center; gap: 4px; }
  input[type='range'] { accent-color: var(--accent); width: 100%; }
</style>
