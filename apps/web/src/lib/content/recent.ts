/**
 * "Recently used" for the side panels, kept in this browser (localStorage).
 * Items are anything a panel can add again: content results, shapes, lines,
 * fonts…, each a small JSON entry with a stable key.
 */

export interface Recent<T = unknown> {
  key: string;
  /** What it is, so a panel can draw and re-add it (`content`, `shape`, `font`, …). */
  type: string;
  data: T;
  at: number;
}

const KEY = 'dc.recent.v1';
const MAX = 40;

function read(): Recent[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Recent[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

let listeners: (() => void)[] = [];

/** Most recent first, optionally of some types only. */
export function recent(types?: string[]): Recent[] {
  const all = read();
  return types ? all.filter((r) => types.includes(r.type)) : all;
}

export function remember<T>(type: string, key: string, data: T): void {
  const list = [{ key: `${type}:${key}`, type, data, at: Date.now() }, ...read().filter((r) => r.key !== `${type}:${key}`)];
  // fonts and content share the list; keep each type from crowding the other out
  const perType = new Map<string, number>();
  const kept = list.filter((r) => { const n = (perType.get(r.type) ?? 0) + 1; perType.set(r.type, n); return n <= MAX; });
  try {
    localStorage.setItem(KEY, JSON.stringify(kept));
  } catch { /* quota */ }
  for (const l of listeners) l();
}

/** Call `fn` whenever the list changes. Returns an unsubscribe. */
export function onRecent(fn: () => void): () => void {
  listeners.push(fn);
  return () => { listeners = listeners.filter((l) => l !== fn); };
}
