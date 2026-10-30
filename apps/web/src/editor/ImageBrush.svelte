<script lang="ts">
  /**
   * Paint a mask over a picture: BG Remover's Erase/Restore, the Blur brush,
   * Magic Eraser and Magic Edit. Sits exactly on the element (CSS transform =
   * its rotation and flips); pointer events are in the element's own space, so
   * a stroke lands on the same image pixels at any zoom, on a phone too.
   */
  import { coverCrop, findElement, type ImageElement } from '@digital-canvas/scene';
  import { untrack } from 'svelte';
  import type { EditorState } from '../lib/editor.svelte.ts';
  import { brush } from '../lib/vision/brush.svelte.ts';
  import { eraseMasked, magicEdit, editProvider } from '../lib/vision/tools.svelte.ts';
  import Icon from '../lib/Icon.svelte';

  let { ed, left, top, zoom }: { ed: EditorState; left: number; top: number; zoom: number } = $props();

  const hit = $derived(brush.id ? findElement(ed.doc, brush.id) : null);
  const el = $derived(hit?.element.type === 'image' ? (hit.element as ImageElement) : null);
  const TITLE = { bg: 'BG Remover', blur: 'Blur', erase: 'Magic Eraser', edit: 'Magic Edit' } as const;

  let view = $state<HTMLCanvasElement>();
  /** The mask, in image pixels (at most 2048 on the long side): alpha = painted. */
  let mask: OffscreenCanvas | null = null;
  let source: ImageBitmap | null = null;
  let k = 1;
  let ready = $state(false);
  let painted = $state(false);

  const blobOf = (asset: string) => new Blob([ed.assets.get(asset) as BlobPart], { type: ed.doc.assets[asset]?.mime ?? 'image/png' });

  async function setUp(e: ImageElement): Promise<void> {
    ready = false;
    painted = false;
    source = await createImageBitmap(blobOf(brush.tool === 'bg' ? e.original ?? e.asset : e.asset));
    k = Math.min(1, 2048 / Math.max(source.width, source.height));
    const w = Math.round(source.width * k), h = Math.round(source.height * k);
    mask = new OffscreenCanvas(w, h);
    const g = mask.getContext('2d', { willReadFrequently: true })!;
    const start = brush.tool === 'bg' ? e.asset : brush.tool === 'blur' ? e.blurBrush?.asset : undefined;
    if (start && ed.assets.has(start)) {
      const b = await createImageBitmap(blobOf(start));
      g.drawImage(b, 0, 0, w, h);
      b.close();
      if (e.blurBrush) brush.intensity = e.blurBrush.intensity;
    }
    ready = true;
    redraw();
  }

  $effect(() => {
    const id = brush.id;
    if (!id) return;
    const e = untrack(() => el);
    if (e) void setUp(e);
    return () => { source?.close(); source = null; mask = null; };
  });

  const crop = () => { const e = el!, m = ed.doc.assets[e.asset]; return e.crop ?? coverCrop(m?.width ?? e.w, m?.height ?? e.h, e.w, e.h); };

  function redraw(): void {
    if (!view || !mask || !source || !el) return;
    const c = crop(), W = view.width, H = view.height;
    const g = view.getContext('2d')!;
    g.clearRect(0, 0, W, H);
    const sx = c.x * mask.width, sy = c.y * mask.height, sw = c.w * mask.width, sh = c.h * mask.height;
    if (brush.tool === 'bg') {
      // the picture through the mask, on a checkerboard; what's gone shows faintly red
      const s = 12;
      for (let y = 0; y < H; y += s) for (let x = 0; x < W; x += s) {
        g.fillStyle = ((x + y) / s) % 2 ? '#ffffff' : '#e3e5e9';
        g.fillRect(x, y, s, s);
      }
      if (brush.showOriginal) {
        g.drawImage(source, c.x * source.width, c.y * source.height, c.w * source.width, c.h * source.height, 0, 0, W, H);
        return;
      }
      g.globalAlpha = 0.28;
      g.drawImage(source, c.x * source.width, c.y * source.height, c.w * source.width, c.h * source.height, 0, 0, W, H);
      g.globalAlpha = 1;
      const t = new OffscreenCanvas(W, H), tg = t.getContext('2d')!;
      tg.drawImage(mask, sx, sy, sw, sh, 0, 0, W, H);
      tg.globalCompositeOperation = 'source-in';
      tg.drawImage(source, c.x * source.width, c.y * source.height, c.w * source.width, c.h * source.height, 0, 0, W, H);
      g.drawImage(t, 0, 0);
    } else {
      const t = new OffscreenCanvas(W, H), tg = t.getContext('2d')!;
      tg.drawImage(mask, sx, sy, sw, sh, 0, 0, W, H);
      tg.globalCompositeOperation = 'source-in';
      tg.fillStyle = 'rgba(139,92,246,.55)';
      tg.fillRect(0, 0, W, H);
      g.drawImage(t, 0, 0);
    }
  }
  $effect(() => { void brush.showOriginal; redraw(); });

  /** Element-space pointer → mask pixels. */
  function toMask(e: PointerEvent): { x: number; y: number } {
    const c = crop(), r = view!, u = e.offsetX / r.clientWidth, v = e.offsetY / r.clientHeight;
    return { x: (c.x + u * c.w) * mask!.width, y: (c.y + v * c.h) * mask!.height };
  }

  let last: { x: number; y: number } | null = null;

  function stroke(p: { x: number; y: number }): void {
    const g = mask!.getContext('2d')!;
    const c = crop();
    const scale = (mask!.width * c.w) / (el!.w * zoom); // screen px → mask px
    g.save();
    g.globalCompositeOperation = brush.mode === 'remove' ? 'destination-out' : 'source-over';
    g.strokeStyle = g.fillStyle = '#fff';
    g.lineCap = g.lineJoin = 'round';
    g.lineWidth = brush.size * scale;
    g.beginPath();
    g.moveTo((last ?? p).x, (last ?? p).y);
    g.lineTo(p.x + 0.01, p.y);
    g.stroke();
    g.restore();
    last = p;
    painted = true;
    redraw();
  }

  function down(e: PointerEvent): void {
    if (!ready || e.button > 0) return;
    e.preventDefault();
    e.stopPropagation();
    view!.setPointerCapture(e.pointerId);
    last = null;
    stroke(toMask(e));
  }
  function move(e: PointerEvent): void {
    cursor = { x: e.offsetX, y: e.offsetY };
    if (last) { e.stopPropagation(); stroke(toMask(e)); }
  }
  function up(e: PointerEvent): void {
    e.stopPropagation();
    last = null;
  }
  let cursor = $state<{ x: number; y: number } | null>(null);

  const png = async (c: OffscreenCanvas) => new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());

  async function done(): Promise<void> {
    const e = el;
    if (!e || !mask || !source) return brush.close();
    const tool = brush.tool, m = mask, src = source, prompt = brush.prompt;
    if (tool === 'bg') {
      const out = new OffscreenCanvas(src.width, src.height), g = out.getContext('2d')!;
      g.drawImage(src, 0, 0);
      g.globalCompositeOperation = 'destination-in';
      g.imageSmoothingQuality = 'high';
      g.drawImage(m, 0, 0, src.width, src.height);
      const id = await ed.addAsset(await png(out), 'image/png', `${(ed.doc.assets[e.asset]?.name ?? 'image').replace(/\.[^.]+$/, '')} (refined).png`);
      if (id) { ed.update({ asset: id, original: e.original ?? e.asset, matte: undefined }, null, [e.id]); ed.seal(); }
    } else if (tool === 'blur') {
      const id = await ed.addAsset(await png(m), 'image/png', 'blur brush.png');
      if (id) { ed.update({ blurBrush: { asset: id, intensity: brush.intensity } }, null, [e.id]); ed.seal(); }
    } else if (tool === 'erase') {
      const bytes = await png(m);
      brush.close();
      return eraseMasked(ed, e, bytes);
    } else {
      const bytes = await png(m);
      brush.close();
      return magicEdit(ed, e, bytes, prompt);
    }
    brush.close();
  }

  function wholeImage(): void {
    if (!mask) return;
    const g = mask.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, mask.width, mask.height);
    painted = true;
    redraw();
  }

  function clearAll(): void {
    if (!mask) return;
    mask.getContext('2d')!.clearRect(0, 0, mask.width, mask.height);
    painted = false;
    redraw();
  }

  function keys(e: KeyboardEvent): void {
    if (e.key === 'Escape' && brush.id) { e.stopPropagation(); brush.close(); }
  }

  const needKey = $derived(brush.tool === 'edit' && !editProvider() && !ed.imageEditor);
  const canApply = $derived(ready && (brush.tool === 'bg' || brush.tool === 'blur' || (painted && (brush.tool !== 'edit' || (!!brush.prompt.trim() && !needKey)))));
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const addLabel = $derived(brush.tool === 'bg' ? 'Restore' : 'Brush');
  const removeLabel = $derived(brush.tool === 'bg' ? 'Erase' : 'Undo brush');
</script>

<svelte:window onkeydown={keys} />

{#if el}
  {@const w = el.w * zoom}
  {@const h = el.h * zoom}
  <canvas bind:this={view} class="paint" data-testid="brush-canvas" width={Math.round(w * dpr)} height={Math.round(h * dpr)}
    style:left="{left}px" style:top="{top}px" style:width="{w}px" style:height="{h}px"
    style:transform="rotate({el.rotation}deg) scale({el.flipX ? -1 : 1}, {el.flipY ? -1 : 1})"
    onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onpointerleave={() => (cursor = null)}></canvas>
  {#if cursor && !el.rotation}
    <i class="ring" style:left="{left + cursor.x}px" style:top="{top + cursor.y}px" style:width="{brush.size}px" style:height="{brush.size}px"></i>
  {/if}
  <div class="bar" data-testid="brush-bar" role="toolbar" aria-label="{TITLE[brush.tool]} brush">
    <b>{TITLE[brush.tool]}</b>
    <div class="seg" role="group">
      <button class:on={brush.mode === 'add'} data-testid="brush-add" onclick={() => (brush.mode = 'add')}>{addLabel}</button>
      <button class:on={brush.mode === 'remove'} data-testid="brush-remove" onclick={() => (brush.mode = 'remove')}>{removeLabel}</button>
    </div>
    <label class="s"><span>Size</span><input type="range" min="6" max="200" bind:value={brush.size} data-testid="brush-size" /></label>
    {#if brush.tool === 'blur'}
      <label class="s"><span>Intensity</span><input type="range" min="1" max="100" bind:value={brush.intensity} data-testid="brush-intensity" /></label>
      <button class="ghost" data-testid="brush-whole" onclick={wholeImage}>Whole image</button>
    {/if}
    {#if brush.tool === 'bg'}
      <label class="check"><input type="checkbox" bind:checked={brush.showOriginal} data-testid="brush-original" /> Show original</label>
    {/if}
    {#if brush.tool === 'edit'}
      <input class="prompt" placeholder={needKey ? 'Needs an OpenAI or Google key' : 'Describe what goes here'} bind:value={brush.prompt} disabled={needKey} data-testid="brush-prompt" />
    {/if}
    {#if brush.tool !== 'bg'}<button class="ghost" onclick={clearAll} disabled={!painted}>Clear</button>{/if}
    <button class="ghost" data-testid="brush-cancel" onclick={() => brush.close()}>Cancel</button>
    <button class="go" data-testid="brush-done" disabled={!canApply} onclick={() => void done()}><Icon name="check" size={16} /> {brush.tool === 'erase' ? 'Erase' : brush.tool === 'edit' ? 'Generate' : 'Done'}</button>
  </div>
{/if}

<style>
  .paint { position: absolute; z-index: 30; transform-origin: center; touch-action: none; cursor: crosshair; pointer-events: auto; }
  .ring { position: absolute; z-index: 31; border: 1.5px solid #fff; outline: 1px solid rgba(0,0,0,.5); border-radius: 50%; transform: translate(-50%, -50%); pointer-events: none; }
  .bar { position: absolute; z-index: 32; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 10px; max-width: calc(100% - 16px); padding: 8px 12px; background: var(--pop); color: var(--ink); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow); font-size: 13px; pointer-events: auto; }
  .seg { display: flex; padding: 2px; background: var(--chip); border-radius: 8px; }
  .seg button { border: 0; background: none; border-radius: 6px; padding: 6px 10px; font-weight: 600; color: var(--muted); }
  .seg button.on { background: var(--panel); color: var(--ink); box-shadow: 0 1px 2px rgba(0,0,0,.18); }
  .s { display: flex; align-items: center; gap: 6px; color: var(--muted); }
  .s input { width: 96px; }
  .check { display: flex; align-items: center; gap: 4px; }
  .prompt { min-width: 200px; height: 32px; padding: 0 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--field); color: var(--ink); }
  .ghost { border: 0; background: none; color: var(--ink-2); padding: 6px 8px; border-radius: 6px; }
  .ghost:hover:not(:disabled) { background: var(--hover); }
  .go { display: flex; align-items: center; gap: 4px; border: 0; background: var(--accent); color: #fff; padding: 7px 12px; border-radius: 8px; font-weight: 600; }
  .go:disabled { opacity: .45; }
</style>
