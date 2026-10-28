import { clipTime, frameAt, totalDuration, walk, type AudioClip, type VideoElement } from '@digital-canvas/scene';
import type { EditorState } from './editor.svelte.ts';

/** A sound's loudness at `t` on the timeline: its volume with its fade in / out (0 outside it). */
export function soundGain(c: AudioClip, t: number): number {
  const v = c.volume ?? 1;
  const into = t - c.start, left = c.start + c.duration - t;
  if (into < 0 || left <= 0) return 0;
  let g = v;
  if (c.fadeIn && c.fadeIn > 0) g *= Math.min(1, into / c.fadeIn);
  if (c.fadeOut && c.fadeOut > 0) g *= Math.min(1, left / c.fadeOut);
  return Math.max(0, Math.min(1, g));
}

/**
 * Plays a design as a video in the editor: pages one after another for their
 * durations, video clips on the showing page (and on the page before it while
 * a transition plays), and the timeline's sounds with their fades. Video is
 * decoded by the browser (<video>); each animation frame its picture is handed
 * to the renderer. While `live` (playing or scrubbing) the canvas draws the
 * frame at `time` exactly like the MP4 export (render `drawFrameAt`); paused,
 * it shows the editable design (Canva).
 */
export class Player {
  time = $state(0);
  playing = $state(false);
  /** The playhead is being dragged: the canvas shows the frame at `time`. */
  scrubbing = $state(false);

  private videos = new Map<string, HTMLVideoElement>();
  private audios = new Map<string, HTMLAudioElement>();
  private urls: string[] = [];
  private raf = 0;
  private t0 = 0;
  private seekToken = 0;

  constructor(private ed: EditorState) {}

  /** The canvas shows the moving picture (playing or scrubbing), not the editable design. */
  get live(): boolean {
    return this.playing || this.scrubbing;
  }

  get duration(): number {
    return totalDuration(this.ed.doc);
  }

  private media<T extends HTMLMediaElement>(map: Map<string, T>, key: string, asset: string, make: () => T): T | null {
    let m = map.get(key);
    if (m) return m;
    const bytes = this.ed.assets.get(asset);
    const meta = this.ed.doc.assets[asset];
    if (!bytes || !meta) return null;
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: meta.mime }));
    this.urls.push(url);
    m = make();
    m.preload = 'auto';
    m.src = url;
    map.set(key, m);
    return m;
  }

  private video(asset: string): HTMLVideoElement | null {
    return this.media(this.videos, asset, asset, () => {
      const v = document.createElement('video');
      v.playsInline = true;
      v.muted = true;
      return v;
    });
  }

  /** Copy the video's current picture into the renderer. */
  private grab(asset: string, v: HTMLVideoElement): void {
    if (v.readyState < 2 || !v.videoWidth) return;
    const img = this.ed.engine.ck.MakeImageFromCanvasImageSource(v);
    this.ed.renderer.setVideoFrame(asset, img);
  }

  /** The clips showing at `t`: on the page, and on the page before it while a transition plays. */
  private clipsAt(t: number): { el: VideoElement; local: number }[] {
    const f = frameAt(this.ed.doc, t);
    const out: { el: VideoElement; local: number }[] = [];
    const add = (els: Iterable<import('@digital-canvas/scene').Element>, local: number) => {
      for (const e of els) if (e.type === 'video' && !e.hidden) out.push({ el: e, local });
    };
    if (f.prev) add(walk(f.prev.page.elements), f.prev.local);
    add(walk(f.page.elements), f.local);
    return out;
  }

  /** The scene showing at the playhead becomes the current page (Canva's stage follows the playhead). */
  private follow(): void {
    const { page } = frameAt(this.ed.doc, this.time);
    if (this.ed.pageId === page.id) return;
    if (this.ed.selection.length || this.ed.editingTextId || this.ed.croppingId) this.ed.select([], page.id);
    else this.ed.pageId = page.id;
  }

  /** Show the picture at time `t` (paused). `follow`: the scene there becomes the current page. */
  async seek(t: number, follow = true): Promise<void> {
    this.time = Math.max(0, Math.min(this.duration, t));
    const token = ++this.seekToken;
    if (follow) this.follow();
    if (this.playing) {
      this.t0 = performance.now() - this.time * 1000;
      this.syncMedia(true);
      return;
    }
    for (const { el, local } of this.clipsAt(this.time)) {
      const v = this.video(el.asset);
      if (!v) continue;
      const fileDur = this.ed.doc.assets[el.asset]?.duration ?? v.duration ?? 0;
      const ct = clipTime(el, local, fileDur || Infinity);
      if (ct === null) { this.ed.renderer.setVideoFrame(el.asset, null); continue; }
      if (v.readyState < 1) await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
      if (Math.abs(v.currentTime - ct) > 0.02 || v.readyState < 2) {
        v.currentTime = ct;
        await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
      }
      if (token !== this.seekToken) return;
      this.grab(el.asset, v);
    }
    this.ed.frame++;
  }

  /** Fetch the clip pictures again for the current time (media added, export done); the page stays. */
  refresh(): Promise<void> {
    return this.seek(this.time, false);
  }

  /** Start / end dragging the playhead (the canvas shows frames while it lasts). */
  scrub(on: boolean): void {
    this.scrubbing = on;
    this.ed.frame++;
  }

  play(): void {
    if (this.playing) return;
    if (this.time >= this.duration - 0.01) this.time = 0;
    if (this.ed.editingTextId) this.ed.stopEditing();
    this.playing = true;
    this.t0 = performance.now() - this.time * 1000;
    this.syncMedia(true);
    const tick = () => {
      if (!this.playing) return;
      this.time = (performance.now() - this.t0) / 1000;
      if (this.time >= this.duration) {
        this.time = this.duration;
        this.pause();
        return;
      }
      this.syncMedia(false);
      this.ed.frame++;
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    for (const v of this.videos.values()) v.pause();
    for (const a of this.audios.values()) a.pause();
    void this.seek(this.time);
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  /** Keep every clip and sound in step with the clock (seek when it drifts). */
  private syncMedia(hard: boolean): void {
    const t = this.time;
    this.follow();
    const active = new Set<string>();
    for (const { el, local } of this.clipsAt(t)) {
      const v = this.video(el.asset);
      if (!v) continue;
      const ct = clipTime(el, local, this.ed.doc.assets[el.asset]?.duration ?? (v.duration || Infinity));
      if (ct === null) { if (!active.has(el.asset)) { v.pause(); this.ed.renderer.setVideoFrame(el.asset, null); } continue; }
      active.add(el.asset);
      v.muted = !!el.muted;
      v.volume = el.volume ?? 1;
      if (hard || Math.abs(v.currentTime - ct) > 0.25) v.currentTime = ct;
      if (v.paused) void v.play().catch(() => {});
      this.grab(el.asset, v);
    }
    for (const [asset, v] of this.videos) if (!active.has(asset) && !v.paused) v.pause();
    for (const clip of this.ed.doc.audio ?? []) {
      const a = this.media(this.audios, clip.id, clip.asset, () => document.createElement('audio'));
      if (!a) continue;
      const inside = t >= clip.start && t < clip.start + clip.duration;
      if (!inside) { if (!a.paused) a.pause(); continue; }
      const want = clip.offset + (t - clip.start);
      a.volume = soundGain(clip, t);
      if (hard || Math.abs(a.currentTime - want) > 0.25) a.currentTime = want;
      if (a.paused) void a.play().catch(() => {});
    }
  }

  dispose(): void {
    this.playing = false;
    this.scrubbing = false;
    cancelAnimationFrame(this.raf);
    for (const m of [...this.videos.values(), ...this.audios.values()]) { m.pause(); m.removeAttribute('src'); m.load(); }
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.videos.clear();
    this.audios.clear();
  }
}
