/** Canva's Present menu: standard, presenter view (a second window), autoplay. */
export type PresentMode = 'standard' | 'presenter' | 'auto';

/** Seconds as 0:07 or 1:02:07. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

/**
 * The speaker's stopwatch: runs while it is not paused, reads wall time so a
 * sleeping tab loses nothing. `now` is injectable for tests.
 */
export class Stopwatch {
  private base = 0;
  private since: number | null;
  constructor(private now: () => number = () => performance.now()) {
    this.since = this.now();
  }
  get running(): boolean { return this.since !== null; }
  get seconds(): number { return (this.base + (this.since === null ? 0 : this.now() - this.since)) / 1000; }
  pause(): void { if (this.since !== null) { this.base += this.now() - this.since; this.since = null; } }
  resume(): void { if (this.since === null) this.since = this.now(); }
  reset(): void { this.base = 0; if (this.since !== null) this.since = this.now(); }
}

/** Where autoplay goes after page `i` of `n`: the next, round again, or nowhere. */
export function nextPage(i: number, n: number, loop: boolean): number | null {
  if (i + 1 < n) return i + 1;
  return loop && n > 1 ? 0 : null;
}

export interface PresenterState {
  index: number;
  count: number;
  notes: string;
  currentUrl: string;
  nextUrl: string;
  total: string;
  pageTime: string;
  timerRunning: boolean;
  auto: boolean;
  fontSize: number;
}
export interface PresenterActions {
  go(delta: number): void;
  toggleTimer(): void;
  resetTimer(): void;
  toggleAuto(): void;
  font(delta: number): void;
  end(): void;
}
