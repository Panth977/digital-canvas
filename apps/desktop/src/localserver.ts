/**
 * The local server: the built web app plus /mcp, on loopback only (127.0.0.1
 * and ::1, the two addresses `digital-canvas.localhost` resolves to). No
 * Electron here: it runs in the app's utility process and under vitest.
 */
import { createReadStream, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer as createMcp } from '@digital-canvas/mcp';
import type { Workspace } from '@digital-canvas/mcp';
import { HOSTNAME, checkMcp, checkRequest } from './guard.ts';

export const DEFAULT_PORT = 4977;
const PORT_TRIES = 40;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

export interface PickerSession { mode: string; arg?: string; token: string }

export interface LocalServerOptions {
  /** The built web app. */
  root: string;
  /** Ports to try first (the last one used, so the window's origin and its data stay put). */
  preferredPort?: number;
  /** The MCP access token; read per request, so regenerating works at once. */
  token: () => string;
  mcpEnabled: () => boolean;
  /** The active store. */
  workspace: () => Workspace | null;
  /** One-time: gives the picker page its session. */
  takePicker?: (nonce: string) => PickerSession | null;
  pickerDone?: (nonce: string, result: unknown) => void;
}

export interface LocalServer { port: number; url: string; fallbackUrl: string; close(): Promise<void> }

function fileFor(root: string, pathname: string): string | null {
  let rel: string;
  try { rel = decodeURIComponent(pathname); } catch { return null; }
  if (rel.includes('\0')) return null;
  const path = normalize(join(root, rel));
  if (path !== root && !path.startsWith(root.endsWith(sep) ? root : root + sep)) return null;
  try { return statSync(path).isFile() ? path : null; } catch { return null; }
}

function sendFile(res: ServerResponse, path: string, method: string): void {
  const size = statSync(path).size;
  const hashed = /[\\/]assets[\\/]/.test(path) && /-[\w-]{8,}\./.test(path);
  res.writeHead(200, {
    'content-type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream', 'content-length': size,
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache', 'x-content-type-options': 'nosniff',
  });
  if (method === 'HEAD') { res.end(); return; }
  createReadStream(path).on('error', () => res.destroy()).pipe(res);
}

const json = (res: ServerResponse, status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));

async function readJson(req: IncomingMessage, limit = 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req as AsyncIterable<Buffer>) {
    size += c.length;
    if (size > limit) throw new Error('too large');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function startLocalServer(o: LocalServerOptions): Promise<LocalServer> {
  let port = 0;

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const headers = { host: req.headers.host, origin: req.headers.origin, authorization: req.headers.authorization };
    const base = checkRequest(headers, port);
    if (!base.ok) return void json(res, base.status, { error: base.error });
    const url = new URL(req.url ?? '/', 'http://local');
    const method = req.method ?? 'GET';

    if (url.pathname === '/mcp') {
      if (!o.mcpEnabled()) return void json(res, 503, { error: 'the local MCP server is off (Digital Canvas › Settings › Local MCP)' });
      const v = checkMcp(headers, port, o.token());
      if (!v.ok) return void res.writeHead(v.status, { 'content-type': 'application/json', ...(v.status === 401 ? { 'www-authenticate': 'Bearer' } : {}) }).end(JSON.stringify({ error: v.error }));
      const ws = o.workspace();
      if (!ws) return void json(res, 503, { error: 'choose a folder in Digital Canvas first' });
      // Stateless JSON: no server stream to hold open, so GET and DELETE have nothing to do (spec: 405).
      if (method !== 'POST') return void res.writeHead(405, { allow: 'POST' }).end();
      const server = createMcp(ws, { mode: 'local', name: 'digital-canvas', editorUrl: `http://${HOSTNAME}:${port}` });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => { void transport.close(); void server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res);
      return;
    }

    if (url.pathname.startsWith('/desktop/api/')) {
      if (method !== 'POST' || req.headers.origin === undefined) return void json(res, 403, { error: 'same-origin POST only' });
      const body = (await readJson(req).catch(() => null)) as { nonce?: string; result?: unknown } | null;
      if (!body?.nonce) return void json(res, 400, { error: 'bad request' });
      if (url.pathname === '/desktop/api/picker/session') {
        const s = o.takePicker?.(body.nonce);
        return s ? void json(res, 200, s) : void json(res, 404, { error: 'this picker link was already used' });
      }
      if (url.pathname === '/desktop/api/picker/result') {
        o.pickerDone?.(body.nonce, body.result);
        return void json(res, 200, { ok: true });
      }
      return void json(res, 404, { error: 'not found' });
    }

    if (method !== 'GET' && method !== 'HEAD') return void res.writeHead(405).end();
    const file = fileFor(o.root, url.pathname === '/' ? '/index.html' : url.pathname);
    if (file) return sendFile(res, file, method);
    // App routes (/d/…, /view/…); a missing file with an extension stays a 404.
    if (extname(url.pathname)) return void res.writeHead(404).end();
    sendFile(res, join(o.root, 'index.html'), method);
  };

  const onRequest = (req: IncomingMessage, res: ServerResponse) => {
    handle(req, res).catch((e) => {
      console.error('[local server]', e);
      if (!res.headersSent) res.writeHead(500).end();
      else res.destroy();
    });
  };

  const listen = (s: Server, p: number, host: string) => new Promise<void>((resolve, reject) => {
    s.once('error', reject);
    s.listen(p, host, () => { s.off('error', reject); resolve(); });
  });

  const candidates = [...new Set([o.preferredPort, ...Array.from({ length: PORT_TRIES }, (_, i) => DEFAULT_PORT + i)])].filter((p): p is number => !!p);
  for (const p of candidates) {
    const v4 = createServer(onRequest), v6 = createServer(onRequest);
    try {
      await listen(v4, p, '127.0.0.1');
    } catch (e) {
      v4.close();
      if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') continue;
      throw e;
    }
    let servers = [v4, v6];
    try {
      await listen(v6, p, '::1');
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EADDRINUSE') { await new Promise((r) => v4.close(r)); continue; }
      servers = [v4]; // no IPv6 on this machine
    }
    port = p;
    return {
      port, url: `http://${HOSTNAME}:${p}`, fallbackUrl: `http://127.0.0.1:${p}`,
      close: async () => {
        await Promise.all(servers.map((s) => new Promise((r) => { s.close(r); s.closeAllConnections?.(); })));
      },
    };
  }
  throw new Error(`no free port from ${DEFAULT_PORT}`);
}
