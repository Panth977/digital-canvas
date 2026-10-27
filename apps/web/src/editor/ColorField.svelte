<script lang="ts">
  import Icon from '../lib/Icon.svelte';
  import ColorPicker from './ColorPicker.svelte';
  import { normHex } from '../lib/uiutil.ts';

  let { label, value, onchange, onend, testid, open = $bindable(false) }: {
    label: string;
    value: string;
    /** Fires while dragging in the picker. */
    onchange: (hex: string) => void;
    /** Fires when the user is done (drag released, hex entered). */
    onend?: () => void;
    testid?: string;
    /** Our colour picker under the field is showing. */
    open?: boolean;
  } = $props();

  const hex6 = $derived(value.length >= 7 ? value.slice(0, 7) : value);
  let draft = $state('');
  $effect(() => { draft = hex6; });

  /** The browser's eyedropper (Chrome, Edge): pick a colour from anywhere on screen. */
  const canPick = typeof window !== 'undefined' && 'EyeDropper' in window;
  async function pick(): Promise<void> {
    const Dropper = (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;
    try {
      const { sRGBHex } = await new Dropper().open();
      onchange(sRGBHex.toLowerCase());
      onend?.();
    } catch { /* cancelled */ }
  }

  function commitDraft(): void {
    const v = draft.trim().startsWith('#') ? draft.trim() : `#${draft.trim()}`;
    if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) {
      if (v.toLowerCase() !== hex6.toLowerCase()) { onchange(v.toLowerCase()); onend?.(); }
    } else draft = hex6;
  }
  /** A full hex code applies as you type it. */
  function typing(): void {
    const v = normHex(draft);
    if (v && /^#?[0-9a-f]{6}$/i.test(draft.trim()) && v !== hex6.toLowerCase()) onchange(v);
  }
</script>

<div class="color">
  <span class="lab">{label}</span>
  <span class="row">
    <button type="button" class="swatch" class:on={open} style="--c:{value}" aria-label="{label}: choose a colour" aria-expanded={open} onclick={() => (open = !open)}><i></i></button>
    <input class="input hex" bind:value={draft} oninput={typing} onblur={commitDraft} onkeydown={(e) => e.key === 'Enter' && commitDraft()} aria-label="{label} hex" data-testid={testid} />
    {#if canPick}
      <button type="button" class="pick" title="Pick a colour from the screen" aria-label="Pick {label} from the screen" onclick={pick}><Icon name="picker" size={15} /></button>
    {/if}
  </span>
  {#if open}
    <div class="pop"><ColorPicker value={hex6} {onchange} {onend} hex={false} testid={testid ? `${testid}-picker` : undefined} /></div>
  {/if}
</div>

<style>
  .color { display: flex; flex-direction: column; gap: 4px; }
  .lab { font-size: 12px; color: var(--muted); font-weight: 600; }
  .row { display: flex; gap: 6px; align-items: center; }
  .swatch { position: relative; width: 32px; height: 32px; flex-shrink: 0; border-radius: 8px; border: 1px solid var(--line); overflow: hidden; padding: 0; cursor: pointer;
    background-image: linear-gradient(45deg, #ddd 25%, transparent 25%, transparent 75%, #ddd 75%), linear-gradient(45deg, #ddd 25%, transparent 25%, transparent 75%, #ddd 75%);
    background-size: 10px 10px; background-position: 0 0, 5px 5px; }
  .swatch i { position: absolute; inset: 0; background: var(--c); }
  .swatch.on { outline: 2px solid var(--accent); outline-offset: 1px; }
  .pick { flex-shrink: 0; width: 32px; height: 32px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); color: var(--ink-2); }
  .pick:hover { color: var(--accent); border-color: var(--accent); }
  .hex { min-width: 0; font-family: ui-monospace, Menlo, monospace; text-transform: lowercase; }
  .pop { margin-top: 6px; padding: 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--pop); }
</style>
