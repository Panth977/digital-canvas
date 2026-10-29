<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { EditorState } from '../lib/editor.svelte.ts';
  import Icon from '../lib/Icon.svelte';

  /**
   * Share ▸ Present: a full-screen, read-only slideshow. Each page is drawn
   * once as a picture at screen size (video pages show their first frame).
   * ←/→, Space, click: next / previous; Esc closes.
   */
  let { ed, onclose, start = 0 }: { ed: EditorState; onclose: () => void; start?: number } = $props();

  let box = $state<HTMLDivElement>();
  let index = $state(untrack(() => start));
  const urls = new Map<string, string>();
  let src = $state('');
  const pages = $derived(ed.doc.pages);

  function draw(i: number): void {
    const p = pages[i];
    if (!p) return;
    let url = urls.get(p.id);
    if (!url) {
      const scale = Math.min(2, Math.max(0.25, (Math.min(innerWidth / ed.doc.width, innerHeight / ed.doc.height)) * devicePixelRatio));
      url = URL.createObjectURL(new Blob([ed.exportPage(p.id, 'png', scale) as BlobPart], { type: 'image/png' }));
      urls.set(p.id, url);
    }
    src = url;
  }

  $effect(() => draw(index));

  function go(d: number): void {
    const n = index + d;
    if (n >= 0 && n < pages.length) index = n;
  }

  function key(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); go(-1); }
    else if (e.key === 'Home') index = 0;
    else if (e.key === 'End') index = pages.length - 1;
  }

  function close(): void {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    onclose();
  }

  onMount(() => {
    void box?.requestFullscreen?.().catch(() => { /* not allowed (tests, iframes): the overlay still covers the window */ });
    // Esc in full screen leaves full screen first (the browser eats that key): close with it
    let wasFull = false;
    const change = () => { if (document.fullscreenElement) wasFull = true; else if (wasFull) onclose(); };
    document.addEventListener('fullscreenchange', change);
    box?.focus();
    return () => {
      document.removeEventListener('fullscreenchange', change);
      for (const u of urls.values()) URL.revokeObjectURL(u);
    };
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="present" bind:this={box} tabindex="0" role="dialog" aria-label="Presentation" data-testid="present" onkeydowncapture={key}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <img {src} alt="Page {index + 1}" data-testid="present-page" data-index={index} onclick={() => go(1)} />
  <div class="bar">
    <button aria-label="Previous page" onclick={() => go(-1)} disabled={index === 0}><Icon name="left" size={20} /></button>
    <span data-testid="present-count">{index + 1} / {pages.length}</span>
    <button aria-label="Next page" onclick={() => go(1)} disabled={index === pages.length - 1}><Icon name="right" size={20} /></button>
    <button aria-label="Exit presentation" onclick={close} data-testid="present-close"><Icon name="close" size={20} /></button>
  </div>
</div>

<style>
  .present { position: fixed; inset: 0; z-index: 200; background: #000; display: grid; place-items: center; outline: none; }
  img { max-width: 100vw; max-height: 100vh; object-fit: contain; cursor: pointer; user-select: none; }
  .bar { position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; background: rgba(30,30,30,.8); color: #fff; border-radius: 999px; padding: 4px 8px; opacity: .2; transition: opacity .2s; font-size: 13px; }
  .present:hover .bar, .bar:focus-within { opacity: 1; }
  .bar button { width: 36px; height: 36px; border: 0; border-radius: 50%; background: transparent; color: #fff; display: grid; place-items: center; }
  .bar button:hover:not(:disabled) { background: rgba(255,255,255,.15); }
  .bar button:disabled { opacity: .35; }
</style>
