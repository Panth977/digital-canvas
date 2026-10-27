<script lang="ts">
  /** A Canva panel section: title, "See all", and a sideways-scrolling row with arrows. */
  import type { Snippet } from 'svelte';
  import Icon from '../../lib/Icon.svelte';

  let { title, seeAll, children, testid }: { title: string; seeAll?: () => void; children: Snippet; testid?: string } = $props();

  let track = $state<HTMLDivElement>();
  let canL = $state(false), canR = $state(false);

  function update(): void {
    if (!track) return;
    canL = track.scrollLeft > 2;
    canR = track.scrollLeft + track.clientWidth < track.scrollWidth - 2;
  }

  $effect(() => {
    if (!track) return;
    const ro = new ResizeObserver(update);
    ro.observe(track);
    const mo = new MutationObserver(update);
    mo.observe(track, { childList: true, subtree: true });
    update();
    return () => { ro.disconnect(); mo.disconnect(); };
  });

  const go = (d: number) => track?.scrollBy({ left: d * track.clientWidth * 0.8, behavior: 'smooth' });
</script>

<section class="row" data-testid={testid}>
  <header>
    <h3>{title}</h3>
    {#if seeAll}<button class="see" onclick={seeAll} data-testid={testid ? `${testid}-all` : undefined}>See all</button>{/if}
  </header>
  <div class="wrap">
    <div class="strip" bind:this={track} onscroll={update}>{@render children()}</div>
    {#if canL}<button class="arrow l" aria-label="Scroll {title} left" onclick={() => go(-1)}><Icon name="left" size={16} /></button>{/if}
    {#if canR}<button class="arrow r" aria-label="Scroll {title} right" onclick={() => go(1)}><Icon name="right" size={16} /></button>{/if}
  </div>
</section>

<style>
  .row { margin-top: 22px; }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  h3 { margin: 0; font-size: 15px; font-weight: 600; }
  .see { border: 0; background: none; color: var(--ink-2); font-size: 13px; font-weight: 500; padding: 2px 4px; border-radius: 4px; }
  .see:hover { text-decoration: underline; }
  .wrap { position: relative; }
  .strip { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; scroll-snap-type: x proximity; }
  .strip::-webkit-scrollbar { display: none; }
  .strip > :global(*) { flex-shrink: 0; scroll-snap-align: start; }
  .arrow { position: absolute; top: 50%; transform: translateY(-50%); width: 32px; height: 32px; border-radius: 50%; border: 0; display: grid; place-items: center; background: var(--pop); color: var(--ink); box-shadow: var(--shadow); z-index: 2; }
  .arrow:hover { background: var(--field); filter: brightness(1.1); }
  .arrow.l { left: -6px; }
  .arrow.r { right: -6px; }
</style>
