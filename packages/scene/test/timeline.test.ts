import { describe, expect, it } from 'vitest';
import { posterOf, addAudio, addElements, clipTime, createDoc, isVideo, pageAtTime, pageStart, pruneAssets, removeAudio, totalDuration, updatePage, video, addPage } from '../src/index.ts';

describe('timeline', () => {
  it('pages play one after another for their durations', () => {
    let d = createDoc({ width: 100, height: 100 });
    expect(isVideo(d)).toBe(false);
    d = updatePage(d, d.pages[0]!.id, { duration: 3 });
    const r = addPage(d);
    d = r.doc; // second page: default 5 s
    expect(isVideo(d)).toBe(true);
    expect(totalDuration(d)).toBe(8);
    expect(pageStart(d, r.pageId)).toBe(3);
    expect(pageAtTime(d, 1).page.id).toBe(d.pages[0]!.id);
    const at = pageAtTime(d, 4.5);
    expect(at.page.id).toBe(r.pageId);
    expect(at.local).toBeCloseTo(1.5);
    expect(pageAtTime(d, 99).page.id).toBe(r.pageId);
    d = updatePage(d, r.pageId, { hidden: true });
    expect(totalDuration(d)).toBe(3);
  });
  it('clip time honours trim and loop', () => {
    const v = video('a.mp4', { x: 0, y: 0, w: 10, h: 10 });
    expect(clipTime(v, 1, 4)).toBe(1);
    expect(clipTime(v, 5, 4)).toBeNull();
    expect(clipTime({ ...v, trimStart: 1, trimEnd: 3 }, 0.5, 4)).toBe(1.5);
    expect(clipTime({ ...v, trimStart: 1, trimEnd: 3 }, 2.5, 4)).toBeNull();
    expect(clipTime({ ...v, trimStart: 1, trimEnd: 3, loop: true }, 2.5, 4)).toBeCloseTo(1.5);
  });
  it('keeps video, poster and sound assets', () => {
    let d = { ...createDoc({ width: 100, height: 100 }), assets: { 'a.mp4': { mime: 'video/mp4' }, 'a.mp4.poster': { mime: 'image/png' }, 'm.mp3': { mime: 'audio/mpeg' }, 'x.png': { mime: 'image/png' } } };
    d = addElements(d, d.pages[0]!.id, [video('a.mp4', { x: 0, y: 0, w: 10, h: 10 })]);
    const r = addAudio(d, { asset: 'm.mp3', start: 0, offset: 0, duration: 2 });
    expect(Object.keys(pruneAssets(r.doc).assets).sort()).toEqual(['a.mp4', 'a.mp4.poster', 'm.mp3']);
    expect(isVideo(r.doc)).toBe(true);
    expect(removeAudio(r.doc, r.id).audio).toEqual([]);
  });

  it('a clip can have its own poster (a trimmed piece opens on a later frame)', () => {
    const v = { ...video('a.mp4', { x: 0, y: 0, w: 10, h: 10 }), trimStart: 4, poster: 'f4.png' };
    expect(posterOf(v)).toBe('f4.png');
    expect(posterOf(video('a.mp4', { x: 0, y: 0, w: 10, h: 10 }))).toBe('a.mp4.poster');
    let d = { ...createDoc({ width: 100, height: 100 }), assets: { 'a.mp4': { mime: 'video/mp4' }, 'f4.png': { mime: 'image/png' }, 'x.png': { mime: 'image/png' } } };
    d = addElements(d, d.pages[0]!.id, [v]);
    expect(Object.keys(pruneAssets(d).assets).sort()).toEqual(['a.mp4', 'f4.png']);
  });
});
