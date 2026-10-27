<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from '../../lib/Icon.svelte';

  /**
   * Canva mobile's bottom sheet: drag the grabber up for full height, down to
   * go back to half height or close. `auto` fits small tool sheets.
   */
  let { title = '', size = $bindable('half'), onclose, children, testid = 'sheet' }: {
    title?: string;
    size?: 'auto' | 'half' | 'full';
    onclose: () => void;
    children: Snippet;
    testid?: string;
  } = $props();

  let el = $state<HTMLElement>();
  let dy = $state(0);
  let base = $state(0);
  let dragging = $state(false);
  let start = 0, t0 = 0;

  function down(e: PointerEvent): void {
    if ((e.target as HTMLElement).closest('button')) return;
    dragging = true;
    start = e.clientY;
    t0 = performance.now();
    base = el?.offsetHeight ?? 0;
    dy = 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent): void {
    if (dragging) dy = e.clientY - start;
  }
  function up(): void {
    if (!dragging) return;
    dragging = false;
    const v = dy / Math.max(1, performance.now() - t0); // px per ms
    if (dy > base * 0.3 || v > 0.6) {
      if (size === 'full') size = 'half';
      else onclose();
    } else if (dy < -60 || v < -0.6) size = 'full';
    dy = 0;
  }
  // down: slide the sheet; up: grow it
  const style = $derived(dragging ? (dy > 0 ? `transform:translateY(${dy}px)` : `height:${base - dy}px;max-height:none`) : '');
</script>

<div class="sheet {size}" class:dragging bind:this={el} {style} role="dialog" aria-label={title || 'Panel'} data-testid={testid} data-size={size} data-text-tools>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="grab" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} data-testid="sheet-handle">
    <i aria-hidden="true"></i>
    {#if title}<h3>{title}</h3>{/if}
    <button class="x" aria-label="Close" data-testid="sheet-close" onclick={onclose}><Icon name="close" size={18} /></button>
  </div>
  <div class="body scroll-y">{@render children()}</div>
</div>

<style>
  .sheet {
    position: absolute; left: 0; right: 0; bottom: 0; z-index: 40; display: flex; flex-direction: column;
    background: var(--panel); color: var(--ink); border-radius: 16px 16px 0 0; box-shadow: 0 -6px 28px rgba(0, 0, 0, .18); border-bottom: 1px solid var(--line);
    transition: height .22s ease, transform .22s ease; will-change: transform;
  }
  .sheet.half { height: 52%; }
  .sheet.full { height: calc(100% - 8px); }
  .sheet.auto { max-height: 60%; }
  .sheet.dragging { transition: none; }
  .grab { position: relative; flex-shrink: 0; padding: 8px 48px 6px; min-height: 28px; touch-action: none; cursor: grab; text-align: center; }
  .grab i { display: block; width: 36px; height: 4px; border-radius: 2px; background: var(--line); margin: 0 auto 6px; }
  .grab h3 { margin: 0; font-size: 15px; font-weight: 600; }
  .x { position: absolute; right: 8px; top: 6px; width: 36px; height: 36px; border: 0; border-radius: 18px; background: transparent; color: var(--muted); display: grid; place-items: center; }
  .body { flex: 1; min-height: 0; padding: 4px 16px 16px; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
  .sheet.auto .body { flex: initial; }
</style>
