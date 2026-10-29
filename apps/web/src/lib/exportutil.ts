/** Pure helpers for the Download panel's exporters (no DOM, no CanvasKit): tested in apps/web/test/exportutil.test.ts. */
import { pageDuration, pageStart, totalDuration, walk, type Doc } from '@digital-canvas/scene';

/** Canva's MP4 qualities: the short side of the video in px. */
export const VIDEO_QUALITIES = [
  { id: 480, label: '480p' },
  { id: 720, label: '720p' },
  { id: 1080, label: '1080p' },
  { id: 2160, label: '4K' },
] as const;
export type VideoQuality = (typeof VIDEO_QUALITIES)[number]['id'];

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Video size for a quality, scaled from the design (its short side becomes `quality` px; even sides for H.264). */
export function videoSize(doc: Pick<Doc, 'width' | 'height'>, quality: number): { W: number; H: number } {
  const s = quality / Math.min(doc.width, doc.height);
  return { W: even(doc.width * s), H: even(doc.height * s) };
}

/** Canva's GIF sizes. */
export const GIF_SIZES = [0.2, 0.4, 0.6, 0.8, 1] as const;

/** True when the design makes a sound: timeline audio or a video clip that isn't muted. */
export function hasSound(doc: Doc): boolean {
  if (doc.audio?.some((a) => (a.volume ?? 1) > 0 && a.duration > 0)) return true;
  return doc.pages.some((p) => !p.hidden && [...walk(p.elements)].some((e) => e.type === 'video' && !e.muted && !e.hidden && (e.volume ?? 1) > 0));
}

/** Length of the design's sound track: the pages, or longer when a sound runs past them. */
export function soundDuration(doc: Doc): number {
  return Math.max(totalDuration(doc), ...(doc.audio ?? []).map((a) => a.start + a.duration));
}

/**
 * One page as a design of its own, for "Download pages as separate files":
 * the page without its incoming transition, and the timeline sounds cut to
 * the page's time (fades kept only where the sound really starts or ends).
 */
export function pageDoc(doc: Doc, pageId: string): Doc {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) throw new Error(`no page ${pageId}`);
  const start = pageStart(doc, pageId), end = start + pageDuration(page);
  const audio = (doc.audio ?? []).flatMap((a) => {
    const s = Math.max(a.start, start), e = Math.min(a.start + a.duration, end);
    if (e <= s) return [];
    return [{ ...a, start: s - start, offset: a.offset + (s - a.start), duration: e - s, fadeIn: s > a.start ? 0 : a.fadeIn, fadeOut: e < a.start + a.duration ? 0 : a.fadeOut }];
  });
  const { transition: _drop, ...rest } = page;
  return { ...doc, pages: [{ ...rest, hidden: false }], audio };
}

/** File name for one of several files: "Title - page 2.ext" (just "Title.ext" for a one-page design). */
export function pageFileName(title: string, index: number, pages: number, ext: string): string {
  return pages > 1 ? `${title} - page ${index + 1}.${ext}` : `${title}.${ext}`;
}
