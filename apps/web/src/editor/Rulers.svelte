<script lang="ts" module>
  /** Ruler thickness, screen px. */
  export const RULER = 20;
</script>

<script lang="ts">
  import { PX_PER, type Unit } from '@digital-canvas/scene';

  /**
   * Rulers along the top and left of the stage, in the design's unit, zero at
   * the current page's top-left corner. Drag out of one to make a guide.
   */
  let { zoom, origin, width, height, unit, vw, vh, onstart }: {
    zoom: number;
    /** Screen position of the current page's top-left corner. */
    origin: { x: number; y: number };
    width: number;
    height: number;
    unit: Unit;
    vw: number;
    vh: number;
    onstart: (axis: 'x' | 'y', e: PointerEvent) => void;
  } = $props();

  /** Screen px per unit, and a round step that leaves ~60 px between labels. */
  const scale = $derived(zoom * PX_PER[unit]);
  const step = $derived.by(() => {
    const want = 60 / scale;
    const p = 10 ** Math.floor(Math.log10(want));
    return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= want) ?? 10 * p;
  });

  function ticks(from: number, to: number, o: number): { at: number; major: boolean; label: string }[] {
    const out: { at: number; major: boolean; label: string }[] = [];
    const minor = step / 5;
    const v0 = Math.floor((from - o) / scale / minor) * minor, v1 = (to - o) / scale;
    for (let i = 0, v = v0; v <= v1 && i < 2000; i++, v = v0 + i * minor) {
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      out.push({ at: o + v * scale, major, label: major ? String(Math.round(v * 100) / 100) : '' });
    }
    return out;
  }

  const top = $derived(ticks(RULER, vw, origin.x));
  const left = $derived(ticks(RULER, vh, origin.y));
</script>

<div class="ruler top" data-testid="ruler-top" role="presentation" onpointerdown={(e) => onstart('y', e)} style="width:{vw}px;height:{RULER}px">
  <div class="page" style="left:{origin.x}px;width:{(width / PX_PER[unit]) * scale}px"></div>
  <svg width={vw} height={RULER}>
    {#each top as t (t.at)}
      <line x1={t.at} x2={t.at} y1={t.major ? 6 : 14} y2={RULER} />
      {#if t.label}<text x={t.at + 3} y="10">{t.label}</text>{/if}
    {/each}
  </svg>
</div>
<div class="ruler left" data-testid="ruler-left" role="presentation" onpointerdown={(e) => onstart('x', e)} style="width:{RULER}px;height:{vh}px">
  <div class="page" style="top:{origin.y}px;height:{(height / PX_PER[unit]) * scale}px"></div>
  <svg width={RULER} height={vh}>
    {#each left as t (t.at)}
      <line y1={t.at} y2={t.at} x1={t.major ? 6 : 14} x2={RULER} />
      {#if t.label}<text x="10" y={t.at + 3} transform="rotate(-90 10 {t.at + 3})">{t.label}</text>{/if}
    {/each}
  </svg>
</div>
<div class="corner" style="width:{RULER}px;height:{RULER}px">{unit}</div>

<style>
  .ruler { position: absolute; top: 0; left: 0; background: var(--panel); overflow: hidden; z-index: 2; }
  .ruler.top { border-bottom: 1px solid var(--line); cursor: row-resize; }
  .ruler.left { border-right: 1px solid var(--line); cursor: col-resize; }
  .page { position: absolute; background: var(--chip); }
  .top .page { top: 0; bottom: 0; }
  .left .page { left: 0; right: 0; }
  svg { position: absolute; inset: 0; }
  line { stroke: #9aa0ab; stroke-width: 1; shape-rendering: crispEdges; }
  text { font-size: 9px; fill: var(--muted); }
  .corner { position: absolute; top: 0; left: 0; z-index: 3; background: var(--panel); border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); font-size: 9px; color: var(--muted); display: grid; place-items: center; }
</style>
