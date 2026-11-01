import { describe, expect, it } from 'vitest';
import {
  addSpeech, applyCaptionStyle, createDoc, duckGain, duckPoints, emptyTrack, encodeWav, fitFactor, fitSamples, followSubtitles, levelSpeech, lineVoice, parseCues, setLines, setSpeech, speechKey, speechSpans, splitScript, staleLines, stretchLine, syncCaptions, timeScript, toSrt, toVtt, updateElements, updatePage, withoutCaptions, type Doc, type SubtitleLine, type TextElement,
} from '../src/index.ts';

function video(durations: number[]): Doc {
  const base = createDoc({ title: 'v', width: 1080, height: 1920 } as never);
  const page = base.pages[0]!;
  return { ...base, pages: durations.map((duration, i) => ({ ...page, id: `p${i}`, duration, elements: [] })) };
}
const line = (id: string, start: number, end: number, text: string, extra: Partial<SubtitleLine> = {}): SubtitleLine => ({ id, start, end, text, ...extra });
const withLines = (d: Doc, lines: SubtitleLine[]): Doc => setLines({ ...d, subtitles: emptyTrack() }, lines).doc;
const captions = (d: Doc, page = 0) => d.pages[page]!.elements.filter((e) => e.caption) as TextElement[];

describe('script splitting', () => {
  it('splits on line breaks and sentences', () => {
    expect(splitScript('Hello there. How are you?\n\nFine!')).toEqual(['Hello there.', 'How are you?', 'Fine!']);
  });
  it('splits Hindi at the danda and keeps it', () => {
    expect(splitScript('नमस्ते दोस्तों। आज क्या है?')).toEqual(['नमस्ते दोस्तों।', 'आज क्या है?']);
  });
  it('breaks a long sentence at a comma, then at a space', () => {
    const parts = splitScript(`${'word '.repeat(12).trim()}, ${'more '.repeat(20).trim()}`, 80);
    expect(parts.every((p) => p.length <= 80)).toBe(true);
    expect(parts[0]!.endsWith(',')).toBe(true);
    expect(parts.join(' ').replace(/\s+/g, ' ').split(' ').length).toBe(32);
  });
  it('ignores blank text', () => { expect(splitScript('  \n\n ')).toEqual([]); });
  it('keeps closing quotes on their sentence', () => { expect(splitScript('He said "go." Then left.')).toEqual(['He said "go."', 'Then left.']); });
});

describe('timing a script', () => {
  it('gives one line per scene when the numbers match', () => {
    const l = timeScript(video([3, 5]), ['one', 'two']);
    expect(l.map((x) => [x.start, x.end])).toEqual([[0, 3], [3, 8]]);
  });
  it('spreads other counts by length over the whole video', () => {
    const l = timeScript(video([6]), ['short', 'a much longer line of text here']);
    expect(l[0]!.start).toBe(0);
    expect(l[1]!.end).toBeCloseTo(6, 1);
    expect(l[1]!.end - l[1]!.start).toBeGreaterThan(l[0]!.end - l[0]!.start);
  });
});

describe('SRT and VTT', () => {
  const cues = [{ start: 1, end: 2.5, text: 'Hello' }, { start: 3661.25, end: 3662, text: 'Two\nrows' }];
  it('writes SRT', () => { expect(toSrt(cues)).toBe('1\n00:00:01,000 --> 00:00:02,500\nHello\n\n2\n01:01:01,250 --> 01:01:02,000\nTwo\nrows\n'); });
  it('writes VTT', () => { expect(toVtt(cues).startsWith('WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello\n')).toBe(true); });
  it('reads back what it writes', () => {
    expect(parseCues(toSrt(cues))).toEqual(cues);
    expect(parseCues(toVtt(cues))).toEqual(cues);
  });
  it('reads CRLF, a BOM, short VTT times, cue ids, settings, notes and tags', () => {
    const src = '﻿WEBVTT\r\n\r\nNOTE hi\r\n\r\nintro\r\n00:01.500 --> 00:03.000 align:center\r\n<v Sam>Hi <b>there</b>\r\n\r\n';
    expect(parseCues(src)).toEqual([{ start: 1.5, end: 3, text: 'Hi there' }]);
  });
  it('drops broken cues', () => { expect(parseCues('1\n00:00:05,000 --> 00:00:01,000\nbackwards\n\nnot a cue')).toEqual([]); });
});

describe('captions', () => {
  it('are text elements with the line’s timing inside each scene', () => {
    const d = withLines(video([4, 4]), [line('a', 1, 3, 'first'), line('b', 5, 7, 'second')]);
    expect(captions(d, 0).map((e) => [e.text, e.timing])).toEqual([['first', { start: 1, end: 3 }]]);
    expect(captions(d, 1).map((e) => [e.text, e.timing])).toEqual([['second', { start: 1, end: 3 }]]);
  });
  it('split over the scenes a line crosses', () => {
    const d = withLines(video([4, 4]), [line('a', 3, 6, 'across')]);
    expect(captions(d, 0)[0]!.timing).toEqual({ start: 3, end: 4 });
    expect(captions(d, 1)[0]!.timing).toEqual({ start: 0, end: 2 });
  });
  it('keep a move and a restyle when the line changes', () => {
    let d = withLines(video([4]), [line('a', 0, 2, 'one')]);
    const id = captions(d)[0]!.id;
    d = updateElements(d, [id], { y: 40 });
    d = setLines(d, [line('a', 0.5, 2, 'two')]).doc;
    expect(captions(d)[0]).toMatchObject({ id, y: 40, text: 'two', timing: { start: 0.5, end: 2 } });
  });
  it('go when the line goes or the track hides', () => {
    const d = withLines(video([4]), [line('a', 0, 2, 'one')]);
    expect(captions(setLines(d, []).doc)).toEqual([]);
    expect(captions(syncCaptions({ ...d, subtitles: { ...d.subtitles!, show: false } }).doc)).toEqual([]);
    expect(captions(withoutCaptions(d))).toEqual([]);
  });
  it('take a style', () => {
    const d = applyCaptionStyle(withLines(video([4]), [line('a', 0, 2, 'one')]), 'yellow');
    expect(captions(d)[0]!.style.color).toBe('#ffd400');
    expect(d.subtitles!.style).toBe('yellow');
  });
});

describe('change detection', () => {
  const ready = (d: Doc, id: string): Doc => addSpeech(d, id, 'x.wav', 1, 1).doc;
  it('finds lines with no speech, not empty ones', () => {
    const d = withLines(video([4]), [line('a', 0, 2, 'one'), line('b', 2, 3, '   ')]);
    expect(staleLines(d).map((l) => l.id)).toEqual(['a']);
  });
  it('leaves a generated line alone until it matters', () => {
    let d = ready(withLines(video([4]), [line('a', 0, 2, 'one'), line('b', 2, 3, 'two')]), 'a');
    expect(staleLines(d).map((l) => l.id)).toEqual(['b']);
    // moving a line or spaces in its text do not change the sound
    d = setLines(d, [line('a', 0.5, 2, ' one  '), line('b', 2, 3, 'two')]).doc;
    expect(staleLines(d).map((l) => l.id)).toEqual(['b']);
  });
  it('sees new text, voice and speed, per line or for the track', () => {
    const d = ready(withLines(video([4]), [line('a', 0, 2, 'one')]), 'a');
    expect(staleLines(setLines(d, [line('a', 0, 2, 'changed')]).doc)).toHaveLength(1);
    expect(staleLines(setLines(d, [line('a', 0, 2, 'one', { voice: 'bf_emma' })]).doc)).toHaveLength(1);
    expect(staleLines(setSpeech(d, { speed: 1.2 }))).toHaveLength(1);
    expect(staleLines(setSpeech(d, { voice: 'am_puck' }))).toHaveLength(1);
    expect(staleLines(setSpeech(d, { volume: 0.5 }))).toHaveLength(0);
  });
  it('sees a new model and a lost file', () => {
    const d = ready(withLines(video([4]), [line('a', 0, 2, 'one')]), 'a');
    expect(staleLines(d, () => true, 'another-model')).toHaveLength(1);
    expect(staleLines(d, () => false)).toHaveLength(1);
  });
  it('asks again when a line sped to fit got shorter', () => {
    let d = setSpeech(withLines(video([4]), [line('a', 0, 2, 'one')]), { fit: 'speed' });
    d = addSpeech(d, 'a', 'x.wav', 1.9, 1.3).doc;
    expect(staleLines(d)).toHaveLength(0);
    expect(staleLines(setLines(d, [line('a', 0, 1, 'one')]).doc)).toHaveLength(1);
  });
  it('gives Hindi text a Hindi voice unless the line chose one', () => {
    const s = emptyTrack().speech;
    expect(lineVoice({ text: 'नमस्ते' }, s)).toBe('hf_alpha');
    expect(lineVoice({ text: 'hello' }, s)).toBe('af_heart');
    expect(lineVoice({ text: 'नमस्ते', voice: 'hm_psi' }, s)).toBe('hm_psi');
    expect(speechKey({ text: 'नमस्ते' }, s)).toContain('hf_alpha');
  });
});

describe('fit', () => {
  it('fitFactor is 1 when speech fits and caps at the limit', () => {
    expect(fitFactor(1, 2)).toBe(1);
    expect(fitFactor(3, 2.05)).toBe(1.5);
    expect(fitFactor(10, 2)).toBe(2);
  });
  it('stretch grows the line and its scene, later lines and clips move on', () => {
    let d = withLines(video([3, 3]), [line('a', 0, 3, 'one'), line('b', 3, 6, 'two')]);
    d = addSpeech(d, 'b', 'b.wav', 1, 1).doc;
    d = stretchLine(d, 'a', 4);
    expect(d.pages[0]!.duration).toBeCloseTo(4.15);
    const [a, b] = d.subtitles!.lines;
    expect([a!.start, a!.end]).toEqual([0, 4.15]);
    expect(b!.start).toBeCloseTo(4.15);
    expect(d.audio![0]!.start).toBeCloseTo(4.15);
    // the later scene keeps its length; the line stays on it
    expect(d.pages[1]!.duration).toBe(3);
  });
  it('stretch uses a free gap first, and never shrinks', () => {
    const d = withLines(video([6]), [line('a', 0, 2, 'one'), line('b', 4, 5, 'two')]);
    const s = stretchLine(d, 'a', 3);
    expect(s.pages[0]!.duration).toBe(6);
    expect(s.subtitles!.lines.map((l) => l.start)).toEqual([0, 4]);
    expect(stretchLine(d, 'a', 1)).toBe(d);
  });
  it('speed keeps the line and squeezes the samples', () => {
    const d = setSpeech(withLines(video([4]), [line('a', 0, 1, 'one')]), { fit: 'speed' });
    const r = fitSamples(d, 'a', new Float32Array(24000 * 2), 24000);
    expect(r.factor).toBeGreaterThan(2 - 0.01);
    expect(r.pcm.length).toBeCloseTo(24000, -3);
  });
  it('addSpeech records text, voice and model, stored once', () => {
    let d = withLines(video([4]), [line('a', 0, 2, 'hello'), line('b', 2, 4, 'hello')]);
    d = addSpeech(d, 'a', 'same.wav', 1, 1).doc;
    d = addSpeech(d, 'b', 'same.wav', 1, 1).doc;
    expect(Object.keys(d.assets)).toEqual(['same.wav']);
    expect(d.assets['same.wav']!.speech).toMatchObject({ text: 'hello', voice: 'af_heart', model: 'Kokoro-82M' });
    expect(d.audio!.map((a) => a.start)).toEqual([0, 2]);
  });
  it('a line stretched past its scene keeps caption and clip in step', () => {
    let d = withLines(video([2, 2]), [line('a', 0, 2, 'one'), line('b', 2, 4, 'two')]);
    d = addSpeech(d, 'a', 'a.wav', 3, 1).doc;
    d = addSpeech(d, 'b', 'b.wav', 1, 1).doc;
    expect(captions(d, 0)[0]!.timing!.end).toBeCloseTo(3.15);
    expect(captions(d, 1)[0]!.timing).toEqual({ start: 0, end: 2 });
    expect(d.audio!.find((a) => a.speech!.line === 'b')!.start).toBeCloseTo(3.15);
  });
});

describe('following edits', () => {
  it('text typed on the canvas reaches the line and its other span', () => {
    const d = withLines(video([4, 4]), [line('a', 3, 6, 'old')]);
    const next = followSubtitles(d, updateElements(d, [captions(d, 0)[0]!.id], { text: 'new' } as never));
    expect(next.subtitles!.lines[0]!.text).toBe('new');
    expect(captions(next, 1)[0]!.text).toBe('new');
    expect(staleLines(next)).toHaveLength(1);
  });
  it('a caption’s timing bar moves the line and its clip', () => {
    let d = withLines(video([4]), [line('a', 1, 3, 'one')]);
    d = addSpeech(d, 'a', 'a.wav', 1, 1).doc;
    const next = followSubtitles(d, updateElements(d, [captions(d)[0]!.id], { timing: { start: 2, end: 3.5 } }));
    expect(next.subtitles!.lines[0]).toMatchObject({ start: 2, end: 3.5 });
    expect(next.audio![0]!.start).toBe(2);
  });
  it('a longer scene moves what comes after it', () => {
    let d = withLines(video([3, 3]), [line('a', 0, 3, 'one'), line('b', 3, 6, 'two')]);
    d = addSpeech(d, 'b', 'b.wav', 1, 1).doc;
    const next = followSubtitles(d, updatePage(d, 'p0', { duration: 5 }));
    expect(next.subtitles!.lines.map((l) => l.start)).toEqual([0, 5]);
    expect(next.audio![0]!.start).toBe(5);
  });
  it('reordered scenes take their lines along', () => {
    const d = withLines(video([2, 3]), [line('a', 0, 2, 'one'), line('b', 2, 5, 'two')]);
    const next = followSubtitles(d, { ...d, pages: [d.pages[1]!, d.pages[0]!] });
    expect(next.subtitles!.lines.map((l) => [l.text, l.start])).toEqual([['two', 0], ['one', 3]]);
  });
  it('a change that set the lines itself is not moved twice', () => {
    const d = withLines(video([3, 3]), [line('a', 0, 3, 'one'), line('b', 3, 6, 'two')]);
    const s = stretchLine(d, 'a', 4);
    expect(followSubtitles(d, s)).toBe(s);
  });
  it('does nothing without subtitles', () => {
    const d = video([3]);
    expect(followSubtitles(d, updatePage(d, 'p0', { duration: 4 })).subtitles).toBeUndefined();
  });
});

describe('ducking', () => {
  const ducked = (level?: number): Doc => {
    let d = withLines(video([10]), [line('a', 1, 3, 'one'), line('b', 6, 8, 'two')]);
    d = addSpeech(d, 'a', 'a.wav', 2, 1).doc;
    d = addSpeech(d, 'b', 'b.wav', 2, 1).doc;
    return level === undefined ? d : setSpeech(d, { duck: level });
  };
  it('is off by default', () => { expect(duckGain(ducked(), 2)).toBe(1); expect(duckPoints(ducked())).toEqual([]); });
  it('dips during speech, with ramps', () => {
    const d = ducked(0.25);
    expect(duckGain(d, 0)).toBe(1);
    expect(duckGain(d, 2)).toBeCloseTo(0.25);
    expect(duckGain(d, 0.9)).toBeCloseTo(0.625);
    expect(duckGain(d, 5)).toBe(1);
  });
  it('merges close speech', () => {
    const d = withLines(video([10]), [line('a', 1, 2, 'one'), line('b', 2.1, 3, 'two')]);
    const m = addSpeech(addSpeech(d, 'a', 'a.wav', 1, 1).doc, 'b', 'b.wav', 0.9, 1).doc;
    expect(speechSpans(m)).toHaveLength(1);
  });
  it('turns off again', () => { expect(setSpeech(ducked(0.25), { duck: undefined }).subtitles!.speech.duck).toBeUndefined(); });
});

describe('audio', () => {
  it('levels speech to one loudness, clear of clipping', () => {
    const a = new Float32Array(1000).fill(0.01), b = new Float32Array(1000).fill(0.2);
    expect(levelSpeech(a)[0]).toBeCloseTo(levelSpeech(b)[0]!);
    const spike = new Float32Array(1000); spike[0] = 1;
    expect(Math.max(...levelSpeech(spike))).toBeCloseTo(0.92);
  });
  it('writes a valid mono WAV', () => {
    const w = encodeWav(new Float32Array([0, 1, -1]), 24000);
    const v = new DataView(w.buffer);
    expect(new TextDecoder().decode(w.slice(0, 4))).toBe('RIFF');
    expect(v.getUint32(24, true)).toBe(24000);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(40, true)).toBe(6);
    expect(v.getInt16(46, true)).toBe(32767);
    expect(v.getInt16(48, true)).toBe(-32767);
  });
});
