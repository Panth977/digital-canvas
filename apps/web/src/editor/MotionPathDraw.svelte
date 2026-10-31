<script lang="ts">
  /**
   * Canva's "Create an animation": drag on the page to draw the path the
   * selected element will follow. Covers the current page; a ghost of the
   * element follows the pointer; the drawing's own pace is kept (style Original).
   */
  import { findElement, MAX_ANIMATION_DURATION, type Animation, type MotionPath } from '@digital-canvas/scene';
  import type { EditorState } from '../lib/editor.svelte.ts';
  import { motionDraw } from '../lib/motionpath.svelte.ts';
  import { pathFromSamples } from '../lib/motionpath.ts';
  import { ui } from '../lib/ui.svelte.ts';

  let { ed, left, top, zoom }: { ed: EditorState; left: number; top: number; zoom: number } = $props();

  const el = $derived(motionDraw.id ? findElement(ed.doc, motionDraw.id)?.element ?? null : null);
  let samples = $state<{ x: number; y: number; t: number }[]>([]);
  let drawing = $state(false);
  let box = $state<HTMLDivElement>();

  const at = (e: PointerEvent) => {
    const r = box!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom, t: performance.now() / 1000 };
  };
  function down(e: PointerEvent): void {
    e.stopPropagation();
    e.preventDefault();
    box?.setPointerCapture(e.pointerId);
    drawing = true;
    samples = [at(e)];
  }
  function move(e: PointerEvent): void {
    if (!drawing) return;
    e.stopPropagation();
    samples = [...samples, at(e)];
  }
  function up(e: PointerEvent): void {
    if (!drawing) return;
    e.stopPropagation();
    drawing = false;
    const got = pathFromSamples(samples);
    const target = el;
    if (!got || !target) { samples = []; return; }
    const old = target.animation?.type === 'custom' ? target.animation : undefined;
    const path: MotionPath = { style: 'original', rotation: 'none', ...old?.path, points: got.points };
    const animation: Animation = { type: 'custom', duration: Math.max(0.5, Math.min(MAX_ANIMATION_DURATION, Math.round(got.seconds * 10) / 10)), path };
    ed.update({ animation }, null, [target.id]);
    ed.seal();
    motionDraw.stop();
    ui.open('animate', false);
  }
  const line = $derived(samples.map((s) => `${s.x * zoom},${s.y * zoom}`).join(' '));
  const tip = $derived(samples[samples.length - 1]);
  const start = $derived(samples[0]);
  function key(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.stopPropagation(); motionDraw.stop(); }
  }
</script>

<svelte:window onkeydowncapture={key} />
{#if el}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="draw" bind:this={box} style:left="{left}px" style:top="{top}px" style:width="{ed.doc.width * zoom}px" style:height="{ed.doc.height * zoom}px"
    data-testid="motion-draw" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}>
    <svg width="100%" height="100%" aria-hidden="true">
      {#if samples.length}<polyline points={line} />{/if}
    </svg>
    {#if tip && start}
      <div class="ghost" style:left="{(el.x + tip.x - start.x) * zoom}px" style:top="{(el.y + tip.y - start.y) * zoom}px" style:width="{el.w * zoom}px" style:height="{el.h * zoom}px"></div>
    {:else}
      <div class="ghost idle" style:left="{el.x * zoom}px" style:top="{el.y * zoom}px" style:width="{el.w * zoom}px" style:height="{el.h * zoom}px"></div>
    {/if}
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="bar" role="status" onpointerdown={(e) => e.stopPropagation()}>
    <span>Drag on the page to draw the path. It plays at the pace you draw.</span>
    <button class="btn" data-testid="motion-cancel" onclick={() => motionDraw.stop()}>Cancel</button>
  </div>
{/if}

<style>
  .draw { position: absolute; z-index: 8; cursor: crosshair; touch-action: none; background: rgba(125, 42, 232, .06); outline: 2px dashed var(--accent); outline-offset: -2px; }
  svg { position: absolute; inset: 0; pointer-events: none; }
  polyline { fill: none; stroke: var(--accent); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 2 7; }
  .ghost { position: absolute; border: 2px solid var(--accent); border-radius: 3px; background: rgba(125, 42, 232, .16); pointer-events: none; }
  .ghost.idle { background: none; border-style: dashed; }
  .bar { position: absolute; z-index: 9; left: 50%; top: 12px; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; padding: 6px 8px 6px 14px; border-radius: 10px; background: var(--panel); box-shadow: 0 4px 16px rgba(0,0,0,.25); font-size: 13px; white-space: nowrap; }
</style>
