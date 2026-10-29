import { describe, expect, it } from 'vitest';
import { addPage, createDoc, updatePage, type Doc } from '@digital-canvas/scene';
import { hasSound, pageDoc, pageFileName, soundDuration, videoSize } from '../src/lib/exportutil.ts';

function twoPages(): Doc {
  let doc = createDoc({ width: 1080, height: 1920 });
  const p1 = doc.pages[0]!.id;
  doc = updatePage(doc, p1, { duration: 4 });
  const r = addPage(doc);
  doc = updatePage(r.doc, r.pageId, { duration: 6, transition: { type: 'dissolve' } });
  return { ...doc, audio: [{ id: 'a', asset: 'song', start: 1, offset: 10, duration: 7, fadeIn: 1, fadeOut: 2 }] };
}

describe('export helpers', () => {
  it('video sizes follow Canva: the short side is the quality', () => {
    expect(videoSize({ width: 1920, height: 1080 }, 1080)).toEqual({ W: 1920, H: 1080 });
    expect(videoSize({ width: 1080, height: 1920 }, 720)).toEqual({ W: 720, H: 1280 });
    expect(videoSize({ width: 1920, height: 1080 }, 2160)).toEqual({ W: 3840, H: 2160 });
    expect(videoSize({ width: 1000, height: 1000 }, 480)).toEqual({ W: 480, H: 480 });
    const odd = videoSize({ width: 1001, height: 999 }, 480);
    expect(odd.W % 2 + odd.H % 2).toBe(0);
  });

  it('pageDoc cuts sounds to the page and drops the incoming transition', () => {
    const doc = twoPages();
    const first = pageDoc(doc, doc.pages[0]!.id);
    expect(first.pages).toHaveLength(1);
    expect(first.audio).toEqual([{ id: 'a', asset: 'song', start: 1, offset: 10, duration: 3, fadeIn: 1, fadeOut: 0 }]);
    const second = pageDoc(doc, doc.pages[1]!.id);
    expect(second.pages[0]!.transition).toBeUndefined();
    expect(second.audio).toEqual([{ id: 'a', asset: 'song', start: 0, offset: 13, duration: 4, fadeIn: 0, fadeOut: 2 }]);
  });

  it('knows when a design makes a sound and how long it runs', () => {
    const doc = twoPages();
    expect(hasSound(doc)).toBe(true);
    expect(hasSound({ ...doc, audio: [] })).toBe(false);
    expect(soundDuration(doc)).toBe(10);
    expect(soundDuration({ ...doc, audio: [{ id: 'b', asset: 's', start: 8, offset: 0, duration: 5 }] })).toBe(13);
  });

  it('names files like the PNG zip', () => {
    expect(pageFileName('Reel', 1, 3, 'mp4')).toBe('Reel - page 2.mp4');
    expect(pageFileName('Reel', 0, 1, 'mp4')).toBe('Reel.mp4');
  });
});
