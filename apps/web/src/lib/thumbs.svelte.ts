import type { Page } from '@digital-canvas/scene';
import type { EditorState } from './editor.svelte.ts';

/**
 * Small pictures of the pages (Pages strip, grid view, the video timeline's
 * filmstrip), one cache per editor. Pages are immutable: an unchanged page
 * keeps its object, so its picture is reused; an edited page is drawn again
 * after a pause in edits, one page per task so typing never stutters.
 */
export class Thumbs {
  /** Page id → object URL of its PNG. */
  urls = $state<Record<string, string>>({});
  private cache = new Map<string, { page: Page; w: number; h: number; url: string }>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private run = 0;

  constructor(private ed: EditorState, private maxSide = 360) {}

  /** Bring the pictures up to date (throttled). Call from an effect that reads `ed.doc`. */
  update(delay = 250): void {
    if (this.timer) clearTimeout(this.timer);
    const run = ++this.run;
    this.timer = setTimeout(async () => {
      this.timer = null;
      const doc = this.ed.doc;
      const scale = Math.min(1, this.maxSide / Math.max(doc.width, doc.height));
      for (const p of doc.pages) {
        if (run !== this.run) return;
        const hit = this.cache.get(p.id);
        if (hit && hit.page === p && hit.w === doc.width && hit.h === doc.height) continue;
        const bytes = this.ed.exportPage(p.id, 'png', scale);
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));
        if (hit) URL.revokeObjectURL(hit.url);
        this.cache.set(p.id, { page: p, w: doc.width, h: doc.height, url });
        this.urls = { ...this.urls, [p.id]: url };
        await new Promise((r) => setTimeout(r, 0));
      }
    }, delay);
  }

  dispose(): void {
    this.run++;
    if (this.timer) clearTimeout(this.timer);
    for (const c of this.cache.values()) URL.revokeObjectURL(c.url);
    this.cache.clear();
  }
}
