<script lang="ts">
  import { splitTip } from './uiutil.ts';
  /**
   * Canva's tooltips: a dark label (with the shortcut) under the button after
   * a short hover. Inside any `[data-tips]` container, an element's `title`
   * becomes such a tooltip (the native one is suppressed).
   */
  let tip = $state<{ label: string; keys: string; x: number; y: number; below: boolean } | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: HTMLElement | null = null;

  function target(e: Event): HTMLElement | null {
    const t = e.target as HTMLElement | null;
    const el = t?.closest?.<HTMLElement>('[title], [data-tip]') ?? null;
    return el && el.closest('[data-tips]') ? el : null;
  }

  function over(e: PointerEvent): void {
    if (e.pointerType === 'touch') return;
    const el = target(e);
    if (el === current) return;
    hide();
    if (!el) return;
    if (el.title) {
      el.dataset.tip = el.title;
      if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', el.title);
      el.removeAttribute('title');
    }
    current = el;
    timer = setTimeout(() => show(el), 350);
  }

  function show(el: HTMLElement): void {
    if (!el.isConnected || !el.dataset.tip) return;
    const r = el.getBoundingClientRect();
    const below = r.bottom + 44 < innerHeight;
    tip = { ...splitTip(el.dataset.tip), x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below };
  }

  function hide(): void {
    clearTimeout(timer);
    current = null;
    tip = null;
  }
</script>

<svelte:window onpointerover={over} onpointerdown={hide} onkeydown={hide} onscroll={hide} />

{#if tip}
  <div class="tip" class:above={!tip.below} role="tooltip" data-testid="tooltip" style="left:{tip.x}px;top:{tip.y}px">
    <span>{tip.label}</span>{#if tip.keys}<kbd>{tip.keys}</kbd>{/if}
  </div>
{/if}

<style>
  .tip { position: fixed; z-index: 2000; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; max-width: 280px; padding: 6px 10px; border-radius: 6px;
    background: #0d1216; color: #fff; font-size: 13px; font-weight: 500; line-height: 1.3; pointer-events: none; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,.25); }
  .tip.above { transform: translate(-50%, -100%); }
  kbd { font: inherit; font-size: 12px; color: rgba(255,255,255,.7); }
  @media (prefers-color-scheme: dark) { .tip { background: #fff; color: #0d1216; } kbd { color: rgba(13,18,22,.6); } }
</style>
