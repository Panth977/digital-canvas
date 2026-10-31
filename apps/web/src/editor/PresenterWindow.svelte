<script lang="ts">
  /**
   * The speaker's window in presenter view: this page, the next one, the notes
   * and the timers. It is mounted into a second browser window by Present,
   * which owns all the state; styles come from presenter.css (the window has
   * none of the app's).
   */
  import type { PresenterActions, PresenterState } from '../lib/present.ts';

  let { s, act }: { s: PresenterState; act: PresenterActions } = $props();
</script>

<div class="pv" data-testid="presenter">
  <div class="top">
    <span class="timer" data-testid="presenter-timer">{s.total}</span>
    <button data-testid="presenter-timer-toggle" onclick={act.toggleTimer}>{s.timerRunning ? 'Pause timer' : 'Resume timer'}</button>
    <button data-testid="presenter-timer-reset" onclick={act.resetTimer}>Reset</button>
    <span class="small" data-testid="presenter-page-time">This page {s.pageTime}</span>
    <span class="spacer"></span>
    <span class="small" data-testid="presenter-count">Page {s.index + 1} of {s.count}</span>
  </div>
  <div class="slides">
    <span class="label">Now</span>
    <img src={s.currentUrl} alt="Page {s.index + 1}" data-testid="presenter-current" />
  </div>
  <div class="side">
    <div class="next">
      <span class="label">Next</span>
      {#if s.nextUrl}<img src={s.nextUrl} alt="Next page" data-testid="presenter-next" />{:else}<div class="end" data-testid="presenter-next-end">End of presentation</div>{/if}
    </div>
    <div class="notes">
      <span class="label">Notes</span>
      <div class="text" class:empty={!s.notes} style:font-size="{s.fontSize}px" data-testid="presenter-notes">{s.notes || 'No notes on this page.'}</div>
    </div>
  </div>
  <div class="bar">
    <button data-testid="presenter-prev" disabled={s.index === 0} onclick={() => act.go(-1)}>Previous</button>
    <button data-testid="presenter-go-next" disabled={s.index === s.count - 1} onclick={() => act.go(1)}>Next</button>
    <button class:on={s.auto} aria-pressed={s.auto} data-testid="presenter-auto" onclick={act.toggleAuto}>Autoplay</button>
    <span class="spacer"></span>
    <button aria-label="Smaller notes" data-testid="presenter-font-down" onclick={() => act.font(-2)}>A−</button>
    <button aria-label="Larger notes" data-testid="presenter-font-up" onclick={() => act.font(2)}>A+</button>
    <button data-testid="presenter-end" onclick={act.end}>End</button>
  </div>
</div>
