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

describe('timing, transitions (MCP reels)', async () => {
  const { animateAt, frameAt, transitionLayers, text, parseDoc } = await import('../src/index.ts');
  it('a timed element shows only in its window', () => {
    let d = createDoc({ width: 100, height: 100 });
    const cap = { ...text('hi', { x: 0, y: 0, w: 50, h: 20 }), timing: { start: 1, end: 2 } };
    d = addElements(d, d.pages[0]!.id, [cap]);
    const p = d.pages[0]!;
    expect(animateAt(d, p, 0.5).elements).toHaveLength(0);
    expect(animateAt(d, p, 1.5).elements).toHaveLength(1);
    expect(animateAt(d, p, 2).elements).toHaveLength(0);
  });
  it('frameAt plays a transition over the start of the next page', () => {
    let d = updatePage(createDoc({ width: 100, height: 100 }), '', {});
    d = updatePage(d, d.pages[0]!.id, { duration: 2 });
    const r = addPage(d);
    d = updatePage(r.doc, r.pageId, { duration: 2, transition: { type: 'dissolve', duration: 1 } });
    const f = frameAt(d, 2.5);
    expect(f.page.id).toBe(r.pageId);
    expect(f.prev?.page.id).toBe(d.pages[0]!.id);
    expect(f.progress).toBeCloseTo(0.5);
    expect(frameAt(d, 3.5).prev).toBeUndefined();
    expect(frameAt(d, 1).prev).toBeUndefined();
    const L = transitionLayers({ type: 'slide', direction: 'right' }, 0, 100, 100);
    expect(L.next.dx).toBe(100);
    expect(parseDoc(JSON.parse(JSON.stringify({ ...d, pages: d.pages.map((p) => ({ ...p, transition: { type: 'bogus' } })) }))).pages[1]!.transition).toBeUndefined();
  });
});

describe('splitPage', async () => {
  const { splitPage, text, animateAt } = await import('../src/index.ts');
  it('splits a scene at a time: durations, clip trims, caption windows, no replayed animation', () => {
    let d = createDoc({ width: 100, height: 100 });
    const pid = d.pages[0]!.id;
    d = updatePage(d, pid, { duration: 6, transition: { type: 'dissolve' }, animation: { type: 'fade' } });
    const clip = { ...video('a.mp4', { x: 0, y: 0, w: 10, h: 10 }), trimStart: 1 };
    const early = { ...text('early', { x: 0, y: 0, w: 50, h: 20 }), timing: { start: 0, end: 1.5 } };
    const across = { ...text('across', { x: 0, y: 0, w: 50, h: 20 }), timing: { start: 1, end: 4 } };
    const late = { ...text('late', { x: 0, y: 0, w: 50, h: 20 }), timing: { start: 3 } };
    const title = { ...text('title', { x: 0, y: 0, w: 50, h: 20 }), animation: { type: 'rise' as const } };
    d = addElements(d, pid, [clip, early, across, late, title]);
    const r = splitPage(d, pid, 2);
    expect(r.doc.pages).toHaveLength(2);
    const [a, b] = r.doc.pages as [any, any];
    expect(a.id).toBe(pid);
    expect(b.id).toBe(r.pageId);
    expect(a.duration).toBe(2);
    expect(b.duration).toBe(4);
    expect(a.transition).toEqual({ type: 'dissolve' });
    expect(b.transition).toBeUndefined();
    expect(b.animation).toBeUndefined();
    expect(a.elements.map((e: any) => e.text ?? e.type)).toEqual(['video', 'early', 'across', 'title']);
    expect(b.elements.map((e: any) => e.text ?? e.type)).toEqual(['video', 'across', 'late', 'title']);
    expect(b.elements[0].trimStart).toBe(3);
    expect(b.elements[1].timing).toEqual({ end: 2 });
    expect(b.elements[2].timing).toEqual({ start: 1 });
    expect(b.elements[3].animation).toBeUndefined();
    expect(new Set(b.elements.map((e: any) => e.id)).size).toBe(4);
    expect(b.elements.some((e: any) => a.elements.some((x: any) => x.id === e.id))).toBe(false);
    // the second part at 0 looks like the first at 2 for the animated title (already in place)
    expect(animateAt(r.doc, b, 0).elements.find((e: any) => e.text === 'title').y).toBe(0);
    expect(totalDuration(r.doc)).toBe(6);
  });
  it('refuses to split at the very ends', () => {
    let d = createDoc({ width: 100, height: 100 });
    d = updatePage(d, d.pages[0]!.id, { duration: 3 });
    expect(splitPage(d, d.pages[0]!.id, 0.05).doc).toBe(d);
    expect(splitPage(d, d.pages[0]!.id, 2.95).doc).toBe(d);
  });
});
