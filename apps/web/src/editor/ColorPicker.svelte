<script lang="ts">
  import { untrack } from 'svelte';
  import { hexToHsv, hsvToHex, normHex, type HSV } from '../lib/uiutil.ts';
  import Icon from '../lib/Icon.svelte';

  /**
   * Canva's custom colour picker: a saturation/brightness square, a hue
   * slider, the hex code and the eyedropper (no browser colour dialog).
   */
  let { value, onchange, onend, hex = true, testid }: {
    value: string;
    /** While dragging. */
    onchange: (hex: string) => void;
    /** Drag released, hex entered, colour picked from the screen. */
    onend?: () => void;
    /** Show the hex field and eyedropper row. */
    hex?: boolean;
    testid?: string;
  } = $props();

  // Keep our own HSV so hue survives greys and black while dragging.
  let hsv = $state<HSV>(untrack(() => hexToHsv(value)));
  let last = $state(untrack(() => normHex(value) ?? '#000000'));
  $effect(() => {
    const v = normHex(value) ?? '#000000';
    untrack(() => { if (v !== last) { last = v; hsv = hexToHsv(v); draft = v; } });
  });
  let draft = $state(untrack(() => normHex(value) ?? '#000000'));

  function emit(next: HSV): void {
    hsv = next;
    last = hsvToHex(next);
    draft = last;
    onchange(last);
  }

  function drag(e: PointerEvent, fn: (fx: number, fy: number) => void): void {
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const at = (ev: PointerEvent) => fn(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)));
    el.setPointerCapture(e.pointerId);
    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); onend?.(); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  function keySv(e: KeyboardEvent): void {
    const d = e.shiftKey ? 0.1 : 0.02;
    const m: Record<string, [number, number]> = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] };
    const v = m[e.key];
    if (!v) return;
    e.preventDefault();
    emit({ ...hsv, s: Math.max(0, Math.min(1, hsv.s + v[0])), v: Math.max(0, Math.min(1, hsv.v + v[1])) });
    onend?.();
  }
  function keyHue(e: KeyboardEvent): void {
    const d = (e.shiftKey ? 30 : 5) * (e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : 0);
    if (!d) return;
    e.preventDefault();
    emit({ ...hsv, h: (hsv.h + d + 360) % 360 });
    onend?.();
  }

  function typed(): void {
    const v = normHex(draft);
    if (v && v !== last) { last = v; hsv = hexToHsv(v); onchange(v); onend?.(); }
  }

  const canPick = typeof window !== 'undefined' && 'EyeDropper' in window;
  async function pick(): Promise<void> {
    const Dropper = (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;
    try {
      const { sRGBHex } = await new Dropper().open();
      const v = normHex(sRGBHex);
      if (v) { last = v; hsv = hexToHsv(v); draft = v; onchange(v); onend?.(); }
    } catch { /* cancelled */ }
  }
</script>

<div class="cp" data-testid={testid ?? 'color-picker'}>
  <div class="sv" role="slider" tabindex="0" aria-label="Saturation and brightness" aria-valuetext="{Math.round(hsv.s * 100)}% saturation, {Math.round(hsv.v * 100)}% brightness" aria-valuenow={Math.round(hsv.v * 100)}
    style="--hue: hsl({hsv.h} 100% 50%)" data-testid="cp-square"
    onpointerdown={(e) => drag(e, (x, y) => emit({ ...hsv, s: x, v: 1 - y }))} onkeydown={keySv}>
    <i style="left:{hsv.s * 100}%;top:{(1 - hsv.v) * 100}%;background:{last}"></i>
  </div>
  <div class="hue" role="slider" tabindex="0" aria-label="Hue" aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(hsv.h)} data-testid="cp-hue"
    onpointerdown={(e) => drag(e, (x) => emit({ ...hsv, h: Math.min(359.9, x * 360) }))} onkeydown={keyHue}>
    <i style="left:{(hsv.h / 360) * 100}%;background:hsl({hsv.h} 100% 50%)"></i>
  </div>
  {#if hex}
    <div class="row">
      <span class="chip" style="background:{last}"></span>
      <input class="input hexin" bind:value={draft} spellcheck="false" aria-label="Hex code" data-testid="cp-hex"
        oninput={() => { if (/^#?[0-9a-f]{6}$/i.test(draft.trim())) typed(); }} onblur={() => { typed(); draft = last; }} onkeydown={(e) => e.key === 'Enter' && typed()} />
      {#if canPick}<button type="button" class="pick" title="Pick a colour from the screen" aria-label="Eyedropper" onclick={pick}><Icon name="picker" size={16} /></button>{/if}
    </div>
  {/if}
</div>

<style>
  .cp { display: flex; flex-direction: column; gap: 12px; }
  .sv { position: relative; height: 150px; border-radius: 8px; cursor: crosshair; touch-action: none;
    background: linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, var(--hue)); }
  .sv i, .hue i { position: absolute; width: 16px; height: 16px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.35), 0 1px 3px rgba(0,0,0,.4); transform: translate(-50%, -50%); pointer-events: none; }
  .hue { position: relative; height: 12px; border-radius: 6px; cursor: pointer; touch-action: none;
    background: linear-gradient(to right, #f00 0%, #ff0 16.66%, #0f0 33.33%, #0ff 50%, #00f 66.66%, #f0f 83.33%, #f00 100%); }
  .hue i { top: 50%; }
  .sv:focus-visible, .hue:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .row { display: flex; align-items: center; gap: 8px; }
  .chip { width: 32px; height: 32px; flex-shrink: 0; border-radius: 6px; box-shadow: inset 0 0 0 1px rgba(127,127,127,.4); }
  .hexin { flex: 1; min-width: 0; font-family: ui-monospace, Menlo, monospace; text-transform: lowercase; }
  .pick { flex-shrink: 0; width: 32px; height: 32px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); color: var(--ink-2); }
  .pick:hover { color: var(--accent); border-color: var(--accent); }
</style>
