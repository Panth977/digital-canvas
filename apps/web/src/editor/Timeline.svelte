<script lang="ts">
  import { untrack } from 'svelte';
  import { TRANSITIONS, findElement, pageDuration, pageStart, totalDuration, type AudioClip, type Element, type TransitionType } from '@digital-canvas/scene';
  import type { EditorState } from '../lib/editor.svelte.ts';
  import { formatTime } from '../lib/media.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import { mobile } from '../lib/mobile.svelte.ts';
  import { toast } from '../lib/toast.svelte.ts';
  import {
    GAP, ZOOM_MAX, ZOOM_MIN, audioRows, dragDuration, dragTiming, durationLabel, layoutScenes, moveAudio, pxPerSecond, reorderTarget, stripWidth, timeToX, timingOf, trimAudio, xToTime,
  } from '../lib/timeline.ts';
  import { BARS_PER_SECOND, waveform } from '../lib/waveform.ts';
  import Icon from '../lib/Icon.svelte';

  /**
   * Canva's video timeline, under the stage of a video design: play / time,
   * a filmstrip of scenes (widths ∝ durations) with a draggable playhead,
   * scene edges to change durations, drag to reorder, a menu per scene
   * (duplicate, delete, split, hide, duration, transition), the selected
   * element's timing bar, and the sounds as waveforms (move, trim). Zoom with
   * the slider or a pinch; collapse to the play bar.
   */
  let { ed }: { ed: EditorState } = $props();

  const p = $derived(ed.player);
  const total = $derived(Math.max(0.1, totalDuration(ed.doc)));
  const open = $derived(ui.timelineOpen);
  const PAD = $derived(mobile.on ? 10 : 16);
  const ADD_W = $derived(mobile.on ? 40 : 48);

  let scroller = $state<HTMLDivElement>();
  let viewW = $state(0);
  /** Frozen while a scene edge is dragged, so the strip does not rescale under the pointer. */
  let frozenPps = $state<number | null>(null);
  const pps = $derived(frozenPps ?? pxPerSecond(ed.doc, Math.max(120, viewW - 2 * PAD - ADD_W - 8), ui.timelineZoom));
  const slots = $derived(layoutScenes(ed.doc, pps));
  const stripW = $derived(stripWidth(slots));
  const headX = $derived(PAD + timeToX(slots, p.time));
  const cur = $derived(slots.find((s) => s.id === ed.pageId) ?? null);

  // ---- thumbnails (the editor's shared cache) ----
  $effect(() => {
    void ed.doc;
    if (open) untrack(() => ed.thumbs.update(150));
  });
  const thumbs = $derived(ed.thumbs.urls);
  const thumbW = $derived(Math.max(8, (ed.doc.width / ed.doc.height) * (mobile.on ? 40 : 52)));

  // ---- the playhead stays in the current scene (a scene picked anywhere moves it there) ----
  $effect(() => {
    const id = ed.pageId;
    untrack(() => {
      if (p.playing || p.scrubbing) return;
      const pg = ed.doc.pages.find((x) => x.id === id);
      if (!pg || pg.hidden) return;
      const s = pageStart(ed.doc, id), d = pageDuration(pg);
      if (p.time < s - 1e-6 || p.time > s + d + 1e-6) void p.seek(s, false);
    });
  });
  // while playing, keep the playhead in view when zoomed in
  $effect(() => {
    const x = headX;
    if (!p.playing || !scroller) return;
    const sl = scroller.scrollLeft, w = scroller.clientWidth;
    if (x < sl + 20 || x > sl + w - 40) scroller.scrollLeft = Math.max(0, x - w * 0.25);
  });

  // ---- pointer drags ----
  function track(e: PointerEvent, move: (dx: number, ev: PointerEvent) => void, up?: (moved: boolean, ev: PointerEvent) => void, slop = 3): void {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < slop) return;
      moved = true;
      move(ev.clientX - x0, ev);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      up?.(moved, ev);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  /** Strip x (from the strip's left edge) under the pointer. */
  function stripX(ev: { clientX: number }): number {
    const r = scroller!.getBoundingClientRect();
    return ev.clientX - r.left + scroller!.scrollLeft - PAD;
  }

  // scrub: drag the playhead or click / drag on the ruler
  function scrubStart(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (p.playing) p.pause();
    p.scrub(true);
    void p.seek(xToTime(slots, stripX(e)));
    track(e, (_dx, ev) => void p.seek(xToTime(slots, stripX(ev))), () => p.scrub(false), 0);
  }

  // scenes: click = pick it (playhead to the click), drag = reorder
  let reorder = $state<{ id: string; from: number; dx: number; to: number } | null>(null);
  function sceneDown(e: PointerEvent, id: string, i: number): void {
    if (e.button !== 0) return;
    menu = null;
    track(e, (dx, ev) => {
      reorder = { id, from: i, dx, to: reorderTarget(slots, i, stripX(ev)) };
    }, (moved, ev) => {
      const r = reorder;
      reorder = null;
      if (moved && r) {
        if (r.to !== r.from) ed.movePageTo(id, r.to);
        return;
      }
      if (p.playing) p.pause();
      ed.select([], id);
      ed.pageSelected = true;
      const s = slots.find((x) => x.id === id);
      if (s && !s.hidden) void p.seek(Math.min(s.start + s.d - 1 / 30, xToTime(slots, stripX(ev))), false);
    }, 5);
  }

  // scene edge: its duration
  function edgeDown(e: PointerEvent, id: string): void {
    if (e.button !== 0) return;
    const pg = ed.doc.pages.find((x) => x.id === id);
    if (!pg) return;
    const d0 = pageDuration(pg), k = pps;
    frozenPps = k;
    track(e, (dx) => ed.updatePage({ duration: dragDuration(d0, dx, k) }, `scene-dur:${id}`, id), () => {
      ed.seal();
      frozenPps = null;
    }, 0);
  }

  // ---- the selected element's timing (when it shows within its scene) ----
  const timed = $derived.by(() => {
    if (ed.selection.length !== 1 || !cur || cur.hidden) return null;
    const hit = findElement(ed.doc, ed.selection[0]!);
    if (!hit || hit.page.id !== ed.pageId) return null;
    const len = pageDuration(hit.page);
    return { el: hit.element, len, w: timingOf(hit.element, len) };
  });
  function timingDown(e: PointerEvent, part: 'start' | 'end' | 'move'): void {
    if (e.button !== 0 || !timed) return;
    const { el, len, w } = timed;
    const k = pps;
    track(e, (dx) => ed.update({ timing: dragTiming(w, part, dx / k, len) } as Partial<Element>, `timing:${el.id}`, [el.id]), () => ed.seal(), 0);
  }
  const KIND: Record<string, string> = { text: 'Text', image: 'Image', video: 'Video', shape: 'Shape', line: 'Line', group: 'Group', table: 'Table', chart: 'Chart', path: 'Graphic' };

  // ---- sounds ----
  const sounds = $derived(ed.doc.audio ?? []);
  const stack = $derived(audioRows(sounds));
  const ROW = $derived(mobile.on ? 22 : 30);
  let bars = $state<Record<string, number[] | null>>({});
  $effect(() => {
    for (const a of sounds) {
      if (a.asset in bars) continue;
      bars = { ...bars, [a.asset]: null };
      void waveform(a.asset, ed.assets.get(a.asset)).then((w) => (bars = { ...bars, [a.asset]: w }));
    }
  });
  let soundSel = $state<string | null>(null);
  function soundDown(e: PointerEvent, a: AudioClip, part: 'move' | 'start' | 'end'): void {
    if (e.button !== 0) return;
    soundSel = a.id;
    const k = pps, c0 = { start: a.start, offset: a.offset, duration: a.duration };
    const fileLen = ed.doc.assets[a.asset]?.duration ?? Infinity;
    track(e, (dx) => ed.updateAudio(a.id, part === 'move' ? moveAudio(c0, dx / k) : trimAudio(c0, part, dx / k, fileLen), `audio:${a.id}`), () => ed.seal(), 0);
  }
  /** The sound's bars (a path of thin rects, 0..1 tall) over its trimmed part. */
  function wavePath(a: AudioClip, w: number, h: number): string {
    const b = bars[a.asset];
    if (!b?.length || w <= 0) return '';
    const n = Math.max(1, Math.floor(w / 3));
    let d = '';
    for (let i = 0; i < n; i++) {
      const t = a.offset + (i / n) * a.duration;
      const v = b[Math.min(b.length - 1, Math.floor(t * BARS_PER_SECOND))] ?? 0;
      const bh = Math.max(1.5, v * (h - 4));
      d += `M${i * 3 + 1} ${(h - bh) / 2}h1.6v${bh}h-1.6z`;
    }
    return d;
  }

  // ---- ruler ----
  const ticks = $derived.by(() => {
    const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * pps >= (mobile.on ? 44 : 64)) ?? 600;
    const out: { x: number; label: string }[] = [];
    for (let t = 0; t <= total + 1e-6; t += step) out.push({ x: timeToX(slots, t), label: t >= 60 ? formatTime(t) : `${+t.toFixed(1)}s` });
    return out;
  });

  // ---- zoom (slider, ⌘/ctrl + wheel, pinch on the strip) ----
  function zoomTo(z: number, anchorClientX?: number): void {
    const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    if (!scroller) { ui.timelineZoom = next; return; }
    const r = scroller.getBoundingClientRect();
    const ax = anchorClientX === undefined ? r.width / 2 : anchorClientX - r.left;
    const t = xToTime(slots, scroller.scrollLeft + ax - PAD);
    ui.timelineZoom = next;
    requestAnimationFrame(() => { if (scroller) scroller.scrollLeft = Math.max(0, PAD + timeToX(slots, t) - ax); });
  }
  function onWheel(e: WheelEvent): void {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      zoomTo(ui.timelineZoom * Math.exp(-e.deltaY * 0.01), e.clientX);
    }
  }
  const fingers = new Map<number, number>();
  let pinch: { d0: number; z0: number } | null = null;
  function fingerDown(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    fingers.set(e.pointerId, e.clientX);
    if (fingers.size === 2) {
      const [a, b] = [...fingers.values()] as [number, number];
      pinch = { d0: Math.max(10, Math.abs(a - b)), z0: ui.timelineZoom };
    }
  }
  function fingerMove(e: PointerEvent): void {
    if (!fingers.has(e.pointerId)) return;
    fingers.set(e.pointerId, e.clientX);
    if (pinch && fingers.size === 2) {
      const [a, b] = [...fingers.values()] as [number, number];
      zoomTo(pinch.z0 * Math.max(10, Math.abs(a - b)) / pinch.d0, (a + b) / 2);
    }
  }
  function fingerUp(e: PointerEvent): void {
    fingers.delete(e.pointerId);
    if (fingers.size < 2) pinch = null;
  }

  // ---- scene menu (right-click or …) ----
  let menu = $state<{ id: string; x: number; y: number } | null>(null);
  const menuPage = $derived(menu ? ed.doc.pages.find((x) => x.id === menu!.id) ?? null : null);
  function openMenu(e: MouseEvent, id: string): void {
    e.preventDefault();
    e.stopPropagation();
    if (p.playing) p.pause();
    ed.select([], id);
    ed.pageSelected = true;
    const W = 240, H = 330;
    menu = { id, x: Math.max(8, Math.min(window.innerWidth - W - 8, e.clientX)), y: Math.max(8, Math.min(window.innerHeight - H - 8, e.clientY - H)) };
  }
  const playheadIn = (id: string) => {
    const s = slots.find((x) => x.id === id);
    return !!s && !s.hidden && p.time > s.start + 0.1 && p.time < s.start + s.d - 0.1;
  };
  function split(): void {
    if (!ed.splitAtPlayhead()) toast.show('Move the playhead inside a scene to split it');
  }
  function addScene(): void {
    if (p.playing) p.pause();
    ed.select([], ed.doc.pages[ed.doc.pages.length - 1]!.id);
    ed.addPage();
    // a new scene of a video gets the default length explicitly (Canva: 5 s)
    ed.updatePage({ duration: pageDuration(ed.page) });
    ed.seal();
    requestAnimationFrame(() => scroller?.scrollTo({ left: scroller.scrollWidth, behavior: 'smooth' }));
  }
  function setTransition(id: string, type: TransitionType | '', dir?: string): void {
    const pg = ed.doc.pages.find((x) => x.id === id);
    if (!pg) return;
    const meta = TRANSITIONS.find((t) => t.type === type);
    ed.updatePage({ transition: type ? { ...pg.transition, type, ...(meta?.directional ? { direction: (dir ?? pg.transition?.direction ?? 'right') as 'left' } : { direction: undefined }) } : undefined }, null, id);
    ed.seal();
  }
</script>

<svelte:window onpointerdown={() => (menu = null)} />

<div class="vt" class:m={mobile.on} class:closed={!open} data-testid="timeline">
  <div class="head">
    <button class="play" onclick={(e) => { p.toggle(); (e.currentTarget as HTMLElement).blur(); }} aria-label={p.playing ? 'Pause' : 'Play'} title="{p.playing ? 'Pause' : 'Play'} (Space)" data-testid="play">
      <Icon name={p.playing ? 'pause' : 'play'} size={mobile.on ? 16 : 18} />
    </button>
    <span class="time" data-testid="time">{formatTime(p.time, true)} / {formatTime(total, true)}</span>
    {#if !mobile.on}
      <button class="hb" title="Split scene at the playhead (S)" aria-label="Split scene" data-testid="tl-split-btn" onclick={split}><Icon name="scissors" size={16} /></button>
    {/if}
    <span class="grow"></span>
    {#if timed && open && !mobile.on}<span class="hint">Drag the bar to set when this {KIND[timed.el.type]?.toLowerCase() ?? 'element'} shows</span>{/if}
    {#if open && !mobile.on}
      <button class="hb" aria-label="Zoom out timeline" onclick={() => zoomTo(ui.timelineZoom / 1.5)}><Icon name="minus" size={14} /></button>
      <input class="zr" type="range" min={ZOOM_MIN} max={ZOOM_MAX} step="0.1" value={ui.timelineZoom} aria-label="Timeline zoom" data-testid="tl-zoom"
        oninput={(e) => zoomTo(Number((e.currentTarget as HTMLInputElement).value))} />
      <button class="hb" aria-label="Zoom in timeline" onclick={() => zoomTo(ui.timelineZoom * 1.5)}><Icon name="plus" size={14} /></button>
    {/if}
    <button class="hb" aria-label={open ? 'Hide timeline' : 'Show timeline'} title={open ? 'Hide timeline' : 'Show timeline'} aria-expanded={open} data-testid="tl-collapse" onclick={() => (ui.timelineOpen = !open)}>
      <Icon name={open ? 'down' : 'up'} size={16} />
    </button>
  </div>

  {#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="scroll" bind:this={scroller} bind:clientWidth={viewW} onwheel={onWheel}
      onpointerdown={fingerDown} onpointermove={fingerMove} onpointerup={fingerUp} onpointercancel={fingerUp} data-testid="tl-scroll">
      <div class="content" style="width:{PAD * 2 + stripW + ADD_W + 8}px">
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="ruler" onpointerdown={scrubStart} data-testid="tl-ruler">
          {#each ticks as t (t.x)}<span class="tick" style="left:{PAD + t.x}px">{t.label}</span>{/each}
        </div>

        <div class="lane scenes">
          {#each slots as s (s.id)}
            {@const pg = ed.doc.pages[s.i]!}
            {@const dragging = reorder?.id === s.id}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="scene" class:on={s.id === ed.pageId} class:hid={s.hidden} class:dragging
              style="left:{PAD + s.x}px;width:{s.w}px;{dragging ? `transform:translateX(${reorder!.dx}px)` : ''};{thumbs[s.id] ? `background-image:url(${thumbs[s.id]});background-size:${thumbW}px 100%` : ''}"
              title="Scene {s.i + 1}{pg.name ? ` · ${pg.name}` : ''} · {durationLabel(pageDuration(pg))}"
              data-testid="tl-scene" data-id={s.id} data-duration={pageDuration(pg)}
              onpointerdown={(e) => sceneDown(e, s.id, s.i)} oncontextmenu={(e) => openMenu(e, s.id)}>
              {#if s.hidden}
                <Icon name="eyeoff" size={14} />
              {:else}
                <span class="dur" data-testid="tl-scene-dur">{durationLabel(s.d)}</span>
                <button class="more" aria-label="Scene {s.i + 1} options" data-testid="tl-scene-more" onpointerdown={(e) => e.stopPropagation()} onclick={(e) => openMenu(e, s.id)}><Icon name="more" size={14} /></button>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="edge" title="Drag to change the length" data-testid="tl-scene-edge" onpointerdown={(e) => edgeDown(e, s.id)}></div>
              {/if}
            </div>
            {#if s.i > 0 && !s.hidden}
              <button class="tr" class:set={!!pg.transition} style="left:{PAD + s.x - GAP / 2}px" title={pg.transition ? `Transition: ${TRANSITIONS.find((t) => t.type === pg.transition!.type)?.label}` : 'Add transition'}
                aria-label="Transition before scene {s.i + 1}" data-testid="tl-transition" onpointerdown={(e) => e.stopPropagation()} onclick={(e) => openMenu(e, s.id)}>
                <Icon name={pg.transition ? 'bolt' : 'plus'} size={10} />
              </button>
            {/if}
          {/each}
          {#if reorder && reorder.to !== reorder.from}
            {@const target = reorder.to > reorder.from ? slots[reorder.to] : slots[reorder.to]}
            {#if target}<i class="drop" style="left:{PAD + (reorder.to > reorder.from ? target.x + target.w + GAP / 2 : target.x - GAP / 2)}px"></i>{/if}
          {/if}
          <button class="add" style="left:{PAD + stripW + 8}px;width:{ADD_W}px" aria-label="Add scene" title="Add scene" data-testid="tl-add-scene" onclick={addScene}><Icon name="plus" size={18} /></button>
        </div>

        {#if timed && cur}
          {@const k = pps}
          <div class="lane timing" data-testid="tl-timing-lane">
            <i class="span" style="left:{PAD + cur.x}px;width:{cur.w}px"></i>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="tbar" style="left:{PAD + cur.x + timed.w.start * k}px;width:{Math.max(6, (timed.w.end - timed.w.start) * k)}px" data-testid="tl-timing"
              data-start={timed.w.start} data-end={timed.w.end} title="{timed.w.start.toFixed(1)}–{timed.w.end.toFixed(1)} s" onpointerdown={(e) => timingDown(e, 'move')}>
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <i class="h l" data-testid="tl-timing-start" onpointerdown={(e) => timingDown(e, 'start')}></i>
              {#if (timed.w.end - timed.w.start) * k > 90}<span>{KIND[timed.el.type] ?? 'Element'} · {timed.w.start.toFixed(1)}–{timed.w.end.toFixed(1)}s</span>{/if}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <i class="h r" data-testid="tl-timing-end" onpointerdown={(e) => timingDown(e, 'end')}></i>
            </div>
          </div>
        {/if}

        {#if sounds.length}
          <div class="lane audio" style="height:{stack.count * ROW}px" data-testid="tl-audio-lane">
            {#each sounds as a (a.id)}
              {@const x0 = timeToX(slots, a.start)}
              {@const w = Math.max(6, timeToX(slots, Math.min(total, a.start + a.duration)) - x0)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="sound" class:on={soundSel === a.id} style="left:{PAD + x0}px;width:{w}px;top:{(stack.rows[a.id] ?? 0) * ROW}px;height:{ROW - 2}px" title="{a.name ?? 'Sound'} · {durationLabel(a.duration)}"
                data-testid="tl-audio" data-start={a.start} data-duration={a.duration}
                onpointerdown={(e) => soundDown(e, a, 'move')} ondblclick={() => ui.open('audio')}
                oncontextmenu={(e) => { e.preventDefault(); soundSel = a.id; ui.open('audio'); }}>
                <svg class="wave" width={w} height={mobile.on ? 18 : 26} aria-hidden="true"><path d={wavePath(a, w, mobile.on ? 18 : 26)} /></svg>
                <span class="sname"><Icon name="music" size={11} /> {a.name ?? 'Sound'}</span>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <i class="h l" data-testid="tl-audio-start" onpointerdown={(e) => soundDown(e, a, 'start')}></i>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <i class="h r" data-testid="tl-audio-end" onpointerdown={(e) => soundDown(e, a, 'end')}></i>
              </div>
            {/each}
          </div>
        {/if}

        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="playhead" style="left:{headX}px" data-testid="tl-playhead" data-time={p.time}>
          <i class="knob" onpointerdown={scrubStart} data-testid="tl-playhead-knob"></i>
        </div>
      </div>
    </div>
  {/if}

  {#if menu && menuPage}
    {@const id = menuPage.id}
    {@const i = ed.doc.pages.indexOf(menuPage)}
    {@const tmeta = TRANSITIONS.find((t) => t.type === menuPage.transition?.type)}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="menu" role="menu" tabindex="-1" style="left:{menu.x}px;top:{menu.y}px" data-testid="tl-menu" onpointerdown={(e) => e.stopPropagation()}>
      <b>Scene {i + 1}</b>
      <label class="row">Duration
        <input type="number" min="0.1" max="3600" step="0.1" value={pageDuration(menuPage)} data-testid="tl-menu-duration"
          onchange={(e) => { const v = Number((e.currentTarget as HTMLInputElement).value); if (v > 0) { ed.updatePage({ duration: Math.min(3600, Math.max(0.1, Math.round(v * 10) / 10)) }, null, id); ed.seal(); } }} /> s
      </label>
      {#if i > 0}
        <label class="row">Transition
          <select value={menuPage.transition?.type ?? ''} data-testid="tl-menu-transition" onchange={(e) => setTransition(id, (e.currentTarget as HTMLSelectElement).value as TransitionType | '')}>
            <option value="">None</option>
            {#each TRANSITIONS as t (t.type)}<option value={t.type}>{t.label}</option>{/each}
          </select>
        </label>
        {#if tmeta?.directional}
          <label class="row">Direction
            <select value={menuPage.transition?.direction ?? 'right'} onchange={(e) => setTransition(id, menuPage.transition!.type, (e.currentTarget as HTMLSelectElement).value)}>
              <option value="right">From right</option><option value="left">From left</option><option value="down">From bottom</option><option value="up">From top</option>
            </select>
          </label>
        {/if}
      {/if}
      <hr />
      <button role="menuitem" data-testid="tl-split" disabled={!playheadIn(id)} onclick={() => { split(); menu = null; }}><Icon name="scissors" size={16} /> Split at playhead <kbd>S</kbd></button>
      <button role="menuitem" data-testid="tl-dup" onclick={() => { ed.duplicatePage(id); menu = null; }}><Icon name="copy" size={16} /> Duplicate scene</button>
      <button role="menuitem" data-testid="tl-add-after" onclick={() => { ed.select([], id); ed.addPage(); ed.updatePage({ duration: pageDuration(ed.page) }); ed.seal(); menu = null; }}><Icon name="addpage" size={16} /> Add scene after</button>
      <button role="menuitem" data-testid="tl-hide" onclick={() => { ed.updatePage({ hidden: menuPage.hidden ? undefined : true }, null, id); ed.seal(); menu = null; }}><Icon name={menuPage.hidden ? 'eye' : 'eyeoff'} size={16} /> {menuPage.hidden ? 'Show scene' : 'Hide scene'}</button>
      <button role="menuitem" data-testid="tl-del" disabled={ed.doc.pages.length === 1} onclick={() => { ed.removePage(id); menu = null; }}><Icon name="trash" size={16} /> Delete scene</button>
    </div>
  {/if}
</div>

<style>
  .vt { flex-shrink: 0; display: flex; flex-direction: column; background: var(--panel); border-top: 1px solid var(--line); user-select: none; }
  .head { height: 44px; display: flex; align-items: center; gap: 6px; padding: 0 12px; }
  .vt.m .head { height: 38px; padding: 0 8px; }
  .play { width: 34px; height: 34px; border-radius: 50%; border: 0; background: var(--accent); color: #fff; display: grid; place-items: center; flex-shrink: 0; }
  .vt.m .play { width: 30px; height: 30px; }
  .time { font-variant-numeric: tabular-nums; font-size: 12px; color: var(--ink-2); min-width: 92px; }
  .grow { flex: 1; }
  .hint { font-size: 12px; color: var(--muted); margin-right: 8px; }
  .hb { width: 30px; height: 30px; display: grid; place-items: center; border: 0; border-radius: 8px; background: none; color: var(--ink-2); }
  .hb:hover { background: var(--hover); color: var(--ink); }
  .zr { width: 110px; accent-color: var(--ink); }
  .scroll { position: relative; overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; padding-bottom: 8px; touch-action: pan-x; }
  .content { position: relative; min-width: 100%; display: flex; flex-direction: column; gap: 6px; }
  .ruler { position: relative; height: 18px; cursor: pointer; font-size: 10px; color: var(--muted); }
  .tick { position: absolute; top: 2px; padding-left: 3px; border-left: 1px solid var(--line); line-height: 14px; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .lane { position: relative; }
  .scenes { height: 56px; }
  .vt.m .scenes { height: 44px; }
  .scene { position: absolute; top: 0; bottom: 0; box-sizing: border-box; border-radius: 8px; border: 2px solid transparent; background-color: var(--chip); background-repeat: repeat-x; background-position: left center; outline: 1px solid var(--line); outline-offset: -1px; overflow: hidden; cursor: pointer; touch-action: none; }
  .scene:hover { outline-color: var(--muted); }
  .scene.on { border-color: var(--accent); outline-color: transparent; }
  .scene.hid { display: grid; place-items: center; opacity: .55; color: var(--ink-2); background-image: none !important; }
  .scene.dragging { opacity: .75; z-index: 3; box-shadow: var(--shadow); }
  .dur { position: absolute; left: 4px; bottom: 3px; padding: 1px 5px; border-radius: 4px; background: rgba(0,0,0,.62); color: #fff; font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums; pointer-events: none; }
  .more { position: absolute; top: 3px; right: 8px; width: 22px; height: 18px; border: 0; border-radius: 4px; background: rgba(0,0,0,.62); color: #fff; display: none; place-items: center; padding: 0; }
  .scene:hover .more, .scene.on .more { display: grid; }
  .vt.m .scene.on .more { display: grid; }
  .edge { position: absolute; top: 0; right: 0; bottom: 0; width: 8px; cursor: ew-resize; background: transparent; }
  .scene:hover .edge, .scene.on .edge { background: linear-gradient(90deg, transparent 2px, var(--accent) 2px, var(--accent) 5px, transparent 5px); }
  .vt.m .edge { width: 14px; }
  .tr { position: absolute; top: 50%; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%; border: 1px solid var(--line); background: var(--pop); color: var(--ink-2); display: grid; place-items: center; padding: 0; z-index: 2; opacity: 0; }
  .scenes:hover .tr, .tr.set { opacity: 1; }
  .tr.set { color: var(--accent); border-color: var(--accent); }
  .drop { position: absolute; top: -3px; bottom: -3px; width: 3px; margin-left: -1.5px; border-radius: 2px; background: var(--accent); }
  .add { position: absolute; top: 0; bottom: 0; border-radius: 8px; border: 1px dashed var(--line); background: var(--chip); color: var(--ink-2); display: grid; place-items: center; }
  .add:hover { color: var(--ink); border-color: var(--muted); }
  .timing { height: 22px; }
  .timing .span { position: absolute; top: 9px; height: 4px; border-radius: 2px; background: var(--line); }
  .tbar { position: absolute; top: 0; bottom: 0; box-sizing: border-box; border-radius: 6px; background: var(--accent-soft); border: 1.5px solid var(--accent); cursor: grab; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; color: var(--ink); overflow: hidden; white-space: nowrap; touch-action: none; }
  .h { position: absolute; top: 0; bottom: 0; width: 8px; cursor: ew-resize; touch-action: none; }
  .h.l { left: 0; }
  .h.r { right: 0; }
  .tbar .h { background: var(--accent); width: 5px; }
  .sound { position: absolute; box-sizing: border-box; border-radius: 6px; background: rgba(48,164,108,.16); border: 1px solid #3fae74; overflow: hidden; cursor: grab; touch-action: none; }
  .sound.on { border-width: 2px; border-color: #2a9a5f; }
  .wave { position: absolute; left: 0; top: 50%; transform: translateY(-50%); }
  .wave path { fill: #3fae74; opacity: .75; }
  .sname { position: absolute; left: 10px; top: 2px; display: flex; align-items: center; gap: 3px; font-size: 10px; font-weight: 600; color: var(--ink); white-space: nowrap; pointer-events: none; text-shadow: 0 0 3px var(--panel); }
  .sound .h:hover { background: rgba(48,164,108,.5); }
  .playhead { position: absolute; top: 0; bottom: -8px; width: 2px; margin-left: -1px; background: var(--ink); pointer-events: none; z-index: 5; }
  .knob { position: absolute; top: 0; left: -6px; width: 14px; height: 18px; border-radius: 4px 4px 7px 7px; background: var(--ink); pointer-events: auto; cursor: ew-resize; touch-action: none; }
  .menu { position: fixed; z-index: 60; width: 240px; padding: 8px; display: flex; flex-direction: column; gap: 2px; background: var(--pop); color: var(--ink); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow); font-size: 13px; }
  .menu b { padding: 4px 8px 6px; font-size: 13px; }
  .menu .row { display: flex; align-items: center; gap: 8px; justify-content: space-between; padding: 4px 8px; color: var(--ink-2); }
  .menu .row input { width: 64px; height: 28px; border-radius: 6px; border: 1px solid var(--line); background: var(--chip); color: var(--ink); padding: 0 6px; margin-left: auto; }
  .menu .row select { height: 28px; border-radius: 6px; border: 1px solid var(--line); background: var(--chip); color: var(--ink); max-width: 130px; }
  .menu hr { width: 100%; border: 0; border-top: 1px solid var(--line); margin: 4px 0; }
  .menu button { height: 34px; display: flex; align-items: center; gap: 10px; padding: 0 8px; border: 0; border-radius: 8px; background: none; color: inherit; font: inherit; text-align: left; }
  .menu button:hover:not(:disabled) { background: var(--hover); }
  .menu button:disabled { opacity: .45; }
  .menu kbd { margin-left: auto; font: inherit; font-size: 11px; color: var(--muted); }
</style>
