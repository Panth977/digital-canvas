<script lang="ts">
  import { isVideo, pageDuration, type VideoElement } from '@digital-canvas/scene';
  import { formatTime } from '../lib/media.ts';
  import { defaultEffect, formatLength, TEXT_EFFECTS, type Element, type ShapeElement, type Stroke, type TextAlign, type TextEffect, type TextEffectType, type TextElement, type ImageElement } from '@digital-canvas/scene';
  import FontPicker from './FontPicker.svelte';
  import type { EditorState } from '../lib/editor.svelte.ts';
  import Icon, { type IconName } from '../lib/Icon.svelte';
  import ColorField from './ColorField.svelte';
  import NumField from './NumField.svelte';

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
    if (k === 'w' && one.type === 'text') {
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
    <h3>{one ? (one.type === 'text' ? 'Text' : one.type === 'image' ? 'Image' : one.type === 'video' ? 'Video' : 'Shape') : `${sel.length} elements`}</h3>

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

    {#if images.length && images[0]}
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
  .btn.link { border: 0; background: none; color: var(--accent); padding: 0; height: auto; justify-content: flex-start; font-size: 12px; }
  .field > span { display: flex; align-items: center; gap: 4px; }
  input[type='range'] { accent-color: var(--accent); width: 100%; }
</style>
