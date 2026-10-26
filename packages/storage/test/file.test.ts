import { describe, expect, it } from 'vitest';
import { addElements, createDoc, image } from '@digital-canvas/scene';
import { FileFormatError, MemoryStore, assetId, fileName, pack, peek, unpack } from '../src/index.ts';

describe('.dcanvas', () => {
  it('packs and unpacks doc, assets and thumbnail', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const id = await assetId(bytes, 'image/png');
    expect(id).toMatch(/^[0-9a-f]{20}\.png$/);
    expect(await assetId(bytes, 'image/png')).toBe(id);
    let doc = { ...createDoc({ width: 300, height: 200, title: 'Menu' }), assets: { [id]: { mime: 'image/png', width: 1, height: 1 } } };
    doc = addElements(doc, doc.pages[0]!.id, [image(id, { x: 0, y: 0, w: 10, h: 10 })]);
    const zip = pack({ doc, assets: new Map([[id, bytes], ['unused', new Uint8Array([1])]]), thumbnail: new Uint8Array([9]) });
    const back = unpack(zip);
    expect(back.doc).toEqual(doc);
    expect([...back.assets.keys()]).toEqual([id]); // unlisted assets are not written
    expect(back.assets.get(id)).toEqual(bytes);
    expect(back.thumbnail).toEqual(new Uint8Array([9]));
    expect(peek(zip).doc.title).toBe('Menu');
  });
  it('rejects other files', () => {
    expect(() => unpack(new Uint8Array([1, 2, 3]))).toThrow(FileFormatError);
  });
  it('makes safe file names', () => {
    expect(fileName('Café menu: v2/final (A4)')).toBe('Café menu v2final (A4).dcanvas');
    expect(fileName('***')).toBe('Untitled design.dcanvas');
  });
  it('memory store lists by recency', async () => {
    const s = new MemoryStore();
    const a = { ...createDoc({ width: 100, height: 100, title: 'A' }), updatedAt: '2026-01-01T00:00:00Z' };
    const b = { ...createDoc({ width: 100, height: 100, title: 'B' }), updatedAt: '2026-02-01T00:00:00Z' };
    await s.save({ doc: a, assets: new Map() });
    await s.save({ doc: b, assets: new Map() });
    expect((await s.list()).map((m) => m.title)).toEqual(['B', 'A']);
  });
});
