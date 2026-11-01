/**
 * The Subtitles panel's work: lines through scene/subtitles.ts, speech through
 * `ed.synth`. Results are ordinary audio assets, one per different sound; one
 * Generate is one undo step.
 */
import {
  HINDI_FONT, addSpeech, applyCaptionStyle, emptyTrack, encodeWav, fitSamples, levelSpeech, lineVoice, newId, parseCues, setLines, setSpeech, speechKey, splitScript, staleLines, syncCaptions, timeScript, toSrt, toVtt, updateElements,
  pageDuration, pageStart, type Doc, type SpeechSettings, type SubtitleLine, type SubtitleTrack, type TextElement,
} from '@digital-canvas/scene';
import { assetId } from '@digital-canvas/storage';
import { catalog, fetchFamily } from '../fonts.ts';
import type { EditorState } from '../editor.svelte.ts';
import { ENGINES, voiceById, type Engine } from './voices.ts';
import type { Spoken } from './synth.ts';

/** Text the model says when a voice is previewed. */
const SAMPLE: Record<string, string> = { hi: 'नमस्ते, मैं आपके वीडियो की आवाज़ हूँ।', en: 'Hello, this is how your video will sound.' };

const ENGINE_KEY = 'dc.tts.engine';

export interface SpeechJob {
  /** Lines done, of `total`. */
  done: number;
  total: number;
  msg: string;
  /** Of the current step (download, a long line). */
  fraction?: number;
}

export class Subtitles {
  job = $state<SpeechJob | null>(null);
  error = $state<string | null>(null);
  previewing = $state<string | null>(null);
  /** Smaller, slower model; always on phones. */
  smallModel = $state(typeof localStorage !== 'undefined' && localStorage.getItem(ENGINE_KEY) === 'small');

  private abort: AbortController | null = null;
  /** Spoken lines of this session by key, so changing only the fit doesn't run the model again. */
  private spoken = new Map<string, Spoken>();
  private jobs = 0;
  private fontPending = false;

  constructor(private ed: EditorState) {}

  get track(): SubtitleTrack {
    return this.ed.doc.subtitles ?? emptyTrack();
  }

  get engine(): Engine {
    return this.smallModel ? 'small' : 'gpu';
  }

  downloadMb(gpu: boolean): number {
    return ENGINES[gpu && !this.smallModel ? 'gpu' : 'small'].mb;
  }

  setSmallModel(on: boolean): void {
    this.smallModel = on;
    localStorage.setItem(ENGINE_KEY, on ? 'small' : 'auto');
  }

  /** Commit a doc with caption text that changed: boxes fit their new text. */
  private apply(r: { doc: Doc; changed: string[] }, key: string | null = null): void {
    const ed = this.ed;
    const fit = (e: TextElement): Partial<TextElement> => { try { return ed.fitPatch(e); } catch { return {}; } };
    const doc = r.changed.length ? updateElements(r.doc, r.changed, (e) => (e.type === 'text' ? fit(e) : {})) : r.doc;
    ed.commit(doc, key);
    if (doc.subtitles?.lines.some((l) => /[\u0900-\u097f]/.test(l.text))) void this.hindiFont();
  }

  /** Hindi captions need a font with Devanagari; embedded like any other font. Offline, the design still opens. */
  private async hindiFont(): Promise<void> {
    const ed = this.ed;
    if (ed.engine.fonts.families.has(HINDI_FONT) || this.fontPending) return;
    this.fontPending = true;
    try {
      const f = (await catalog()).find((x) => x.family === HINDI_FONT);
      const text = this.track.lines.map((l) => l.text).join(' ');
      if (f) await ed.addFonts(await fetchFamily(f, text));
      const ids = ed.doc.pages.flatMap((p) => p.elements).filter((e) => e.caption).map((e) => e.id);
      this.apply({ doc: ed.doc, changed: ids });
    } catch (e) {
      console.warn('Hindi caption font not loaded', e);
    } finally {
      this.fontPending = false;
    }
  }

  private lines(next: SubtitleLine[], key: string | null = null): void {
    const doc: Doc = this.ed.doc.subtitles ? this.ed.doc : { ...this.ed.doc, subtitles: this.track };
    this.apply(setLines(doc, next), key);
  }

  /** Script text becomes lines, after the ones there (one per scene when the numbers match). */
  addScript(script: string): number {
    const parts = splitScript(script);
    if (!parts.length) return 0;
    const old = this.track.lines;
    if (!old.length) this.lines(timeScript(this.ed.doc, parts));
    else {
      const at = old[old.length - 1]!.end;
      this.lines([...old, ...parts.map((text, i) => ({ id: newId('l_'), start: at + i * 3, end: at + (i + 1) * 3, text }))]);
    }
    this.ed.seal();
    return parts.length;
  }

  /** An empty line at the current scene's free time. */
  addLine(): void {
    const ed = this.ed, page = ed.page;
    const s = pageStart(ed.doc, page.id), e = s + pageDuration(page);
    const start = Math.min(Math.max(s, ...this.track.lines.filter((l) => l.end <= e + 1e-6).map((l) => l.end)), e - 0.5);
    this.lines([...this.track.lines, { id: newId('l_'), start: Math.max(s, start), end: e, text: '' }]);
    ed.seal();
  }

  updateLine(id: string, patch: Partial<SubtitleLine>, key: string | null = null): void {
    this.lines(this.track.lines.map((l) => {
      if (l.id !== id) return l;
      const next = { ...l, ...patch };
      for (const k of Object.keys(patch) as (keyof SubtitleLine)[]) if (patch[k] === undefined) delete next[k];
      return next;
    }), key);
  }

  removeLine(id: string): void {
    this.lines(this.track.lines.filter((l) => l.id !== id));
    this.ed.seal();
  }

  clear(): void {
    this.lines([]);
    this.ed.seal();
  }

  /** SRT or VTT replaces the lines. */
  importCues(src: string): number {
    const cues = parseCues(src);
    if (cues.length) { this.lines(cues.map((c) => ({ id: newId('l_'), ...c }))); this.ed.seal(); }
    return cues.length;
  }

  exportCues(kind: 'srt' | 'vtt'): string {
    return (kind === 'srt' ? toSrt : toVtt)(this.track.lines.filter((l) => l.text.trim()));
  }

  setShow(show: boolean): void {
    const doc: Doc = { ...this.ed.doc, subtitles: { ...this.track, show } };
    this.apply(syncCaptions(doc));
    this.ed.seal();
  }

  setStyle(id: string): void {
    const doc = this.ed.doc.subtitles ? this.ed.doc : { ...this.ed.doc, subtitles: this.track };
    this.ed.commit(applyCaptionStyle(doc, id));
    this.ed.seal();
  }

  setSpeech(patch: Partial<SpeechSettings>, key: string | null = null): void {
    this.ed.commit(setSpeech(this.ed.doc, patch), key);
  }

  /** Lines whose sound is missing or old. */
  get stale(): SubtitleLine[] {
    return staleLines(this.ed.doc, (id) => this.ed.assets.has(id));
  }

  cancel(): void {
    this.abort?.abort();
  }

  /** Say a line or every changed line. Lines that didn't change are left alone. */
  async generate(only?: string): Promise<void> {
    if (this.job) return;
    const ed = this.ed;
    const todo = only ? this.track.lines.filter((l) => l.id === only && l.text.trim()) : this.stale;
    if (!todo.length) return;
    this.error = null;
    const ac = (this.abort = new AbortController());
    const undo = `speech:${++this.jobs}`;
    this.job = { done: 0, total: todo.length, msg: 'Getting ready…' };
    try {
      for (const [i, first] of todo.entries()) {
        const line = this.track.lines.find((l) => l.id === first.id);
        if (!line?.text.trim()) continue;
        const s = this.track.speech, key = speechKey(line, s), voice = lineVoice(line, s), speed = line.speed ?? s.speed;
        this.job = { done: i, total: todo.length, msg: 'Speaking…' };
        let got = this.spoken.get(key);
        if (!got) {
          const r = await ed.synth(line.text, { voice, speed, engine: this.engine, signal: ac.signal, progress: (msg, fraction) => { if (this.job) this.job = { ...this.job, msg, fraction }; } });
          got = { pcm: levelSpeech(r.pcm), rate: r.rate };
          this.spoken.set(key, got);
        }
        await this.place(line.id, got, undo);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== 'cancelled') this.error = `Speech failed: ${msg}. Your subtitles are safe; try again, or try the smaller model.`;
    } finally {
      this.job = null;
      this.abort = null;
      ed.seal();
      void ed.player.refresh();
    }
  }

  /** Store a line's sound (once) and put it on the timeline, fitted to the line. */
  private async place(id: string, got: Spoken, undo: string): Promise<void> {
    const ed = this.ed;
    const { pcm, factor } = fitSamples(ed.doc, id, got.pcm, got.rate);
    const bytes = encodeWav(pcm, got.rate);
    const asset = await assetId(bytes, 'audio/wav');
    ed.assets.set(asset, bytes);
    this.apply(addSpeech(ed.doc, id, asset, pcm.length / got.rate, factor), undo);
  }

  /** Hear a voice on its sample sentence. */
  async preview(voice: string): Promise<void> {
    if (this.previewing) return;
    this.previewing = voice;
    this.error = null;
    try {
      const lang = voiceById(voice)?.lang ?? 'en-us';
      const key = `preview|${voice}`;
      let got = this.spoken.get(key);
      if (!got) {
        const r = await this.ed.synth(SAMPLE[lang === 'hi' ? 'hi' : 'en']!, { voice, speed: 1, engine: this.engine, progress: (msg, fraction) => (this.job = { done: 0, total: 1, msg, fraction }) });
        got = { pcm: levelSpeech(r.pcm), rate: r.rate };
        this.spoken.set(key, got);
      }
      const url = URL.createObjectURL(new Blob([encodeWav(got.pcm, got.rate) as BlobPart], { type: 'audio/wav' }));
      const a = new Audio(url);
      a.onended = () => URL.revokeObjectURL(url);
      await a.play().catch(() => {});
    } catch (e) {
      this.error = `Preview failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      this.previewing = null;
      this.job = null;
    }
  }
}
