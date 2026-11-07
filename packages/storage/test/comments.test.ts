import { afterEach, describe, expect, it, vi } from 'vitest';
import { DriveComments, JsonComments, MemoryCommentFiles, CommentError } from '../src/index.ts';

afterEach(() => vi.unstubAllGlobals());

type Call = { method: string; path: string; query: URLSearchParams; body: any };
function stub(respond: (c: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const text = req.method === 'GET' || req.method === 'DELETE' ? '' : await req.text();
    const c = { method: req.method, path: url.pathname, query: url.searchParams, body: text ? JSON.parse(text) : undefined };
    calls.push(c);
    return respond(c);
  });
  return calls;
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const drive = () => new DriveComments(async () => 't', async (id) => (id === 'doc' ? 'FILE' : undefined));

describe('DriveComments (Drive comments API)', () => {
  it('lists every page, maps authors and our anchors, hides deleted', async () => {
    const calls = stub((c) => c.query.get('pageToken')
      ? json({ comments: [{ id: 'c3', content: 'gone', deleted: true, createdTime: 'a', modifiedTime: 'a' }] })
      : json({ nextPageToken: 'p2', comments: [
        { id: 'c1', content: 'Bigger', anchor: '{"dc":1,"page":"p1","el":"e1","fx":1,"fy":0,"t":2}', resolved: false, createdTime: '2026-01-01', modifiedTime: '2026-01-02',
          author: { displayName: 'Manager', photoLink: '//lh3/x', me: false }, replies: [{ id: 'r1', content: '', action: 'resolve', createdTime: 'b', author: { displayName: 'Ed', me: true } }, { id: 'r2', deleted: true, createdTime: 'c' }] },
        { id: 'c2', content: 'From the Drive UI', anchor: '{"r":"head"}', resolved: true, createdTime: 'x', modifiedTime: 'x', author: { displayName: 'Ann' } },
      ] }));
    const list = await drive().list('doc');
    expect(calls[0]!.path).toBe('/drive/v3/files/FILE/comments');
    expect(calls[0]!.query.get('fields')).toContain('anchor');
    expect(list.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(list[0]).toMatchObject({ text: 'Bigger', author: { name: 'Manager', photo: 'https://lh3/x' }, anchor: { page: 'p1', el: 'e1', fx: 1, fy: 0, t: 2 } });
    expect(list[0]!.replies).toEqual([{ id: 'r1', text: '', action: 'resolve', createdAt: 'b', author: { name: 'Ed', me: true } }]);
    expect(list[1]!.anchor).toBeUndefined();
    stub((c) => json({ comments: [{ id: 'c1', resolved: true, createdTime: 'a', modifiedTime: 'a' }, { id: 'c2', createdTime: 'a', modifiedTime: 'a' }] }));
    expect((await drive().list('doc', { resolved: false })).map((c) => c.id)).toEqual(['c2']);
  });

  it('add / reply / edit / resolve / reopen / delete hit the right endpoints', async () => {
    const calls = stub((c) => (c.method === 'DELETE' ? new Response(null, { status: 204 }) : json({ id: 'n', createdTime: 'a', modifiedTime: 'a', content: c.body?.content })));
    const d = drive();
    const c = await d.add('doc', '  Move it \r\n left ', { page: 'p1', x: 1, y: 2 });
    expect(c.text).toBe('Move it \n left');
    expect(calls[0]!.body).toEqual({ content: 'Move it \n left', anchor: '{"dc":1,"page":"p1","x":1,"y":2}' });
    await d.reply('doc', 'c1', 'ok');
    await d.edit('doc', 'c1', 'new');
    await d.edit('doc', 'c1', 'new r', 'r1');
    await d.setResolved('doc', 'c1', true, 'done');
    await d.setResolved('doc', 'c1', false);
    await d.remove('doc', 'c1');
    await d.remove('doc', 'c1', 'r1');
    expect(calls.slice(1).map((x) => `${x.method} ${x.path.replace('/drive/v3/files/FILE/comments', '')} ${JSON.stringify(x.body ?? '')}`)).toEqual([
      'POST /c1/replies {"content":"ok"}',
      'PATCH /c1 {"content":"new"}',
      'PATCH /c1/replies/r1 {"content":"new r"}',
      'POST /c1/replies {"action":"resolve","content":"done"}',
      'POST /c1/replies {"action":"reopen"}',
      'DELETE /c1 ""',
      'DELETE /c1/replies/r1 ""',
    ]);
  });

  it('explains refusals and needs a saved file', async () => {
    stub(() => json({ error: { message: 'The user does not have sufficient permissions' } }, 403));
    await expect(drive().remove('doc', 'c1')).rejects.toThrow(/author/);
    await expect(drive().list('unsaved')).rejects.toBeInstanceOf(CommentError);
    await expect(drive().add('doc', '   ')).rejects.toThrow(/needs some text/);
  });
});

describe('JsonComments (local sidecar)', () => {
  it('keeps threads in one JSON file per design', async () => {
    const files = new MemoryCommentFiles();
    const s = new JsonComments(files, () => ({ name: 'Claude' }));
    const c = await s.add('d1', 'Hello', { page: 'p' });
    await s.reply('d1', c.id, 'Hi');
    await s.setResolved('d1', c.id, true);
    await s.edit('d1', c.id, 'Hello!');
    let [got] = await s.list('d1');
    expect(got).toMatchObject({ text: 'Hello!', resolved: true, author: { name: 'Claude', me: true }, anchor: { page: 'p' } });
    expect(got!.replies.map((r) => r.action ?? r.text)).toEqual(['Hi', 'resolve']);
    expect(await s.list('d1', { resolved: false })).toEqual([]);
    await s.remove('d1', c.id, got!.replies[0]!.id);
    [got] = await s.list('d1');
    expect(got!.replies).toHaveLength(1);
    await s.remove('d1', c.id);
    expect(await s.list('d1')).toEqual([]);
    expect(JSON.parse(files.files.get('d1')!)).toMatchObject({ format: 'dcanvas-comments', version: 1 });
    await expect(s.reply('d1', 'nope', 'x')).rejects.toThrow(/gone/);
  });
});
