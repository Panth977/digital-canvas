import { clipTime, pageAtTime, totalDuration, type VideoElement } from '@digital-canvas/scene';
import type { EditorState } from './editor.svelte.ts';

/**
 * Plays a design as a video in the editor: pages one after another for their durations, video
 * clips on the showing page, and the timeline's sounds. Video is decoded by the browser
 * (<video>); each animation frame its picture is handed to the renderer.
 */
export class Player {
  time = $state(0);
  playing = $state(false);

  private videos = new Map<string, HTMLVideoElement>();
  private audios = new Map<string, HTMLAudioElement>();
  private urls: string[] = [];
  private raf = 0;
  private t0 = 0;
  private seekToken = 0;

  constructor(private ed: EditorState) {}

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

  private clipsAt(t: number): { el: VideoElement; local: number }[] {
    const { page, local } = pageAtTime(this.ed.doc, t);
    return page.elements.filter((e): e is VideoElement => e.type === 'video' && !e.hidden).map((el) => ({ el, local }));
  }

  /** Show the picture at time `t` (paused). */
  async seek(t: number): Promise<void> {
    this.time = Math.max(0, Math.min(this.duration, t));
    const token = ++this.seekToken;
    const { page } = pageAtTime(this.ed.doc, this.time);
    if (this.ed.pageId !== page.id && !this.ed.selection.length) this.ed.pageId = page.id;
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

  play(): void {
    if (this.playing) return;
    if (this.time >= this.duration - 0.01) this.time = 0;
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
    const { page } = pageAtTime(this.ed.doc, t);
    if (this.ed.pageId !== page.id) this.ed.pageId = page.id;
    const active = new Set<string>();
    for (const { el, local } of this.clipsAt(t)) {
      const v = this.video(el.asset);
      if (!v) continue;
      const ct = clipTime(el, local, this.ed.doc.assets[el.asset]?.duration ?? (v.duration || Infinity));
      if (ct === null) { v.pause(); this.ed.renderer.setVideoFrame(el.asset, null); continue; }
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
      a.volume = clip.volume ?? 1;
      if (hard || Math.abs(a.currentTime - want) > 0.25) a.currentTime = want;
      if (a.paused) void a.play().catch(() => {});
    }
  }

  dispose(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    for (const m of [...this.videos.values(), ...this.audios.values()]) { m.pause(); m.removeAttribute('src'); m.load(); }
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.videos.clear();
    this.audios.clear();
  }
}
