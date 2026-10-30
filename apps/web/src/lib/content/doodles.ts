/**
 * Open Doodles by Pablo Stanley (CC0, https://www.opendoodles.com): whole
 * illustrations shipped with the app in public/illustrations/open-doodles
 * (tools/catalogs/build.ts).
 */
import type { Fetch, Item, Page } from './types.ts';

interface Doodle { id: string; title: string; width: number; height: number }

/** Same origin as the app. This file is also bundled into the MCP server, where the source simply drops out. */
const BASE = '/illustrations/open-doodles/';
let index: Promise<Doodle[]> | null = null;

function load(f: Fetch): Promise<Doodle[]> {
  index ??= f(`${BASE}index.json`).then((r) => {
    if (!r.ok) throw new Error(`Open Doodles: HTTP ${r.status}`);
    return r.json() as Promise<Doodle[]>;
  }).catch((e) => { index = null; throw e; });
  return index;
}

const item = (d: Doodle): Item => ({
  key: `doodles:${d.id}`, kind: 'illustration', source: 'doodles', title: d.title, thumb: `${BASE}${d.id}.svg`, url: `${BASE}${d.id}.svg`, width: d.width, height: d.height,
  credit: { title: d.title, creator: 'Pablo Stanley', license: 'CC0', page: 'https://www.opendoodles.com', source: 'Open Doodles' },
});

/** All doodles at once (there are few); empty words list them all. */
export async function searchDoodles(query: string, _cursor = 0, f: Fetch = fetch): Promise<Page> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const list = await load(f);
  return { items: list.filter((d) => words.every((w) => d.title.toLowerCase().includes(w))).map(item), next: null };
}
