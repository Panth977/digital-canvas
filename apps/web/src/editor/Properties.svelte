<script lang="ts">
  import { formatLength, type Element, type ShapeElement, type Stroke, type TextAlign, type TextElement, type ImageElement } from '@digital-canvas/scene';
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
  const t0 = $derived(texts[0]);
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

<aside class="props scroll-y" data-testid="properties">
  {#if !sel.length}
    <h3>Page {ed.pageIndex + 1}</h3>
    <ColorField label="Background" value={pageBg} testid="page-bg"
      onchange={(hex) => ed.updatePage({ background: { type: 'solid', color: hex } }, 'page-bg')} onend={end} />
    <div class="info">
      <span>Size</span>
      <b>{formatLength(ed.doc.width, ed.doc.unit)} × {formatLength(ed.doc.height, ed.doc.unit)} {ed.doc.unit}</b>
      {#if ed.doc.bleed}<span>Print bleed {formatLength(ed.doc.bleed, 'mm')} mm</span>{/if}
    </div>
    <p class="hint">Click an element to edit it. Drag on empty space to select several. Hold Space and drag to pan, ⌘/Ctrl + scroll to zoom.</p>
  {:else}
    <h3>{one ? (one.type === 'text' ? 'Text' : one.type === 'image' ? 'Image' : 'Shape') : `${sel.length} elements`}</h3>

    {#if t0}
      <section>
        <div class="field">
          <span>Font</span>
          <select class="input" value={t0.style.fontFamily} onchange={(e) => { ed.updateTextStyle({ fontFamily: (e.currentTarget as HTMLSelectElement).value }); end(); }}>
            {#each [...ed.engine.fonts.families] as f}<option value={f}>{f}</option>{/each}
          </select>
        </div>
        <div class="row2">
          <NumField label="Size" value={t0.style.fontSize} min={4} max={800} step={1} testid="font-size"
            onchange={(v) => ed.updateTextStyle({ fontSize: v }, key('fs'))} onend={end} />
          <ColorField label="Colour" value={t0.style.color} testid="text-color"
            onchange={(hex) => ed.updateTextStyle({ color: hex }, key('tc'))} onend={end} />
        </div>
        <div class="toggles">
          <button class="btn icon" class:on={t0.style.bold} aria-label="Bold" data-testid="bold" onclick={() => { ed.updateTextStyle({ bold: !t0.style.bold }); end(); }}><Icon name="bold" /></button>
          <button class="btn icon" class:on={t0.style.italic} aria-label="Italic" onclick={() => { ed.updateTextStyle({ italic: !t0.style.italic }); end(); }}><Icon name="italic" /></button>
          <button class="btn icon" class:on={t0.style.underline} aria-label="Underline" onclick={() => { ed.updateTextStyle({ underline: !t0.style.underline }); end(); }}><Icon name="underline" /></button>
          <button class="btn icon" class:on={t0.style.strike} aria-label="Strikethrough" onclick={() => { ed.updateTextStyle({ strike: !t0.style.strike }); end(); }}><Icon name="strike" /></button>
          <button class="btn icon" class:on={t0.style.uppercase} aria-label="Uppercase" onclick={() => { ed.updateTextStyle({ uppercase: !t0.style.uppercase }); end(); }}><Icon name="caps" /></button>
        </div>
        <div class="toggles">
          {#each ALIGNS as { a, icon }}
            <button class="btn icon" class:on={t0.style.align === a} aria-label="Align {a}" onclick={() => { ed.updateTextStyle({ align: a }); end(); }}><Icon name={icon} /></button>
          {/each}
        </div>
        <div class="row2">
          <NumField label="Line height" value={t0.style.lineHeight} min={0.5} max={4} step={0.05}
            onchange={(v) => ed.updateTextStyle({ lineHeight: v }, key('lh'))} onend={end} />
          <NumField label="Letter spacing" value={t0.style.letterSpacing} min={-20} max={200} step={0.5}
            onchange={(v) => ed.updateTextStyle({ letterSpacing: v }, key('ls'))} onend={end} />
        </div>
      </section>
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
  input[type='range'] { accent-color: var(--accent); width: 100%; }
</style>
