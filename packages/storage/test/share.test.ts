import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDoc, type Doc } from '@digital-canvas/scene';
import {
  DriveError, DriveSharing, DriveStore, linkAccessOf, isShared, isEmail, mailtoLink, openPublicDesign, pack, readMedia, shareLink, unpack,
  type KnownFiles,
} from '../src/index.ts';

afterEach(() => vi.unstubAllGlobals());

type Call = { method: string; path: string; query: URLSearchParams; auth: string | null; body: any };

/** A fetch stub: records calls, answers with `respond`. */
function stub(respond: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const text = req.method === 'GET' || req.method === 'DELETE' ? '' : await req.text();
    let body: any = text;
    try { body = text ? JSON.parse(text) : undefined; } catch { /* multipart */ }
    const c = { method: req.method, path: url.pathname, query: url.searchParams, auth: req.headers.get('authorization'), body };
    calls.push(c);
    return respond(c);
  });
  return calls;
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const token = async () => 't0k';

describe('DriveSharing (permissions API)', () => {
  it('lists every page of permissions, owner first, link last', async () => {
    const calls = stub((c) => c.query.get('pageToken')
      ? json({ permissions: [{ id: 'anyoneWithLink', type: 'anyone', role: 'reader' }] })
      : json({ nextPageToken: 'p2', permissions: [
        { id: 'p1', type: 'user', role: 'writer', emailAddress: 'a@x.com', displayName: 'Ann' },
        { id: 'p0', type: 'user', role: 'owner', emailAddress: 'me@x.com', displayName: 'Me', photoLink: 'https://lh3/me' },
      ] }));
    const people = await new DriveSharing(token).people('FILE');
    expect(people.map((p) => p.id)).toEqual(['p0', 'p1', 'anyoneWithLink']);
    expect(people[0]).toEqual({ id: 'p0', type: 'user', role: 'owner', email: 'me@x.com', name: 'Me', photo: 'https://lh3/me' });
    expect(calls[0]!.path).toBe('/drive/v3/files/FILE/permissions');
    expect(calls[0]!.query.get('fields')).toBe('nextPageToken,permissions(id,type,role,emailAddress,displayName,photoLink,domain,deleted,pendingOwner)');
    expect(calls[0]!.auth).toBe('Bearer t0k');
    expect(calls[1]!.query.get('pageToken')).toBe('p2');
    expect(linkAccessOf(people)).toBe('reader');
    expect(isShared(people)).toBe(true);
    expect(isShared([people[0]!])).toBe(false);
  });

  it('adds a person with a role, a notification email and a message', async () => {
    const calls = stub((c) => json({ id: 'p9', type: 'user', role: c.body.role, emailAddress: c.body.emailAddress }));
    const p = await new DriveSharing(token).add('FILE', ' bob@x.com ', 'commenter', { message: 'Have a look' });
    expect(p).toEqual({ id: 'p9', type: 'user', role: 'commenter', email: 'bob@x.com' });
    const c = calls[0]!;
    expect(c.method).toBe('POST');
    expect(c.path).toBe('/drive/v3/files/FILE/permissions');
    expect(c.body).toEqual({ type: 'user', role: 'commenter', emailAddress: 'bob@x.com' });
    expect(c.query.get('sendNotificationEmail')).toBe('true');
    expect(c.query.get('emailMessage')).toBe('Have a look');
  });

  it('can add without an email (no message sent then)', async () => {
    const calls = stub(() => json({ id: 'p9', type: 'user', role: 'reader' }));
    await new DriveSharing(token).add('FILE', 'bob@x.com', 'reader', { notify: false, message: 'ignored' });
    expect(calls[0]!.query.get('sendNotificationEmail')).toBe('false');
    expect(calls[0]!.query.has('emailMessage')).toBe(false);
  });

  it('changes a role (PATCH) and removes a person (DELETE)', async () => {
    const calls = stub((c) => (c.method === 'DELETE' ? new Response(null, { status: 204 }) : json({ id: 'p1', type: 'user', role: c.body.role })));
    const s = new DriveSharing(token);
    expect((await s.setRole('FILE', 'p1', 'reader')).role).toBe('reader');
    await s.remove('FILE', 'p1');
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['PATCH /drive/v3/files/FILE/permissions/p1', 'DELETE /drive/v3/files/FILE/permissions/p1']);
    expect(calls[0]!.body).toEqual({ role: 'reader' });
  });

  it('link access: creates an undiscoverable anyone permission, changes its role, deletes it', async () => {
    const calls = stub((c) => (c.method === 'DELETE' ? new Response(null, { status: 204 }) : json({ id: 'anyoneWithLink', type: 'anyone', role: c.body?.role ?? 'reader' })));
    const s = new DriveSharing(token);
    await s.setLinkAccess('FILE', 'writer', []);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.body).toEqual({ type: 'anyone', role: 'writer', allowFileDiscovery: false });
    const link = [{ id: 'anyoneWithLink', type: 'anyone' as const, role: 'writer' as const }];
    await s.setLinkAccess('FILE', 'writer', link); // already so: nothing to do
    expect(calls).toHaveLength(1);
    await s.setLinkAccess('FILE', 'reader', link);
    expect(`${calls[1]!.method} ${calls[1]!.path}`).toBe('PATCH /drive/v3/files/FILE/permissions/anyoneWithLink');
    await s.setLinkAccess('FILE', 'restricted', link);
    expect(`${calls[2]!.method} ${calls[2]!.path}`).toBe('DELETE /drive/v3/files/FILE/permissions/anyoneWithLink');
  });

  it('publish makes files link-readable and skips the ones Drive refuses', async () => {
    stub((c) => (c.path.includes('/theirs/') ? json({ error: { message: 'Insufficient permissions' } }, 403) : json({ id: 'anyoneWithLink' })));
    expect((await new DriveSharing(token).publish(['a', 'theirs', 'b', 'a'])).sort()).toEqual(['a', 'b']);
  });

  it('reads owner, sharer and capabilities', async () => {
    const calls = stub(() => json({ id: 'FILE', name: 'Poster.dcanvas', ownedByMe: false, shared: true, owners: [{ displayName: 'Ann', emailAddress: 'a@x.com' }], sharingUser: { displayName: 'Ann', emailAddress: 'a@x.com' }, capabilities: { canEdit: false, canComment: true, canShare: false, canCopy: true } }));
    const a = await new DriveSharing(token).access('FILE');
    expect(a).toMatchObject({ fileId: 'FILE', ownedByMe: false, shared: true, owner: { name: 'Ann', email: 'a@x.com' }, sharedBy: { name: 'Ann' }, canEdit: false, canComment: true, canShare: false, canCopy: true, canDownload: true });
    expect(calls[0]!.query.get('fields')).toContain('capabilities(canEdit,canComment,canShare,canCopy,canDownload)');
  });

  it('throws Drive errors with their status', async () => {
    stub(() => json({ error: { message: 'Bad Request. User message: "Invalid email"' } }, 400));
    const e = await new DriveSharing(token).add('FILE', 'nope', 'reader').catch((x) => x);
    expect(e).toBeInstanceOf(DriveError);
    expect(e.status).toBe(400);
  });
});

describe('links', () => {
  it('builds share, view, template and mailto links', () => {
    expect(shareLink('edit', 'abc_1')).toBe('https://digital-canvas-p977.web.app/d/abc_1');
    expect(shareLink('view', 'abc')).toBe('https://digital-canvas-p977.web.app/view/abc');
    expect(shareLink('template', 'abc', 'http://localhost:5221/')).toBe('http://localhost:5221/template/abc');
    const m = mailtoLink('Poster', 'https://x/d/1', 'Ann');
    expect(m.startsWith('mailto:?subject=')).toBe(true);
    expect(decodeURIComponent(m)).toContain('https://x/d/1');
    expect(isEmail('a@b.co')).toBe(true);
    expect(isEmail('a@b')).toBe(false);
  });
});

describe('readMedia fallback chain', () => {
  const bytes = new Uint8Array([1, 2, 3]);

  it('uses OAuth when Drive lets the token read the file', async () => {
    const calls = stub(() => new Response(bytes));
    expect(await readMedia('F', { token, apiKey: 'KEY' })).toEqual(bytes);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.auth).toBe('Bearer t0k');
    expect(calls[0]!.query.get('alt')).toBe('media');
    expect(calls[0]!.query.has('key')).toBe(false);
  });

  it('falls back to the API key on 404 / 403 (drive.file has not granted it)', async () => {
    for (const status of [404, 403]) {
      const calls = stub((c) => (c.auth ? json({ error: { message: 'File not found' } }, status) : new Response(bytes)));
      expect(await readMedia('F', { token, apiKey: 'KEY' })).toEqual(bytes);
      expect(calls.map((c) => [c.auth, c.query.get('key')])).toEqual([['Bearer t0k', null], [null, 'KEY']]);
    }
  });

  it('falls back to the key when there is no token (signed out)', async () => {
    const calls = stub(() => new Response(bytes));
    await readMedia('F', { token: async () => { throw new Error('signed out'); }, apiKey: 'KEY' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.query.get('key')).toBe('KEY');
    stub(() => new Response(bytes));
    await readMedia('F', { apiKey: 'KEY' });
  });

  it('does not retry with the key on server errors, and reports the key error last', async () => {
    let calls = stub(() => json({ error: { message: 'Backend Error' } }, 500));
    await expect(readMedia('F', { token, apiKey: 'KEY' })).rejects.toMatchObject({ status: 500 });
    expect(calls).toHaveLength(1);
    calls = stub(() => json({ error: { message: 'File not found' } }, 404));
    await expect(readMedia('F', { token, apiKey: 'KEY' })).rejects.toMatchObject({ status: 404 });
    expect(calls).toHaveLength(2);
    await expect(readMedia('F', {})).rejects.toBeInstanceOf(DriveError);
  });
});

/**
 * Two people's Drives behind one fetch: `me` (the recipient) and the owner's files.
 * OAuth sees only files granted to `me`; the API key sees files with an anyone permission.
 */
function twoDrives() {
  type F = { id: string; name: string; mimeType: string; parents: string[]; appProperties: Record<string, string>; body?: Uint8Array; mine: boolean; granted: boolean; anyone?: string; perms: any[] };
  const files = new Map<string, F>();
  let n = 0;
  const add = (f: Partial<F> & { id?: string }) => {
    const file: F = { id: f.id ?? `x${++n}`, name: '', mimeType: 'application/octet-stream', parents: [], appProperties: {}, mine: true, granted: true, perms: [], ...f };
    files.set(file.id, file);
    return file;
  };
  const log: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const viaKey = url.searchParams.get('key');
    const auth = req.headers.get('authorization');
    log.push(`${req.method} ${url.pathname}${viaKey ? ' key' : ''}`);
    const id = /\/files\/([^/?]+)/.exec(url.pathname)?.[1];
    const f = id ? files.get(id) : undefined;
    const can = (x?: F) => !!x && (viaKey ? !!x.anyone : auth === 'Bearer t0k' && x.granted);
    if (url.pathname === '/drive/v3/files' && req.method === 'GET') {
      const q = url.searchParams.get('q')!;
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const props = [...q.matchAll(/key='([^']+)' and value='([^']*)'/g)];
      return json({ files: [...files.values()].filter((x) => x.mine && (!parent || x.parents.includes(parent)) && props.every((m) => x.appProperties[m[1]!] === m[2]) && (!/mimeType='/.test(q) || x.mimeType === /mimeType='([^']+)'/.exec(q)![1])).map(({ body, ...x }) => x) });
    }
    if (url.pathname === '/drive/v3/files' && req.method === 'POST') return json({ id: add({ ...(await req.json()) }).id });
    if (url.pathname.startsWith('/upload/')) {
      const buf = new Uint8Array(await req.arrayBuffer());
      const text = new TextDecoder('latin1').decode(buf);
      const boundary = /boundary=(\S+)/.exec(req.headers.get('content-type')!)![1]!;
      const metaStart = text.indexOf('\r\n\r\n') + 4;
      const meta = JSON.parse(text.slice(metaStart, text.indexOf(`\r\n--${boundary}`, metaStart)));
      const start = text.indexOf('\r\n\r\n', text.indexOf(`\r\n--${boundary}`, metaStart)) + 4;
      const body = buf.slice(start, text.lastIndexOf(`\r\n--${boundary}--`));
      if (f) {
        if (!can(f)) return json({ error: { message: 'File not found' } }, 404);
        Object.assign(f, { body, appProperties: { ...f.appProperties, ...meta.appProperties } });
        return json({ id });
      }
      return json({ id: add({ ...meta, body }).id });
    }
    if (url.pathname.endsWith('/permissions') && req.method === 'POST') {
      if (!f || !f.mine) return json({ error: { message: 'Insufficient permissions' } }, 403);
      const p = await req.json();
      if (p.type === 'anyone') f.anyone = p.role;
      f.perms.push(p);
      return json({ id: 'anyoneWithLink' });
    }
    if (!can(f)) return json({ error: { message: 'File not found' } }, 404);
    if (url.searchParams.get('alt') === 'media') return new Response(f!.body as BodyInit);
    if (req.method === 'PATCH') {
      const { appProperties } = await req.json();
      Object.assign(f!.appProperties, appProperties ?? {});
      return json({ id });
    }
    return json({ id: f!.id, name: f!.name, ownedByMe: f!.mine, shared: !!f!.anyone || f!.perms.length > 0, owners: [{ displayName: f!.mine ? 'Me' : 'Ann', emailAddress: f!.mine ? 'me@x.com' : 'ann@x.com' }], capabilities: { canEdit: f!.mine, canComment: true, canShare: f!.mine, canCopy: true } });
  });
  return { files, add, log };
}

function design(): Doc {
  const d = createDoc({ width: 100, height: 100, title: 'Shared' });
  return { ...d, assets: { 'aaaaaaaaaaaaaaaaaaaa.png': { mime: 'image/png' } } };
}

describe('DriveStore: shared designs', () => {
  it('saves a links.json map, publishes assets when shared and on later saves', async () => {
    const d = twoDrives();
    const store = new DriveStore(token);
    const doc = design();
    await store.save({ doc, assets: new Map([['aaaaaaaaaaaaaaaaaaaa.png', new Uint8Array([7])]]) });
    const saved = [...d.files.values()].find((f) => f.appProperties.dcDocId === doc.id)!;
    const asset = [...d.files.values()].find((f) => f.appProperties.dcAsset === 'aaaaaaaaaaaaaaaaaaaa.png')!;
    expect(unpack(saved.body!).links).toEqual({ 'aaaaaaaaaaaaaaaaaaaa.png': asset.id });
    expect(store.hasLinks(doc.id)).toBe(true);
    expect(asset.anyone).toBeUndefined(); // not shared yet: nothing public

    store.setShared(doc.id, true);
    expect(await store.publishAssets(doc.id)).toBe(1);
    expect(asset.anyone).toBe('reader');
    expect(asset.appProperties.dcPublic).toBe('1');
    expect(await store.publishAssets(doc.id)).toBe(0); // once

    // a new asset added while shared is published on save
    const doc2 = { ...doc, assets: { ...doc.assets, 'bbbbbbbbbbbbbbbbbbbb.png': { mime: 'image/png' } } };
    await store.save({ doc: doc2, assets: new Map([['aaaaaaaaaaaaaaaaaaaa.png', new Uint8Array([7])], ['bbbbbbbbbbbbbbbbbbbb.png', new Uint8Array([8])]]) });
    const b = [...d.files.values()].find((f) => f.appProperties.dcAsset === 'bbbbbbbbbbbbbbbbbbbb.png')!;
    expect(b.anyone).toBe('reader');
  });

  it('a recipient opens a shared design, reads the owner’s assets with the API key and saves back without copying them', async () => {
    const d = twoDrives();
    const doc = design();
    const theirAsset = d.add({ id: 'OWNER_ASSET', mine: false, granted: false, anyone: 'reader', body: new Uint8Array([9, 9]) });
    const file = d.add({ id: 'OWNER_FILE', name: 'Shared.dcanvas', mine: false, granted: true, perms: [{ type: 'user', role: 'writer' }], body: pack({ doc, assets: new Map(), links: { 'aaaaaaaaaaaaaaaaaaaa.png': theirAsset.id } }) });
    const remembered = new Map<string, string>();
    const known: KnownFiles = { get: (k) => remembered.get(k), set: (k, v) => void remembered.set(k, v) };
    const store = new DriveStore(token, 'Digital Canvas', undefined, { apiKey: 'KEY', known });

    const opened = await store.openFile(file.id);
    expect(opened.assets.get('aaaaaaaaaaaaaaaaaaaa.png')).toEqual(new Uint8Array([9, 9]));
    expect(d.log).toContain('GET /drive/v3/files/OWNER_ASSET'); // OAuth first…
    expect(d.log).toContain('GET /drive/v3/files/OWNER_ASSET key'); // …then the key
    expect(remembered.get(doc.id)).toBe('OWNER_FILE');
    expect(await store.access(doc.id)).toMatchObject({ ownedByMe: false, owner: { name: 'Ann' }, canEdit: false });

    await store.save({ doc: { ...doc, title: 'Edited' }, assets: opened.assets });
    expect([...d.files.values()].filter((f) => f.appProperties.dcAsset)).toHaveLength(0); // not copied into my Drive
    expect(unpack(file.body!).doc.title).toBe('Edited');
    expect(unpack(file.body!).links).toEqual({ 'aaaaaaaaaaaaaaaaaaaa.png': 'OWNER_ASSET' });

    // after a reload the design is found again from the remembered file id
    const again = new DriveStore(token, 'Digital Canvas', undefined, { apiKey: 'KEY', known });
    expect((await again.open(doc.id)).doc.title).toBe('Edited');
  });

  it('a "Make a copy" of a shared design keeps its own assets', async () => {
    const d = twoDrives();
    const doc = design();
    d.add({ id: 'OWNER_ASSET', mine: false, granted: false, anyone: 'reader', body: new Uint8Array([5]) });
    d.add({ id: 'OWNER_FILE', mine: false, granted: false, anyone: 'reader', body: pack({ doc, assets: new Map(), links: { 'aaaaaaaaaaaaaaaaaaaa.png': 'OWNER_ASSET' } }) });
    const store = new DriveStore(token, 'Digital Canvas', undefined, { apiKey: 'KEY' });
    const opened = await store.openFile('OWNER_FILE'); // not granted: read with the key
    await store.save({ ...opened, doc: { ...opened.doc, id: 'd_copy' } });
    const mine = [...d.files.values()].filter((f) => f.mine && f.appProperties.dcAsset === 'aaaaaaaaaaaaaaaaaaaa.png');
    expect(mine).toHaveLength(1);
  });

  it('openPublicDesign reads the design and its assets with the key only', async () => {
    const d = twoDrives();
    const doc = design();
    d.add({ id: 'A', mine: false, granted: false, anyone: 'reader', body: new Uint8Array([1]) });
    d.add({ id: 'D', name: 'Shared.dcanvas', mine: false, granted: false, anyone: 'reader', body: pack({ doc, assets: new Map(), links: { 'aaaaaaaaaaaaaaaaaaaa.png': 'A' } }) });
    const r = await openPublicDesign('D', { apiKey: 'KEY' });
    expect(r.file.doc.id).toBe(doc.id);
    expect(r.file.assets.get('aaaaaaaaaaaaaaaaaaaa.png')).toEqual(new Uint8Array([1]));
    expect(r.missing).toEqual([]);
    expect(r.access?.owner?.name).toBe('Ann');
    expect(d.log.every((l) => l.endsWith(' key'))).toBe(true);
    d.files.get('D')!.anyone = undefined; // link access back to "only people added"
    await expect(openPublicDesign('D', { apiKey: 'KEY' })).rejects.toMatchObject({ status: 404 });
  });

  it('pack/unpack keeps the links map and drops bad ids', () => {
    const doc = design();
    expect(unpack(pack({ doc, assets: new Map(), links: { 'aaaaaaaaaaaaaaaaaaaa.png': 'F_1-x' } })).links).toEqual({ 'aaaaaaaaaaaaaaaaaaaa.png': 'F_1-x' });
    expect(unpack(pack({ doc, assets: new Map() })).links).toBeUndefined();
    expect(unpack(pack({ doc, assets: new Map(), links: { a: '../x' } })).links).toEqual({});
  });
});
