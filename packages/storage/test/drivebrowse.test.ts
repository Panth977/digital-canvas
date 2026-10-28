import { describe, expect, it } from 'vitest';
import { DriveBrowser, FOLDER_MIME, kindClause, listParams, quote } from '../src/index.ts';

const q = (p: URLSearchParams) => p.get('q')!;

describe('listParams (Drive query builder)', () => {
  it('lists My Drive root: folders plus usable media, folders first', () => {
    const p = listParams({ source: 'my-drive' });
    expect(q(p)).toBe(`'root' in parents and (mimeType = '${FOLDER_MIME}' or (mimeType contains 'image/' or mimeType contains 'video/' or mimeType contains 'audio/')) and trashed = false`);
    expect(p.get('orderBy')).toBe('folder,name_natural');
    expect(p.get('supportsAllDrives')).toBe('true');
    expect(p.get('fields')).toContain('thumbnailLink');
    expect(p.has('pageToken')).toBe(false);
  });

  it('lists a folder with a media filter and a page token', () => {
    const p = listParams({ source: 'my-drive', folderId: 'F1' }, 'image', 'tok2');
    expect(q(p)).toBe(`'F1' in parents and (mimeType = '${FOLDER_MIME}' or mimeType contains 'image/') and trashed = false`);
    expect(p.get('pageToken')).toBe('tok2');
  });

  it('scopes a shared-drive folder to that drive', () => {
    const p = listParams({ source: 'my-drive', folderId: 'D1', driveId: 'D1' });
    expect(p.get('corpora')).toBe('drive');
    expect(p.get('driveId')).toBe('D1');
  });

  it('lists recent media', () => {
    const recent = listParams({ source: 'recent' }, 'video');
    expect(q(recent)).toBe("mimeType contains 'video/' and trashed = false");
    expect(recent.get('orderBy')).toBe('recency desc');
  });

  it('searches by name, escaping quotes', () => {
    const p = listParams({ source: 'my-drive', folderId: 'F1', search: " Tom's \\ pic " });
    expect(q(p)).toBe(`name contains 'Tom\\'s \\\\ pic' and (mimeType = '${FOLDER_MIME}' or (mimeType contains 'image/' or mimeType contains 'video/' or mimeType contains 'audio/')) and trashed = false`);
    expect(p.get('corpora')).toBe('allDrives');
  });

  it('helpers', () => {
    expect(quote("a'b")).toBe("'a\\'b'");
    expect(kindClause('audio')).toBe("mimeType contains 'audio/'");
  });
});

/** A fake Drive: a My Drive tree. */
function fakeDrive() {
  const F = FOLDER_MIME;
  const files = [
    { id: 'root-photos', name: 'Photos', mimeType: F, parents: ['ROOT'] },
    { id: 'cat', name: 'cat.png', mimeType: 'image/png', parents: ['root-photos'], size: '6', thumbnailLink: 'https://lh3/x=s220', imageMediaMetadata: { width: 40, height: 30 } },
    { id: 'clip', name: 'clip.mp4', mimeType: 'video/mp4', parents: ['root-photos'], videoMediaMetadata: { width: 64, height: 36, durationMillis: '2500' } },
    { id: 'other', name: 'Old', mimeType: F, parents: ['ROOT'] },
  ];
  const calls: URL[] = [];
  const fetchFn = async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    calls.push(url);
    const auth = new Headers(init?.headers).get('authorization');
    if (auth !== 'Bearer good') return new Response('{}', { status: 401 });
    const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/drive/v3/files/cat' && !url.searchParams.get('alt')) return json(files.find((f) => f.id === 'cat'));
    if (url.pathname === '/drive/v3/files/cat' && url.searchParams.get('alt') === 'media') return new Response(new Uint8Array([1, 2, 3, 4, 5, 6]), { headers: { 'content-length': '6' } });
    if (url.pathname === '/drive/v3/files') {
      const query = url.searchParams.get('q')!;
      const parent = /^'([^']+)' in parents/.exec(query)?.[1];
      const want = parent === 'root' ? 'ROOT' : parent;
      const all = files.filter((f) => f.parents?.includes(want!));
      // page size 1 for Photos, to check paging
      if (want === 'root-photos') {
        const i = Number(url.searchParams.get('pageToken') ?? 0);
        return json({ files: all.slice(i, i + 1), ...(i + 1 < all.length ? { nextPageToken: String(i + 1) } : {}) });
      }
      return json({ files: all });
    }
    return new Response('{}', { status: 404 });
  };
  let token = 'stale';
  const tokens = async (force?: boolean) => (force ? (token = 'good') : token);
  return { fetchFn, calls, tokens };
}

describe('DriveBrowser', () => {
  it('lists folders, pages and caches, refreshing an expired token once', async () => {
    const d = fakeDrive();
    const b = new DriveBrowser(d.tokens, d.fetchFn);
    const root = await b.list({ source: 'my-drive' });
    expect(root.items.map((i) => [i.name, i.isFolder])).toEqual([['Photos', true], ['Old', true]]);
    const p1 = await b.list({ source: 'my-drive', folderId: 'root-photos' });
    expect(p1.items).toEqual([{ id: 'cat', name: 'cat.png', mimeType: 'image/png', isFolder: false, thumbnailLink: 'https://lh3/x=s220', size: 6, parents: ['root-photos'], width: 40, height: 30 }]);
    expect(p1.nextPageToken).toBe('1');
    const p2 = await b.list({ source: 'my-drive', folderId: 'root-photos' }, 'all', p1.nextPageToken);
    expect(p2.items[0]).toMatchObject({ id: 'clip', width: 64, height: 36, duration: 2.5 });
    const n = d.calls.length;
    await b.list({ source: 'my-drive', folderId: 'root-photos' });
    expect(d.calls.length).toBe(n); // cached
    await b.list({ source: 'my-drive', folderId: 'root-photos' }, 'all', undefined, true);
    expect(d.calls.length).toBe(n + 1); // fresh
  });

  it('reads one file\'s metadata (a picked file)', async () => {
    const d = fakeDrive();
    const b = new DriveBrowser(d.tokens, d.fetchFn);
    expect(await b.file('cat')).toMatchObject({ id: 'cat', name: 'cat.png', mimeType: 'image/png', size: 6 });
    await expect(b.file('nope')).rejects.toMatchObject({ status: 404 });
  });

  it('downloads with progress', async () => {
    const d = fakeDrive();
    const b = new DriveBrowser(d.tokens, d.fetchFn);
    const seen: number[] = [];
    const bytes = await b.download({ id: 'cat' }, (f) => seen.push(f));
    expect([...bytes]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(seen.at(-1)).toBe(1);
  });

});
