<script lang="ts">
  /**
   * Edit image, laid out like Canva's: Tools, Filters, Adjust, Shadows, Duotone
   * and Effects. Sliders edit plain data; the renderer draws it, so the panel,
   * every export and MCP show the same picture.
   */
  import {
    ADJUST_GROUPS, ADJUST_SLIDERS, addElements, COLOR_BANDS, createDoc, defaultShadow, DUOTONES, duotoneOf, FILTER_GROUPS, image as imageEl, IMAGE_FILTERS, SHADOW_SLIDERS, SHADOW_STYLES, shadowOf, STYLIZES, stylizeOf,
    type BandEdit, type ColorBand, type ColorEdit, type ImageAdjust, type ImageAdjustKey, type ImageElement, type ImageLook, type ImageShadow, type ImageShadowStyle, type ImageStylizeType, type VideoElement,
  } from '@digital-canvas/scene';
  import type { EditorState } from '../lib/editor.svelte.ts';
  import Icon, { type IconName } from '../lib/Icon.svelte';
  import { mobile } from '../lib/mobile.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import { brush } from '../lib/vision/brush.svelte.ts';
  import { editProvider, grabText, magicCrop, magicExpand, magicGrab, runAutoAdjust, withMatte, type BrushTool } from '../lib/vision/tools.svelte.ts';
  import ColorField from './ColorField.svelte';

  let { ed, pic }: { ed: EditorState; pic: ImageElement | VideoElement } = $props();

  const key = (k: string) => `img:${k}:${ed.selection.join(',')}`;
  const end = () => ed.seal();
  const img = $derived(pic.type === 'image' ? pic : null);

  type Tab = 'tools' | 'filters' | 'adjust' | 'shadows' | 'duotone' | 'effects';
  let tab = $state<Tab>('tools');
  const TABS = $derived<{ id: Tab; label: string }[]>([
    ...(img ? [{ id: 'tools' as const, label: 'Tools' }] : []),
    { id: 'filters', label: 'Filters' }, { id: 'adjust', label: 'Adjust' }, { id: 'shadows', label: 'Shadows' }, { id: 'duotone', label: 'Duotone' }, { id: 'effects', label: 'Effects' },
  ]);
  const shown = $derived(tab === 'tools' && !img ? 'filters' : tab);

  function openBrush(tool: BrushTool): void {
    if (!img) return;
    brush.open(img.id, tool);
    if (mobile.on) ui.panel = null; // the brush needs the page in view
  }

  // ---- adjust ----
  let scope = $state<'whole' | 'foreground' | 'background'>('whole');
  const values = $derived<ImageAdjust>(scope === 'whole' ? pic.adjust ?? {} : pic.selective?.[scope] ?? {});
  async function setScope(s: typeof scope): Promise<void> {
    if (s !== 'whole' && !pic.matte) await withMatte(ed, () => ({}));
    if (s === 'whole' || img?.matte) scope = s;
  }
  function setAdjust(k: ImageAdjustKey, v: number): void {
    const s = scope;
    ed.updateLook((e) => {
      if (s === 'whole') {
        const adjust = { ...e.adjust, [k]: v };
        if (!v) delete adjust[k];
        return { adjust: Object.keys(adjust).length ? adjust : undefined };
      }
      const next = { ...e.selective?.[s], [k]: v };
      if (!v) delete next[k];
      return { selective: { ...e.selective, [s]: Object.keys(next).length ? next : undefined } };
    }, key(`adj-${scope}-${k}`));
  }
  const groupSliders = (g: string) => ADJUST_SLIDERS.filter((s) => s.group === g);

  // ---- colour edit ----
  let band = $state<ColorBand>('red');
  const bandVal = $derived<BandEdit>(pic.colorEdit?.[band] ?? {});
  function setBand(k: keyof BandEdit, v: number): void {
    const b = band;
    ed.updateLook((e) => {
      const edit: ColorEdit = { ...e.colorEdit, [b]: { ...e.colorEdit?.[b], [k]: v } };
      return { colorEdit: edit };
    }, key(`band-${band}-${k}`));
  }
  const bandEdited = (b: ColorBand) => { const v = pic.colorEdit?.[b]; return !!v && Object.values(v).some(Boolean); };

  // ---- filters: small previews on the selected picture ----
  let thumbs = $state<Record<string, string>>({});
  const thumbAsset = $derived(shown === 'filters' ? (pic.type === 'video' ? `${pic.asset}.poster` : pic.asset) : null);
  $effect(() => {
    const asset = thumbAsset;
    void ed.frame;
    if (!asset || !ed.renderer.hasImage(asset)) return;
    const urls: Record<string, string> = {};
    const doc = createDoc({ width: 64, height: 64 });
    const base = { ...imageEl(asset, { x: 0, y: 0, w: 64, h: 64 }), crop: undefined };
    for (const f of [{ name: '' }, ...IMAGE_FILTERS]) {
      const d = addElements(doc, doc.pages[0]!.id, [f.name ? { ...base, filter: { name: f.name, intensity: 100 } } : base]);
      const bytes = ed.renderer.exportPage(d, d.pages[0]!, { format: 'png', scale: 2 });
      urls[f.name] = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));
    }
    thumbs = urls;
    return () => { for (const u of Object.values(urls)) URL.revokeObjectURL(u); };
  });

  // ---- shadows ----
  const shadow = $derived(shadowOf(pic));
  function pickShadow(style: ImageShadowStyle | ''): void {
    ed.updateLook({ shadow: style ? defaultShadow(style) : undefined, effect: pic.effect?.type === 'duotone' || pic.effect?.type === 'pixelate' ? pic.effect : undefined });
    end();
  }
  function patchShadow(patch: Partial<ImageShadow>): void {
    if (shadow) ed.updateLook({ shadow: { ...shadow, ...patch }, effect: pic.effect?.type === 'duotone' || pic.effect?.type === 'pixelate' ? pic.effect : undefined }, key('shadow'));
  }

  // ---- duotone ----
  const duo = $derived(duotoneOf(pic));
  function setDuo(d: ImageLook['duotone']): void {
    ed.updateLook({ duotone: d, effect: pic.effect?.type === 'duotone' ? undefined : pic.effect });
  }

  // ---- effects ----
  const st = $derived(stylizeOf(pic));
  function pickStylize(type: ImageStylizeType | ''): void {
    const preset = STYLIZES.find((s) => s.type === type);
    ed.updateLook({ stylize: preset ? { type: preset.type, amount: preset.amount } : undefined, effect: pic.effect?.type === 'pixelate' ? undefined : pic.effect });
    end();
  }

  // ---- tools ----
  const hasKey = $derived(!!editProvider());
  let expandOpen = $state(false);
  const EXPAND = [{ id: '1:1', r: 1 }, { id: '4:5', r: 4 / 5 }, { id: '16:9', r: 16 / 9 }, { id: '9:16', r: 9 / 16 }, { id: 'Page', r: 0 }];
  const expandTo = (r: number) => { expandOpen = false; void magicExpand(ed, r || ed.doc.width / ed.doc.height); };
  const pop = $derived(!!pic.matte && pic.selective?.background?.saturation === -100);
  const blurs = $derived(!!pic.blurBrush);

  function tool(id: string, label: string, icon: IconName, hint: string, run: () => void, on = false, disabled = false) {
    return { id, label, icon, hint, run, on, disabled };
  }
  const BUSY = $derived(!!ed.bgStatus);
  const TOOLS = $derived(img ? [
    tool('remove-bg', 'BG Remover', 'wand', 'On this device. 99 MB the first time.', () => void ed.removeBackground(), !!img.original, BUSY),
    tool('tool-erase', 'Magic Eraser', 'eraser', 'Brush out objects. On this device, 208 MB the first time.', () => openBrush('erase'), false, BUSY),
    tool('tool-grab', 'Magic Grab', 'sparkle', 'The subject becomes its own element, the photo is filled in behind it.', () => void magicGrab(ed), false, BUSY),
    tool('tool-text', 'Grab Text', 'text', 'Words in the photo become editable text. English.', () => void grabText(ed), false, BUSY),
    tool('tool-edit', 'Magic Edit', 'wand', hasKey ? 'Brush an area and describe the change.' : 'Needs your OpenAI or Google key.', () => openBrush('edit'), false, BUSY),
    tool('tool-expand', 'Magic Expand', 'crop', hasKey ? 'Grow the photo to a new shape.' : 'Needs your OpenAI or Google key.', () => (expandOpen = !expandOpen), expandOpen, BUSY || !hasKey),
    tool('tool-crop', 'Magic Crop', 'crop', 'Frame the subject.', () => void magicCrop(ed), false, BUSY),
    tool('tool-blur', 'Blur', 'sliders', 'Brush blur on, or over the whole picture.', () => openBrush('blur'), blurs, BUSY),
  ] : []);
</script>

{#snippet slider(id: string, label: string, value: number, min: number, max: number, onset: (v: number) => void, reset = 0)}
  <div class="sl">
    <label for={id}><span>{label}</span><output>{Math.round(value)}</output></label>
    <input {id} type="range" {min} {max} value={value} data-testid={id}
      oninput={(e) => onset(Number((e.currentTarget as HTMLInputElement).value))} onchange={end}
      ondblclick={() => { onset(reset); end(); }} />
  </div>
{/snippet}

<div class="ip" data-testid="image-tools">
  <div class="itabs" role="tablist">
    {#each TABS as t (t.id)}
      <button role="tab" aria-selected={shown === t.id} class:on={shown === t.id} data-testid="imgtab-{t.id}" onclick={() => (tab = t.id)}>{t.label}</button>
    {/each}
  </div>

  {#if ed.bgStatus}
    <div class="progress" data-testid="bg-progress">
      <span>{ed.bgStatus.msg}</span>
      {#if ed.bgStatus.fraction !== undefined}<i style="width:{Math.round(ed.bgStatus.fraction * 100)}%"></i>{/if}
    </div>
  {/if}
  {#if ed.bgError}<p class="hint err" data-testid="tool-error">{ed.bgError}</p>{/if}

  <div class="scroll-y sc">
    {#if shown === 'tools' && img}
      <div class="tgrid">
        {#each TOOLS as t (t.id)}
          <button class="t" class:on={t.on} disabled={t.disabled} data-testid={t.id} title={t.hint} onclick={t.run}>
            <span class="ic"><Icon name={t.icon} size={22} /></span>
            <b>{t.label}</b>
            <small>{t.hint}</small>
          </button>
        {/each}
      </div>
      {#if expandOpen}
        <div class="row" data-testid="expand-ratios">
          {#each EXPAND as e (e.id)}<button class="pill" data-testid="expand-{e.id}" onclick={() => expandTo(e.r)}>{e.id}</button>{/each}
        </div>
      {/if}
      {#if !hasKey}<p class="hint" data-testid="key-note">Magic Edit and Magic Expand paint new content, so they use your own image AI key: add one in File › Settings › AI and devices. Everything else here runs on this device.</p>{/if}
      {#if img.original}
        <div class="row">
          <button class="pill" data-testid="bg-brush" onclick={() => openBrush('bg')}>Erase / Restore brush</button>
          <button class="pill" data-testid="restore-original" onclick={() => ed.restoreOriginal()}>Restore original</button>
        </div>
      {/if}
      <h4>Auto Focus</h4>
      <p class="hint">Keeps the subject sharp and blurs the rest.</p>
      {#if img.autoFocus === undefined}
        <button class="pill" data-testid="tool-focus" disabled={BUSY} onclick={() => void withMatte(ed, () => ({ autoFocus: 40 }))}>Add Auto Focus</button>
      {:else}
        {@render slider('auto-focus', 'Blur intensity', img.autoFocus, 0, 100, (v) => ed.updateLook({ autoFocus: v }, key('af')))}
        <button class="pill" onclick={() => { ed.updateLook({ autoFocus: undefined }); end(); }}>Remove</button>
      {/if}
      <h4>Colour Pop</h4>
      <button class="pill" class:on={pop} data-testid="tool-pop" disabled={BUSY} onclick={() => void withMatte(ed, (e) => ({ selective: { ...e.selective, background: { ...e.selective?.background, saturation: pop ? 0 : -100 } } }))}>{pop ? 'Remove Colour Pop' : 'Black and white behind the subject'}</button>
      <h4>Face Retouch</h4>
      <p class="hint">Smooths skin tones, keeps edges, eyes and lips.</p>
      {@render slider('retouch', 'Smooth skin', img.retouch ?? 0, 0, 100, (v) => ed.updateLook({ retouch: v || undefined }, key('rt')))}
      {#if img.blurBrush}
        <h4>Blur brush</h4>
        {@render slider('blur-intensity', 'Intensity', img.blurBrush.intensity, 1, 100, (v) => ed.updateLook({ blurBrush: { ...img!.blurBrush!, intensity: v } }, key('bb')))}
        <button class="pill" data-testid="blur-remove" onclick={() => { ed.updateLook({ blurBrush: undefined }); end(); }}>Remove blur</button>
      {/if}

    {:else if shown === 'filters'}
      <button class="filter none" class:on={!pic.filter} data-testid="filter-none" onclick={() => { ed.updateLook({ filter: undefined }); end(); }}>
        {#if thumbs['']}<img src={thumbs['']} alt="" />{:else}<span class="ph"></span>{/if}<span>None</span>
      </button>
      {#if pic.filter}
        {@render slider('filter-intensity', 'Intensity', pic.filter.intensity, 0, 100, (v) => ed.updateLook({ filter: { name: pic.filter!.name, intensity: v } }, key('fint')), 100)}
      {/if}
      {#each FILTER_GROUPS as g (g)}
        <h4>{g}</h4>
        <div class="filters">
          {#each IMAGE_FILTERS.filter((f) => f.group === g) as f (f.name)}
            <button class="filter" class:on={pic.filter?.name === f.name} data-testid="filter-{f.name}"
              onclick={() => { ed.updateLook({ filter: { name: f.name, intensity: pic.filter?.intensity ?? 100 } }); end(); }}>
              {#if thumbs[f.name]}<img src={thumbs[f.name]} alt="" />{:else}<span class="ph"></span>{/if}
              <span>{f.label}</span>
            </button>
          {/each}
        </div>
      {/each}

    {:else if shown === 'adjust'}
      {#if img}
        <button class="pill wide" data-testid="auto-adjust" onclick={() => void runAutoAdjust(ed)}><Icon name="wand" size={16} /> Auto-adjust</button>
        {#if pic.auto}
          {@render slider('auto-intensity', 'Auto-adjust intensity', pic.auto.intensity, 0, 100, (v) => ed.updateLook({ auto: { ...pic.auto!, intensity: v } }, key('auto')), 100)}
        {/if}
        <div class="seg" role="group" aria-label="Select area">
          <button class:on={scope === 'whole'} data-testid="scope-whole" onclick={() => void setScope('whole')}>Whole image</button>
          <button class:on={scope === 'foreground'} data-testid="scope-foreground" disabled={BUSY} onclick={() => void setScope('foreground')}>Foreground</button>
          <button class:on={scope === 'background'} data-testid="scope-background" disabled={BUSY} onclick={() => void setScope('background')}>Background</button>
        </div>
      {/if}
      {#each ADJUST_GROUPS as g (g)}
        <details open>
          <summary>{g}</summary>
          {#each groupSliders(g) as s (s.key)}
            {@render slider(`adj-${s.key}`, s.label, values[s.key] ?? 0, s.min, s.max, (v) => setAdjust(s.key, v))}
          {/each}
        </details>
      {/each}
      <details open>
        <summary>Colour edit</summary>
        <div class="bands" role="group" aria-label="Colour band">
          {#each COLOR_BANDS as b (b.band)}
            <button class="band" class:on={band === b.band} class:set={bandEdited(b.band)} aria-label={b.label} title={b.label} data-testid="band-{b.band}" style="--c:{b.swatch}" onclick={() => (band = b.band)}></button>
          {/each}
        </div>
        {@render slider('band-hue', 'Hue', bandVal.hue ?? 0, -100, 100, (v) => setBand('hue', v))}
        {@render slider('band-saturation', 'Saturation', bandVal.saturation ?? 0, -100, 100, (v) => setBand('saturation', v))}
        {@render slider('band-lightness', 'Lightness', bandVal.lightness ?? 0, -100, 100, (v) => setBand('lightness', v))}
      </details>
      <label class="check"><input type="checkbox" checked={!!pic.invert} data-testid="invert" onchange={(e) => { ed.updateLook({ invert: (e.currentTarget as HTMLInputElement).checked || undefined }); end(); }} /> Invert colours</label>
      {#if pic.adjust || pic.auto || pic.colorEdit || pic.invert || pic.selective}
        <button class="pill wide" data-testid="adj-reset" onclick={() => { ed.updateLook({ adjust: undefined, auto: undefined, colorEdit: undefined, invert: undefined, selective: undefined }); end(); }}>Reset adjustments</button>
      {/if}

    {:else if shown === 'shadows'}
      <div class="fxgrid">
        <button class="fx" class:on={!shadow} data-testid="shadow-none" onclick={() => pickShadow('')}><span class="pv"><span class="box"></span></span><span>None</span></button>
        {#each SHADOW_STYLES as s (s.style)}
          <button class="fx" class:on={shadow?.style === s.style} data-testid="shadow-{s.style}" onclick={() => pickShadow(s.style)}><span class="pv"><span class="box sh-{s.style}"></span></span><span>{s.label}</span></button>
        {/each}
      </div>
      {#if shadow}
        {#each SHADOW_SLIDERS[shadow.style] as s (s.k)}
          {@render slider(`shadow-${s.k}`, s.label, shadow[s.k], s.min, s.max, (v) => patchShadow({ [s.k]: v }))}
        {/each}
        <ColorField label="Colour" value={shadow.color} onchange={(hex) => patchShadow({ color: hex })} onend={end} />
        {#if shadow.style === 'outline' || shadow.style === 'glow'}<p class="hint">Follows the outline of cut-outs and frames.</p>{/if}
      {/if}

    {:else if shown === 'duotone'}
      <div class="fxgrid">
        <button class="fx" class:on={!duo} data-testid="duo-none" onclick={() => { setDuo(undefined); end(); }}><span class="pv"><span class="box"></span></span><span>None</span></button>
        {#each DUOTONES as d (d.id)}
          <button class="fx" class:on={duo?.dark === d.dark && duo?.light === d.light} data-testid="duo-{d.id}" onclick={() => { setDuo({ dark: d.dark, light: d.light, intensity: duo?.intensity ?? 100 }); end(); }}>
            <span class="pv" style="background:linear-gradient(135deg, {d.dark} 50%, {d.light} 50%)"></span><span>{d.label}</span>
          </button>
        {/each}
      </div>
      {#if duo}
        <div class="row2">
          <ColorField label="Highlights" value={duo.light} onchange={(hex) => { ed.updateLook({ duotone: { ...duo!, light: hex } }, key('dl')); }} onend={end} />
          <ColorField label="Shadows" value={duo.dark} onchange={(hex) => { ed.updateLook({ duotone: { ...duo!, dark: hex } }, key('dd')); }} onend={end} />
        </div>
        {@render slider('duo-intensity', 'Intensity', duo.intensity ?? 100, 0, 100, (v) => setDuo({ ...duo!, intensity: v }), 100)}
      {/if}

    {:else}
      <div class="fxgrid">
        <button class="fx" class:on={!st} data-testid="stylize-none" onclick={() => pickStylize('')}><span class="pv"><span class="box"></span></span><span>None</span></button>
        {#each STYLIZES as s (s.type)}
          <button class="fx" class:on={st?.type === s.type} data-testid="stylize-{s.type}" onclick={() => pickStylize(s.type)}><span class="pv st-{s.type}"></span><span>{s.label}</span></button>
        {/each}
      </div>
      {#if st}
        {@render slider('stylize-amount', 'Amount', st.amount, 1, 100, (v) => ed.updateLook({ stylize: { type: st!.type, amount: v } }, key('st')))}
      {/if}
    {/if}
  </div>
</div>

<style>
  .ip { display: flex; flex-direction: column; gap: 10px; flex: 1; min-height: 0; }
  .sc { display: flex; flex-direction: column; gap: 10px; flex: 1; min-height: 0; padding-bottom: 16px; }
  .itabs { display: flex; gap: 2px; overflow-x: auto; flex-shrink: 0; border-bottom: 1px solid var(--line); scrollbar-width: none; }
  .itabs button { flex: 0 0 auto; border: 0; background: none; padding: 7px 8px; font-size: 13px; font-weight: 600; color: var(--muted); border-bottom: 2px solid transparent; }
  .itabs button.on { color: var(--ink); border-bottom-color: var(--accent); }
  h4 { margin: 6px 0 0; font-size: 14px; font-weight: 600; }
  .hint { color: var(--muted); font-size: 12px; line-height: 1.5; margin: 0; }
  .hint.err { color: var(--danger); }
  .tgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .t { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--chip); color: var(--ink); text-align: left; min-height: 104px; }
  .t:hover:not(:disabled) { background: var(--hover); }
  .t.on { border-color: var(--accent); }
  .t:disabled { opacity: .5; }
  .t b { font-size: 13px; }
  .t small { color: var(--muted); font-size: 11px; line-height: 1.3; }
  .ic { color: var(--accent); }
  .row { display: flex; gap: 6px; flex-wrap: wrap; }
  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-items: end; }
  .pill { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); background: var(--chip); color: var(--ink); border-radius: 8px; padding: 7px 10px; font-size: 13px; font-weight: 500; }
  .pill:hover:not(:disabled) { background: var(--hover); }
  .pill.on { border-color: var(--accent); color: var(--accent); }
  .pill.wide { justify-content: center; width: 100%; }
  .sl { display: flex; flex-direction: column; gap: 2px; }
  .sl label { display: flex; justify-content: space-between; font-size: 12px; color: var(--ink-2); }
  .sl output { color: var(--muted); font-variant-numeric: tabular-nums; }
  .sl input { width: 100%; }
  details { display: flex; flex-direction: column; gap: 8px; }
  summary { font-size: 14px; font-weight: 600; padding: 4px 0; cursor: pointer; }
  details > .sl { margin-bottom: 8px; }
  .seg { display: flex; padding: 3px; background: var(--chip); border-radius: 9px; }
  .seg button { flex: 1; border: 0; background: none; border-radius: 7px; padding: 6px 2px; font-size: 12px; font-weight: 600; color: var(--muted); }
  .seg button.on { background: var(--panel); color: var(--ink); box-shadow: 0 1px 2px rgba(0,0,0,.18); }
  .bands { display: flex; justify-content: space-between; margin: 4px 0 10px; }
  .band { width: 26px; height: 26px; border-radius: 50%; border: 0; padding: 0; background: var(--c); position: relative; }
  .band.on { outline: 2px solid var(--accent); outline-offset: 2px; }
  .band.set::after { content: ''; position: absolute; right: -1px; top: -1px; width: 8px; height: 8px; border-radius: 50%; background: var(--ink); border: 1px solid var(--panel); }
  .check { display: flex; align-items: center; gap: 6px; font-size: 13px; }
  .filters { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .filter { display: flex; flex-direction: column; align-items: center; gap: 4px; border: 0; background: none; padding: 0; font-size: 11px; color: var(--ink-2); min-width: 0; }
  .filter img, .filter .ph { width: 100%; aspect-ratio: 1; border-radius: 8px; border: 2px solid transparent; object-fit: cover; background: var(--chip); display: block; }
  .filter.none { width: 33%; }
  .filter.on img, .filter.on .ph { border-color: var(--accent); }
  .filter.on { color: var(--accent); font-weight: 600; }
  .fxgrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .fx { display: flex; flex-direction: column; align-items: center; gap: 4px; border: 0; background: none; padding: 0; font-size: 11px; color: var(--ink-2); }
  .pv { width: 100%; aspect-ratio: 1; display: grid; place-items: center; border-radius: 8px; background: var(--chip); border: 2px solid transparent; overflow: hidden; }
  .fx.on .pv { border-color: var(--accent); }
  .box { width: 58%; height: 58%; background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.12); }
  .sh-glow { box-shadow: 0 0 10px 3px #ffd84d; }
  .sh-drop { box-shadow: 4px 4px 7px rgba(0,0,0,.5); }
  .sh-angle { box-shadow: -8px 4px 6px -3px rgba(0,0,0,.45); }
  .sh-curved { box-shadow: 0 10px 8px -8px rgba(0,0,0,.65); border-radius: 0 0 40% 40% / 0 0 8% 8%; }
  .sh-lift { box-shadow: 8px 10px 7px -8px rgba(0,0,0,.6), -8px 10px 7px -8px rgba(0,0,0,.6); }
  .sh-backdrop { box-shadow: 5px 5px 0 #8b5cf6; }
  .sh-outline { box-shadow: 0 0 0 3px #111, 0 0 0 4px #fff; }
  .st-pixelate { background: conic-gradient(#8b5cf6 25%, #c4b5fd 0 50%, #8b5cf6 0 75%, #c4b5fd 0) 0 0 / 16px 16px; }
  .st-halftone { background: radial-gradient(circle, #111 34%, #fff 36%) 0 0 / 9px 9px; }
  .st-posterize { background: linear-gradient(90deg, #1e1b4b 33%, #8b5cf6 0 66%, #fde68a 0); }
  .st-glitch { background: linear-gradient(90deg, #00e0ff 20%, #fff 0 80%, #ff2e63 0); }
  .st-screen { background: repeating-linear-gradient(0deg, #8b5cf6 0 3px, #2e1065 3px 6px); }
  .st-sketch { background: repeating-linear-gradient(45deg, #fff 0 4px, #555 4px 5px); }
  .progress { position: relative; font-size: 12px; color: var(--muted); padding-bottom: 6px; flex-shrink: 0; }
  .progress i { position: absolute; left: 0; bottom: 0; height: 3px; border-radius: 2px; background: var(--accent); }
</style>
