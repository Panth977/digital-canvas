/**
 * One search over every open source of a kind: pages from each source are
 * fetched together and interleaved, so results from Openverse, Wikimedia
 * Commons and NASA (or several icon sets) mix the way Canva mixes its
 * libraries. A source that fails drops out; the feed only fails when all do.
 */
import { searchCommons } from './commons.ts';
import { searchDoodles } from './doodles.ts';
import { browseIconify, searchIconify } from './iconify.ts';
import { searchNasa } from './nasa.ts';
import { searchAudio, searchImages } from './openverse.ts';
import type { Fetch, Item, Kind, Page, SourceId } from './types.ts';

export interface Source {
  id: SourceId;
  label: string;
  /** Cursor of the first page. */
  first: unknown;
  page: (query: string, cursor: unknown, f?: Fetch) => Promise<Page>;
}

export interface FeedOptions {
  /** Only this source. */
  only?: SourceId;
  /** Audio: music or sound effects (Openverse's categories). */
  audio?: 'music' | 'sound_effect';
}

/** Browsing a kind with no search words uses these. */
export const DEFAULT_QUERY: Record<Kind, string> = {
  graphic: '', sticker: '', icon: '', illustration: 'illustration', photo: 'nature', video: 'nature', audio: 'music',
};

export const SOURCE_LABEL: Record<SourceId, string> = { iconify: 'Iconify', openverse: 'Openverse', commons: 'Wikimedia Commons', nasa: 'NASA', doodles: 'Open Doodles' };

export function sourcesFor(kind: Kind, opts: FeedOptions = {}): Source[] {
  const n = (c: unknown) => c as number;
  const icon = (k: 'graphic' | 'sticker' | 'icon'): Source => ({
    id: 'iconify', label: SOURCE_LABEL.iconify, first: 0,
    page: (q, c, f) => (q.trim() ? searchIconify(k, q, n(c), f) : browseIconify(k, n(c), f)),
  });
  const ov = (category: 'photograph' | 'illustration'): Source => ({ id: 'openverse', label: SOURCE_LABEL.openverse, first: 1, page: (q, c, f) => searchImages(q, { category, page: n(c) }, f) });
  const commons = (k: 'photo' | 'video' | 'audio'): Source => ({ id: 'commons', label: SOURCE_LABEL.commons, first: 0, page: (q, c, f) => searchCommons(k, q, n(c), f) });
  const nasa = (k: 'photo' | 'video' | 'audio'): Source => ({ id: 'nasa', label: SOURCE_LABEL.nasa, first: 1, page: (q, c, f) => searchNasa(k, q, n(c), f) });
  let list: Source[];
  switch (kind) {
    case 'graphic': case 'sticker': case 'icon': list = [icon(kind)]; break;
    case 'illustration': list = [{ id: 'doodles', label: SOURCE_LABEL.doodles, first: 0, page: (q, c, f) => searchDoodles(q === DEFAULT_QUERY.illustration ? '' : q, n(c), f) }, ov('illustration')]; break;
    case 'photo': list = opts.only === 'nasa' ? [nasa('photo')] : [ov('photograph'), commons('photo')]; break;
    case 'video': list = [commons('video'), nasa('video')]; break;
    case 'audio': list = [{ id: 'openverse', label: SOURCE_LABEL.openverse, first: 1, page: (q, c, f) => searchAudio(q, { category: opts.audio, page: n(c) }, f) }, commons('audio')]; break;
  }
  return opts.only ? list.filter((s) => s.id === opts.only) : list;
}

/** Round-robin merge: a1 b1 c1 a2 b2 … */
export function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]!);
  return out;
}

export interface Feed {
  readonly done: boolean;
  /** Sources that failed (shown as a note). */
  readonly failed: SourceId[];
  next(): Promise<Item[]>;
}

/** Page through all `sources` for `query`. */
export function createFeed(sources: Source[], query: string, f?: Fetch): Feed {
  const cursors = new Map<SourceId, unknown>(sources.map((s) => [s.id, s.first]));
  const seen = new Set<string>();
  const failed: SourceId[] = [];
  let busy: Promise<Item[]> | null = null;
  const live = () => sources.filter((s) => cursors.get(s.id) !== null);
  async function load(): Promise<Item[]> {
    const now = live();
    if (!now.length) return [];
    const pages = await Promise.all(now.map((s) => s.page(query, cursors.get(s.id), f).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))))));
    const lists: Item[][] = [];
    let errors = 0, lastError: Error | null = null;
    pages.forEach((p, i) => {
      const s = now[i]!;
      if (p instanceof Error) {
        cursors.set(s.id, null);
        failed.push(s.id);
        errors++;
        lastError = p;
      } else {
        cursors.set(s.id, p.next);
        lists.push(p.items);
      }
    });
    if (errors === now.length && lastError) throw lastError;
    const out = interleave(lists).filter((x) => !seen.has(x.key) && (seen.add(x.key), true));
    // a page that was all duplicates: keep going so the grid doesn't stall
    if (!out.length && live().length) return load();
    return out;
  }
  return {
    get done() { return live().length === 0; },
    failed,
    next() {
      busy ??= load().finally(() => (busy = null));
      return busy;
    },
  };
}

/** Feed for a kind and words (empty words browse the kind's default). */
export function feedFor(kind: Kind, query: string, opts: FeedOptions = {}, f?: Fetch): Feed {
  const q = query.trim() || DEFAULT_QUERY[kind];
  return createFeed(sourcesFor(kind, opts), q, f);
}
