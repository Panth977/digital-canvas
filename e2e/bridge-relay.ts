/**
 * For bridge.spec.ts: the remote MCP server (packages/mcp/src/remote, with the
 * device bridge on) in this test process, over an in-memory mailbox
 * (MemoryBridge) instead of Firestore. The browser page is the device: it
 * reaches the mailbox through small HTTP routes here (/dev/*, CORS open),
 * standing in for the Firestore client SDK.
 */
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createRemoteHandler } from '../packages/mcp/src/remote/http.ts';
import { MemoryOAuthStore } from '../packages/mcp/src/remote/store.ts';
import { sha256hex } from '../packages/mcp/src/remote/oauth.ts';
import { MemoryBridge } from '../packages/mcp/src/bridge/store.ts';
import type { JobRow } from '../packages/mcp/src/bridge/types.ts';

export const UID = 'google:1';

export interface Relay {
  base: string;
  token: string;
  bridge: MemoryBridge;
  close: () => Promise<void>;
}

export async function startRelay(email = 'tester@example.com'): Promise<Relay> {
  const store = new MemoryOAuthStore();
  const token = `dca_${randomBytes(20).toString('hex')}`;
  const now = Date.now();
  await store.putGrant(UID, 'test-client', { clientId: 'test-client', clientName: 'Test', scopes: ['designs'], createdAt: now, lastUsedAt: now });
  await store.putToken(sha256hex(token), { kind: 'access', uid: UID, grantId: 'test-client', clientId: 'test-client', scopes: ['designs'], expiresAt: now + 3600_000, createdAt: now });
  const bridge = new MemoryBridge();
  bridge.setSettings(UID, { email });
  const handler = createRemoteHandler({
    store,
    google: { clientId: 'x', clientSecret: 'y', tokenKey: randomBytes(32).toString('base64'), fetch: async () => new Response('{}', { status: 500 }) },
    bridge: { store: bridge, allowlist: ['ppanth977@gmail.com'], pickupMs: 15_000 },
  });
  const link = bridge.link(UID);

  // device side: a job list per device, answered on change (long poll)
  const versions = new Map<string, number>();
  const lists = new Map<string, JobRow[]>();
  const waiters = new Map<string, Set<() => void>>();
  const subscribed = new Set<string>();
  const ensure = (device: string) => {
    if (subscribed.has(device)) return;
    subscribed.add(device);
    link.listenJobs(device, (jobs) => {
      lists.set(device, jobs);
      versions.set(device, (versions.get(device) ?? 0) + 1);
      for (const w of waiters.get(device) ?? []) w();
      waiters.get(device)?.clear();
    });
  };

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (url.pathname.startsWith('/fixtures/')) {
      // media the agent imports by URL (the device downloads it)
      const name = url.pathname.slice('/fixtures/'.length).replace(/[^\w.-]/g, '');
      const type = name.endsWith('.webm') ? 'video/webm' : name.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream';
      try { return void res.writeHead(200, { ...cors, 'content-type': type }).end(readFileSync(new URL(`fixtures/${name}`, import.meta.url))); }
      catch { return void res.writeHead(404, cors).end(); }
    }
    if (!url.pathname.startsWith('/dev/')) return void handler(req, res);
    if (req.method === 'OPTIONS') return void res.writeHead(204, cors).end();
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    const ok = (v: unknown = {}) => res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify(v));
    try {
      if (url.pathname === '/dev/putDevice') { await link.putDevice({ ...body, lastSeen: Date.now() }); return ok(); }
      if (url.pathname === '/dev/updateJob') { await link.updateJob(body.id, body.patch); return ok(); }
      if (url.pathname === '/dev/putParts') { await link.putParts(body.id, body.parts); return ok(); }
      if (url.pathname === '/dev/jobs') {
        const device = url.searchParams.get('device')!;
        const seen = Number(url.searchParams.get('v') ?? -1);
        ensure(device);
        await new Promise<void>((resolve) => {
          if ((versions.get(device) ?? 0) !== seen) return resolve();
          const set = waiters.get(device) ?? waiters.set(device, new Set()).get(device)!;
          const t = setTimeout(resolve, 20_000);
          set.add(() => { clearTimeout(t); resolve(); });
        });
        return ok({ v: versions.get(device) ?? 0, jobs: lists.get(device) ?? [] });
      }
      res.writeHead(404, cors).end();
    } catch (e) {
      res.writeHead(500, cors).end(String(e));
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  return {
    base: `http://127.0.0.1:${port}`, token, bridge,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}
