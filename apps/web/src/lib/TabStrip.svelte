<script lang="ts">
  /**
   * Design tabs (Canva's desktop app): Home, one tab per open design, "+".
   * `titlebar`: the installed app draws its own title bar (Window Controls
   * Overlay) and the strip sits next to the traffic lights / caption buttons;
   * the empty part of the bar drags the window. `bar`: the same strip as a
   * thin bar above the editor header.
   */
  import Icon from './Icon.svelte';
  import { tabs } from './tabs.svelte.ts';
  import { dropIndex } from './tabmodel.ts';
  import type { StripMode } from './tabmodel.ts';

  let { mode }: { mode: Exclude<StripMode, 'none'> } = $props();

  let listEl = $state<HTMLDivElement>();
  const active = $derived(tabs.activeId);

  // ---- drag to reorder: the tab follows the pointer, the others make room, it drops on release ----
  let drag = $state<{ id: string; from: number; to: number; dx: number; width: number } | null>(null);
  let press: { id: string; from: number; x: number; centres: number[]; width: number; el: HTMLElement; pointer: number } | null = null;

  function onDown(e: PointerEvent, id: string, i: number): void {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.x')) return;
    if (id !== active) tabs.open(id); // tabs switch on press, like browsers
    const els = [...(listEl?.querySelectorAll<HTMLElement>('[data-tab]') ?? [])];
    const el = els[i];
    if (!el) return;
    press = { id, from: i, x: e.clientX, centres: els.map((t) => { const r = t.getBoundingClientRect(); return r.left + r.width / 2; }), width: el.getBoundingClientRect().width, el, pointer: e.pointerId };
  }

  function onMove(e: PointerEvent): void {
    if (!press) return;
    const dx = e.clientX - press.x;
    if (!drag) {
      if (Math.abs(dx) < 5) return;
      press.el.setPointerCapture?.(press.pointer);
      drag = { id: press.id, from: press.from, to: press.from, dx, width: press.width };
    }
    drag.dx = dx;
    drag.to = dropIndex(press.centres, press.from, press.centres[press.from]! + dx);
  }

  function onUp(): void {
    if (drag && drag.to !== drag.from) tabs.move(drag.from, drag.to);
    drag = null;
    press = null;
  }

  /** How far tab i moves while another one is dragged. */
  function shift(i: number): number {
    const d = drag;
    if (!d) return 0;
    if (i === d.from) return d.dx;
    if (d.from < d.to && i > d.from && i <= d.to) return -d.width;
    if (d.to < d.from && i >= d.to && i < d.from) return d.width;
    return 0;
  }

  // the active tab stays in view when the strip overflows
  $effect(() => {
    const id = active;
    if (!id || !listEl) return;
    void tabs.list.length;
    listEl.querySelector<HTMLElement>(`[data-tab="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  /** A mouse wheel scrolls the strip sideways. */
  function onWheel(e: WheelEvent): void {
    if (!listEl || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    listEl.scrollLeft += e.deltaY;
    e.preventDefault();
  }
</script>

<div class="strip {mode}" data-testid="dtabs" data-mode={mode}>
  <div class="area">
    <button class="home" class:on={!active} onclick={() => tabs.home()} title="Home" aria-label="Home" data-testid="dtab-home"><Icon name="home" size={16} /></button>
    <div class="list" bind:this={listEl} role="tablist" aria-label="Open designs" onwheel={onWheel} class:dragging={!!drag}>
      {#each tabs.list as t, i (t.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div class="tab" class:on={t.id === active} class:lifted={drag?.id === t.id} role="tab" tabindex={t.id === active ? 0 : -1} aria-selected={t.id === active}
          title={t.title} data-tab={t.id} data-testid="dtab-{t.id}" style:transform={drag ? `translateX(${shift(i)}px)` : undefined}
          onpointerdown={(e) => onDown(e, t.id, i)} onpointermove={onMove} onpointerup={onUp} onpointercancel={onUp}
          onmousedown={(e) => { if (e.button === 1) e.preventDefault(); /* no autoscroll */ }}
          onauxclick={(e) => { if (e.button === 1) { e.preventDefault(); tabs.close(t.id); } }}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tabs.open(t.id); } }}>
          <img class="fav" src="/favicon.svg" alt="" draggable="false" />
          <span class="name">{t.title}</span>
          <button class="x" aria-label="Close {t.title}" title="Close (⌘W)" data-testid="dtab-close-{t.id}" onclick={(e) => { e.stopPropagation(); tabs.close(t.id); }}><Icon name="close" size={12} /></button>
        </div>
      {/each}
    </div>
    <button class="new" onclick={(e) => { e.stopPropagation(); tabs.create(); }} title="New design (⌘T)" aria-label="New design" data-testid="dtab-new"><Icon name="plus" size={16} /></button>
    <div class="grip"></div>
  </div>
</div>

<style>
  /* Canva: the title bar is the header's gradient, a little darker */
  .strip { position: relative; flex-shrink: 0; height: 38px; background: var(--header); color: #fff; user-select: none; -webkit-user-select: none; }
  .strip::before { content: ''; position: absolute; inset: 0; background: rgba(9, 6, 30, .26); pointer-events: none; }
  @media (prefers-color-scheme: dark) { .strip::before { background: rgba(9, 6, 30, .5); } }
  .area { position: relative; height: 100%; display: flex; align-items: center; gap: 4px; padding: 0 6px; min-width: 0; }

  /* Window Controls Overlay: draw only in the free area; the rest of the bar moves the window */
  .titlebar { height: var(--tb-h); -webkit-app-region: drag; }
  .titlebar .area { position: absolute; top: var(--tb-y); left: var(--tb-x); width: var(--tb-w); height: var(--tb-h); padding: 0 4px; }
  .titlebar button, .titlebar .tab { -webkit-app-region: no-drag; }

  .home, .new { flex-shrink: 0; width: 30px; height: 28px; display: grid; place-items: center; border: 0; border-radius: 8px; background: transparent; color: rgba(255,255,255,.9); }
  .home:hover, .new:hover { background: rgba(255,255,255,.16); }
  .home.on { background: rgba(255,255,255,.22); color: #fff; }

  .list { flex: 0 1 auto; min-width: 0; height: 100%; display: flex; align-items: center; gap: 2px; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
  .list::-webkit-scrollbar { display: none; }
  .tab { position: relative; flex: 0 1 220px; min-width: 120px; height: calc(100% - 8px); max-height: 30px; display: flex; align-items: center; gap: 8px; padding: 0 4px 0 10px; border-radius: 8px;
    color: rgba(255,255,255,.82); font-size: 12.5px; font-weight: 500; cursor: default; transition: transform .15s ease; }
  .tab:hover { background: rgba(255,255,255,.1); color: #fff; }
  .tab.on { background: rgba(255,255,255,.24); color: #fff; font-weight: 600; }
  .tab.lifted { z-index: 2; transition: none; background: rgba(255,255,255,.3); box-shadow: 0 2px 10px rgba(0,0,0,.25); }
  .tab:focus-visible { outline: 2px solid #fff; outline-offset: -2px; }
  .fav { width: 16px; height: 16px; flex-shrink: 0; border-radius: 4px; }
  .name { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .x { flex-shrink: 0; width: 22px; height: 22px; display: grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: inherit; opacity: .75; }
  .x:hover { opacity: 1; background: rgba(255,255,255,.2); }
  .grip { flex: 1; align-self: stretch; }
</style>
