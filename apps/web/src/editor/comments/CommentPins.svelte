<script lang="ts">
  import { isVideo, pageStart, pinPlace } from '@digital-canvas/scene';
  import type { CommentsState } from '../../lib/comments.svelte.ts';
  import CommentThread from './CommentThread.svelte';

  /**
   * Comment pins over the stage (speech bubbles with the thread number, point
   * at the bottom-left like Canva) and the open thread's card beside its pin.
   * `at` turns page px on page i into stage px.
   */
  let { cs, at, vw, vh }: {
    cs: CommentsState;
    at: (pageIndex: number, x: number, y: number) => { x: number; y: number };
    vw: number;
    vh: number;
  } = $props();

  const doc = $derived(cs.ed.doc);
  const video = $derived(isVideo(doc));
  const nums = $derived(cs.numbers);
  /** In a video only the current scene shows; a pin is lit while the playhead is at its moment (±1 s or its range). */
  const pins = $derived.by(() => {
    const out: { id: string; n: number; x: number; y: number; resolved: boolean; dim: boolean }[] = [];
    for (const c of cs.list) {
      if (!c.anchor || (c.resolved && cs.filter === 'open' && cs.active !== c.id)) continue;
      const p = pinPlace(doc, c.anchor);
      if (!p.page) continue;
      const i = doc.pages.findIndex((pg) => pg.id === p.page);
      if (video && p.page !== cs.ed.pageId) continue;
      const s = at(i, p.x, p.y);
      if (s.x < -40 || s.y < -40 || s.x > vw + 40 || s.y > vh + 40) continue;
      let dim = false;
      if (video && c.anchor.t != null) {
        const t = cs.ed.player.time - pageStart(doc, p.page);
        dim = c.anchor.t1 != null ? t < c.anchor.t - 0.05 || t > c.anchor.t1 + 0.05 : Math.abs(t - c.anchor.t) > 1;
      }
      out.push({ id: c.id, n: nums.get(c.id) ?? 0, x: s.x, y: s.y, resolved: c.resolved, dim });
    }
    return out;
  });

  const draftAt = $derived.by(() => {
    const a = cs.draft?.anchor;
    if (!a) return null;
    const p = pinPlace(doc, a);
    const i = doc.pages.findIndex((pg) => pg.id === p.page);
    return i < 0 ? null : at(i, p.x, p.y);
  });

  const activePin = $derived(pins.find((p) => p.id === cs.active) ?? null);
  const activeComment = $derived(cs.find(cs.active));

  /** Card beside the pin, kept inside the stage. */
  function cardPos(p: { x: number; y: number }): string {
    const W = 300, H = 300;
    let x = p.x + 28, y = p.y - 30;
    if (x + W > vw - 8) x = Math.max(8, p.x - W - 12);
    y = Math.max(8, Math.min(y, vh - H - 8));
    return `left:${x}px;top:${y}px`;
  }
</script>

{#each pins as p (p.id)}
  <button class="pin" class:resolved={p.resolved} class:active={cs.active === p.id} class:dim={p.dim || cs.unsynced.has(p.id)} style="left:{p.x}px;top:{p.y}px"
    title="Comment {p.n}" aria-label="Comment {p.n}" data-testid="comment-pin" data-id={p.id}
    onpointerdown={(e) => e.stopPropagation()} onclick={(e) => { e.stopPropagation(); cs.draft = null; cs.active = cs.active === p.id ? null : p.id; }}>{p.n}</button>
{/each}

{#if cs.draft && draftAt}
  <span class="pin new" style="left:{draftAt.x}px;top:{draftAt.y}px" aria-hidden="true">+</span>
  <div class="card" style={cardPos(draftAt)}><CommentThread {cs} onclose={() => cs.cancel()} /></div>
{:else if activeComment && activePin}
  <div class="card" style={cardPos(activePin)}><CommentThread {cs} comment={activeComment} n={activePin.n} onclose={() => (cs.active = null)} /></div>
{/if}

<style>
  .pin { position: absolute; z-index: 25; transform: translate(0, -100%); min-width: 28px; height: 28px; padding: 0 7px; border: 2px solid #fff; border-radius: 14px 14px 14px 3px; background: #8b3dff; color: #fff; font-size: 12px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(0,0,0,.35); cursor: pointer; }
  .pin:hover, .pin.active { transform: translate(0, -100%) scale(1.12); transform-origin: bottom left; }
  .pin.active { background: #6a1fe0; }
  .pin.resolved { background: #8e8e93; }
  .pin.dim { opacity: .45; }
  .pin.new { background: #00c4cc; cursor: default; }
  .card { position: absolute; z-index: 40; }
</style>
