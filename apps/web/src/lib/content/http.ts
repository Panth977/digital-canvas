/** Fetching for the content sources: cached JSON and downloads with progress and a size limit. */
import type { Fetch } from './types.ts';

const memory = new Map<string, { at: number; data: unknown }>();
const PREFIX = 'dc.content.';
const TTL = 6 * 3600e3;
/** How long a search may take before its source is skipped. */
const TIMEOUT = 8_000;

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * GET JSON. Answers are cached in memory and in localStorage for a few hours,
 * so reopening a panel doesn't spend the anonymous rate limits of the
 * public APIs (Openverse allows only a handful of requests a minute).
 */
export async function getJson<T>(url: string, f: Fetch = fetch, ttl = TTL): Promise<T> {
  const now = Date.now();
  const hit = memory.get(url);
  if (hit && now - hit.at < ttl) return hit.data as T;
  const ls = store();
  if (ls) {
    try {
      const saved = JSON.parse(ls.getItem(PREFIX + url) ?? 'null') as { at: number; data: unknown } | null;
      if (saved && now - saved.at < ttl) {
        memory.set(url, saved);
        return saved.data as T;
      }
    } catch { /* broken entry */ }
  }
  // a slow source must not hold up the others in a combined feed
  const r = await f(url, typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? { signal: AbortSignal.timeout(TIMEOUT) } : undefined)
    .catch((e: unknown) => { throw new Error(e instanceof Error && e.name === 'TimeoutError' ? 'no answer' : e instanceof Error ? e.message : String(e)); });
  if (!r.ok) throw new Error(r.status === 429 ? 'too many requests, try again in a minute' : `HTTP ${r.status}`);
  const data = (await r.json()) as T;
  memory.set(url, { at: now, data });
  if (ls) {
    try {
      ls.setItem(PREFIX + url, JSON.stringify({ at: now, data }));
    } catch {
      // quota: drop our older entries and carry on without saving
      for (let i = ls.length - 1; i >= 0; i--) { const k = ls.key(i); if (k?.startsWith(PREFIX)) ls.removeItem(k); }
    }
  }
  return data;
}

/** Forget cached answers (tests). */
export function clearCache(): void {
  memory.clear();
  const ls = store();
  if (ls) for (let i = ls.length - 1; i >= 0; i--) { const k = ls.key(i); if (k?.startsWith(PREFIX)) ls.removeItem(k); }
}

export class TooLargeError extends Error {
  constructor(readonly bytes: number, readonly limit: number) {
    super(`The file is ${mb(bytes)}; the limit is ${mb(limit)}.`);
  }
}

export const mb = (n: number) => `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;

export interface Downloaded {
  bytes: Uint8Array;
  mime: string;
}

/**
 * Download a file, reporting progress (0..1, or -1 while the size is
 * unknown) and refusing files larger than `maxBytes`.
 */
export async function download(url: string, opts: { onProgress?: (p: number) => void; maxBytes?: number; signal?: AbortSignal; fetch?: Fetch } = {}): Promise<Downloaded> {
  const f = opts.fetch ?? fetch;
  const r = await f(url, { signal: opts.signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const mime = (r.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  const total = Number(r.headers.get('content-length') ?? 0) || 0;
  const max = opts.maxBytes ?? Infinity;
  if (total > max) throw new TooLargeError(total, max);
  if (!r.body) {
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length > max) throw new TooLargeError(bytes.length, max);
    opts.onProgress?.(1);
    return { bytes, mime };
  }
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  opts.onProgress?.(total ? 0 : -1);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (got > max) {
      await reader.cancel();
      throw new TooLargeError(got, max);
    }
    opts.onProgress?.(total ? Math.min(1, got / total) : -1);
  }
  const bytes = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { bytes.set(c, o); o += c.length; }
  opts.onProgress?.(1);
  return { bytes, mime };
}

/** Plain text from an HTML snippet (Wikimedia's artist field is HTML). */
export function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
