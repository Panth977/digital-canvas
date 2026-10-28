<script lang="ts">
  import {
    isVideo, pageDuration, formatLength, TRANSITIONS, type TransitionType,
    type Element, type ImageElement, type LineElement, type LineMarker, type LineRoute, type ShapeElement, type Stroke, type TextAlign, type TextElement, type VideoElement,
  } from '@digital-canvas/scene';
  import type { EditorState } from '../lib/editor.svelte.ts';
  import Icon, { type IconName } from '../lib/Icon.svelte';
  import { ui, type ColorTarget } from '../lib/ui.svelte.ts';
  import { formatTime } from '../lib/media.ts';
  import { pickFiles, IMAGE_TYPES } from '../lib/files.ts';
  import ColorField from './ColorField.svelte';
  import NumField from './NumField.svelte';
  import { FONT_SIZES, parseSize } from '../lib/uiutil.ts';
  import { copyStyle, pasteStyle } from '../lib/copystyle.ts';
  import { animationLabel } from '@digital-canvas/scene';
  import { untrack } from 'svelte';

  /**
   * Canva's contextual toolbar: a floating bar at the top of the workspace
   * whose controls follow what is selected. Bigger tools open in the left panel.
   */
  let { ed }: { ed: EditorState } = $props();

  const sel = $derived(ed.selected);
  const one = $derived(sel.length === 1 ? sel[0]! : null);
  const texts = $derived(sel.filter((e): e is TextElement => e.type === 'text'));
  const t0 = $derived(texts[0]);
  const ts = $derived(ed.textStyle ?? {});
  const editingSel = $derived(!!ed.editingTextId && !!ed.textSel && ed.textSel.end > ed.textSel.start);
  const s0 = $derived(sel.find((e): e is ShapeElement => e.type === 'shape'));
  const l0 = $derived(sel.find((e): e is LineElement => e.type === 'line'));
  const v0 = $derived(sel.find((e): e is VideoElement => e.type === 'video'));
  const v0dur = $derived(v0 ? ed.doc.assets[v0.asset]?.duration ?? 0 : 0);
  const pic = $derived(sel.find((e): e is ImageElement | VideoElement => e.type === 'image' || e.type === 'video'));
  const fr = $derived(one?.type === 'image' && one.mask ? one : null);
  const gr = $derived(one?.type === 'path' ? one : null);
  const locked = $derived(sel.some((e) => e.locked));
  const groups = $derived(sel.filter((e) => e.type === 'group'));

  type Kind = 'page' | 'text' | 'image' | 'video' | 'frame' | 'shape' | 'line' | 'table' | 'chart' | 'graphic' | 'qr' | 'group' | 'multi';
  const kind = $derived.by((): Kind => {
    if (!sel.length) return 'page';
    if (texts.length === sel.length) return 'text';
    if (!one) return 'multi';
    if (one.type === 'image') return one.mask ? 'frame' : 'image';
    if (one.type === 'path') return one.qr !== undefined ? 'qr' : 'graphic';
    return one.type as Kind;
  });

  const key = (k: string) => `prop:${k}:${ed.selection.join(',')}`;
  const end = () => ed.seal();
  const owner = $derived(ed.selection.join(','));

  function color(t: Omit<ColorTarget, 'owner' | 'onend'> & { onend?: () => void }): void {
    if (ui.panel === 'color' && ui.color?.title === t.title && ui.color.owner === owner) return ui.close();
    ui.openColor({ onend: end, ...t, owner });
  }

  function togglePop(name: string): void {
    ui.pop = ui.pop === name ? null : name;
  }
  function onWindowDown(e: PointerEvent): void {
    if (ui.pop && !(e.target as HTMLElement | null)?.closest?.('.pw, [data-more]')) ui.pop = null;
  }

  // ---- text ----
  const ALIGNS: { a: TextAlign; icon: IconName; label: string }[] = [
    { a: 'left', icon: 'tl', label: 'Align left' }, { a: 'center', icon: 'tc', label: 'Align centre' }, { a: 'right', icon: 'tr', label: 'Align right' }, { a: 'justify', icon: 'tj', label: 'Justify' },
  ];
  const align = $derived(ALIGNS.find((x) => x.a === (ts.align ?? t0?.style.align)) ?? ALIGNS[0]!);
  const size = $derived(ts.fontSize ?? t0?.style.fontSize ?? 0);
  /** What the size box shows: Canva keeps what you type until Enter or click-away. */
  let sizeDraft = $state('');
  let sizeFocused = $state(false);
  const sizeText = $derived(ts.fontSize === undefined && texts.length && !t0 ? '' : String(Math.round(size * 10) / 10));
  $effect(() => { const v = sizeText; if (!untrack(() => sizeFocused)) sizeDraft = v; });
  function setSize(v: number): void {
    if (!Number.isFinite(v) || v <= 0) return;
    ed.updateTextStyle({ fontSize: Math.max(1, Math.min(800, v)) }, key('fs'));
  }
  function commitSize(): void {
    const v = parseSize(sizeDraft);
    if (v !== null && v !== Math.round(size * 10) / 10) { setSize(v); end(); }
    sizeDraft = sizeText;
  }
  function bump(d: number): void {
    setSize(Math.max(1, Math.round(size) + d));
    end();
  }
  function sizeKey(e: KeyboardEvent): void {
    const el = e.currentTarget as HTMLInputElement;
    if (e.key === 'Enter') { commitSize(); ui.pop = null; el.blur(); }
    else if (e.key === 'Escape') { e.stopPropagation(); sizeDraft = sizeText; ui.pop = null; el.blur(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); bump(e.key === 'ArrowUp' ? 1 : -1); sizeDraft = String(Math.round(size)); }
  }

  /** Every colour in the selected text (runs too): several make a striped bar, like Canva. */
  const textColors = $derived.by(() => {
    if (editingSel) return [ts.color ?? '#000000'];
    const out: string[] = [];
    for (const t of texts) {
      const runs = t.runs?.filter((r) => r.text.length);
      const cs = runs?.length ? runs.map((r) => r.style?.color ?? t.style.color) : [t.style.color];
      for (const c of cs) if (c && !out.includes(c.slice(0, 7).toLowerCase())) out.push(c.slice(0, 7).toLowerCase());
    }
    return out.length ? out.slice(0, 6) : ['#000000'];
  });
  const stripes = (cs: string[]) => cs.length === 1 ? cs[0]! : `linear-gradient(90deg, ${cs.map((c, i) => `${c} ${(i / cs.length) * 100}% ${((i + 1) / cs.length) * 100}%`).join(', ')})`;

  /** Bold / italic need a face of the font that has them (Canva greys the button out). */
  const faces = $derived.by(() => {
    void ed.doc.fonts;
    const fam = ts.fontFamily;
    const fs = fam ? ed.engine.fonts.faces.filter((f) => f.family === fam) : [];
    return { known: fs.length > 0, bold: fs.some((f) => f.weight >= 600), italic: fs.some((f) => f.italic) };
  });
  const noBold = $derived(faces.known && !faces.bold && !ts.bold);
  const noItalic = $derived(faces.known && !faces.italic && !ts.italic);
  const textColor = () => ed.textStyle?.color ?? '#000000';
  const textBar = $derived(t0?.gradient && !editingSel ? `linear-gradient(90deg, ${t0.gradient.stops.map((s) => s.color).join(', ')})` : stripes(textColors));

  // ---- shapes / lines ----
  const fillHex = (s: ShapeElement) => (s.fill?.type === 'solid' ? s.fill.color : s.fill?.type === 'linear' ? s.fill.stops[0]?.color ?? '#000000' : '#ffffff');
  function setStroke(patch: Partial<Stroke> | null): void {
    ed.update((e) => {
      if (e.type !== 'shape') return {};
      if (patch === null) return { stroke: null };
      return { stroke: { color: '#1f2328', width: 4, dash: 'solid' as const, ...(e.stroke ?? {}), ...patch } };
    }, key('stroke'));
  }
  const MARKERS: { m: LineMarker; label: string }[] = [
    { m: 'none', label: 'None' }, { m: 'arrow', label: 'Arrow' }, { m: 'triangle', label: 'Triangle' }, { m: 'circle', label: 'Circle' }, { m: 'square', label: 'Square' }, { m: 'bar', label: 'Bar' },
  ];

  // ---- graphics ----
  function colorsOf(p: Extract<Element, { type: 'path' }>): string[] {
    const out = new Set<string>();
    for (const part of p.paths) {
      if (part.fill?.type === 'solid') out.add(part.fill.color.slice(0, 7).toLowerCase());
      if (part.stroke) out.add(part.stroke.color.slice(0, 7).toLowerCase());
    }
    return [...out].slice(0, 8);
  }
  /** Recolouring changes the colour list, so the panel keeps the slot's latest colour. */
  function graphicColor(i: number, c: string): void {
    let cur = c;
    color({ title: 'Colour', testid: `graphic-color-${i}`, value: () => cur, onchange: (hex) => { ed.recolor(cur, hex, key(`rc${i}`)); cur = hex; } });
  }

  async function uploadToFrame(id: string): Promise<void> {
    const [f] = await pickFiles(IMAGE_TYPES.join(','), false);
    if (!f) return;
    const asset = await ed.addAsset(new Uint8Array(await f.arrayBuffer()), f.type, f.name);
    if (asset) ed.fillFrame(id, asset);
  }

  // ---- page ----
  const pageBg = () => (ed.page.background.type === 'solid' ? ed.page.background.color : '#ffffff');
  const pageBgShown = $derived(ed.page.background.type === 'solid' ? ed.page.background.color : '#ffffff');

  // ---- copy style (the paint roller): arm it, then the next element picked gets the look ----
  function armStyle(): void {
    if (ui.styleClip) { ui.styleClip = null; return; }
    const src = sel[0];
    if (src) ui.styleClip = { style: copyStyle($state.snapshot(src) as Element), source: ed.selection.join(',') };
    ui.pop = null;
  }
  $effect(() => {
    const ids = ed.selection;
    const clip = untrack(() => ui.styleClip);
    if (!clip || !ids.length || ids.join(',') === clip.source) return;
    untrack(() => {
      ui.styleClip = null;
      ed.update((e) => pasteStyle(clip.style, e), null, ids);
      ed.refitText();
      ed.seal();
    });
  });

  // ---- overflow: when the bar is too wide, the less used tools go into "…" (Canva) ----
  // level 1: Lock moves into "…"; level 2: Copy style and Transparency; level 3: Effects, Animate, Position.
  let bar = $state<HTMLElement>();
  let level = $state(0);
  const compact = $derived(level >= 2);
  let need: number[] = [];
  let raf = 0;
  function check(): void {
    const el = bar;
    if (!el?.parentElement) return;
    const room = el.parentElement.clientWidth - 24;
    if (el.scrollWidth > el.clientWidth + 1 && level < 3) { need[level] = el.scrollWidth; level++; again(); }
    else if (level > 0 && need[level - 1] && room >= need[level - 1]!) { level--; again(); }
  }
  function again(): void { cancelAnimationFrame(raf); raf = requestAnimationFrame(check); }
  $effect(() => {
    const el = bar;
    if (!el?.parentElement) return;
    const ro = new ResizeObserver(again);
    ro.observe(el.parentElement);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  });
  // a new kind of selection measures again
  $effect(() => { void kind; void sel.length; void editingSel; untrack(() => { level = 0; need = []; again(); }); });

  const animated = $derived(sel.length ? sel.some((e) => e.animation) : !!ed.page.animation);

  const TITLES: Record<Kind, string> = { page: 'Page', text: 'Text', image: 'Image', video: 'Video', frame: 'Frame', shape: 'Shape', line: 'Line', table: 'Table', chart: 'Chart', graphic: 'Graphic', qr: 'QR code', group: 'Group', multi: 'Selection' };
  const opacity = $derived(Math.round((sel[0]?.opacity ?? 1) * 100));
</script>

<svelte:window onpointerdown={onWindowDown} />

<div class="ctx" bind:this={bar} class:compact class:tight={level >= 3} role="toolbar" tabindex="-1" aria-label="{TITLES[kind]} toolbar" data-testid="context-toolbar" data-kind={kind} data-compact={level} data-text-tools data-tips>
  {#if kind === 'page'}
    <button class="sw" title="Background colour" aria-label="Background colour" data-testid="page-bg-btn" style="--c:{pageBgShown}"
      onclick={() => color({ title: 'Background colour', testid: 'page-bg', kind: 'page', value: pageBg, onchange: (hex) => ed.updatePage({ background: { type: 'solid', color: hex } }, 'page-bg') })}><i></i></button>
    <span class="info">{formatLength(ed.doc.width, ed.doc.unit)} × {formatLength(ed.doc.height, ed.doc.unit)} {ed.doc.unit}{#if ed.doc.bleed}&nbsp;· bleed {formatLength(ed.doc.bleed, 'mm')} mm{/if}</span>
    <span class="sep"></span>
    {#if isVideo(ed.doc)}
      <label class="dur" title="Page duration">
        <Icon name="play" size={14} />
        <input type="number" min="0.1" max="3600" step="0.5" value={pageDuration(ed.page)} aria-label="Page duration" data-testid="page-duration"
          oninput={(e) => { const v = Number((e.currentTarget as HTMLInputElement).value); if (v > 0) ed.updatePage({ duration: Math.min(3600, Math.max(0.1, v)) }, 'page-dur'); }} onchange={end} />
        <em>s</em>
      </label>
      {#if ed.pageIndex > 0}
        <label class="dur" title="Transition into this scene">
          <Icon name="bolt" size={14} />
          <select value={ed.page.transition?.type ?? ''} aria-label="Transition" data-testid="page-transition"
            onchange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value as TransitionType | ''; ed.updatePage({ transition: v ? { type: v, ...(TRANSITIONS.find((t) => t.type === v)?.directional ? { direction: ed.page.transition?.direction ?? 'right' } : {}) } : undefined }); end(); }}>
            <option value="">No transition</option>
            {#each TRANSITIONS as t (t.type)}<option value={t.type}>{t.label}</option>{/each}
          </select>
        </label>
      {/if}
      {#if ed.doc.audio?.length}
        <button class="tb" class:on={ui.panel === 'audio'} data-testid="sounds-btn" onclick={() => ui.open('audio')}><Icon name="music" size={16} /> Sounds</button>
      {/if}
    {:else}
      <button class="tb" data-testid="make-video" onclick={() => { ed.updatePage({ duration: pageDuration(ed.page) }); end(); }}><Icon name="video" size={16} /> Make it a video</button>
    {/if}
    <button class="tb" class:on={ui.panel === 'animate'} class:set={animated} title="Animate the page" data-testid="animate-btn" onclick={() => ui.open('animate')}><Icon name="animate" size={16} /> {ed.page.animation ? animationLabel(ed.page.animation) : 'Animate'}</button>
    <button class="tb" class:on={ui.panel === 'position'} title="Layers" data-testid="layers-btn" onclick={() => { ui.positionTab = 'layers'; ui.open('position'); }}><Icon name="layers" size={16} /> Layers</button>
  {:else}
    {#if kind === 'text' && t0}
      <button class="tb font" class:on={ui.panel === 'font'} data-testid="font-picker" title="Font" aria-label="Font: {ts.fontFamily ?? 'Mixed'}" onclick={() => ui.open('font')}
        style="font-family:'{ts.fontFamily ?? 'Inter'}', Inter, sans-serif">
        <span>{ts.fontFamily ?? 'Mixed'}</span>
        {#if ed.fontLoading}<span class="spin"></span>{:else}<Icon name="down" size={14} />{/if}
      </button>
      <div class="size pw">
        <button title="Decrease font size (⇧⌘,)" aria-label="Decrease font size" data-testid="font-size-down" onclick={() => bump(-1)}><Icon name="minus" size={14} /></button>
        <input type="text" inputmode="decimal" bind:value={sizeDraft} placeholder="–" aria-label="Font size" title="Font size" data-testid="font-size" role="combobox" aria-expanded={ui.pop === 'fsize'} aria-controls="fsize-list"
          onfocus={(e) => { sizeFocused = true; (e.currentTarget as HTMLInputElement).select(); ui.pop = 'fsize'; requestAnimationFrame(() => document.querySelector('#fsize-list button.on')?.scrollIntoView({ block: 'center' })); }}
          onblur={() => { sizeFocused = false; commitSize(); }} onkeydown={sizeKey} />
        <button title="Increase font size (⇧⌘.)" aria-label="Increase font size" data-testid="font-size-up" onclick={() => bump(1)}><Icon name="plus" size={14} /></button>
        {#if ui.pop === 'fsize'}
          <ul class="pop sizes" id="fsize-list" role="listbox" aria-label="Font sizes" data-testid="font-size-list">
            {#each FONT_SIZES as n (n)}
              <li role="option" aria-selected={Math.round(size) === n}><button class:on={Math.round(size) === n} data-testid="font-size-{n}" onpointerdown={(e) => e.preventDefault()} onclick={() => { setSize(n); end(); sizeDraft = String(n); ui.pop = null; }}>{n}</button></li>
            {/each}
          </ul>
        {/if}
      </div>
      <button class="ib tcolor" class:on={ui.panel === 'color' && ui.color?.kind === 'text'} title="Text colour" aria-label="Text colour" data-testid="text-color-btn"
        onclick={() => color({ title: 'Text colour', testid: 'text-color', kind: 'text', value: textColor, onchange: (hex) => ed.updateTextStyle({ color: hex }, key('tc')) })}>
        <b>A</b><i style="background:{textBar}" data-testid="text-color-bar" data-colors={textColors.length}></i>
      </button>
      <button class="ib" class:on={ts.bold} disabled={noBold} title={noBold ? `${ts.fontFamily} has no bold` : 'Bold (⌘B)'} aria-label="Bold" data-testid="bold" onclick={() => { ed.updateTextStyle({ bold: !ts.bold }); end(); }}><Icon name="bold" /></button>
      <button class="ib" class:on={ts.italic} disabled={noItalic} title={noItalic ? `${ts.fontFamily} has no italic` : 'Italic (⌘I)'} aria-label="Italic" data-testid="italic" onclick={() => { ed.updateTextStyle({ italic: !ts.italic }); end(); }}><Icon name="italic" /></button>
      <button class="ib" class:on={ts.underline} title="Underline (⌘U)" aria-label="Underline" data-testid="underline" onclick={() => { ed.updateTextStyle({ underline: !ts.underline }); end(); }}><Icon name="underline" /></button>
      <button class="ib" class:on={ts.strike} title="Strikethrough (⇧⌘X)" aria-label="Strikethrough" data-testid="strike" onclick={() => { ed.updateTextStyle({ strike: !ts.strike }); end(); }}><Icon name="strike" /></button>
      <button class="ib case" class:on={ts.uppercase} title="Uppercase (⇧⌘K)" aria-label="Uppercase" data-testid="uppercase" onclick={() => { ed.updateTextStyle({ uppercase: !ts.uppercase }); end(); }}>aA</button>
      <button class="ib" title="Alignment: {align.label.toLowerCase().replace('align ', '')}" aria-label={align.label} data-testid="align"
        onclick={() => { const n = ALIGNS[(ALIGNS.indexOf(align) + 1) % ALIGNS.length]!; ed.updateTextStyle({ align: n.a }); end(); }}><Icon name={align.icon} /></button>
      <button class="ib" class:on={!!t0.list} title={t0.list === 'bullet' ? 'Bulleted list (⇧⌘8)' : t0.list === 'number' ? 'Numbered list (⇧⌘7)' : 'List (⇧⌘8)'} aria-label="List" data-testid="list"
        onclick={() => { ed.updateText({ list: !t0!.list ? 'bullet' : t0!.list === 'bullet' ? 'number' : undefined }); end(); }}><Icon name={t0.list === 'number' ? 'listn' : 'listb'} /></button>
      <div class="pw">
        <button class="ib" class:on={ui.pop === 'spacing'} title="Spacing" aria-label="Spacing" data-testid="spacing-btn" onclick={() => togglePop('spacing')}><Icon name="spacing" /></button>
        {#if ui.pop === 'spacing'}
          <div class="pop">
            <div class="slider">
              <span>Letter spacing</span>
              <input type="range" min="-20" max="200" step="0.5" value={ts.letterSpacing ?? 0} data-testid="letter-spacing"
                oninput={(e) => ed.updateTextStyle({ letterSpacing: Number((e.currentTarget as HTMLInputElement).value) }, key('ls'))} onchange={end} />
              <input class="input n" type="number" min="-20" max="200" step="0.5" value={ts.letterSpacing ?? 0} aria-label="Letter spacing value"
                oninput={(e) => ed.updateTextStyle({ letterSpacing: Number((e.currentTarget as HTMLInputElement).value) }, key('ls'))} onchange={end} />
            </div>
            <div class="slider">
              <span>Line spacing</span>
              <input type="range" min="0.5" max="4" step="0.05" value={ts.lineHeight ?? t0.style.lineHeight} data-testid="line-height"
                oninput={(e) => ed.updateTextStyle({ lineHeight: Number((e.currentTarget as HTMLInputElement).value) }, key('lh'))} onchange={end} />
              <input class="input n" type="number" min="0.5" max="4" step="0.05" value={ts.lineHeight ?? t0.style.lineHeight} aria-label="Line spacing value"
                oninput={(e) => ed.updateTextStyle({ lineHeight: Number((e.currentTarget as HTMLInputElement).value) }, key('lh'))} onchange={end} />
            </div>
            <div class="anchor">
              <span>Anchor text box</span>
              <div class="seg" role="radiogroup" aria-label="Anchor text box">
                {#each [{ a: 'top', icon: 'alignt', label: 'Top' }, { a: 'middle', icon: 'alignm', label: 'Middle' }, { a: 'bottom', icon: 'alignb', label: 'Bottom' }] as const as o (o.a)}
                  <button role="radio" aria-checked={(t0.anchor ?? 'top') === o.a} class:on={(t0.anchor ?? 'top') === o.a} title="Anchor to the {o.label.toLowerCase()}" aria-label={o.label} data-testid="anchor-{o.a}"
                    onclick={() => { ed.updateText({ anchor: o.a === 'top' ? undefined : o.a }); end(); }}><Icon name={o.icon} size={16} /></button>
                {/each}
              </div>
            </div>
          </div>
        {/if}
      </div>
      {#if level < 3}<span class="sep"></span>{/if}
      {#if !editingSel}
        <button class="tb" class:gone={level >= 3} class:on={ui.panel === 'effects'} title="Effects" data-testid="effects-btn" onclick={() => ui.open('effects')}>Effects</button>
      {/if}
    {/if}

    {#if (kind === 'image' || kind === 'video' || (kind === 'frame' && fr?.asset)) && pic}
      <button class="tb" class:on={ui.panel === 'image'} title="Edit image" data-testid="edit-image" onclick={() => ui.open('image')}><Icon name="sliders" size={16} /> Edit</button>
      <button class="tb" class:on={ed.croppingId === pic.id} title="Crop" data-testid="crop" disabled={pic.locked}
        onclick={() => (ed.croppingId === pic!.id ? ed.stopCrop() : ed.startCrop(pic!.id))}><Icon name="crop" size={16} /> {ed.croppingId === pic.id ? 'Done' : 'Crop'}</button>
      <div class="pw">
        <button class="tb" class:on={ui.pop === 'flip'} title="Flip" data-testid="flip-btn" onclick={() => togglePop('flip')}><Icon name="flipx" size={16} /> Flip</button>
        {#if ui.pop === 'flip'}
          <div class="pop menu">
            <button onclick={() => { ed.update((e) => ({ flipX: !e.flipX })); end(); }}><Icon name="flipx" size={16} /> Flip horizontal</button>
            <button onclick={() => { ed.update((e) => ({ flipY: !e.flipY })); end(); }}><Icon name="flipy" size={16} /> Flip vertical</button>
          </div>
        {/if}
      </div>
    {/if}
    {#if kind === 'video' && v0}
      <div class="pw">
        <button class="tb" class:on={ui.pop === 'trim'} title="Trim" data-testid="trim-btn" onclick={() => togglePop('trim')}><Icon name="scissors" size={16} /> Trim</button>
        {#if ui.pop === 'trim'}
          <div class="pop">
            <div class="row2">
              <NumField label="Trim start" value={v0.trimStart ?? 0} min={0} max={v0dur} step={0.1} suffix="s" testid="trim-start"
                onchange={(v) => ed.update((e) => (e.type === 'video' ? { trimStart: v } : {}), key('ts'))} onend={end} />
              <NumField label="Trim end" value={v0.trimEnd ?? v0dur} min={0} max={v0dur} step={0.1} suffix="s"
                onchange={(v) => ed.update((e) => (e.type === 'video' ? { trimEnd: v } : {}), key('te'))} onend={end} />
            </div>
            <p class="hint">Clip length {formatTime(v0dur, true)}. It plays from the start of its page.</p>
          </div>
        {/if}
      </div>
      <div class="pw">
        <button class="ib" class:on={ui.pop === 'volume'} title="Volume" aria-label="Volume" data-testid="volume-btn" onclick={() => togglePop('volume')}><Icon name="volume" /></button>
        {#if ui.pop === 'volume'}
          <div class="pop">
            <div class="slider">
              <span>Volume</span>
              <input type="range" min="0" max="100" value={Math.round((v0.volume ?? 1) * 100)} data-testid="video-volume"
                oninput={(e) => ed.update((x) => (x.type === 'video' ? { volume: Number((e.currentTarget as HTMLInputElement).value) / 100 } : {}), key('vol'))} onchange={end} />
              <b>{Math.round((v0.volume ?? 1) * 100)}</b>
            </div>
            <div class="btns">
              <button class="btn" class:on={v0.muted} data-testid="video-mute" onclick={() => { ed.update((e) => (e.type === 'video' ? { muted: !e.muted } : {})); end(); }}>{v0.muted ? 'Unmute' : 'Mute'}</button>
              <button class="btn" class:on={v0.loop} onclick={() => { ed.update((e) => (e.type === 'video' ? { loop: !e.loop } : {})); end(); }}>Loop</button>
            </div>
          </div>
        {/if}
      </div>
    {/if}
    {#if kind === 'frame' && fr}
      {#if !fr.asset}
        <button class="tb" title="Add a photo" data-testid="frame-upload" onclick={() => uploadToFrame(fr!.id)}><Icon name="upload" size={16} /> Add a photo</button>
      {/if}
      <button class="tb" class:on={ui.panel === 'frame'} title="Frame" data-testid="edit-frame" onclick={() => ui.open('frame')}><Icon name="frame" size={16} /> Frame</button>
    {/if}

    {#if kind === 'shape' && s0}
      <button class="sw" class:on={ui.panel === 'color' && ui.color?.kind === 'fill'} class:none={!s0.fill} title="Colour" aria-label="Fill colour" data-testid="fill-btn" style="--c:{s0.fill ? fillHex(s0) : 'transparent'}"
        onclick={() => color({ title: 'Colour', testid: 'fill', kind: 'fill', value: () => (s0?.fill ? fillHex(s0) : '#ffffff'), onchange: (hex) => ed.update((e) => (e.type === 'shape' ? { fill: { type: 'solid', color: hex } } : {}), key('fill')) })}><i></i></button>
      <div class="pw">
        <button class="ib" class:on={ui.pop === 'border'} title="Border style" aria-label="Border style" data-testid="border-btn" onclick={() => togglePop('border')}><Icon name="square" /></button>
        {#if ui.pop === 'border'}
          <div class="pop">
            {#if s0.stroke}
              <ColorField label="Border colour" value={s0.stroke.color} onchange={(hex) => setStroke({ color: hex })} onend={end} />
              <div class="row2">
                <NumField label="Border weight" value={s0.stroke.width} min={0} max={200} onchange={(v) => setStroke({ width: v })} onend={end} />
                <label class="field"><span>Style</span>
                  <select class="input" value={s0.stroke.dash ?? 'solid'} onchange={(e) => { setStroke({ dash: (e.currentTarget as HTMLSelectElement).value as Stroke['dash'] }); end(); }}>
                    <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
                  </select>
                </label>
              </div>
              <button class="btn danger" onclick={() => { setStroke(null); end(); }}>Remove border</button>
            {:else}
              <button class="btn" onclick={() => { setStroke({}); end(); }}>Add border</button>
            {/if}
          </div>
        {/if}
      </div>
      {#if s0.shape === 'rect'}
        <div class="pw">
          <button class="ib" class:on={ui.pop === 'radius'} title="Corner rounding" aria-label="Corner rounding" data-testid="shape-radius-btn" onclick={() => togglePop('radius')}><Icon name="radius" /></button>
          {#if ui.pop === 'radius'}
            <div class="pop"><NumField label="Corner rounding" value={s0.radius} min={0} max={2000} onchange={(v) => ed.update((e) => (e.type === 'shape' ? { radius: v } : {}), key('r'))} onend={end} /></div>
          {/if}
        </div>
      {/if}
    {/if}

    {#if kind === 'line' && l0}
      <button class="sw" title="Colour" aria-label="Line colour" data-testid="line-color-btn" style="--c:{l0.stroke.color}"
        onclick={() => color({ title: 'Line colour', testid: 'line-color', value: () => l0?.stroke.color ?? '#000000', onchange: (hex) => l0 && ed.updateLine({ stroke: { ...l0.stroke, color: hex } }, key('lc')) })}><i></i></button>
      <div class="pw">
        <button class="ib" class:on={ui.pop === 'weight'} title="Line style" aria-label="Line style" data-testid="line-style-btn" onclick={() => togglePop('weight')}><Icon name="line" /></button>
        {#if ui.pop === 'weight'}
          <div class="pop">
            <div class="row2">
              <NumField label="Line weight" value={l0.stroke.width} min={0.5} max={100} step={0.5} testid="line-width" onchange={(v) => ed.updateLine({ stroke: { ...l0!.stroke, width: v } }, key('lw'))} onend={end} />
              <label class="field"><span>Style</span>
                <select class="input" value={l0.stroke.dash ?? 'solid'} onchange={(e) => { ed.updateLine({ stroke: { ...l0!.stroke, dash: (e.currentTarget as HTMLSelectElement).value as Stroke['dash'] } }); end(); }}>
                  <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
                </select>
              </label>
            </div>
            <p class="hint">{l0.start.attach || l0.end.attach ? 'Connected: it follows the elements it is stuck to.' : 'Drag an end onto a shape to connect it.'}</p>
          </div>
        {/if}
      </div>
      <select class="sel" title="Line type" aria-label="Line type" value={l0.route} data-testid="line-route" onchange={(e) => { ed.updateLine({ route: (e.currentTarget as HTMLSelectElement).value as LineRoute }); end(); }}>
        <option value="straight">Straight</option><option value="elbow">Elbow</option><option value="curved">Curved</option>
      </select>
      <select class="sel" title="Line start" aria-label="Line start" value={l0.start.marker} data-testid="line-start" onchange={(e) => { ed.updateLine({ startMarker: (e.currentTarget as HTMLSelectElement).value as LineMarker }); end(); }}>
        {#each MARKERS as m}<option value={m.m}>Start: {m.label}</option>{/each}
      </select>
      <select class="sel" title="Line end" aria-label="Line end" value={l0.end.marker} data-testid="line-end" onchange={(e) => { ed.updateLine({ endMarker: (e.currentTarget as HTMLSelectElement).value as LineMarker }); end(); }}>
        {#each MARKERS as m}<option value={m.m}>End: {m.label}</option>{/each}
      </select>
    {/if}

    {#if kind === 'table'}
      <button class="tb" class:on={ui.panel === 'table'} title="Edit table" data-testid="edit-table" onclick={() => ui.open('table')}><Icon name="table" size={16} /> Edit table</button>
    {/if}
    {#if kind === 'chart'}
      <button class="tb" class:on={ui.panel === 'chart'} title="Edit chart" data-testid="edit-chart" onclick={() => ui.open('chart')}><Icon name="chart" size={16} /> Edit chart</button>
    {/if}
    {#if (kind === 'graphic' || kind === 'qr') && gr}
      {#if kind === 'qr'}
        <button class="tb" class:on={ui.panel === 'qr'} title="QR code" data-testid="edit-qr" onclick={() => ui.open('qr')}><Icon name="qr" size={16} /> QR code</button>
      {/if}
      {#each colorsOf(gr) as c, i (i + c)}
        <button class="sw" title="Colour {i + 1}" aria-label="Colour {i + 1}" data-testid="graphic-swatch-{i}" style="--c:{c}" onclick={() => graphicColor(i, c)}><i></i></button>
      {/each}
    {/if}
    {#if kind === 'group'}
      <button class="tb" title="Ungroup (⇧⌘G)" data-testid="ungroup" onclick={() => ed.ungroup()}><Icon name="ungroup" size={16} /> Ungroup</button>
    {/if}
    {#if sel.length > 1}
      <button class="tb" title="Group (⌘G)" data-testid="group" onclick={() => ed.group()}><Icon name="group" size={16} /> Group</button>
      {#if groups.length && kind !== 'group'}
        <button class="tb" title="Ungroup (⇧⌘G)" data-testid="ungroup" onclick={() => ed.ungroup()}><Icon name="ungroup" size={16} /> Ungroup</button>
      {/if}
    {/if}

    {#if kind !== 'text' && level < 3}<span class="sep"></span>{/if}
    <button class="tb" class:gone={level >= 3} class:on={ui.panel === 'animate'} class:set={animated} title="Animate" data-testid="animate-btn" onclick={() => ui.open('animate')}>{sel.length === 1 && sel[0]!.animation ? animationLabel(sel[0]!.animation) : 'Animate'}</button>
    <button class="tb" class:gone={level >= 3} class:on={ui.panel === 'position'} title="Position" data-testid="position-btn" onclick={() => { ui.positionTab = 'arrange'; ui.open('position'); }}>Position</button>
    {#if !compact}
      <button class="ib" class:on={!!ui.styleClip} title={ui.styleClip ? 'Click an element to paste the style (Esc to cancel)' : 'Copy style (⌥⌘C)'} aria-label="Copy style" aria-pressed={!!ui.styleClip} data-testid="copy-style" onclick={armStyle}><Icon name="roller" /></button>
    {/if}
    {#if pic && !fr && (kind === 'image' || kind === 'video')}
      <div class="pw">
        <button class="ib" class:on={ui.pop === 'iradius'} title="Corner rounding" aria-label="Corner rounding" data-testid="radius-btn" onclick={() => togglePop('iradius')}><Icon name="radius" /></button>
        {#if ui.pop === 'iradius'}
          <div class="pop"><NumField label="Corner rounding" value={pic.radius} min={0} max={2000} onchange={(v) => ed.update((e) => (e.type === 'image' || e.type === 'video' ? { radius: v } : {}), key('ir'))} onend={end} /></div>
        {/if}
      </div>
    {/if}
    <div class="pw" class:gone={compact}>
      <button class="ib" class:on={ui.pop === 'opacity'} title="Transparency" aria-label="Transparency" data-testid="opacity-btn" onclick={() => togglePop('opacity')}><Icon name="transparency" /></button>
      {#if ui.pop === 'opacity'}
        <div class="pop right">
          <div class="slider">
            <span>Transparency</span>
            <input type="range" min="0" max="100" value={opacity} data-testid="opacity"
              oninput={(e) => ed.update({ opacity: Number((e.currentTarget as HTMLInputElement).value) / 100 }, key('op'))} onchange={end} />
            <input class="input n" type="number" min="0" max="100" value={opacity} aria-label="Transparency value"
              oninput={(e) => ed.update({ opacity: Math.max(0, Math.min(100, Number((e.currentTarget as HTMLInputElement).value))) / 100 }, key('op'))} onchange={end} />
          </div>
        </div>
      {/if}
    </div>
    {#if level < 1}
      <button class="ib" class:on={locked} title={locked ? 'Unlock (⌥⇧L)' : 'Lock (⌥⇧L)'} aria-label={locked ? 'Unlock' : 'Lock'} data-testid="lock" onclick={() => { ed.update({ locked: !locked }); end(); }}><Icon name={locked ? 'lock' : 'unlock'} /></button>
    {/if}
    <div class="pw">
      <button class="ib" class:on={ui.pop === 'more'} title="More" aria-label="More" data-testid="more-btn" onclick={() => togglePop('more')}><Icon name="more" /></button>
      {#if ui.pop === 'more'}
        <div class="pop menu right" data-testid="more-menu">
          {#if level >= 3}
            {#if kind === 'text' && !editingSel}<button data-testid="more-effects" onclick={() => ui.open('effects')}><Icon name="sparkle" size={16} /> Effects</button>{/if}
            <button data-testid="more-animate" onclick={() => ui.open('animate')}><Icon name="animate" size={16} /> Animate</button>
            <button data-testid="more-position" onclick={() => { ui.positionTab = 'arrange'; ui.open('position'); }}><Icon name="position" size={16} /> Position</button>
          {/if}
          {#if compact}
            <button data-testid="more-copy-style" onclick={armStyle}><Icon name="roller" size={16} /> Copy style <kbd>⌥⌘C</kbd></button>
            <button data-testid="more-opacity" onclick={() => (ui.pop = 'opacity')}><Icon name="transparency" size={16} /> Transparency</button>
            <hr />
          {/if}
          <button onclick={() => { ed.copy(); ui.pop = null; }}><Icon name="copy" size={16} /> Copy <kbd>⌘C</kbd></button>
          <button onclick={() => { ed.paste(); ui.pop = null; }}><Icon name="copy" size={16} /> Paste <kbd>⌘V</kbd></button>
          <button onclick={() => { ed.duplicateSelection(); ui.pop = null; }}><Icon name="copy" size={16} /> Duplicate <kbd>⌘D</kbd></button>
          <button class="danger" data-testid="delete" onclick={() => { ed.deleteSelection(); ui.pop = null; }}><Icon name="trash" size={16} /> Delete <kbd>⌫</kbd></button>
          <hr />
          <button data-testid="more-lock" onclick={() => { ed.update({ locked: !locked }); end(); ui.pop = null; }}><Icon name={locked ? 'unlock' : 'lock'} size={16} /> {locked ? 'Unlock' : 'Lock'} <kbd>⌥⇧L</kbd></button>
          <button onclick={() => { ed.update((e) => ({ flipX: !e.flipX })); end(); }}><Icon name="flipx" size={16} /> Flip horizontal</button>
          <button onclick={() => { ed.update((e) => ({ flipY: !e.flipY })); end(); }}><Icon name="flipy" size={16} /> Flip vertical</button>
          {#if pic && !(fr && !fr.asset)}
            <button data-testid="set-bg" onclick={() => { ed.setAsBackground(); ui.pop = null; }}><Icon name="image" size={16} /> Set image as background</button>
          {/if}
          <button onclick={() => { ui.positionTab = 'layers'; ui.open('position', false); }}><Icon name="layers" size={16} /> Show layers</button>
        </div>
      {/if}
    </div>
  {/if}
</div>
{#if editingSel}<p class="chip">Styling the selected text only.</p>{/if}

<style>
  .ctx { pointer-events: auto; display: flex; align-items: center; gap: 2px; height: 48px; padding: 0 6px; max-width: calc(100% - 24px); overflow-x: auto; overflow-y: visible;
    background: var(--pop); color: var(--ink); border-radius: 12px; box-shadow: var(--shadow); border: 1px solid var(--line); scrollbar-width: none; }
  .ctx:has(.pop) { overflow: visible; }
  .tb, .ib, .sw { flex-shrink: 0; height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 0; background: none; border-radius: 8px; color: inherit; font-weight: 600; font-size: 14px; white-space: nowrap; }
  .tb { padding: 0 8px; }
  .ib { width: 36px; }
  .tb:hover:not(:disabled), .ib:hover, .sw:hover { background: var(--hover); }
  .tb.on, .ib.on, .sw.on { background: var(--accent-soft); color: var(--accent); }
  .tb:disabled, .ib:disabled { opacity: .35; cursor: default; }
  .ib:disabled:hover { background: none; }
  .tb.set:not(.on) { color: var(--accent); }
  .pw.gone > .ib, .tb.gone { display: none; }
  .tight .font { width: 120px; }
  .pop.sizes { list-style: none; margin: 0; width: 84px; max-height: 320px; overflow-y: auto; padding: 6px; gap: 0; left: 50%; transform: translateX(-50%); }
  .sizes button { width: 100%; height: 30px; border: 0; background: none; border-radius: 6px; color: inherit; font-size: 14px; }
  .sizes button:hover { background: var(--hover); }
  .sizes button.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  .anchor { display: flex; align-items: center; justify-content: space-between; font-size: 13px; font-weight: 600; }
  .seg { display: flex; gap: 2px; padding: 2px; border-radius: 8px; background: var(--chip); }
  .seg button { width: 32px; height: 28px; display: grid; place-items: center; border: 0; background: none; border-radius: 6px; color: var(--ink-2); }
  .seg button.on { background: var(--pop); color: var(--accent); box-shadow: 0 1px 2px rgba(0,0,0,.15); }
  .font { width: 150px; justify-content: space-between; border: 1px solid var(--line); font-weight: 400; font-size: 15px; }
  .font span:first-child { overflow: hidden; text-overflow: ellipsis; }
  .size { display: flex; align-items: center; border: 1px solid var(--line); border-radius: 8px; height: 36px; margin: 0 4px; flex-shrink: 0; }
  .size button { width: 26px; height: 34px; border: 0; background: none; display: grid; place-items: center; color: inherit; border-radius: 7px; }
  .size button:hover { background: var(--hover); }
  .size.pw { position: relative; }
  .size input { width: 42px; height: 34px; border: 0; border-left: 1px solid var(--line); border-right: 1px solid var(--line); background: none; text-align: center; font-weight: 600; -moz-appearance: textfield; appearance: textfield; }
  .size input::-webkit-inner-spin-button { display: none; }
  .tcolor { flex-direction: column; gap: 1px; }
  .tcolor b { font-size: 16px; line-height: 16px; }
  .tcolor i { width: 20px; height: 4px; border-radius: 2px; border: 1px solid var(--line); }
  .case { font-size: 14px; font-weight: 700; }
  .sw { width: 36px; }
  .sw i { width: 24px; height: 24px; border-radius: 50%; background: var(--c); box-shadow: inset 0 0 0 1px rgba(127,127,127,.4); }
  .sw.none i { background: linear-gradient(135deg, transparent 45%, var(--danger) 45%, var(--danger) 55%, transparent 55%); }
  .sep { width: 1px; height: 24px; background: var(--line); margin: 0 6px; flex-shrink: 0; }
  .info { font-size: 13px; color: var(--muted); padding: 0 8px; white-space: nowrap; }
  .dur { display: flex; align-items: center; gap: 4px; height: 36px; padding: 0 8px; border: 1px solid var(--line); border-radius: 8px; color: var(--ink-2); }
  .dur input { width: 52px; border: 0; background: none; font-weight: 600; }
  .dur em { font-style: normal; color: var(--muted); }
  .dur select { border: 0; background: none; color: var(--ink); font-weight: 600; max-width: 150px; }
  .sel { height: 36px; border: 1px solid var(--line); border-radius: 8px; background: var(--field); padding: 0 6px; margin: 0 2px; flex-shrink: 0; }
  .pw { position: relative; flex-shrink: 0; }
  .pop { position: absolute; top: 44px; left: 0; z-index: 40; width: 300px; padding: 14px; display: flex; flex-direction: column; gap: 12px;
    background: var(--pop); color: var(--ink); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow); }
  .pop.right { left: auto; right: 0; }
  .pop.menu { width: 250px; padding: 6px; gap: 0; }
  .pop.menu button { display: flex; align-items: center; gap: 10px; height: 36px; padding: 0 10px; border: 0; background: none; border-radius: 6px; text-align: left; color: inherit; }
  .pop.menu button:hover { background: var(--hover); }
  .pop.menu kbd { margin-left: auto; font: inherit; font-size: 12px; color: var(--muted); }
  .pop.menu hr { border: 0; border-top: 1px solid var(--line); margin: 4px 0; }
  .danger { color: var(--danger) !important; }
  .slider { display: grid; grid-template-columns: 1fr 60px; gap: 6px 10px; align-items: center; font-size: 13px; font-weight: 600; }
  .slider span { grid-column: 1 / -1; }
  .slider input[type='range'] { width: 100%; }
  .slider .n { height: 30px; text-align: center; }
  .slider b { text-align: center; }
  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-items: end; }
  .btns { display: flex; gap: 6px; }
  .hint { color: var(--muted); font-size: 12px; margin: 0; line-height: 1.4; }
  .chip { position: absolute; top: 58px; pointer-events: none; margin: 0; padding: 4px 10px; border-radius: 99px; background: var(--accent); color: #fff; font-size: 12px; font-weight: 600; }
  .spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--line); border-top-color: var(--accent); animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
