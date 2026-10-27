import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDoc } from '@digital-canvas/scene';
import { DriveStore, unpack } from '../src/index.ts';

/** A tiny in-memory Google Drive v3, enough for DriveStore. */
function fakeDrive() {
  const files = new Map<string, { id: string; name: string; mimeType: string; parents: string[]; appProperties: Record<string, string>; trashed: boolean; modifiedTime: string; body?: Uint8Array }>();
  let n = 0;
  const calls: string[] = [];
  const matches = (f: { parents: string[]; trashed: boolean; mimeType: string; appProperties: Record<string, string> }, q: string) => {
    if (/trashed=false/.test(q) && f.trashed) return false;
    const parent = /'([^']+)' in parents/.exec(q)?.[1];
    if (parent && !f.parents.includes(parent)) return false;
    const mime = /mimeType='([^']+)'/.exec(q)?.[1];
    if (mime && f.mimeType !== mime) return false;
    for (const m of q.matchAll(/key='([^']+)' and value='([^']*)'/g)) if (f.appProperties[m[1]!] !== m[2]) return false;
    return true;
  };
  async function parseMultipart(req: Request) {
    const ct = req.headers.get('content-type')!;
    const boundary = /boundary=(\S+)/.exec(ct)![1]!;
    const buf = new Uint8Array(await req.arrayBuffer());
    const text = new TextDecoder('latin1').decode(buf);
    const parts = text.split(`--${boundary}`);
    const latin = parts[1]!.split('\r\n\r\n')[1]!.trim();
    const meta = JSON.parse(new TextDecoder().decode(Uint8Array.from(latin, (c) => c.charCodeAt(0))));
    const start = text.indexOf('\r\n\r\n', text.indexOf(parts[2]!.slice(0, 30))) + 4;
    const end = text.lastIndexOf(`\r\n--${boundary}--`);
    return { meta, body: buf.slice(start, end) };
  }
  const handler = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    calls.push(`${req.method} ${url.pathname}`);
    if (req.headers.get('authorization') !== 'Bearer t0k') return new Response('{}', { status: 401 });
    const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
    const id = /\/files\/([^/?]+)/.exec(url.pathname)?.[1];
    if (url.pathname === '/drive/v3/files' && req.method === 'GET') {
      const q = url.searchParams.get('q')!;
      return json({ files: [...files.values()].filter((f) => matches(f, q)).map(({ body, ...f }) => f) });
    }
    if (url.pathname === '/drive/v3/files' && req.method === 'POST') {
      const meta = await req.json();
      const f = { id: `f${++n}`, parents: [], appProperties: {}, trashed: false, modifiedTime: new Date().toISOString(), ...meta };
      files.set(f.id, f);
      return json({ id: f.id });
    }
    if (url.pathname.startsWith('/upload/drive/v3/files')) {
      const { meta, body } = await parseMultipart(req);
      if (id) {
        const f = files.get(id)!;
        Object.assign(f, meta, { body, modifiedTime: new Date(Date.now() + 1000).toISOString() });
        return json({ id });
      }
      const f = { id: `f${++n}`, parents: [], appProperties: {}, trashed: false, modifiedTime: new Date().toISOString(), ...meta, body };
      files.set(f.id, f);
      return json({ id: f.id });
    }
    if (id && url.searchParams.get('alt') === 'media') return new Response(files.get(id)!.body as BodyInit);
    if (id && req.method === 'PATCH') {
      const f = files.get(id)!;
      const { appProperties, ...rest } = await req.json();
      Object.assign(f, rest);
      // Drive merges app properties; null removes one.
      for (const [k, v] of Object.entries((appProperties ?? {}) as Record<string, string | null>)) {
        if (v === null) delete f.appProperties[k];
        else f.appProperties[k] = v;
      }
      return json({ id });
    }
    return new Response('{"error":{"message":"not faked"}}', { status: 404 });
  };
  return { files, calls, handler };
}

afterEach(() => vi.unstubAllGlobals());

describe('DriveStore', () => {
  it('creates its folder once, saves, lists, renames, opens and trashes', async () => {
    const drive = fakeDrive();
    vi.stubGlobal('fetch', drive.handler);
    const store = new DriveStore(async () => 't0k');
    const doc = createDoc({ width: 1080, height: 1080, title: 'Café menu' });
    await store.save({ doc, assets: new Map(), thumbnail: new Uint8Array([1, 2, 3]) });
    await store.save({ doc: { ...doc, title: 'Café menu v2' }, assets: new Map() });

    const folders = [...drive.files.values()].filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
    expect(folders).toHaveLength(1);
    expect(folders[0]!.name).toBe('Digital Canvas');
    const docs = [...drive.files.values()].filter((f) => f.mimeType !== 'application/vnd.google-apps.folder');
    expect(docs).toHaveLength(1); // second save updated, not duplicated
    expect(docs[0]!.name).toBe('Café menu v2.dcanvas');
    expect(docs[0]!.parents).toEqual([folders[0]!.id]);

    // a fresh store (another device) finds the same folder and file
    const other = new DriveStore(async () => 't0k');
    const list = await other.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: doc.id, title: 'Café menu v2', width: 1080, height: 1080 });
    const opened = await other.open(doc.id);
    expect(opened.doc.title).toBe('Café menu v2');
    expect(unpack(docs[0]!.body!).doc.id).toBe(doc.id);

    await other.remove(doc.id);
    expect(await other.list()).toHaveLength(0);
    expect(docs[0]!.trashed).toBe(true);
  });

  it('keeps assets once in the shared assets folder; design files stay small', async () => {
    const drive = fakeDrive();
    vi.stubGlobal('fetch', drive.handler);
    const cache = new Map<string, Uint8Array>();
    const store = new DriveStore(async () => 't0k', 'Digital Canvas', { get: async (k) => cache.get(k), set: async (k, v) => void cache.set(k, v) });
    const img = new Uint8Array(5000).fill(7);
    const a = { ...createDoc({ width: 100, height: 100, title: 'A' }), assets: { '0123456789abcdef0123.png': { mime: 'image/png' } } };
    const b = { ...createDoc({ width: 100, height: 100, title: 'B' }), assets: { '0123456789abcdef0123.png': { mime: 'image/png' } } };
    await store.save({ doc: a, assets: new Map([['0123456789abcdef0123.png', img]]) });
    await store.save({ doc: b, assets: new Map([['0123456789abcdef0123.png', img]]) });
    await store.save({ doc: { ...a, title: 'A2' }, assets: new Map([['0123456789abcdef0123.png', img]]) });
    const all = [...drive.files.values()];
    const assetFiles = all.filter((f) => f.appProperties.dcAsset);
    expect(assetFiles).toHaveLength(1); // uploaded once, shared
    expect(all.find((f) => f.id === assetFiles[0]!.parents[0])!.name).toBe('assets');
    const designs = all.filter((f) => f.appProperties.dcDocId);
    expect(designs).toHaveLength(2);
    for (const d of designs) expect(unpack(d.body!).assets.size).toBe(0); // no bytes inside the design

    // another device opens it: the asset comes from the assets folder
    const other = new DriveStore(async () => 't0k');
    const opened = await other.open(a.id);
    expect(opened.assets.get('0123456789abcdef0123.png')).toEqual(img);
    expect((await other.list()).map((m) => m.title).sort()).toEqual(['A2', 'B']);
  });

  it('lists your uploads with their names, hides removed ones, and shows them again when reused', async () => {
    const drive = fakeDrive();
    vi.stubGlobal('fetch', drive.handler);
    const store = new DriveStore(async () => 't0k');
    const id1 = '0123456789abcdef0123.png', id2 = 'aaaaaaaaaaaaaaaaaaaa.mp4';
    const doc = { ...createDoc({ width: 100, height: 100, title: 'A' }), assets: { [id1]: { mime: 'image/png', name: 'cat.png' }, [id2]: { mime: 'video/mp4', name: 'é'.repeat(80) } } };
    await store.save({ doc, assets: new Map([[id1, new Uint8Array([1])], [id2, new Uint8Array([2])]]) });
    const list = await new DriveStore(async () => 't0k').listAssets();
    expect(list.map((a) => [a.id, a.mime, a.name]).sort()).toEqual([[id1, 'image/png', 'cat.png'], [id2, 'video/mp4', 'é'.repeat(50)]]);
    expect([...(await store.getAsset(id1))!]).toEqual([1]);

    await store.hideAsset(id1);
    const other = new DriveStore(async () => 't0k');
    expect((await other.listAssets()).map((a) => a.id)).toEqual([id2]);
    expect([...(await other.getAsset(id1))!]).toEqual([1]); // designs still open
    await other.save({ doc: { ...doc, id: 'd2' }, assets: new Map([[id1, new Uint8Array([1])]]) });
    expect((await other.listAssets(true)).map((a) => a.id).sort()).toEqual([id1, id2]);
  });

  it('retries once with a fresh token on 401', async () => {
    const drive = fakeDrive();
    vi.stubGlobal('fetch', drive.handler);
    const tokens: boolean[] = [];
    const store = new DriveStore(async (force) => { tokens.push(!!force); return force ? 't0k' : 'stale'; });
    await store.list();
    expect(tokens.slice(0, 2)).toEqual([false, true]);
  });
});
