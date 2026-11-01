/**
 * A video's subtitles and speech: pure functions over `Doc.subtitles`. Lines
 * are timed in seconds of the whole video; each shows as an ordinary text element
 * per scene it crosses (`ElementBase.caption`), and its speech is an ordinary
 * sound (`AudioClip.speech`). The element and the clip follow the line, and
 * `followSubtitles` (run on every commit) makes the line follow canvas edits and
 * scene changes.
 */
import { addAudio, addElements, newId, pageDuration, pageStart, removeElements, text, updateElements } from './doc.ts';
import { stretchAudio } from './stretch.ts';
import { walk } from './tree.ts';
import type { AudioClip, Doc, Element, Page, SpeechSettings, SubtitleLine, SubtitleTrack, TextElement, TextEffect, TextStyle } from './types.ts';

const DEVANAGARI = /[\u0900-\u097f]/;
const r2 = (n: number): number => Math.round(n * 100) / 100;
const r3 = (n: number): number => Math.round(n * 1000) / 1000;
/** A line never gets shorter than this, seconds. */
const MIN_LINE = 0.2;
/** Air after the speech, so one line doesn't run into the next. */
export const SPEECH_TAIL = 0.15;

export const DEFAULT_SPEECH: SpeechSettings = { voice: 'af_heart', speed: 1, volume: 1, fit: 'stretch' };

export const emptyTrack = (): SubtitleTrack => ({ lines: [], show: true, style: 'bar', speech: { ...DEFAULT_SPEECH } });

// ---- typing or pasting a script ----

/** A script as lines: its own line breaks, then sentences, then long sentences at commas. */
export function splitScript(script: string, maxChars = 90): string[] {
  const out: string[] = [];
  for (const para of script.split(/\r?\n+/)) {
    const clean = para.replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    for (const sentence of clean.match(/[^.!?।॥]+(?:[.!?।॥]+["')\]”’]*|$)\s*/gu) ?? [clean]) {
      let rest = sentence.trim();
      while (rest.length > maxChars) {
        const head = rest.slice(0, maxChars);
        const comma = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '), head.lastIndexOf(': '), head.lastIndexOf(' — '));
        const cut = comma > maxChars / 3 ? comma + 1 : head.lastIndexOf(' ') > 0 ? head.lastIndexOf(' ') : maxChars;
        out.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) out.push(rest);
    }
  }
  return out;
}

const visible = (doc: Doc): Page[] => doc.pages.filter((p) => !p.hidden);
const total = (doc: Doc): number => visible(doc).reduce((t, p) => t + pageDuration(p), 0);

/**
 * Time script lines: one per scene when they match the scenes (the default),
 * else spread over the video by length, with a share for each line's pause.
 */
export function timeScript(doc: Doc, lines: string[]): SubtitleLine[] {
  const pages = visible(doc);
  if (lines.length === pages.length) {
    return lines.map((t, i) => {
      const s = pageStart(doc, pages[i]!.id);
      return { id: newId('l_'), start: r2(s), end: r2(s + pageDuration(pages[i]!)), text: t };
    });
  }
  const weight = lines.map((l) => l.length + 8), sum = weight.reduce((a, b) => a + b, 0) || 1, len = total(doc);
  let t = 0;
  return lines.map((l, i) => {
    const d = (len * weight[i]!) / sum;
    const line = { id: newId('l_'), start: r2(t), end: r2(t + d), text: l };
    t += d;
    return line;
  });
}

// ---- SRT and VTT ----

const clock = (t: number, sep: ',' | '.'): string => {
  const ms = Math.max(0, Math.round(t * 1000));
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`;
};

export type Timed = Pick<SubtitleLine, 'start' | 'end' | 'text'>;

export const toSrt = (lines: readonly Timed[]): string => lines.map((l, i) => `${i + 1}\n${clock(l.start, ',')} --> ${clock(l.end, ',')}\n${l.text}\n`).join('\n');
export const toVtt = (lines: readonly Timed[]): string => `WEBVTT\n\n${lines.map((l) => `${clock(l.start, '.')} --> ${clock(l.end, '.')}\n${l.text}\n`).join('\n')}`;

const seconds = (c: string): number => {
  const p = c.trim().replace(',', '.').split(':').map(Number);
  return p.reduce((t, v) => t * 60 + v, 0);
};

/** SRT or VTT cues (either format; numbers, notes, styles and tags are dropped). */
export function parseCues(src: string): Timed[] {
  const out: Timed[] = [];
  for (const block of src.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const rows = block.split('\n');
    const at = rows.findIndex((r) => r.includes('-->'));
    if (at < 0) continue;
    const m = /^\s*([\d:.,]+)\s*-->\s*([\d:.,]+)/.exec(rows[at]!);
    if (!m) continue;
    const start = seconds(m[1]!), end = seconds(m[2]!);
    const body = rows.slice(at + 1).join('\n').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').trim();
    if (body && end > start) out.push({ start: r3(start), end: r3(end), text: body });
  }
  return out;
}

// ---- how captions look ----

export interface CaptionStyle { id: string; label: string; style: Partial<TextStyle>; effect?: TextEffect; /** Top of the box, share of the height. */ y: number }

const WHITE = '#ffffff', BLACK = '#000000';
export const CAPTION_STYLES: CaptionStyle[] = [
  { id: 'bar', label: 'Bar', y: 0.76, style: { fontFamily: 'Inter', bold: true, color: WHITE }, effect: { type: 'background', color: BLACK, transparency: 25, roundness: 40, spread: 40 } },
  { id: 'clean', label: 'Clean', y: 0.78, style: { fontFamily: 'Inter', bold: true, color: WHITE }, effect: { type: 'shadow', offset: 20, direction: 90, blur: 40, transparency: 20, color: BLACK } },
  { id: 'outline', label: 'Outline', y: 0.76, style: { fontFamily: 'Inter', bold: true, color: WHITE }, effect: { type: 'outline', thickness: 40, color: BLACK } },
  { id: 'yellow', label: 'Yellow', y: 0.76, style: { fontFamily: 'Inter', bold: true, color: '#ffd400' }, effect: { type: 'background', color: BLACK, transparency: 10, roundness: 20, spread: 30 } },
  { id: 'loud', label: 'Loud', y: 0.68, style: { fontFamily: 'Inter', bold: true, color: WHITE, uppercase: true }, effect: { type: 'outline', thickness: 60, color: BLACK } },
  { id: 'top', label: 'Top', y: 0.08, style: { fontFamily: 'Inter', bold: true, color: WHITE }, effect: { type: 'background', color: BLACK, transparency: 25, roundness: 40, spread: 40 } },
];

const captionStyle = (id: string): CaptionStyle => CAPTION_STYLES.find((s) => s.id === id) ?? CAPTION_STYLES[0]!;
export const isCaption = (e: Element): boolean => !!e.caption;

/** Inter has no Devanagari. Caption styles use Inter, so a Hindi line swaps it for this. */
export const HINDI_FONT = 'Noto Sans Devanagari';
const captionFamily = (lineText: string, family: string): string => (family === 'Inter' && DEVANAGARI.test(lineText) ? HINDI_FONT : family === HINDI_FONT && !DEVANAGARI.test(lineText) ? 'Inter' : family);

function captionElement(doc: Doc, c: CaptionStyle, line: SubtitleLine, timing: Element['timing']): TextElement {
  const size = Math.round(Math.min(doc.width, doc.height) * 0.05);
  const box = { x: doc.width * 0.08, y: doc.height * c.y, w: doc.width * 0.84, h: size * 1.25 };
  return { ...text(line.text, box, { fontSize: size, align: 'center', lineHeight: 1.2, ...c.style, fontFamily: captionFamily(line.text, c.style.fontFamily ?? 'Inter') }), name: 'Caption', caption: line.id, ...(c.effect ? { effect: c.effect } : {}), timing };
}

/** Where a line falls on each scene it crosses. */
function spans(doc: Doc, l: SubtitleLine): { page: Page; timing: { start: number; end: number } }[] {
  const out: { page: Page; timing: { start: number; end: number } }[] = [];
  for (const p of visible(doc)) {
    const a = pageStart(doc, p.id), b = a + pageDuration(p);
    const s = Math.max(l.start, a), e = Math.min(l.end, b);
    if (e - s >= 0.05) out.push({ page: p, timing: { start: r2(s - a), end: r2(e - a) } });
  }
  return out;
}

const captionsOf = (doc: Doc): { page: Page; el: TextElement }[] => doc.pages.flatMap((p) => [...walk(p.elements)].filter((e): e is TextElement => e.type === 'text' && !!e.caption).map((el) => ({ page: p, el })));

/**
 * Make the caption elements match the lines: new ones for new lines, text and
 * timing for the rest, gone for lines (or scenes) that went. An element the user
 * moved or restyled keeps its look. Returns the ids of elements whose text
 * changed (they need refitting to their text).
 */
export function syncCaptions(doc: Doc): { doc: Doc; changed: string[] } {
  const tr = doc.subtitles;
  const have = captionsOf(doc);
  if (!tr?.show) return have.length ? { doc: removeElements(doc, have.map((h) => h.el.id)), changed: [] } : { doc, changed: [] };
  const style = captionStyle(tr.style);
  const changed: string[] = [];
  const keep = new Set<string>();
  let next = doc;
  for (const l of tr.lines) {
    if (!l.text.trim()) continue;
    for (const { page, timing } of spans(doc, l)) {
      const hit = have.find((h) => h.el.caption === l.id && h.page.id === page.id);
      if (!hit) {
        const el = captionElement(doc, style, l, timing);
        keep.add(el.id);
        changed.push(el.id);
        next = addElements(next, page.id, [el]);
        continue;
      }
      keep.add(hit.el.id);
      const same = hit.el.text === l.text && hit.el.timing?.start === timing.start && hit.el.timing?.end === timing.end;
      if (same) continue;
      if (hit.el.text !== l.text) changed.push(hit.el.id);
      next = updateElements(next, [hit.el.id], { text: l.text, runs: undefined, timing, style: { ...hit.el.style, fontFamily: captionFamily(l.text, hit.el.style.fontFamily) } } as never);
    }
  }
  const gone = have.filter((h) => !keep.has(h.el.id)).map((h) => h.el.id);
  return { doc: gone.length ? removeElements(next, gone) : next, changed };
}

/** The look of a style on every caption (position too: the picker is a reset). */
export function applyCaptionStyle(doc: Doc, id: string): Doc {
  if (!doc.subtitles) return doc;
  const c = captionStyle(id);
  const size = Math.round(Math.min(doc.width, doc.height) * 0.05);
  const next = updateElements(doc, captionsOf(doc).map((h) => h.el.id), (e) => ({ y: doc.height * c.y, effect: c.effect, style: { ...(e as TextElement).style, ...c.style, fontFamily: captionFamily((e as TextElement).text, c.style.fontFamily ?? 'Inter'), uppercase: c.style.uppercase ?? false, fontSize: size } }) as never);
  return { ...next, subtitles: { ...doc.subtitles, style: id } };
}

/** The design with no captions on it, for exports without burned-in subtitles. */
export function withoutCaptions(doc: Doc): Doc {
  const ids = captionsOf(doc).map((h) => h.el.id);
  return ids.length ? removeElements(doc, ids) : doc;
}

// ---- lines ----

const lineSpeech = (doc: Doc, id: string): AudioClip | undefined => doc.audio?.find((a) => a.speech?.line === id);

/** New lines for the track: clips follow their lines, clips of removed lines go, captions catch up. */
export function setLines(doc: Doc, lines: SubtitleLine[]): { doc: Doc; changed: string[] } {
  const tr = doc.subtitles ?? emptyTrack();
  const ids = new Map(lines.map((l) => [l.id, l]));
  const audio = doc.audio?.filter((a) => !a.speech || ids.has(a.speech.line)).map((a) => {
    const l = a.speech && ids.get(a.speech.line);
    return l && a.start !== l.start ? { ...a, start: l.start } : a;
  });
  return syncCaptions({ ...doc, audio, subtitles: { ...tr, lines: [...lines].sort((a, b) => a.start - b.start) }, updatedAt: new Date().toISOString() });
}

/** A whole-track change that isn't lines (voice, volume, fit, ducking). Volume reaches the clips. */
export function setSpeech(doc: Doc, patch: Partial<SpeechSettings>): Doc {
  const tr = doc.subtitles ?? emptyTrack();
  const speech = { ...tr.speech, ...patch };
  if ('duck' in patch && patch.duck === undefined) delete speech.duck;
  const audio = patch.volume === undefined ? doc.audio : doc.audio?.map((a) => (a.speech ? { ...a, volume: patch.volume! } : a));
  return { ...doc, audio, subtitles: { ...tr, speech } };
}

// ---- which lines need speech ----


/** The voice that says a line: its own, else the track's; Hindi text gets a Hindi voice. */
export function lineVoice(l: Pick<SubtitleLine, 'text' | 'voice'>, s: SpeechSettings): string {
  if (l.voice) return l.voice;
  return DEVANAGARI.test(l.text) && !s.voice.startsWith('h') ? 'hf_alpha' : s.voice;
}

/** What a line's speech depends on: same key = same sound. */
export function speechKey(l: Pick<SubtitleLine, 'text' | 'voice' | 'speed'>, s: SpeechSettings, model = SPEECH_MODEL.id): string {
  return [model, lineVoice(l, s), l.speed ?? s.speed, l.text.replace(/\s+/g, ' ').trim()].join('|');
}

/** Lines whose sound is missing or out of date (empty lines say nothing). */
export function staleLines(doc: Doc, hasAsset: (id: string) => boolean = () => true, model = SPEECH_MODEL.id): SubtitleLine[] {
  const tr = doc.subtitles;
  if (!tr) return [];
  return tr.lines.filter((l) => {
    if (!l.text.trim()) return false;
    const c = lineSpeech(doc, l.id);
    if (!c || c.speech!.key !== speechKey(l, tr.speech, model) || !hasAsset(c.asset)) return true;
    return tr.speech.fit === 'speed' && c.duration > l.end - l.start + 0.05;
  });
}

// ---- fitting speech to lines ----

/** How much to speed up `len` seconds of speech to fit `room`: 1 = it fits; never past `max`. */
export function fitFactor(len: number, room: number, max = 2): number {
  const want = len / Math.max(0.05, room - 0.05);
  return want <= 1 ? 1 : Math.min(max, r3(want));
}

/** The page showing at the end of a line. */
function pageOfLineEnd(doc: Doc, l: SubtitleLine): Page | undefined {
  const at = l.end - 1e-3;
  return visible(doc).find((p) => { const s = pageStart(doc, p.id); return at >= s - 1e-6 && at < s + pageDuration(p); }) ?? visible(doc).at(-1);
}

/**
 * Give a line `len` seconds of room: it grows, its scene grows with it, and
 * everything after moves on (later lines and their speech). Lines never shrink.
 */
export function stretchLine(doc: Doc, id: string, len: number): Doc {
  const tr = doc.subtitles;
  const l = tr?.lines.find((x) => x.id === id);
  if (!tr || !l) return doc;
  const d = r2(len + SPEECH_TAIL - (l.end - l.start));
  if (d <= 0) return doc;
  const page = pageOfLineEnd(doc, l);
  // a gap before the next line is used first
  const next = tr.lines.filter((x) => x.start >= l.end - 1e-6).sort((a, b) => a.start - b.start)[0];
  const free = next ? Math.max(0, next.start - l.end) : Math.max(0, total(doc) - l.end);
  const grow = r2(Math.max(0, d - free));
  const oldEnd = l.end;
  const lines = tr.lines.map((x) => (x.id === id ? { ...x, end: r2(x.end + d) } : x.start >= oldEnd - 1e-6 ? { ...x, start: r2(x.start + grow), end: r2(x.end + grow) } : x));
  const moved = new Map(lines.map((x) => [x.id, x.start]));
  const pages = grow > 0 && page ? doc.pages.map((p) => (p.id === page.id ? { ...p, duration: r2(pageDuration(p) + grow) } : p)) : doc.pages;
  const audio = doc.audio?.map((a) => (a.speech && moved.has(a.speech.line) ? { ...a, start: moved.get(a.speech.line)! } : a));
  return { ...doc, pages, audio, subtitles: { ...tr, lines } };
}

/** A line's clip, new or replaced, starting with the line. `asset` is already in `doc.assets`. */
export function placeSpeech(doc: Doc, id: string, asset: string, duration: number, key: string, fitted = 1): Doc {
  const tr = doc.subtitles;
  const l = tr?.lines.find((x) => x.id === id);
  if (!tr || !l) return doc;
  const speech = { line: id, key, ...(fitted !== 1 ? { fitted } : {}) };
  const name = l.text.length > 28 ? `${l.text.slice(0, 27)}…` : l.text;
  const old = lineSpeech(doc, id);
  if (old) return { ...doc, audio: doc.audio!.map((a) => (a === old ? { ...a, asset, start: l.start, offset: 0, duration: r3(duration), speech, name, volume: tr.speech.volume } : a)) };
  return addAudio(doc, { asset, start: l.start, offset: 0, duration: r3(duration), volume: tr.speech.volume, name, speech }).doc;
}

/** The speech model, as recorded on what it makes. A new id regenerates every line. */
export const SPEECH_MODEL = { id: 'kokoro-82m-v1.0', label: 'Kokoro-82M' };

// ---- speech samples → timeline ----

/** Bring speech to one loudness, so lines and voices match; peaks stay clear of clipping. */
export function levelSpeech(pcm: Float32Array, rms = 0.11, peak = 0.92): Float32Array {
  let sum = 0, top = 0;
  for (const v of pcm) { sum += v * v; top = Math.max(top, Math.abs(v)); }
  if (!pcm.length || top === 0) return pcm;
  const g = Math.min(rms / Math.sqrt(sum / pcm.length), peak / top);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i]! * g;
  return out;
}

/** 16-bit mono WAV: every browser, Mediabunny and ffmpeg read it without a codec. */
export function encodeWav(pcm: Float32Array, rate: number): Uint8Array {
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const d = new DataView(bytes.buffer);
  const tag = (at: number, s: string): void => { for (let i = 0; i < 4; i++) d.setUint8(at + i, s.charCodeAt(i)); };
  tag(0, 'RIFF'); d.setUint32(4, 36 + pcm.length * 2, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, rate, true); d.setUint32(28, rate * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true);
  tag(36, 'data'); d.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) d.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, pcm[i]!)) * 32767), true);
  return bytes;
}

/** Samples for a line: as spoken, or sped up to fit it when the track says so (pitch kept). */
export function fitSamples(doc: Doc, id: string, pcm: Float32Array, rate: number): { pcm: Float32Array; factor: number } {
  const tr = doc.subtitles, l = tr?.lines.find((x) => x.id === id);
  const factor = tr?.speech.fit === 'speed' && l ? fitFactor(pcm.length / rate, l.end - l.start) : 1;
  return { pcm: factor === 1 ? pcm : stretchAudio([pcm], factor, rate)[0]!, factor };
}

/**
 * A line's finished sound on the timeline: the asset's record (what it says, with
 * which voice and model), the line grown to hold it when the track stretches, the
 * clip at the line's start. The caller has stored the bytes under `asset`.
 */
export function addSpeech(doc: Doc, id: string, asset: string, duration: number, factor: number): { doc: Doc; changed: string[] } {
  const tr = doc.subtitles, l = tr?.lines.find((x) => x.id === id);
  if (!tr || !l) return { doc, changed: [] };
  const voice = lineVoice(l, tr.speech);
  let next = doc;
  if (!next.assets[asset]) next = { ...next, assets: { ...next.assets, [asset]: { mime: 'audio/wav', duration, name: `Speech: ${l.text.slice(0, 40)}`, speech: { text: l.text, voice, model: SPEECH_MODEL.label, speed: l.speed ?? tr.speech.speed } } } };
  if (tr.speech.fit === 'stretch') next = stretchLine(next, id, duration);
  return syncCaptions(placeSpeech(next, id, asset, duration, speechKey(l, tr.speech, SPEECH_MODEL.id), factor));
}

// ---- following the canvas and the timeline ----

const layout = (doc: Doc): Map<string, { start: number; d: number }> => new Map(visible(doc).map((p) => [p.id, { start: pageStart(doc, p.id), d: pageDuration(p) }]));

/** Where the scenes went, between two docs: each line and its speech goes with its scene. */
function retime(prev: Doc, next: Doc): Doc {
  const tr = next.subtitles;
  if (!tr?.lines.length) return next;
  const a = layout(prev), b = layout(next);
  let moved = false;
  for (const [id, p] of a) { const q = b.get(id); if (!q || q.start !== p.start || q.d !== p.d) moved = true; }
  if (!moved && a.size === b.size) return next;
  const delta = new Map<string, number>();
  const lines = tr.lines.map((l) => {
    let d = 0;
    for (const [id, p] of a) if (l.start >= p.start - 1e-6 && l.start < p.start + p.d) { const q = b.get(id); if (q) d = q.start - p.start; break; }
    if (!d) return l;
    delta.set(l.id, d);
    return { ...l, start: r2(l.start + d), end: r2(l.end + d) };
  }).sort((x, y) => x.start - y.start);
  const audio = next.audio?.map((c) => { const d = c.speech && delta.get(c.speech.line); return d ? { ...c, start: r2(c.start + d) } : c; });
  return syncCaptions({ ...next, audio, subtitles: { ...tr, lines } }).doc;
}

/** Text typed on the canvas, or a caption's timing bar dragged: the line takes it. */
function adopt(next: Doc): Doc {
  const tr = next.subtitles;
  if (!tr?.lines.length) return next;
  let lines = tr.lines;
  const edited = new Set<string>();
  for (const { page, el } of captionsOf(next)) {
    const was = tr.lines.find((x) => x.id === el.caption);
    const l = lines.find((x) => x.id === el.caption);
    if (!l || !was) continue;
    const base = pageStart(next, page.id);
    const first = spans(next, l)[0];
    if (!first) continue;
    let patch: Partial<SubtitleLine> | null = null;
    if (el.text !== was.text) patch = { text: el.text };
    const single = spans(next, l).length === 1;
    if (single && el.timing && (el.timing.start !== first.timing.start || el.timing.end !== first.timing.end)) {
      const start = r2(base + (el.timing.start ?? 0));
      const end = r2(base + (el.timing.end ?? pageDuration(page)));
      if (end - start >= MIN_LINE) patch = { ...patch, start, end };
    }
    if (!patch) continue;
    edited.add(l.id);
    lines = lines.map((x) => (x.id === l.id ? { ...x, ...patch } : x));
  }
  if (!edited.size) return next;
  const moved = new Map(lines.map((l) => [l.id, l.start]));
  const audio = next.audio?.map((a) => (a.speech && moved.has(a.speech.line) ? { ...a, start: moved.get(a.speech.line)! } : a));
  return syncCaptions({ ...next, audio, subtitles: { ...tr, lines } }).doc;
}

/**
 * Run on every commit. A change that set the track itself is already timed;
 * anything else may have edited a caption or moved a scene.
 */
export function followSubtitles(prev: Doc, next: Doc): Doc {
  if (!next.subtitles?.lines.length || prev.subtitles !== next.subtitles) return next;
  if (prev.pages === next.pages) return next;
  return retime(prev, adopt(next));
}

// ---- ducking ----

/** Ramp in and out of ducking, seconds. */
const DUCK_RAMP = 0.2;

/** Time spans with speech, merged. */
export function speechSpans(doc: Doc): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const clips = (doc.audio ?? []).filter((a) => a.speech).sort((a, b) => a.start - b.start);
  for (const c of clips) {
    const last = out[out.length - 1], end = c.start + c.duration;
    if (last && c.start <= last.end + DUCK_RAMP * 2) last.end = Math.max(last.end, end);
    else out.push({ start: c.start, end });
  }
  return out;
}

/** What a non-speech sound is multiplied by at `t`: the same curve in playback and every export. */
export function duckGain(doc: Doc, t: number): number {
  const level = doc.subtitles?.speech.duck;
  if (level === undefined) return 1;
  let g = 1;
  for (const s of speechSpans(doc)) {
    const into = Math.min(t - (s.start - DUCK_RAMP), s.end + DUCK_RAMP - t) / DUCK_RAMP;
    if (into <= 0) continue;
    g = Math.min(g, 1 - (1 - level) * Math.min(1, into));
  }
  return g;
}

/** `[time, gain]` points of `duckGain`, for gain automation and ffmpeg. */
export function duckPoints(doc: Doc): [number, number][] {
  const level = doc.subtitles?.speech.duck;
  if (level === undefined) return [];
  return speechSpans(doc).flatMap((s): [number, number][] => [[Math.max(0, s.start - DUCK_RAMP), 1], [s.start, level], [s.end, level], [s.end + DUCK_RAMP, 1]]);
}
