<script lang="ts">
  import { mount, onMount, unmount, untrack } from 'svelte';
  import { drawFrameAt } from '@digital-canvas/render';
  import { holdTime, pageDuration, pageStart } from '@digital-canvas/scene';
  import type { EditorState } from '../lib/editor.svelte.ts';
  import { Stopwatch, clock, nextPage, type PresentMode, type PresenterActions, type PresenterState } from '../lib/present.ts';
  import { mobile } from '../lib/mobile.svelte.ts';
  import Icon from '../lib/Icon.svelte';
  import PresenterWindow from './PresenterWindow.svelte';
  import presenterCss from './presenter.css?inline';

  /**
   * Share ▸ Present: a full-screen, read-only slideshow that plays. Pages run
   * on the editor's player and are drawn by render `drawFrameAt`, so animations,
   * transitions, video clips and sound are the same as in the MP4. A manual
   * page stops when it is complete; autoplay moves on by itself; presenter view
   * opens a second window with notes, next page and timers.
   * ←/→, Space, click: next / previous; Esc closes.
   */
  let { ed, onclose, start = 0, mode = 'standard', presenter = true }: { ed: EditorState; onclose: () => void; start?: number; mode?: PresentMode; presenter?: boolean } = $props();

  let box = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();
  const pages = $derived(ed.doc.pages.filter((p) => !p.hidden));
  const first = untrack(() => Math.min(start, Math.max(0, ed.doc.pages.filter((p) => !p.hidden).length - 1)));
  let index = $state(first);
  let auto = $state(untrack(() => mode === 'auto'));
  /** Autoplay: seconds per page; 0 = each page's own length. */
  let seconds = $state(0);
  let loop = $state(false);
  let blocked = $state(false);
  const hasWindow = () => !!win && !win.closed;

  const player = untrack(() => ed.player);
  const doc = () => ed.doc;
  let raf = 0;
  let pageSince = performance.now();
  let lastDrawn = -1;
  let dirty = true;

  // ---- drawing ----
  function size(): { W: number; H: number } {
    const k = Math.min(innerWidth / doc().width, innerHeight / doc().height) * Math.min(1.5, devicePixelRatio);
    const s = Math.min(k, 1920 / Math.max(doc().width, doc().height));
    return { W: Math.max(2, Math.round(doc().width * s)), H: Math.max(2, Math.round(doc().height * s)) };
  }
  function draw(t: number): void {
    const c = canvas;
    if (!c) return;
    const ck = ed.engine.ck;
    const { W, H } = size();
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const surface = ck.MakeSurface(W, H);
    if (!surface) return;
    try {
      const cv = surface.getCanvas();
      cv.clear(ck.WHITE);
      cv.save();
      cv.scale(W / doc().width, H / doc().height);
      drawFrameAt(ed.renderer, cv, doc(), t);
      cv.restore();
      surface.flush();
      const img = surface.makeImageSnapshot();
      const px = img.readPixels(0, 0, { width: W, height: H, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array;
      img.delete();
      c.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer, px.byteOffset, px.length), W, H), 0, 0);
    } finally {
      surface.delete();
    }
  }

  // ---- the clock is the player: it keeps clips and sounds in step ----
  const pageOf = (i: number) => pages[i]!;
  const startOf = (i: number) => pageStart(doc(), pageOf(i).id);
  /** A manual page stops here: complete, before any exit. */
  const stopAt = (i: number) => startOf(i) + Math.min(pageDuration(pageOf(i)) - 0.001, holdTime(pageOf(i)) > 0 ? holdTime(pageOf(i)) - 0.001 : 0);

  async function show(i: number): Promise<void> {
    index = i;
    pageSince = performance.now();
    pageWatch.reset();
    player.pause();
    await player.seek(startOf(i), false);
    if (index !== i) return;
    dirty = true;
    player.play();
    syncPresenter();
  }

  function go(d: number): void {
    const n = index + d;
    if (n >= 0 && n < pages.length) void show(n);
  }

  function tick(): void {
    raf = requestAnimationFrame(tick);
    const i = index;
    if (!pages[i]) return;
    const end = stopAt(i);
    if (player.playing && player.time >= end) { player.pause(); dirty = true; }
    if (auto) {
      const wait = seconds > 0 ? seconds : pageDuration(pageOf(i));
      if ((performance.now() - pageSince) / 1000 >= wait) {
        const n = nextPage(i, pages.length, loop);
        if (n !== null) void show(n);
        else auto = false;
        return;
      }
    }
    const t = Math.min(player.time, end);
    if (dirty || t !== lastDrawn) {
      draw(t);
      lastDrawn = t;
      dirty = false;
    }
    if (hasWindow()) { shared.total = clock(watch.seconds); shared.pageTime = clock(pageWatch.seconds); }
  }

  // ---- presenter view ----
  const watch = new Stopwatch();
  const pageWatch = new Stopwatch();
  let win: Window | null = null;
  let mounted: ReturnType<typeof mount> | null = null;
  const urls = new Map<string, string>();
  const shared: PresenterState = $state({ index: first, count: 0, notes: '', currentUrl: '', nextUrl: '', total: '0:00', pageTime: '0:00', timerRunning: true, auto: false, fontSize: 20 });

  function urlOf(i: number): string {
    const p = pages[i];
    if (!p) return '';
    let url = urls.get(p.id);
    if (!url) {
      const scale = Math.min(1, 900 / Math.max(doc().width, doc().height));
      url = URL.createObjectURL(new Blob([ed.exportPage(p.id, 'png', scale) as BlobPart], { type: 'image/png' }));
      urls.set(p.id, url);
    }
    return url;
  }
  function syncPresenter(): void {
    if (!hasWindow()) return;
    shared.index = index;
    shared.count = pages.length;
    shared.notes = pageOf(index).notes ?? '';
    shared.currentUrl = urlOf(index);
    shared.nextUrl = urlOf(index + 1);
    shared.auto = auto;
    shared.timerRunning = watch.running;
  }
  const actions: PresenterActions = {
    go,
    toggleTimer() { if (watch.running) watch.pause(); else watch.resume(); shared.timerRunning = watch.running; },
    resetTimer() { watch.reset(); pageWatch.reset(); },
    toggleAuto() { auto = !auto; shared.auto = auto; pageSince = performance.now(); },
    font(d) { shared.fontSize = Math.max(12, Math.min(48, shared.fontSize + d)); },
    end: close,
  };
  function openPresenter(): void {
    if (hasWindow()) { win!.focus(); return; }
    win = window.open('', 'dc-presenter', 'popup,width=1100,height=720');
    if (!win) { blocked = true; return; }
    blocked = false;
    const d = win.document;
    d.title = `Presenter view: ${ed.doc.title}`;
    d.body.replaceChildren();
    d.head.querySelector('style[data-dc]')?.remove();
    const style = d.createElement('style');
    style.dataset.dc = '1';
    style.textContent = presenterCss;
    d.head.append(style);
    win.addEventListener('keydown', key);
    win.addEventListener('pagehide', () => { win = null; });
    syncPresenter();
    mounted = mount(PresenterWindow, { target: d.body, props: { s: shared, act: actions } });
  }
  function closePresenter(): void {
    if (mounted) void unmount(mounted);
    mounted = null;
    if (win && !win.closed) win.close();
    win = null;
  }

  function key(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); go(-1); }
    else if (e.key === 'Home') void show(0);
    else if (e.key === 'End') void show(pages.length - 1);
  }

  function close(): void {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    onclose();
  }

  onMount(() => {
    const wasTime = player.time;
    player.quiet = true;
    if (mode === 'presenter' && presenter) openPresenter();
    void box?.requestFullscreen?.().catch(() => { /* not allowed (tests, iframes): the overlay still covers the window */ });
    // Esc in full screen leaves full screen first (the browser eats that key): close with it
    let wasFull = false;
    const change = () => { if (document.fullscreenElement) wasFull = true; else if (wasFull) onclose(); };
    document.addEventListener('fullscreenchange', change);
    const resized = () => { dirty = true; };
    addEventListener('resize', resized);
    box?.focus();
    void show(first);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('fullscreenchange', change);
      removeEventListener('resize', resized);
      closePresenter();
      for (const u of urls.values()) URL.revokeObjectURL(u);
      player.pause();
      player.quiet = false;
      void player.seek(wasTime, false);
    };
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="present" bind:this={box} tabindex="0" role="dialog" aria-label="Presentation" data-testid="present" data-auto={auto} onkeydowncapture={key}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <canvas bind:this={canvas} data-testid="present-page" data-index={index} aria-label="Page {index + 1}" onclick={() => go(1)}></canvas>
  {#if blocked}<p class="blocked" role="alert" data-testid="present-blocked">The browser blocked the presenter window. Allow pop-ups for this site, then press Presenter view again.</p>{/if}
  <div class="bar">
    <button aria-label="Previous page" onclick={() => go(-1)} disabled={index === 0}><Icon name="left" size={20} /></button>
    <span data-testid="present-count">{index + 1} / {pages.length}</span>
    <button aria-label="Next page" onclick={() => go(1)} disabled={index === pages.length - 1}><Icon name="right" size={20} /></button>
    <button class="txt" class:on={auto} aria-pressed={auto} data-testid="present-auto" onclick={() => { auto = !auto; pageSince = performance.now(); syncPresenter(); }}>Autoplay</button>
    {#if auto}
      <select aria-label="Seconds per page" bind:value={seconds} data-testid="present-seconds">
        <option value={0}>Page length</option>
        {#each [3, 5, 10, 15, 30] as s (s)}<option value={s}>{s} s</option>{/each}
      </select>
      <label class="loop"><input type="checkbox" bind:checked={loop} data-testid="present-loop" /> Loop</label>
    {/if}
    {#if presenter && !mobile.on}<button class="txt" data-testid="present-presenter" onclick={openPresenter}>Presenter view</button>{/if}
    <button aria-label="Exit presentation" onclick={close} data-testid="present-close"><Icon name="close" size={20} /></button>
  </div>
</div>

<style>
  .present { position: fixed; inset: 0; z-index: 200; background: #000; display: grid; place-items: center; outline: none; }
  canvas { max-width: 100vw; max-height: 100vh; cursor: pointer; user-select: none; }
  .blocked { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); margin: 0; padding: 8px 14px; border-radius: 8px; background: #fff; color: #111; font-size: 13px; }
  .bar { position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; background: rgba(30,30,30,.8); color: #fff; border-radius: 999px; padding: 4px 8px; opacity: .2; transition: opacity .2s; font-size: 13px; white-space: nowrap; }
  .present:hover .bar, .bar:focus-within { opacity: 1; }
  .bar button { width: 36px; height: 36px; border: 0; border-radius: 50%; background: transparent; color: #fff; display: grid; place-items: center; }
  .bar button.txt { width: auto; border-radius: 18px; padding: 0 12px; font-size: 13px; font-weight: 600; }
  .bar button.on { background: #7d2ae8; }
  .bar button:hover:not(:disabled):not(.on) { background: rgba(255,255,255,.15); }
  .bar button:disabled { opacity: .35; }
  .bar select { height: 30px; border-radius: 8px; border: 0; background: rgba(255,255,255,.15); color: #fff; font-size: 13px; }
  .bar select option { color: #111; }
  .loop { display: flex; align-items: center; gap: 4px; }
</style>
