<script lang="ts">
  import { pageDuration, pageStart, totalDuration } from '@digital-canvas/scene';
  import type { EditorState } from '../lib/editor.svelte.ts';
  import { formatTime } from '../lib/media.ts';
  import Icon from '../lib/Icon.svelte';

  let { ed }: { ed: EditorState } = $props();

  const p = $derived(ed.player);
  const total = $derived(Math.max(0.1, totalDuration(ed.doc)));
  const pages = $derived(ed.doc.pages.map((pg, i) => ({ pg, i, start: pageStart(ed.doc, pg.id), d: pageDuration(pg) })).filter((x) => !x.pg.hidden));
  let track: HTMLDivElement;
  let scrubbing = false;

  function timeAt(e: PointerEvent): number {
    const r = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * total;
  }
  function down(e: PointerEvent): void {
    scrubbing = true;
    track.setPointerCapture(e.pointerId);
    void p.seek(timeAt(e));
  }
  function move(e: PointerEvent): void {
    if (scrubbing) void p.seek(timeAt(e));
  }
  function up(e: PointerEvent): void {
    scrubbing = false;
    if (track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);
  }
  const pct = (t: number) => `${(t / total) * 100}%`;
</script>

<div class="timeline" data-testid="timeline">
  <div class="controls">
    <button class="play" onclick={() => p.toggle()} aria-label={p.playing ? 'Pause' : 'Play'} data-testid="play">
      <Icon name={p.playing ? 'pause' : 'play'} size={18} />
    </button>
    <span class="time" data-testid="time">{formatTime(p.time, true)} / {formatTime(total, true)}</span>
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="track" bind:this={track} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}>
    <div class="row pages">
      {#each pages as x (x.pg.id)}
        <div class="clip" class:cur={x.pg.id === ed.pageId} style="left:{pct(x.start)};width:{pct(x.d)}" title="Page {x.i + 1} · {x.d.toFixed(1)} s">
          <span>{x.i + 1}</span><em>{x.d.toFixed(1)}s</em>
        </div>
      {/each}
    </div>
    {#if ed.doc.audio?.length}
      <div class="row audio">
        {#each ed.doc.audio as a (a.id)}
          <div class="sound" style="left:{pct(a.start)};width:{pct(Math.min(a.duration, total - a.start))}" title={a.name ?? 'Audio'}>
            <Icon name="music" size={12} /><span>{a.name ?? 'Audio'}</span>
          </div>
        {/each}
      </div>
    {/if}
    <div class="head" style="left:{pct(p.time)}"></div>
  </div>
</div>

<style>
  .timeline { display: flex; align-items: stretch; gap: 10px; padding: 8px 12px; background: var(--panel); border-top: 1px solid var(--line); flex-shrink: 0; }
  .controls { display: flex; align-items: center; gap: 8px; }
  .play { width: 36px; height: 36px; border-radius: 50%; border: 0; background: var(--accent); color: #fff; display: grid; place-items: center; }
  .time { font-variant-numeric: tabular-nums; font-size: 12px; color: var(--muted); width: 92px; }
  .track { position: relative; flex: 1; display: flex; flex-direction: column; gap: 4px; cursor: pointer; touch-action: none; user-select: none; padding: 2px 0; }
  .row { position: relative; height: 30px; }
  .row.audio { height: 20px; }
  .clip { position: absolute; top: 0; bottom: 0; border: 1px solid var(--line); background: var(--chip); border-radius: 6px; display: flex; align-items: center; justify-content: space-between; padding: 0 6px; font-size: 11px; overflow: hidden; box-sizing: border-box; }
  .clip.cur { border-color: var(--accent); background: var(--accent-soft); }
  .clip em { font-style: normal; color: var(--muted); }
  .sound { position: absolute; top: 0; bottom: 0; background: rgba(48,164,108,.18); border: 1px solid #5cbf8a; border-radius: 5px; display: flex; align-items: center; gap: 4px; padding: 0 6px; font-size: 11px; overflow: hidden; white-space: nowrap; box-sizing: border-box; }
  .head { position: absolute; top: -2px; bottom: -2px; width: 2px; margin-left: -1px; background: var(--ink); pointer-events: none; }
  .head::before { content: ''; position: absolute; top: -4px; left: -4px; width: 10px; height: 10px; border-radius: 50%; background: var(--ink); }
</style>
