<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Canvas } from 'canvaskit-wasm';
  import {
    ANIMATIONS, ANIMATION_GROUPS, CUSTOM_ANIMATION, MAX_ANIMATION_DURATION, TRANSITIONS, TRANSITION_MAX, TRANSITION_MIN, animateAt, animationDuration, animationEnd, animationInfo, createDoc, defaultDirection, holdTime, pageDuration, pageStart,
    shape, text, transitionDuration, updateElements, updatePage, addElements, addPage,
    type Animation, type AnimationDirection, type AnimationGroup, type AnimationInfo, type AnimationOrder, type AnimationPhase, type AnimationUnit, type Doc, type MotionPath, type Page, type Transition, type TransitionType,
  } from '@digital-canvas/scene';
  import { drawFrameAt } from '@digital-canvas/render';
  import type { EditorState } from '../lib/editor.svelte.ts';
  import { motionDraw } from '../lib/motionpath.svelte.ts';
  import Icon from '../lib/Icon.svelte';
  import NumField from './NumField.svelte';

  /**
   * Canva's Animate panel: the animation sets for the selection or the page,
   * their options (speed, direction, intensity, In / Out / Both, by letter, word
   * or line, order), hand-drawn paths, page transitions, and previews that play
   * when a tile is hovered. Every preview is the real `animateAt` drawn by the
   * real renderer, so what it shows is what the export holds.
   */
  let { ed }: { ed: EditorState } = $props();

  const sel = $derived(ed.selected);
  let tab = $state<'element' | 'page' | 'transition'>('element');
  $effect(() => { if (!sel.length && tab === 'element') tab = 'page'; });
  const onElements = $derived(tab === 'element' && sel.length > 0);
  const hasText = $derived(sel.some((e) => e.type === 'text'));
  const hasPhoto = $derived(sel.some((e) => e.type === 'image' || e.type === 'video'));

  /** The animation shown as picked: the selection's (when all agree) or the page's. */
  const current = $derived.by((): Animation | undefined => {
    if (!onElements) return ed.page.animation;
    const a = sel[0]!.animation;
    return sel.every((e) => JSON.stringify(e.animation) === JSON.stringify(a)) ? a : undefined;
  });
  const info = $derived(animationInfo(current?.type));
  const custom = $derived(current?.type === CUSTOM_ANIMATION);

  const key = (k: string) => `anim:${k}:${onElements ? ed.selection.join(',') : ed.pageId}`;

  /** The sets that fit what is selected (Canva: the Text and Photo sets follow the selection). */
  const sets = $derived.by(() => {
    const show = (g: AnimationGroup) => {
      if (!onElements) return true;
      if (g === 'text' || g === 'writing') return hasText;
      if (g === 'photo') return hasPhoto;
      return true;
    };
    return ANIMATION_GROUPS.filter((g) => show(g.id)).map((g) => ({ ...g, items: ANIMATIONS.filter((a) => a.groups.includes(g.id)) }));
  });

  function set(a: Animation | undefined, k: string | null = null): void {
    if (onElements) ed.update({ animation: a }, k);
    else ed.updatePage({ animation: a }, k);
    if (!k) ed.seal();
  }
  /** What choosing `i` makes of the current animation: options that still apply stay. */
  function chosen(i: AnimationInfo, group: AnimationGroup): Animation {
    const c = current?.type === CUSTOM_ANIMATION ? undefined : current;
    const out: Animation = { type: i.type };
    if (c?.duration) out.duration = c.duration;
    if (c?.direction && (i.dirs ? i.dirs.includes(c.direction) : i.directional)) out.direction = c.direction;
    if (c?.intensity !== undefined) out.intensity = c.intensity;
    if (c?.order) out.order = c.order;
    if (i.exit) out.phase = 'out';
    else if (c?.phase && !i.loop && !i.span) out.phase = c.phase;
    const unit = (group === 'text' || group === 'writing') && i.by ? i.by : c?.by;
    if (unit && !i.photo && !(i.type === 'typewriter')) out.by = unit;
    return out;
  }
  function pick(i: AnimationInfo | null, group: AnimationGroup = 'basic'): void {
    set(i ? chosen(i, group) : undefined);
    if (i) play();
  }
  function patch(p: Partial<Animation>, k: string | null = null): void {
    if (current) set({ ...current, ...p }, k);
  }
  function patchPath(p: Partial<MotionPath>): void {
    if (current?.path) { patch({ path: { ...current.path, ...p } }); ed.seal(); play(); }
  }
  const DIRS: { d: AnimationDirection; label: string; icon: 'left' | 'right' | 'up' | 'down' }[] = [
    { d: 'left', label: 'From the left', icon: 'right' }, { d: 'right', label: 'From the right', icon: 'left' },
    { d: 'up', label: 'From the top', icon: 'down' }, { d: 'down', label: 'From the bottom', icon: 'up' },
  ];
  const dirs = $derived(DIRS.filter((d) => !info?.dirs || info.dirs.includes(d.d)));
  const PHASES: { id: AnimationPhase; label: string }[] = [{ id: 'in', label: 'In' }, { id: 'out', label: 'Out' }, { id: 'both', label: 'Both' }];
  const UNITS: { id: AnimationUnit; label: string }[] = [{ id: 'element', label: 'Element' }, { id: 'line', label: 'Line' }, { id: 'word', label: 'Word' }, { id: 'letter', label: 'Letter' }];
  const ORDERS: { id: AnimationOrder; label: string }[] = [{ id: 'forward', label: 'In order' }, { id: 'reverse', label: 'Reverse' }, { id: 'center', label: 'From the middle' }, { id: 'random', label: 'Random' }, { id: 'together', label: 'Together' }];
  const STYLES: { id: NonNullable<MotionPath['style']>; label: string }[] = [{ id: 'original', label: 'Original' }, { id: 'smooth', label: 'Smooth' }, { id: 'slow', label: 'Slow' }, { id: 'bounce', label: 'Bounce' }, { id: 'windup', label: 'Wind up' }];
  const ROTATIONS: { id: NonNullable<MotionPath['rotation']>; label: string }[] = [{ id: 'none', label: 'None' }, { id: 'follow', label: 'Follow path' }, { id: 'spin', label: 'Spin' }];

  const maxSpeed = $derived(custom ? MAX_ANIMATION_DURATION : info?.loop ? 6 : 3);
  const phase = $derived(current?.phase ?? (info?.exit ? 'out' : 'in'));
  const showBy = $derived(!!current && !custom && !info?.photo && !info?.span && current.type !== 'typewriter' && (onElements ? hasText : false));

  // ---- timing: when the selected element shows ----
  const one = $derived(onElements && sel.length === 1 ? sel[0]! : null);
  const len = $derived(pageDuration(ed.page));
  function timing(p: { start?: number; end?: number }): void {
    if (!one) return;
    const t = { ...one.timing, ...p };
    const start = t.start && t.start > 0 ? t.start : undefined, end = t.end !== undefined && t.end < len ? t.end : undefined;
    ed.update({ timing: start === undefined && end === undefined ? undefined : { ...(start !== undefined ? { start } : {}), ...(end !== undefined ? { end } : {}) } }, key('timing'));
  }

  // ---- transitions ----
  const tr = $derived(ed.page.transition);
  const trInfo = $derived(TRANSITIONS.find((t) => t.type === tr?.type));
  const first = $derived(ed.pageIndex === 0);
  function setTransition(t: Transition | undefined, k: string | null = null): void {
    ed.updatePage({ transition: t }, k);
    if (!k) ed.seal();
  }
  function pickTransition(type: TransitionType | null): void {
    if (!type) { setTransition(undefined); return; }
    const meta = TRANSITIONS.find((t) => t.type === type);
    setTransition({ type, ...(tr?.duration ? { duration: tr.duration } : {}), ...(meta?.directional && tr?.direction ? { direction: tr.direction } : {}), ...(meta?.color ? { color: tr?.color ?? '#7d2ae8' } : {}) });
    play();
  }
  function applyAll(): void {
    const t = tr;
    ed.commit({ ...ed.doc, pages: ed.doc.pages.map((p, i) => (i === 0 ? p : { ...p, transition: t })) });
    ed.seal();
  }

  // ---- previews ----
  let cv = $state<HTMLCanvasElement>();
  let playing = $state(false);
  let raf = 0;
  const PW = 288;
  const ph = $derived(Math.round((PW * ed.doc.height) / ed.doc.width));
  /** The tile being hovered: type (transition: `tr:type`), and its small canvas. */
  let hover = $state<string | null>(null);
  let tileCv: HTMLCanvasElement | null = null;

  function paint(c: HTMLCanvasElement, draw: (canvas: Canvas) => void, doc: Doc): void {
    const ck = ed.engine.ck;
    const W = c.width, H = c.height;
    const surface = ck.MakeSurface(W, H);
    if (!surface) return;
    try {
      const canvas = surface.getCanvas();
      canvas.clear(ck.WHITE);
      canvas.save();
      canvas.scale(W / doc.width, H / doc.height);
      draw(canvas);
      canvas.restore();
      surface.flush();
      const img = surface.makeImageSnapshot();
      const px = img.readPixels(0, 0, { width: W, height: H, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array;
      img.delete();
      c.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer, px.byteOffset, px.length), W, H), 0, 0);
    } finally {
      surface.delete();
    }
  }

  const drawPageAt = (c: HTMLCanvasElement, doc: Doc, page: Page, t: number) => paint(c, (canvas) => ed.renderer.drawPage(canvas, doc, animateAt(doc, page, t)), doc);

  function draw(t: number, doc: Doc = ed.doc, page: Page = ed.page): void {
    if (cv) drawPageAt(cv, doc, page, t);
  }

  /** Where a preview of this page starts: exits only show at the end. */
  function previewStart(p: Page): number {
    const h = holdTime(p);
    return h < pageDuration(p) ? Math.max(0, h - 0.3) : 0;
  }
  const previewEnd = (p: Page) => Math.max(1.5, Math.min(pageDuration(p), animationEnd(p) + 0.4));

  /** Play this page in the big preview; `tile` runs along on a small canvas. */
  function run(doc: Doc, page: Page, tile?: (t: number) => void): void {
    cancelAnimationFrame(raf);
    const t0 = performance.now();
    const from = previewStart(page), to = Math.max(from + 0.8, previewEnd(page));
    let last = 0;
    const loop = (now: number) => {
      const t = from + (now - t0) / 1000;
      if (now - last >= 1000 / 15) { // ~15 fps is plenty for a thumbnail
        last = now;
        draw(Math.min(t, to), doc, page);
        tile?.(Math.min(t, to));
      }
      if (t < to) raf = requestAnimationFrame(loop);
      else if (hover) { run(doc, page, tile); } // a hovered tile keeps playing
      else playing = false;
    };
    raf = requestAnimationFrame(loop);
  }

  function runTransition(doc: Doc, pageId: string, tile?: (t: number) => void): void {
    cancelAnimationFrame(raf);
    const start = pageStart(doc, pageId);
    const p = doc.pages.find((x) => x.id === pageId)!;
    const lead = Math.max(0, start - 0.25);
    const to = start + (p.transition ? transitionDuration(p.transition) : 0) + 0.5;
    const t0 = performance.now();
    let last = 0;
    const loop = (now: number) => {
      const t = lead + (now - t0) / 1000;
      if (now - last >= 1000 / 15) {
        last = now;
        if (cv) paint(cv, (canvas) => drawFrameAt(ed.renderer, canvas, doc, Math.min(t, to)), doc);
        tile?.(Math.min(t, to));
      }
      if (t < to) raf = requestAnimationFrame(loop);
      else if (hover) runTransition(doc, pageId, tile);
      else playing = false;
    };
    raf = requestAnimationFrame(loop);
  }

  function play(): void {
    playing = true;
    if (tab === 'transition' && !first) runTransition(ed.doc, ed.pageId);
    else run(ed.doc, ed.page);
  }

  /** A little page for tile previews: the motion on a sample, whatever the design holds. */
  function sampleDoc(textual: boolean, a: Animation): Doc {
    const d = createDoc({ width: 100, height: 100 });
    const id = d.pages[0]!.id;
    const el = textual
      ? { ...text('Abc', { x: 12, y: 30, w: 76, h: 36 }), animation: a }
      : { ...shape('rect', { x: 30, y: 30, w: 40, h: 40 }, { type: 'solid', color: '#7d2ae8' }), animation: a };
    if (textual) (el as { style: { fontSize: number; align: string; color: string } }).style = { ...(el as ReturnType<typeof text>).style, fontSize: 28, align: 'center', color: '#7d2ae8' } as never;
    return updatePage(addElements(d, id, [el as never]), id, { duration: 3, background: { type: 'solid', color: '#ffffff' } });
  }

  /** Two pages in two colours, for transition tiles. */
  function sampleTransition(t: Transition): { doc: Doc; pageId: string } {
    let s = createDoc({ width: 100, height: 100 });
    s = updatePage(s, s.pages[0]!.id, { duration: 1, background: { type: 'solid', color: '#c9b6f2' } });
    const r = addPage(s);
    return { doc: updatePage(r.doc, r.pageId, { duration: 2, background: { type: 'solid', color: '#7d2ae8' }, transition: t }), pageId: r.pageId };
  }
  const stillOf = (i: AnimationInfo): Animation => ({ type: i.type, ...(i.exit ? { phase: 'out' as const } : {}), ...(i.by ? { by: i.by } : {}) });
  /** A tile at rest: its own frozen moment of the real motion. */
  function paintStill(c: HTMLCanvasElement, i: AnimationInfo): void {
    const a = stillOf(i), dur = Math.min(animationDuration(a), 1.2);
    const doc = sampleDoc(i.groups.includes('text') || i.groups.includes('writing'), { ...a, duration: dur });
    const t = i.exit ? 3 - dur * 0.45 : i.loop ? dur * 0.2 : dur * (i.by ? 0.25 : 0.45);
    drawPageAt(c, doc, doc.pages[0]!, t);
    c.classList.add('still');
  }
  function paintTransitionStill(c: HTMLCanvasElement, type: TransitionType): void {
    const s = sampleTransition({ type, duration: 0.8, ...(type === 'colorwipe' ? { color: '#ffb020' } : {}) });
    paint(c, (canvas) => drawFrameAt(ed.renderer, canvas, s.doc, 1.32), s.doc);
    c.classList.add('still');
  }
  /** Run once when the tile first scrolls into view (the panel holds about a hundred). */
  function whenSeen(c: HTMLCanvasElement, run: () => void): { destroy(): void } {
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); run(); } });
    io.observe(c);
    return { destroy: () => io.disconnect() };
  }

  function hoverIn(e: PointerEvent, i: AnimationInfo, group: AnimationGroup): void {
    if (e.pointerType === 'touch') return;
    hover = i.type;
    tileCv = (e.currentTarget as HTMLElement).querySelector('canvas');
    const a = chosen(i, group);
    let doc: Doc, page: Page;
    if (onElements) {
      doc = updateElements(ed.doc, ed.selection, { animation: a });
      page = doc.pages.find((p) => p.id === ed.pageId)!;
    } else {
      doc = updatePage(ed.doc, ed.pageId, { animation: a });
      page = doc.pages.find((p) => p.id === ed.pageId)!;
    }
    const photo = !!i.photo;
    const sample = photo ? doc : sampleDoc(i.groups.includes('text') || i.groups.includes('writing'), { ...a, duration: Math.min(animationDuration(a), 1.2) });
    const samplePage = photo ? page : sample.pages[0]!;
    const c = tileCv;
    playing = true;
    run(doc, page, (t) => { if (c) drawPageAt(c, sample, samplePage, photo ? t : (t - previewStart(page)) % Math.max(1.2, previewEnd(samplePage)) + previewStart(samplePage)); });
  }
  function hoverTransition(e: PointerEvent, type: TransitionType): void {
    if (e.pointerType === 'touch') return;
    hover = `tr:${type}`;
    tileCv = (e.currentTarget as HTMLElement).querySelector('canvas');
    const meta = TRANSITIONS.find((t) => t.type === type);
    const t: Transition = { type, duration: tr?.duration ?? 0.8, ...(meta?.directional && tr?.direction ? { direction: tr.direction } : {}), ...(meta?.color ? { color: tr?.color ?? '#7d2ae8' } : {}) };
    // the tile: two colours; the big preview: this page and the one before it
    const { doc: sample, pageId: samplePage } = sampleTransition(t);
    const c = tileCv;
    const offset = first ? 0 : pageStart(ed.doc, ed.pageId) - 1;
    const doc = first ? sample : updatePage(ed.doc, ed.pageId, { transition: t });
    playing = true;
    runTransition(doc, first ? samplePage : ed.pageId, (at) => { if (c) paint(c, (canvas) => drawFrameAt(ed.renderer, canvas, sample, at - offset), sample); });
  }
  function hoverOut(): void {
    const c = tileCv, was = hover;
    hover = null;
    tileCv = null;
    if (c && was?.startsWith('tr:')) paintTransitionStill(c, was.slice(3) as TransitionType);
    else if (c && was) { const i = animationInfo(was); if (i && !i.photo) paintStill(c, i); }
    cancelAnimationFrame(raf);
    playing = false;
    draw(1e6);
  }

  // still frame when the design changes and nothing is playing
  $effect(() => {
    void ed.doc; void ed.pageId; void cv; void ph;
    if (!playing) queueMicrotask(() => draw(holdTime(ed.page) < pageDuration(ed.page) ? holdTime(ed.page) : 1e6));
  });
  onDestroy(() => cancelAnimationFrame(raf));
  const when = $derived(info?.loop ? 'Loops while it shows' : info?.span ? 'Moves for as long as it shows' : custom ? 'Follows the path, then stays at its end' : phase === 'out' ? 'Plays as the page ends' : phase === 'both' ? 'Plays when the page starts and as it ends' : 'Plays when the page starts');
  const hint = $derived(onElements ? when : current?.by === 'page' ? 'The whole page moves as one' : 'Every element without its own animation moves, one after another');
  const directionOf = (a: Animation) => a.direction ?? defaultDirection(a.type) ?? 'down';
</script>

<div class="ap" data-testid="animate-panel">
  <div class="tabs" role="tablist">
    <button role="tab" aria-selected={tab === 'element'} class:on={tab === 'element'} disabled={!sel.length} data-testid="anim-tab-element" onclick={() => (tab = 'element')}>{hasText && sel.length === 1 ? 'Text' : hasPhoto && sel.length === 1 ? 'Photo' : 'Element'}</button>
    <button role="tab" aria-selected={tab === 'page'} class:on={tab === 'page'} data-testid="anim-tab-page" onclick={() => (tab = 'page')}>Page</button>
    <button role="tab" aria-selected={tab === 'transition'} class:on={tab === 'transition'} data-testid="anim-tab-transition" onclick={() => (tab = 'transition')}>Transitions</button>
  </div>

  <div class="pv">
    <canvas bind:this={cv} width={PW} height={ph} data-testid="anim-preview" data-playing={playing} style:aspect-ratio="{ed.doc.width} / {ed.doc.height}"></canvas>
    <button class="btn play" data-testid="anim-play" onclick={play} disabled={playing}><Icon name={playing ? 'pause' : 'play'} size={16} /> {playing ? 'Playing…' : 'Play'}</button>
  </div>

  {#if tab === 'transition'}
    {#if first}<p class="hint" data-testid="tr-first">A transition plays between two pages: pick a later page to use it there. Hover to preview.</p>{/if}
    <div class="grid">
      <button class="tile" class:on={!tr} data-testid="tr-none" onclick={() => pickTransition(null)}>
        <span class="demo none"><Icon name="close" size={20} /></span><span>None</span>
      </button>
      {#each TRANSITIONS as t (t.type)}
        <button class="tile" class:on={tr?.type === t.type} data-testid="tr-{t.type}" disabled={first} onclick={() => pickTransition(t.type)} onpointerenter={(e) => hoverTransition(e, t.type)} onpointerleave={hoverOut}>
          <span class="demo"><canvas width="96" height="96" class:show={hover === `tr:${t.type}`} data-testid="tile-tr-{t.type}" {@attach (c) => { const w = whenSeen(c, () => paintTransitionStill(c, t.type)); return w.destroy; }}></canvas><i class="dot tr"></i></span>
          <span>{t.label}</span>
        </button>
      {/each}
    </div>
    {#if tr}
      <div class="field">
        <span>Duration · {transitionDuration(tr).toFixed(1)} s</span>
        <input type="range" min={TRANSITION_MIN} max={TRANSITION_MAX} step="0.1" value={transitionDuration(tr)} data-testid="tr-duration"
          oninput={(e) => setTransition({ ...tr, duration: Number((e.currentTarget as HTMLInputElement).value) }, `tr:${ed.pageId}`)}
          onchange={() => { ed.seal(); play(); }} />
      </div>
      {#if trInfo?.directional}
        <div class="dirs" role="group" aria-label="Direction">
          {#each DIRS as d (d.d)}
            <button class="btn icon" class:on={(tr.direction ?? 'right') === d.d} title={d.label} aria-label={d.label} data-testid="tr-dir-{d.d}"
              onclick={() => { setTransition({ ...tr, direction: d.d }); play(); }}><Icon name={d.icon} size={16} /></button>
          {/each}
        </div>
      {/if}
      {#if trInfo?.color}
        <label class="row">Colour <input type="color" value={tr.color ?? '#7d2ae8'} data-testid="tr-color" oninput={(e) => setTransition({ ...tr, color: (e.currentTarget as HTMLInputElement).value }, `trc:${ed.pageId}`)} onchange={() => ed.seal()} /></label>
      {/if}
      <button class="btn wide" data-testid="tr-all" onclick={applyAll}>Apply between all pages</button>
    {/if}
  {:else}
    {#if onElements}
      <button class="btn wide make" data-testid="anim-create" disabled={sel.length !== 1} onclick={() => motionDraw.start(sel[0]!.id)}><Icon name="animate" size={16} /> Create an animation</button>
    {/if}

    {#if current}
      <div class="opts" data-testid="anim-options">
        <div class="field">
          <span>Speed · {animationDuration(current).toFixed(1)} s</span>
          <input type="range" min="0.2" max={maxSpeed} step="0.1" value={animationDuration(current)} data-testid="anim-duration"
            oninput={(e) => patch({ duration: Number((e.currentTarget as HTMLInputElement).value) }, key('dur'))}
            onchange={() => { ed.seal(); play(); }} />
        </div>
        {#if custom}
          <div class="field"><span>Style</span>
            <div class="chips">{#each STYLES as s (s.id)}<button class="chip" class:on={(current.path?.style ?? 'smooth') === s.id} data-testid="path-style-{s.id}" onclick={() => patchPath({ style: s.id })}>{s.label}</button>{/each}</div>
          </div>
          <div class="field"><span>Rotation</span>
            <div class="chips">{#each ROTATIONS as s (s.id)}<button class="chip" class:on={(current.path?.rotation ?? 'none') === s.id} data-testid="path-rotation-{s.id}" onclick={() => patchPath({ rotation: s.id })}>{s.label}</button>{/each}</div>
          </div>
          <label class="row"><input type="checkbox" checked={!!current.path?.fade} data-testid="path-fade" onchange={(e) => patchPath({ fade: (e.currentTarget as HTMLInputElement).checked })} /> Fade in</label>
        {:else}
          {#if !info?.loop && !info?.span}
            <div class="field"><span>Animate on</span>
              <div class="chips">{#each PHASES as s (s.id)}<button class="chip" class:on={phase === s.id} data-testid="anim-phase-{s.id}" onclick={() => { patch({ phase: s.id }); ed.seal(); play(); }}>{s.label}</button>{/each}</div>
            </div>
          {/if}
          {#if info?.directional}
            <div class="dirs" role="group" aria-label="Direction">
              {#each dirs as d (d.d)}
                <button class="btn icon" class:on={directionOf(current) === d.d} title={d.label} aria-label={d.label} data-testid="anim-dir-{d.d}"
                  onclick={() => { patch({ direction: d.d }); ed.seal(); play(); }}><Icon name={d.icon} size={16} /></button>
              {/each}
            </div>
          {/if}
          <div class="field">
            <span>Intensity</span>
            <input type="range" min="0" max="1" step="0.05" value={current.intensity ?? 0.5} data-testid="anim-intensity"
              oninput={(e) => patch({ intensity: Number((e.currentTarget as HTMLInputElement).value) }, key('int'))} onchange={() => { ed.seal(); play(); }} />
          </div>
          {#if showBy}
            <div class="field"><span>Move by</span>
              <div class="chips">{#each UNITS as s (s.id)}<button class="chip" class:on={(current.by ?? 'element') === s.id} data-testid="anim-by-{s.id}" onclick={() => { patch({ by: s.id === 'element' ? undefined : s.id }); ed.seal(); play(); }}>{s.label}</button>{/each}</div>
            </div>
          {/if}
          {#if !onElements}
            <div class="field"><span>Moves</span>
              <div class="chips">
                <button class="chip" class:on={current.by !== 'page'} data-testid="anim-page-each" onclick={() => { patch({ by: undefined }); ed.seal(); play(); }}>Element by element</button>
                <button class="chip" class:on={current.by === 'page'} data-testid="anim-page-whole" onclick={() => { patch({ by: 'page' }); ed.seal(); play(); }}>Whole page</button>
              </div>
            </div>
          {/if}
          {#if (showBy && current.by && current.by !== 'element') || (!onElements && current.by !== 'page')}
            <label class="row">Order
              <select value={current.order ?? 'forward'} data-testid="anim-order" onchange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value as AnimationOrder; patch({ order: v === 'forward' ? undefined : v }); ed.seal(); play(); }}>
                {#each ORDERS as o (o.id)}<option value={o.id}>{o.label}</option>{/each}
              </select>
            </label>
          {/if}
        {/if}
        <p class="hint">{hint}. Presentations, MP4 and GIF downloads play it.</p>
      </div>
    {/if}

    {#if one}
      <div class="timing" data-testid="anim-timing">
        <span class="lbl">Shows</span>
        <NumField label="From" value={one.timing?.start ?? 0} min={0} max={len} step={0.1} suffix="s" testid="anim-from" onchange={(v) => timing({ start: v })} onend={() => ed.seal()} />
        <NumField label="To" value={one.timing?.end ?? len} min={0} max={len} step={0.1} suffix="s" testid="anim-to" onchange={(v) => timing({ end: v })} onend={() => ed.seal()} />
      </div>
    {/if}

    <div class="grid one">
      <button class="tile" class:on={!current} data-testid="anim-none" onclick={() => pick(null)}>
        <span class="demo none"><Icon name="close" size={20} /></span>
        <span>None</span>
      </button>
      {#if custom}
        <button class="tile on" data-testid="anim-custom"><span class="demo"><Icon name="animate" size={22} /></span><span>Custom</span></button>
      {/if}
    </div>
    {#each sets as g (g.id)}
      <h3 data-testid="anim-set-{g.id}">{g.label}</h3>
      <div class="grid">
        {#each g.items as a (a.type)}
          {@const textual = a.groups.includes('text') || a.groups.includes('writing')}
          <button class="tile" class:on={current?.type === a.type} data-testid={g.id === a.groups[0] ? `anim-${a.type}` : `anim-${g.id}-${a.type}`} data-kind={a.loop ? 'loop' : a.exit ? 'exit' : a.photo ? 'photo' : 'enter'}
            onclick={() => pick(a, g.id)} onpointerenter={(e) => hoverIn(e, a, g.id)} onpointerleave={hoverOut}>
            <span class="demo"><canvas width="96" height="96" class:show={hover === a.type} data-testid="tile-{a.type}" {@attach (c) => { if (a.photo) return; const w = whenSeen(c, () => paintStill(c, a)); return w.destroy; }}></canvas><i class="dot" class:ab={textual}>{textual ? 'Abc' : a.photo ? '' : ''}</i></span>
            <span>{a.label}</span>
          </button>
        {/each}
      </div>
    {/each}
  {/if}
</div>

<style>
  .ap { display: flex; flex-direction: column; gap: 12px; }
  .tabs { display: flex; gap: 2px; padding: 3px; background: var(--chip); border-radius: 9px; position: sticky; top: 0; z-index: 2; }
  .tabs button { flex: 1; border: 0; background: none; border-radius: 7px; padding: 7px 4px; font-size: 13px; font-weight: 600; color: var(--muted); }
  .tabs button.on { background: var(--panel); color: var(--ink); box-shadow: 0 1px 2px rgba(0,0,0,.18); }
  .tabs button:disabled { opacity: .45; }
  .pv { position: relative; display: grid; place-items: center; background: var(--chip); border-radius: 8px; padding: 10px; }
  .pv canvas { max-width: 100%; max-height: 200px; width: auto; height: auto; border-radius: 3px; box-shadow: var(--page-shadow); background: #fff; }
  .play { position: absolute; right: 8px; bottom: 8px; height: 30px; padding: 0 10px; gap: 6px; }
  h3 { margin: 6px 0 -4px; font-size: 13px; font-weight: 700; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .tile { display: flex; flex-direction: column; align-items: center; gap: 4px; border: 0; background: none; padding: 0; font-size: 12px; color: var(--ink-2); min-width: 0; }
  .tile > span:last-child { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tile:disabled { opacity: .5; }
  .demo { position: relative; width: 100%; aspect-ratio: 1; display: grid; place-items: center; border-radius: 8px; background: var(--chip); border: 2px solid transparent; overflow: hidden; color: var(--muted); }
  .demo canvas { position: absolute; inset: 0; width: 100%; height: 100%; visibility: hidden; }
  .demo canvas.show, .demo :global(canvas.still) { visibility: visible; }
  .tile.on .demo { border-color: var(--accent); }
  .tile:hover .demo { background: var(--hover); }
  .dot { width: 34%; aspect-ratio: 1; border-radius: 6px; background: var(--accent); display: grid; place-items: center; color: #fff; font-style: normal; font-weight: 700; font-size: 13px; }
  .dot.ab { width: auto; aspect-ratio: auto; background: none; color: var(--accent); font-size: 17px; }
  .dot.tr { width: 100%; height: 100%; border-radius: 0; background: linear-gradient(115deg, #c9b6f2 50%, var(--accent) 50%); }
  .opts { display: flex; flex-direction: column; gap: 10px; padding: 10px; border-radius: 8px; background: var(--chip); }
  .field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; font-weight: 600; }
  .field input { width: 100%; }
  .row { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }
  .row select { flex: 1; min-width: 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip { border: 1px solid var(--line); background: var(--panel); border-radius: 7px; padding: 5px 9px; font-size: 12px; font-weight: 600; color: var(--ink-2); }
  .chip.on { border-color: var(--accent); color: var(--accent); }
  .dirs { display: flex; gap: 6px; }
  .wide { width: 100%; justify-content: center; }
  .make { gap: 6px; }
  .timing { display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .lbl { font-weight: 600; }
  .hint { color: var(--muted); font-size: 12px; line-height: 1.5; margin: 0; }
</style>
