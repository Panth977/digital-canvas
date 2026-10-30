<script lang="ts">
  /** Crop mode's controls: ratio presets, straighten and tilt, rotate, flip, crop to a shape. */
  import { CROP_RATIOS, cropPatch, FRAMES, ratioFrame, type ImageElement, type Rect, type VideoElement } from '@digital-canvas/scene';
  import type { EditorState } from '../lib/editor.svelte.ts';
  import Icon from '../lib/Icon.svelte';

  let { ed, el, frame, img }: { ed: EditorState; el: ImageElement | VideoElement; frame: Rect; img: Rect } = $props();

  const end = () => ed.seal();
  let ratioId = $state('free');
  let more = $state(false);

  function pick(id: string, ratio: number | null): void {
    ratioId = id;
    if (!ratio) return;
    ed.update(cropPatch(el, ratioFrame(frame, img, ratio), img));
    end();
  }
  const set = (k: 'straighten' | 'tiltX' | 'tiltY', v: number) => ed.update({ [k]: v || undefined }, `crop-${k}:${el.id}`);
  const SHAPES = FRAMES.filter((f) => f.id !== 'polaroid' && f.id !== 'portrait').slice(0, 10);
  const curShape = $derived(el.type === 'image' ? SHAPES.find((f) => JSON.stringify(f.mask) === JSON.stringify(el.mask))?.id ?? '' : '');
  function shape(id: string): void {
    if (el.type !== 'image') return;
    const f = SHAPES.find((x) => x.id === id);
    ed.update(f ? { mask: f.mask, radius: (f.radius ?? 0) * Math.min(el.w, el.h) } : { mask: undefined, radius: 0 });
    end();
  }
</script>

<div class="cb" role="toolbar" aria-label="Crop" tabindex="-1" data-testid="crop-bar" onpointerdown={(e) => e.stopPropagation()}>
  <div class="row scroll">
    {#each CROP_RATIOS as r (r.id)}
      <button class="pill" class:on={ratioId === r.id} data-testid="ratio-{r.id}" onclick={() => pick(r.id, r.ratio)}>{r.label}</button>
    {/each}
  </div>
  <div class="row">
    <label class="s"><span>Straighten</span>
      <input type="range" min="-45" max="45" value={el.straighten ?? 0} data-testid="crop-straighten" oninput={(e) => set('straighten', Number((e.currentTarget as HTMLInputElement).value))} onchange={end} ondblclick={() => { set('straighten', 0); end(); }} />
      <output>{el.straighten ?? 0}°</output>
    </label>
    <button class="pill" title="Rotate 90°" aria-label="Rotate 90 degrees" data-testid="crop-rotate" onclick={() => { ed.update({ rotation: (el.rotation + 90) % 360 }); end(); }}><Icon name="rotate" size={16} /></button>
    <button class="pill" title="Flip horizontal" aria-label="Flip horizontal" onclick={() => { ed.update((e) => ({ flipX: !e.flipX })); end(); }}><Icon name="flipx" size={16} /></button>
    <button class="pill" title="Flip vertical" aria-label="Flip vertical" onclick={() => { ed.update((e) => ({ flipY: !e.flipY })); end(); }}><Icon name="flipy" size={16} /></button>
    <button class="pill" class:on={more} data-testid="crop-more" onclick={() => (more = !more)}>More</button>
    <button class="pill" data-testid="crop-reset" onclick={() => { ed.update({ crop: undefined, straighten: undefined, tiltX: undefined, tiltY: undefined }); ratioId = 'free'; end(); }}>Reset</button>
    <button class="go" data-testid="crop-done" onclick={() => ed.stopCrop()}>Done</button>
  </div>
  {#if more}
    <div class="row">
      <label class="s"><span>Tilt ↔</span><input type="range" min="-100" max="100" value={el.tiltX ?? 0} data-testid="crop-tiltx" oninput={(e) => set('tiltX', Number((e.currentTarget as HTMLInputElement).value))} onchange={end} ondblclick={() => { set('tiltX', 0); end(); }} /></label>
      <label class="s"><span>Tilt ↕</span><input type="range" min="-100" max="100" value={el.tiltY ?? 0} data-testid="crop-tilty" oninput={(e) => set('tiltY', Number((e.currentTarget as HTMLInputElement).value))} onchange={end} ondblclick={() => { set('tiltY', 0); end(); }} /></label>
      {#if el.type === 'image'}
        <label class="s"><span>Shape</span>
          <select class="input" value={curShape} data-testid="crop-shape" onchange={(e) => shape((e.currentTarget as HTMLSelectElement).value)}>
            <option value="">None</option>
            {#each SHAPES as f (f.id)}<option value={f.id}>{f.label}</option>{/each}
          </select>
        </label>
      {/if}
    </div>
  {/if}
</div>

<style>
  .cb { position: absolute; z-index: 32; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; width: max-content; max-width: calc(100% - 16px); padding: 8px 12px; background: var(--pop); color: var(--ink); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow); font-size: 13px; pointer-events: auto; }
  .row { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px; }
  .row.scroll { flex-wrap: nowrap; overflow-x: auto; justify-content: flex-start; scrollbar-width: none; }
  .pill { flex: 0 0 auto; display: inline-flex; align-items: center; border: 1px solid var(--line); background: var(--chip); color: var(--ink); border-radius: 8px; padding: 5px 9px; font-size: 12px; font-weight: 600; }
  .pill.on { border-color: var(--accent); color: var(--accent); }
  .s { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; }
  .s input[type='range'] { width: 110px; }
  .s output { min-width: 30px; font-variant-numeric: tabular-nums; }
  .s select { height: 28px; }
  .go { border: 0; background: var(--accent); color: #fff; padding: 6px 14px; border-radius: 8px; font-weight: 600; }
</style>
