<script lang="ts">
  import { BLEND_MODES, type BlendMode, type Page, type TextAlign, type TextElement } from '@digital-canvas/scene';
  import type { EditorState } from '../../lib/editor.svelte.ts';
  import Icon, { type IconName } from '../../lib/Icon.svelte';
  import { mobile } from '../../lib/mobile.svelte.ts';
  import { view } from '../../lib/view.svelte.ts';

  /** The phone's small tool sheets: font size, format, spacing, transparency and the pages. */
  let { ed }: { ed: EditorState } = $props();

  const sel = $derived(ed.selected);
  const texts = $derived(sel.filter((e): e is TextElement => e.type === 'text'));
  const t0 = $derived(texts[0]);
  const ts = $derived(ed.textStyle ?? {});
  const key = (k: string) => `prop:${k}:${ed.selection.join(',')}`;
  const end = () => ed.seal();
  const num = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);

  const size = $derived(Math.round((ts.fontSize ?? t0?.style.fontSize ?? 16) * 10) / 10);
  function setSize(v: number): void {
    if (!Number.isFinite(v) || v <= 0) return;
    ed.updateTextStyle({ fontSize: Math.max(1, Math.min(800, v)) }, key('fs'));
  }
  const opacity = $derived(Math.round((sel[0]?.opacity ?? 1) * 100));

  const ALIGNS: { a: TextAlign; icon: IconName; label: string }[] = [
    { a: 'left', icon: 'tl', label: 'Left' }, { a: 'center', icon: 'tc', label: 'Centre' }, { a: 'right', icon: 'tr', label: 'Right' }, { a: 'justify', icon: 'tj', label: 'Justify' },
  ];
  const align = $derived(ts.align ?? t0?.style.align ?? 'left');

  // a sheet that no longer fits the selection closes (Canva)
  $effect(() => {
    const s = mobile.sheet;
    if ((s === 'size' || s === 'spacing' || s === 'format') && !t0) mobile.sheet = null;
    if (s === 'opacity' && !sel.length) mobile.sheet = null;
  });

  // ---- pages: thumbnails, tap to go there ----
  const cache = new Map<string, { page: Page; url: string }>();
  let thumbs = $state<Record<string, string>>({});
  $effect(() => {
    if (mobile.sheet !== 'pages') return;
    const doc = ed.doc;
    let cancelled = false;
    const t = setTimeout(async () => {
      const scale = Math.min(1, 240 / Math.max(doc.width, doc.height));
      for (const p of doc.pages) {
        if (cancelled) return;
        const hit = cache.get(p.id);
        if (hit?.page === p) continue;
        const url = URL.createObjectURL(new Blob([ed.exportPage(p.id, 'png', scale) as BlobPart], { type: 'image/png' }));
        if (hit) URL.revokeObjectURL(hit.url);
        cache.set(p.id, { page: p, url });
        thumbs = { ...thumbs, [p.id]: url };
        await new Promise((r) => setTimeout(r, 0));
      }
    }, 150);
    return () => { cancelled = true; clearTimeout(t); };
  });
  $effect(() => () => { for (const c of cache.values()) URL.revokeObjectURL(c.url); });
  function go(i: number): void {
    ed.select([], ed.doc.pages[i]!.id);
    view.goToPage(i);
  }
</script>

{#if mobile.sheet === 'size' && t0}
  <div class="row" data-testid="m-size-sheet">
    <button class="rb" aria-label="Smaller" data-testid="m-size-down" onclick={() => { setSize(Math.round(size) - 1); end(); }}><Icon name="minus" size={18} /></button>
    <input class="rng" type="range" min="6" max="200" step="1" value={size} aria-label="Font size" data-testid="m-size-range" oninput={(e) => setSize(num(e))} onchange={end} />
    <button class="rb" aria-label="Bigger" data-testid="m-size-up" onclick={() => { setSize(Math.round(size) + 1); end(); }}><Icon name="plus" size={18} /></button>
    <input class="val" type="number" inputmode="decimal" min="1" max="800" value={size} aria-label="Font size value" data-testid="m-size-value" onchange={(e) => { setSize(num(e)); end(); }} />
  </div>
{:else if mobile.sheet === 'format' && t0}
  <div class="grid" data-testid="m-format-sheet">
    <button class:on={ts.bold} aria-pressed={!!ts.bold} data-testid="m-bold" onclick={() => { ed.updateTextStyle({ bold: !ts.bold }); end(); }}><Icon name="bold" /> Bold</button>
    <button class:on={ts.italic} aria-pressed={!!ts.italic} data-testid="m-italic" onclick={() => { ed.updateTextStyle({ italic: !ts.italic }); end(); }}><Icon name="italic" /> Italic</button>
    <button class:on={ts.underline} aria-pressed={!!ts.underline} data-testid="m-underline" onclick={() => { ed.updateTextStyle({ underline: !ts.underline }); end(); }}><Icon name="underline" /> Underline</button>
    <button class:on={ts.strike} aria-pressed={!!ts.strike} data-testid="m-strike" onclick={() => { ed.updateTextStyle({ strike: !ts.strike }); end(); }}><Icon name="strike" /> Strike</button>
    <button class:on={ts.uppercase} aria-pressed={!!ts.uppercase} data-testid="m-uppercase" onclick={() => { ed.updateTextStyle({ uppercase: !ts.uppercase }); end(); }}><Icon name="caps" /> Uppercase</button>
    <button class:on={!!t0.list} data-testid="m-list" onclick={() => { ed.updateText({ list: !t0!.list ? 'bullet' : t0!.list === 'bullet' ? 'number' : undefined }); end(); }}><Icon name={t0.list === 'number' ? 'listn' : 'listb'} /> List</button>
  </div>
  <div class="seg" role="radiogroup" aria-label="Alignment">
    {#each ALIGNS as o (o.a)}
      <button role="radio" aria-checked={align === o.a} class:on={align === o.a} aria-label={o.label} data-testid="m-align-{o.a}" onclick={() => { ed.updateTextStyle({ align: o.a }); end(); }}><Icon name={o.icon} /></button>
    {/each}
  </div>
{:else if mobile.sheet === 'spacing' && t0}
  <div data-testid="m-spacing-sheet">
    <label class="sl"><span>Letter spacing</span>
      <input type="range" min="-20" max="200" step="0.5" value={ts.letterSpacing ?? 0} data-testid="m-letter-spacing" oninput={(e) => ed.updateTextStyle({ letterSpacing: num(e) }, key('ls'))} onchange={end} />
      <b>{ts.letterSpacing ?? 0}</b></label>
    <label class="sl"><span>Line spacing</span>
      <input type="range" min="0.5" max="4" step="0.05" value={ts.lineHeight ?? t0.style.lineHeight} data-testid="m-line-height" oninput={(e) => ed.updateTextStyle({ lineHeight: num(e) }, key('lh'))} onchange={end} />
      <b>{(ts.lineHeight ?? t0.style.lineHeight).toFixed(2)}</b></label>
  </div>
{:else if mobile.sheet === 'opacity' && sel.length}
  <label class="sl" data-testid="m-opacity-sheet"><span>Transparency</span>
    <input type="range" min="0" max="100" value={opacity} data-testid="m-opacity" oninput={(e) => ed.update({ opacity: num(e) / 100 }, key('op'))} onchange={end} />
    <b>{opacity}</b></label>
  <label class="sl"><span>Blend</span>
    <select class="input" value={sel[0]?.blend ?? ''} data-testid="m-blend" onchange={(e) => { ed.update({ blend: ((e.currentTarget as HTMLSelectElement).value || undefined) as BlendMode | undefined }); end(); }}>
      {#each BLEND_MODES as m (m.mode)}<option value={m.mode}>{m.label}</option>{/each}
    </select>
  </label>
{:else if mobile.sheet === 'pages'}
  <div class="pages" data-testid="m-pages-sheet">
    {#each ed.doc.pages as p, i (p.id)}
      <div class="pg" class:cur={p.id === ed.pageId}>
        <button class="thumb" style="aspect-ratio:{ed.doc.width} / {ed.doc.height}" aria-label="Page {i + 1}" data-testid="m-page-{i}" onclick={() => go(i)}>
          {#if thumbs[p.id]}<img src={thumbs[p.id]} alt="" />{/if}
        </button>
        <div class="pa">
          <span>{i + 1}</span>
          <button aria-label="Move page up" disabled={i === 0} onclick={() => ed.movePage(p.id, -1)}><Icon name="up" size={16} /></button>
          <button aria-label="Move page down" disabled={i === ed.doc.pages.length - 1} onclick={() => ed.movePage(p.id, 1)}><Icon name="down" size={16} /></button>
          <button aria-label="Duplicate page" onclick={() => ed.duplicatePage(p.id)}><Icon name="copy" size={16} /></button>
          <button aria-label="Delete page" disabled={ed.doc.pages.length < 2} onclick={() => ed.removePage(p.id)}><Icon name="trash" size={16} /></button>
        </div>
      </div>
    {/each}
    <button class="pg addp" data-testid="m-add-page" onclick={() => { ed.select([], ed.doc.pages[ed.doc.pages.length - 1]!.id); ed.addPage(); }}><Icon name="plus" size={22} /> Add page</button>
  </div>
{/if}

<style>
  .row { display: flex; align-items: center; gap: 8px; padding: 8px 0; }
  .rb { width: 44px; height: 44px; border-radius: 22px; border: 1px solid var(--line); background: var(--field); color: var(--ink); display: grid; place-items: center; flex-shrink: 0; }
  .rng { flex: 1; min-width: 0; accent-color: var(--accent); height: 32px; }
  .val { width: 64px; height: 40px; border: 1px solid var(--line); border-radius: 8px; background: var(--field); color: var(--ink); text-align: center; font-size: 16px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 6px 0; }
  .grid button { height: 48px; display: flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid var(--line); border-radius: 10px; background: var(--field); color: var(--ink); font-size: 13px; }
  button.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
  .seg { display: flex; gap: 8px; padding: 6px 0; }
  .seg button { flex: 1; height: 44px; border: 1px solid var(--line); border-radius: 10px; background: var(--field); color: var(--ink); display: grid; place-items: center; }
  .sl { display: grid; grid-template-columns: 1fr 48px; grid-template-areas: 'l l' 'r v'; align-items: center; gap: 4px 10px; padding: 8px 0; }
  .sl span { grid-area: l; font-size: 13px; color: var(--muted); }
  .sl input { grid-area: r; accent-color: var(--accent); height: 32px; }
  .sl b { grid-area: v; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
  .pages { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; padding: 4px 0; }
  .pg { display: flex; flex-direction: column; gap: 4px; }
  .thumb { width: 100%; padding: 0; border: 2px solid transparent; border-radius: 8px; background: #fff; overflow: hidden; box-shadow: var(--page-shadow); }
  .pg.cur .thumb { border-color: var(--accent); }
  .thumb img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .pa { display: flex; align-items: center; gap: 2px; }
  .pa span { flex: 1; font-size: 13px; font-weight: 600; }
  .pa button { width: 32px; height: 32px; border: 0; border-radius: 8px; background: transparent; color: var(--ink); display: grid; place-items: center; }
  .pa button:disabled { opacity: .35; }
  .addp { min-height: 120px; border: 2px dashed var(--line); border-radius: 8px; background: transparent; color: var(--ink); align-items: center; justify-content: center; font-weight: 600; flex-direction: row; gap: 6px; }
</style>
