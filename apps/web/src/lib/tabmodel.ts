/**
 * Design tabs: the pure parts (no DOM, no Svelte), so they can be unit-tested.
 * State and wiring live in tabs.svelte.ts, the strip in TabStrip.svelte.
 */

/** Editors kept alive in memory; older tabs are suspended and reloaded from storage. */
export const MAX_LIVE = 8;

export interface DesignTab {
  id: string;
  title: string;
}

/** Where the tab strip goes. */
export type StripMode = 'titlebar' | 'bar' | 'none';

export interface StripEnv {
  /** Phone layout (< 768 px): no strip (except in the title bar, which is always drawn). */
  mobile: boolean;
  /** Installed app with Window Controls Overlay on: the strip is the title bar. */
  wco: boolean;
  /** Installed app (standalone / WCO toggled off / Capacitor desktop): a thin bar, always. */
  standalone: boolean;
  /** Design tabs open. */
  count: number;
}

/**
 * Installed app: the strip is always there (in the title bar with WCO, else a
 * thin bar), like Canva's desktop app. A browser tab already sits in a tab
 * strip of its own, so ours only shows up once a second design is open.
 */
export function stripMode(env: StripEnv): StripMode {
  // the window controls cover the top of the page whatever its width: the bar stays
  if (env.wco) return 'titlebar';
  if (env.mobile) return 'none';
  if (env.standalone) return 'bar';
  return env.count >= 2 ? 'bar' : 'none';
}

/** Move the tab at `from` to index `to` (indexes of the list before the move). */
export function reorder<T>(list: readonly T[], from: number, to: number): T[] {
  const out = list.slice();
  if (from < 0 || from >= out.length) return out;
  const [it] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, it!);
  return out;
}

/**
 * Ctrl+Tab / Ctrl+Shift+Tab: the next / previous tab, wrapping. Home counts as
 * a stop before the first design (Canva). `null` = Home.
 */
export function cycle(ids: readonly string[], active: string | null, dir: 1 | -1): string | null {
  const stops: (string | null)[] = [null, ...ids];
  const at = Math.max(0, stops.indexOf(active));
  return stops[(at + dir + stops.length) % stops.length] ?? null;
}

/** ⌘1..⌘8 = that tab, ⌘9 = the last one (browsers). `undefined` = no such tab. */
export function nth(ids: readonly string[], n: number): string | undefined {
  if (n === 9) return ids[ids.length - 1];
  return ids[n - 1];
}

/**
 * The tab to show after closing `closing`: the one to its right, else to its
 * left, else Home (`null`). Closing a background tab keeps the active one.
 */
export function afterClose(ids: readonly string[], closing: string, active: string | null): string | null {
  if (closing !== active) return active;
  const i = ids.indexOf(closing);
  const rest = ids.filter((x) => x !== closing);
  if (!rest.length) return null;
  return rest[Math.min(i, rest.length - 1)] ?? null;
}

/**
 * Which live editors to suspend so at most `max` stay in memory: the least
 * recently used, never the active one. `used` = last time each live tab was shown.
 */
export function toEvict(used: ReadonlyMap<string, number>, active: string | null, max = MAX_LIVE): string[] {
  const extra = used.size - max;
  if (extra <= 0) return [];
  return [...used.entries()]
    .filter(([id]) => id !== active)
    .sort((a, b) => a[1] - b[1])
    .slice(0, extra)
    .map(([id]) => id);
}

/** Parse what was saved in localStorage; anything odd is dropped. */
export function parseSaved(raw: string | null): DesignTab[] {
  try {
    const v = JSON.parse(raw ?? '[]') as unknown;
    if (!Array.isArray(v)) return [];
    const seen = new Set<string>();
    const out: DesignTab[] = [];
    for (const t of v) {
      if (!t || typeof t !== 'object') continue;
      const { id, title } = t as Record<string, unknown>;
      if (typeof id !== 'string' || !/^[\w-]+$/.test(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, title: typeof title === 'string' ? title : 'Untitled design' });
    }
    return out;
  } catch {
    return [];
  }
}

/** Where a dragged tab lands: the slot whose centre the pointer passed. `centres` are the tabs' x centres, left to right. */
export function dropIndex(centres: readonly number[], from: number, x: number): number {
  let to = 0;
  for (let i = 0; i < centres.length; i++) if (i !== from && x > centres[i]!) to++;
  return to;
}
