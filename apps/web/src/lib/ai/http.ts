import type { AdapterOptions, Media, Progress } from './types.ts';

export class AIError extends Error {
  override name = 'AIError';
  constructor(message: string, readonly status = 0) {
    super(message);
  }
}

export const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** `data:image/png;base64,…` → bytes + mime. */
export function fromDataUrl(url: string): Media | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  return { mime: m[1]!, bytes: m[2] ? fromBase64(m[3]!) : new TextEncoder().encode(decodeURIComponent(m[3]!)) };
}

/** Pull a human message out of the many error body shapes providers use. */
export function errorMessage(body: unknown): string {
  if (!body || typeof body !== 'object') return typeof body === 'string' ? body.slice(0, 300) : '';
  const b = body as Record<string, unknown>;
  const e = b.error;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const m = (e as Record<string, unknown>).message;
    if (typeof m === 'string') return m;
  }
  for (const k of ['msg', 'message', 'detail', 'failMsg']) if (typeof b[k] === 'string') return b[k] as string;
  return '';
}

/**
 * One request to a provider. Errors become AIError with a plain sentence;
 * the key is never part of a message (we never echo headers or URLs with keys).
 */
export async function request(o: AdapterOptions, provider: string, url: string, init: RequestInit = {}): Promise<Response> {
  const f = o.fetch ?? globalThis.fetch.bind(globalThis);
  let res: Response;
  try {
    res = await f(url, init);
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    const local = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(url);
    throw new AIError(local
      ? `Couldn't reach ${provider} at ${new URL(url).origin}. Is it running, and does it allow this site (CORS)? For Ollama set OLLAMA_ORIGINS.`
      : `Couldn't reach ${provider}. Check your connection (or the provider blocks calls from browsers).`);
  }
  if (res.ok) return res;
  let body: unknown = null;
  const text = await res.text().catch(() => '');
  try { body = JSON.parse(text); } catch { body = text; }
  const msg = errorMessage(body);
  if (res.status === 401 || res.status === 403) throw new AIError(`${provider} refused that API key${msg ? ` (${msg})` : ''}. Check it in AI providers.`, res.status);
  if (res.status === 402) throw new AIError(`${provider}: not enough credit on this account${msg ? ` (${msg})` : ''}.`, res.status);
  if (res.status === 429) throw new AIError(`${provider}: too many requests right now. Try again in a minute.`, res.status);
  if (res.status === 404) throw new AIError(`${provider}: not found${msg ? ` (${msg})` : ''}. Check the model name${provider === 'OpenAI-compatible' ? ' and base URL' : ''}.`, res.status);
  throw new AIError(`${provider} said: ${msg || `HTTP ${res.status}`}`, res.status);
}

export async function json<T = any>(o: AdapterOptions, provider: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await request(o, provider, url, init);
  try {
    return (await res.json()) as T;
  } catch {
    throw new AIError(`${provider} sent back something that isn't JSON.`);
  }
}

export async function download(o: AdapterOptions, provider: string, url: string, init: RequestInit = {}, fallbackMime = 'application/octet-stream'): Promise<Media> {
  const res = await request(o, provider, url, init);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const mime = (res.headers.get('content-type') ?? '').split(';')[0]!.trim() || fallbackMime;
  return { bytes, mime: mime === 'application/octet-stream' || mime === 'binary/octet-stream' ? sniff(bytes, fallbackMime) : mime };
}

/** Mime from magic bytes (some hosts send octet-stream). */
export function sniff(b: Uint8Array, fallback: string): string {
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57) return 'image/webp';
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'video/mp4';
  if (b[0] === 0x1a && b[1] === 0x45) return 'video/webm';
  return fallback;
}

/** Poll until `step` returns a value; gentle backoff (2 s → 10 s), gives up after `timeoutMs`. */
export async function poll<T>(o: AdapterOptions, step: () => Promise<T | null>, opts: { timeoutMs: number; signal?: AbortSignal; first?: number }): Promise<T> {
  const sleep = o.sleep ?? defaultSleep;
  const start = Date.now();
  let wait = opts.first ?? 2000;
  for (let n = 0; ; n++) {
    if (opts.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const v = await step();
    if (v !== null) return v;
    if (Date.now() - start > opts.timeoutMs) throw new AIError('This is taking too long; the job was given up. Try again later.');
    await sleep(wait);
    wait = Math.min(10_000, Math.round(wait * 1.3));
  }
}

export const report = (cb: ((p: Progress) => void) | undefined, fraction: number | null, message: string) => cb?.({ fraction, message });

/** Nearest of `ratios` ("16:9") to w:h. */
export function nearestRatio(w: number, h: number, ratios: readonly string[]): string {
  const want = Math.log(w / h);
  let best = ratios[0]!, d = Infinity;
  for (const r of ratios) {
    const [a, b] = r.split(':').map(Number);
    if (!a || !b) continue;
    const x = Math.abs(Math.log(a / b) - want);
    if (x < d) { d = x; best = r; }
  }
  return best;
}

/** Nearest allowed value. */
export const nearest = (v: number, allowed: readonly number[]) => allowed.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
