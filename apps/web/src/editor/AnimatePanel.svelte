<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    ANIMATIONS, DEFAULT_ANIMATION_DURATION, animateAt, animationDuration, animationEnd,
    type Animation, type AnimationDirection, type AnimationType,
  } from '@digital-canvas/scene';
  import type { EditorState } from '../lib/editor.svelte.ts';
  import Icon from '../lib/Icon.svelte';

  /**
   * Canva's Animate panel: enter animations for the selected elements or the
   * whole page, their speed and direction, and a small live preview.
   */
  let { ed }: { ed: EditorState } = $props();

  const sel = $derived(ed.selected);
  let tab = $state<'element' | 'page'>('element');
  $effect(() => { if (!sel.length) tab = 'page'; });
  const onElements = $derived(tab === 'element' && sel.length > 0);

  /** The animation shown as picked: the selection's (when all agree) or the page's. */
  const current = $derived.by((): Animation | undefined => {
    if (!onElements) return ed.page.animation;
    const a = sel[0]!.animation;
    return sel.every((e) => JSON.stringify(e.animation) === JSON.stringify(a)) ? a : undefined;
  });
  const info = $derived(ANIMATIONS.find((x) => x.type === current?.type));

  const key = (k: string) => `anim:${k}:${onElements ? ed.selection.join(',') : ed.pageId}`;

  function set(a: Animation | undefined, k: string | null = null): void {
    if (onElements) ed.update({ animation: a }, k);
    else ed.updatePage({ animation: a }, k);
    if (!k) ed.seal();
  }
  function pick(type: AnimationType | null): void {
    set(type ? { type, ...(current?.duration ? { duration: current.duration } : {}), ...(current?.direction ? { direction: current.direction } : {}) } : undefined);
    if (type) play();
  }
  function patch(p: Partial<Animation>, k: string | null = null): void {
    if (current) set({ ...current, ...p }, k);
  }
  const DIRS: { d: AnimationDirection; label: string; icon: 'left' | 'right' | 'up' | 'down' }[] = [
    { d: 'left', label: 'From the left', icon: 'right' }, { d: 'right', label: 'From the right', icon: 'left' },
    { d: 'up', label: 'From the top', icon: 'down' }, { d: 'down', label: 'From the bottom', icon: 'up' },
  ];

  // ---- preview: the current page, animated, drawn small ----
  let cv = $state<HTMLCanvasElement>();
  let playing = $state(false);
  let raf = 0;
  let t0 = 0;
  let last = 0;
  const PW = 288;
  const ph = $derived(Math.round((PW * ed.doc.height) / ed.doc.width));

  function draw(t: number): void {
    const c = cv;
    if (!c) return;
    const doc = ed.doc, page = ed.page;
    const ck = ed.engine.ck;
    const W = c.width, H = c.height;
    const surface = ck.MakeSurface(W, H);
    if (!surface) return;
    try {
      const canvas = surface.getCanvas();
      canvas.clear(ck.WHITE);
      canvas.save();
      canvas.scale(W / doc.width, H / doc.height);
      ed.renderer.drawPage(canvas, doc, animateAt(doc, page, t));
      canvas.restore();
      surface.flush();
      const img = surface.makeImageSnapshot();
      const px = img.readPixels(0, 0, { width: W, height: H, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array;
      img.delete();
      c.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer, px.byteOffset, px.length), W, H), 0, 0);
    } finally {
      surface.delete();
    }
  }

  function play(): void {
    cancelAnimationFrame(raf);
    playing = true;
    t0 = performance.now();
    last = 0;
    const loop = (now: number) => {
      const t = (now - t0) / 1000;
      const end = Math.max(1.5, animationEnd(ed.page) + 0.4);
      if (now - last >= 1000 / 15) { // ~15 fps is plenty for a thumbnail
        last = now;
        draw(Math.min(t, end));
      }
      if (t < end) raf = requestAnimationFrame(loop);
      else playing = false;
    };
    raf = requestAnimationFrame(loop);
  }

  // still frame when the design changes and nothing is playing
  $effect(() => {
    void ed.doc; void ed.pageId; void cv; void ph;
    if (!playing) queueMicrotask(() => draw(1e6));
  });
  onDestroy(() => cancelAnimationFrame(raf));
</script>

<div class="ap" data-testid="animate-panel">
  <div class="tabs" role="tablist">
    <button role="tab" aria-selected={tab === 'element'} class:on={tab === 'element'} disabled={!sel.length} data-testid="anim-tab-element" onclick={() => (tab = 'element')}>Element animations</button>
    <button role="tab" aria-selected={tab === 'page'} class:on={tab === 'page'} data-testid="anim-tab-page" onclick={() => (tab = 'page')}>Page animations</button>
  </div>

  <div class="pv">
    <canvas bind:this={cv} width={PW} height={ph} data-testid="anim-preview" style:aspect-ratio="{ed.doc.width} / {ed.doc.height}"></canvas>
    <button class="btn play" data-testid="anim-play" onclick={play} disabled={playing}><Icon name={playing ? 'pause' : 'play'} size={16} /> {playing ? 'Playing…' : 'Play'}</button>
  </div>

  <div class="grid">
    <button class="tile" class:on={!current} data-testid="anim-none" onclick={() => pick(null)}>
      <span class="demo none"><Icon name="close" size={20} /></span>
      <span>None</span>
    </button>
    {#each ANIMATIONS as a (a.type)}
      <button class="tile" class:on={current?.type === a.type} data-testid="anim-{a.type}" onclick={() => pick(a.type)}>
        <span class="demo"><i class="dot a-{a.type}">{a.type === 'typewriter' ? 'Ab' : ''}</i></span>
        <span>{a.label}</span>
      </button>
    {/each}
  </div>

  {#if current}
    <div class="field">
      <span>Speed · {animationDuration(current).toFixed(1)} s</span>
      <input type="range" min="0.2" max="3" step="0.1" value={current.duration ?? DEFAULT_ANIMATION_DURATION} data-testid="anim-duration"
        oninput={(e) => patch({ duration: Number((e.currentTarget as HTMLInputElement).value) }, key('dur'))}
        onchange={() => { ed.seal(); play(); }} />
    </div>
    {#if info?.directional}
      <div class="dirs" role="group" aria-label="Direction">
        {#each DIRS as d (d.d)}
          <button class="btn icon" class:on={(current.direction ?? (current.type === 'pan' || current.type === 'wipe' || current.type === 'drift' ? 'left' : 'down')) === d.d} title={d.label} aria-label={d.label} data-testid="anim-dir-{d.d}"
            onclick={() => { patch({ direction: d.d }); ed.seal(); play(); }}><Icon name={d.icon} size={16} /></button>
        {/each}
      </div>
    {/if}
    <p class="hint">{onElements ? 'Plays when the page starts' : 'Every element without its own animation enters, one after another'}. Presentations, MP4 and GIF downloads play it.</p>
  {/if}
</div>

<style>
  .ap { display: flex; flex-direction: column; gap: 12px; }
  .tabs { display: flex; gap: 2px; padding: 3px; background: var(--chip); border-radius: 9px; }
  .tabs button { flex: 1; border: 0; background: none; border-radius: 7px; padding: 7px 4px; font-size: 13px; font-weight: 600; color: var(--muted); }
  .tabs button.on { background: var(--panel); color: var(--ink); box-shadow: 0 1px 2px rgba(0,0,0,.18); }
  .tabs button:disabled { opacity: .45; }
  .pv { position: relative; display: grid; place-items: center; background: var(--chip); border-radius: 8px; padding: 10px; }
  .pv canvas { max-width: 100%; max-height: 200px; width: auto; height: auto; border-radius: 3px; box-shadow: var(--page-shadow); background: #fff; }
  .play { position: absolute; right: 8px; bottom: 8px; height: 30px; padding: 0 10px; gap: 6px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .tile { display: flex; flex-direction: column; align-items: center; gap: 4px; border: 0; background: none; padding: 0; font-size: 12px; color: var(--ink-2); }
  .demo { width: 100%; aspect-ratio: 1; display: grid; place-items: center; border-radius: 8px; background: var(--chip); border: 2px solid transparent; overflow: hidden; color: var(--muted); }
  .tile.on .demo { border-color: var(--accent); }
  .tile:hover .demo { background: var(--hover); }
  .dot { width: 34%; aspect-ratio: 1; border-radius: 6px; background: var(--accent); display: grid; place-items: center; color: #fff; font-style: normal; font-weight: 700; font-size: 13px; }
  .tile:hover .a-rise { animation: rise .8s ease-out; }
  .tile:hover .a-pan { animation: pan .8s ease-out; }
  .tile:hover .a-fade { animation: fade .8s ease-out; }
  .tile:hover .a-pop { animation: pop .6s cubic-bezier(.34,1.56,.64,1); }
  .tile:hover .a-wipe { animation: wipe .8s ease-out; }
  .tile:hover .a-typewriter { animation: type .8s steps(3); }
  .tile:hover .a-baseline { animation: rise .8s ease-out; }
  .tile:hover .a-drift { animation: pan 1.4s linear; }
  .tile:hover .a-tumble { animation: tumble .8s ease-out; }
  @keyframes rise { from { transform: translateY(60%); opacity: 0; } }
  @keyframes pan { from { transform: translateX(-80%); opacity: 0; } }
  @keyframes fade { from { opacity: 0; } }
  @keyframes pop { from { transform: scale(0); } }
  @keyframes wipe { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
  @keyframes type { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
  @keyframes tumble { from { transform: rotate(-90deg) scale(.6); opacity: 0; } }
  .field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; font-weight: 600; }
  .field input { width: 100%; }
  .dirs { display: flex; gap: 6px; }
  .hint { color: var(--muted); font-size: 12px; line-height: 1.5; margin: 0; }
</style>
