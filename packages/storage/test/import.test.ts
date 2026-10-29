import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDoc, type Doc } from '@digital-canvas/scene';
import { ImportError, inviteMessage, pack, prepareImport, readDesignFile } from '../src/index.ts';

afterEach(() => vi.unstubAllGlobals());

const A = '0123456789abcdef0123.png';
const B = 'fedcba9876543210fedc.png';

function design(): Doc {
  const doc = createDoc({ width: 100, height: 100, title: 'Poster' });
  return { ...doc, assets: { [A]: { mime: 'image/png' }, [B]: { mime: 'image/png' } } };
}

describe('prepareImport', () => {
  it('a self-contained file imports as is (same id, nothing fetched)', async () => {
    const doc = design();
    const bytes = pack({ doc, assets: new Map([[A, new Uint8Array([1])], [B, new Uint8Array([2])]]) });
    const r = await prepareImport(bytes, { via: {}, exists: () => false });
    expect(r).toMatchObject({ renamed: false, fetched: 0, missing: [] });
    expect(r.file.doc.id).toBe(doc.id);
    expect(r.file.assets.size).toBe(2);
  });

  it('links only: fetches by Drive id (OAuth, then API key), reports progress, new id, drops links', async () => {
    const doc = design();
    const bytes = pack({ doc, assets: new Map(), links: { [A]: 'fileA', [B]: 'fileB' } });
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(String(input));
      seen.push(`${u.pathname} ${u.searchParams.get('key') ? 'key' : new Headers(init?.headers).get('authorization')}`);
      if (!u.searchParams.get('key')) return new Response('{}', { status: 404 }); // not granted under drive.file
      return new Response(new Uint8Array(u.pathname.endsWith('fileA') ? [7] : [8]));
    });
    const progress: string[] = [];
    const r = await prepareImport(bytes, { via: { token: async () => 'tok', apiKey: 'KEY' }, onProgress: (d, t) => progress.push(`${d}/${t}`) });
    expect(r.renamed).toBe(true);
    expect(r.file.doc.id).not.toBe(doc.id);
    expect(r.fetched).toBe(2);
    expect([...r.file.assets.get(A)!]).toEqual([7]);
    expect(r.file.links).toBeUndefined();
    expect(progress[0]).toBe('0/2');
    expect(progress.at(-1)).toBe('2/2');
    expect(seen.filter((s) => s.endsWith('Bearer tok'))).toHaveLength(2);
  });

  it('your own asset copy wins over the link; a taken id gets a new one', async () => {
    const doc = design();
    const bytes = pack({ doc, assets: new Map([[B, new Uint8Array([2])]]), links: { [A]: 'fileA' } });
    vi.stubGlobal('fetch', async () => { throw new Error('no network expected'); });
    const r = await prepareImport(bytes, { via: {}, local: async (id) => (id === A ? new Uint8Array([9]) : undefined), exists: (id) => id === doc.id });
    expect(r).toMatchObject({ renamed: true, fetched: 0, missing: [] });
    expect(r.file.doc.id).not.toBe(doc.id);
  });

  it('unreadable linked assets are reported, not fatal', async () => {
    const bytes = pack({ doc: design(), assets: new Map(), links: { [A]: 'fileA' } });
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 403 }));
    const r = await prepareImport(bytes, { via: { apiKey: 'KEY' } });
    expect(r.missing.sort()).toEqual([A, B].sort());
  });

  it('not a design: a clear ImportError', () => {
    expect(() => readDesignFile(new TextEncoder().encode('<!DOCTYPE html><html>'))).toThrow(/web page/);
    expect(() => readDesignFile(new Uint8Array([1, 2, 3]))).toThrow(ImportError);
  });
});

describe('inviteMessage', () => {
  it('puts the app link first, then the note', () => {
    expect(inviteMessage('https://x/d/1')).toBe('Open in Digital Canvas: https://x/d/1');
    expect(inviteMessage('https://x/d/1', '  hi  ')).toBe('Open in Digital Canvas: https://x/d/1\n\nhi');
  });
});
