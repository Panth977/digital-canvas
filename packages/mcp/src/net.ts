/**
 * Downloads for agents: http(s) only, a size cap, a timeout, and (on servers)
 * no private network addresses, so `import_from_url` can't be used to reach
 * the cloud metadata server or anything else inside the network.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const MAX_DOWNLOAD = 300 * 1024 * 1024;

function privateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const s = ip.toLowerCase();
    if (s === '::1' || s === '::' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80')) return true;
    const m = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    return m ? privateIp(m[1]!) : false;
  }
  const [a = 0, b = 0] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** Throws when `url` isn't a public http(s) address (unless private hosts are allowed). */
export async function checkUrl(url: string, allowPrivate: boolean): Promise<URL> {
  let u: URL;
  try { u = new URL(url); } catch { throw new Error(`not a URL: ${url}`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('only http(s) URLs can be imported');
  if (allowPrivate) return u;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.internal') || host.endsWith('.local')) throw new Error('that host is not reachable from here');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => { throw new Error(`cannot resolve ${host}`); });
  if (addrs.some((a) => privateIp(a.address))) throw new Error('that host is not reachable from here');
  return u;
}

export interface Fetched { bytes: Uint8Array; mime: string; name: string }

export async function download(url: string, opts: { allowPrivate?: boolean; maxBytes?: number; timeoutMs?: number } = {}): Promise<Fetched> {
  let u = await checkUrl(url, !!opts.allowPrivate);
  const max = opts.maxBytes ?? MAX_DOWNLOAD;
  let r: Response | null = null;
  // follow redirects ourselves so every hop is checked
  for (let hop = 0; hop < 5; hop++) {
    r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000), headers: { 'user-agent': 'DigitalCanvas-MCP/0.1 (+https://digital-canvas-p977.web.app)' } });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      u = await checkUrl(new URL(r.headers.get('location')!, u).toString(), !!opts.allowPrivate);
      continue;
    }
    break;
  }
  if (!r || !r.ok) throw new Error(`download failed: HTTP ${r?.status ?? '?'} for ${url}`);
  const len = Number(r.headers.get('content-length') ?? 0);
  if (len > max) throw new Error(`the file is ${Math.round(len / 1048576)} MB; the limit is ${Math.round(max / 1048576)} MB`);
  const chunks: Uint8Array[] = [];
  let got = 0;
  const reader = r.body!.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (got > max) { await reader.cancel(); throw new Error(`the file is over the ${Math.round(max / 1048576)} MB limit`); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { bytes.set(c, o); o += c.length; }
  const mime = (r.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  const name = decodeURIComponent(u.pathname.split('/').pop() || u.hostname).slice(0, 120);
  return { bytes, mime, name };
}
