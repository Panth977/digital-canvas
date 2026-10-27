/**
 * When each GIF frame is drawn and how long it stays (pure, no DOM).
 * While something animates a page gets one frame per 1/fps; once every
 * animation is over the rest of the page is a single long frame.
 */

export interface GifPage {
  /** Seconds the page shows. */
  duration: number;
  /** Seconds until its animations end (0 = static). */
  animEnd: number;
}

export interface GifFrame {
  page: number;
  /** Seconds since the page started. */
  t: number;
  /** How long the frame stays, ms (GIF delays are in 10 ms steps). */
  delay: number;
}

/** Seconds a page shows in a GIF: its own duration in a video, else ~3 s (longer if its animation needs it). */
export function gifPageDuration(isVideo: boolean, pageDuration: number, animEnd: number): number {
  if (isVideo) return pageDuration;
  return Math.max(3, animEnd > 0 ? animEnd + 1 : 0);
}

const ms10 = (s: number) => Math.max(20, Math.round((s * 1000) / 10) * 10);

export function gifFrames(pages: GifPage[], fps: number): GifFrame[] {
  const out: GifFrame[] = [];
  const step = 1 / fps;
  pages.forEach((p, page) => {
    const animated = Math.min(p.animEnd, p.duration);
    const n = animated > 0 ? Math.ceil(animated * fps) : 0;
    for (let i = 0; i < n; i++) out.push({ page, t: i * step, delay: ms10(step) });
    const rest = p.duration - n * step;
    if (rest > 0.001 || n === 0) out.push({ page, t: n * step, delay: ms10(Math.max(rest, step)) });
  });
  return out;
}
