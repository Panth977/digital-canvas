import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FolderWorkspace } from '@digital-canvas/mcp';
import { startLocalServer, type LocalServer } from '../src/localserver.ts';

process.env.DC_OFFLINE = '1';

let dir: string, root: string, srv: LocalServer, ws: FolderWorkspace;
let token = 'dc_test', mcp = true;
const picks = new Map<string, { mode: string; token: string } | null>();
const done: unknown[] = [];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dc-desktop-'));
  root = join(dir, 'web');
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<title>app</title>');
  writeFileSync(join(root, 'a.wasm'), 'w');
  writeFileSync(join(dir, 'secret.txt'), 'outside');
  ws = new FolderWorkspace(join(dir, 'designs'));
  srv = await startLocalServer({
    root, preferredPort: 5293, token: () => token, mcpEnabled: () => mcp, workspace: () => ws,
    takePicker: (n) => { const s = picks.get(n) ?? null; picks.delete(n); return s; }, pickerDone: (_, r) => done.push(r),
  });
});
afterAll(async () => { await srv.close(); rmSync(dir, { recursive: true, force: true }); });

/** Raw request, so Host and Origin can be anything. */
function raw(path: string, headers: Record<string, string>, method = 'GET', body?: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const r = request({ host: '127.0.0.1', port: srv.port, path, method, headers, setHost: false }, (res) => {
      let text = '';
      res.on('data', (d) => (text += d));
      res.on('end', () => resolve({ status: res.statusCode!, text }));
    });
    r.on('error', reject);
    r.end(body);
  });
}
const host = () => `digital-canvas.localhost:${srv.port}`;
const INIT = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
const rpcHeaders = (extra: Record<string, string> = {}) => ({ host: host(), 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`, ...extra });

describe('static files', () => {
  it('serves the app, and index.html for app routes', async () => {
    expect((await raw('/', { host: host() })).text).toContain('app');
    expect((await raw('/d/abc', { host: host() })).text).toContain('app');
  });
  it('a missing file with an extension is a 404', async () => expect((await raw('/nope.png', { host: host() })).status).toBe(404));
  it('nothing outside the web folder', async () => {
    for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/assets/../../secret.txt']) expect((await raw(p, { host: host() })).text).not.toContain('outside');
  });
  it('wasm gets its MIME type', async () => {
    const r = await fetch(`${srv.fallbackUrl}/a.wasm`);
    expect(r.headers.get('content-type')).toBe('application/wasm');
  });
  it('a rebound Host is refused everywhere', async () => {
    expect((await raw('/', { host: `evil.example:${srv.port}` })).status).toBe(403);
    expect((await raw('/mcp', rpcHeaders({ host: `evil.example:${srv.port}` }), 'POST', INIT)).status).toBe(403);
  });
});

describe('binding', () => {
  it('listens on both loopback addresses and nothing else', () => {
    if (process.platform === 'win32') return;
    const out = execFileSync('lsof', ['-nP', `-iTCP:${srv.port}`, '-sTCP:LISTEN']).toString();
    expect(out).toContain(`127.0.0.1:${srv.port}`);
    expect(out).not.toMatch(new RegExp(`\\*:${srv.port}`));
  });
  it('answers on digital-canvas.localhost and on 127.0.0.1', async () => {
    expect((await fetch(`${srv.url}/`)).status).toBe(200);
    expect((await fetch(`${srv.fallbackUrl}/`)).status).toBe(200);
  });
  it('takes the next port when one is busy', async () => {
    const busy = createServer();
    await new Promise<void>((r) => busy.listen(5294, '127.0.0.1', r));
    const next = await startLocalServer({ root, preferredPort: 5294, token: () => token, mcpEnabled: () => mcp, workspace: () => ws });
    expect(next.port).not.toBe(5294);
    await next.close();
    busy.close();
  });
});

describe('/mcp', () => {
  it('no token: 401; wrong origin: 403; GET: 405', async () => {
    expect((await raw('/mcp', { ...rpcHeaders(), authorization: '' }, 'POST', INIT)).status).toBe(401);
    expect((await raw('/mcp', rpcHeaders({ origin: 'https://evil.example' }), 'POST', INIT)).status).toBe(403);
    expect((await raw('/mcp', rpcHeaders())).status).toBe(405);
  });
  it('the switch turns it off', async () => {
    mcp = false;
    expect((await raw('/mcp', rpcHeaders(), 'POST', INIT)).status).toBe(503);
    mcp = true;
  });
  it('a real MCP client lists and creates on the folder; a new token stops the old one', async () => {
    const connect = async (t: string) => {
      const c = new Client({ name: 'test', version: '1' });
      await c.connect(new StreamableHTTPClientTransport(new URL(`${srv.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${t}` } } }));
      return c;
    };
    const c = await connect(token);
    const tools = await c.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('list_designs');
    await c.callTool({ name: 'create_design', arguments: { title: 'From agent', preset: 'instagram-post' } });
    expect((await ws.store.list()).map((m) => m.title)).toContain('From agent');
    await c.close();
    const old = token;
    token = 'dc_new';
    await expect(connect(old)).rejects.toThrow();
    token = old;
  }, 30_000);
});

describe('picker session', () => {
  const origin = () => `http://digital-canvas.localhost:${srv.port}`;
  it('needs a same-origin POST and gives the token once', async () => {
    picks.set('n1', { mode: 'media', token: 'at' });
    const body = JSON.stringify({ nonce: 'n1' });
    expect((await raw('/desktop/api/picker/session', { host: host() }, 'POST', body)).status).toBe(403);
    expect((await raw('/desktop/api/picker/session', { host: host(), origin: 'https://evil.example' }, 'POST', body)).status).toBe(403);
    const r = await raw('/desktop/api/picker/session', { host: host(), origin: origin() }, 'POST', body);
    expect(JSON.parse(r.text)).toEqual({ mode: 'media', token: 'at' });
    expect((await raw('/desktop/api/picker/session', { host: host(), origin: origin() }, 'POST', body)).status).toBe(404);
  });
  it('passes the result on', async () => {
    await raw('/desktop/api/picker/result', { host: host(), origin: origin() }, 'POST', JSON.stringify({ nonce: 'n1', result: [{ id: 'f' }] }));
    expect(done).toEqual([[{ id: 'f' }]]);
  });
});
