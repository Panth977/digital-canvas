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
      Object.assign(files.get(id)!, await req.json());
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

  it('retries once with a fresh token on 401', async () => {
    const drive = fakeDrive();
    vi.stubGlobal('fetch', drive.handler);
    const tokens: boolean[] = [];
    const store = new DriveStore(async (force) => { tokens.push(!!force); return force ? 't0k' : 'stale'; });
    await store.list();
    expect(tokens.slice(0, 2)).toEqual([false, true]);
  });
});
