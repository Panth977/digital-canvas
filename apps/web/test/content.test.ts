import { beforeEach, describe, expect, it } from 'vitest';
import { COMBOS, findCombos, fontId } from '../src/lib/content/combos.ts';
import { commonsUrl, pickVideo, searchCommons, thumbAt } from '../src/lib/content/commons.ts';
import { clearCache, download, getJson, stripHtml, TooLargeError } from '../src/lib/content/http.ts';
import { browseIconify, buildSvg, isSimpleSvg, loadIcons, searchIconify } from '../src/lib/content/iconify.ts';
import { fixUrl, pickNasaFiles, resolveNasa, searchNasa } from '../src/lib/content/nasa.ts';
import { licenseName, searchAudio, searchImages } from '../src/lib/content/openverse.ts';
import { recent, remember } from '../src/lib/content/recent.ts';
import { createFeed, interleave, sourcesFor, type Source } from '../src/lib/content/search.ts';
import type { Fetch, Item } from '../src/lib/content/types.ts';
import { creditLine, mimeFor } from '../src/lib/content/util.ts';

/** A fake fetch answering from a table of URL prefix → JSON (or a function). Records the URLs asked for. */
function fakeFetch(routes: [string | RegExp, unknown | ((url: string) => unknown)][]): Fetch & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    for (const [k, v] of routes) {
      if (typeof k === 'string' ? url.startsWith(k) : k.test(url)) {
        const body = typeof v === 'function' ? (v as (u: string) => unknown)(url) : v;
        if (body instanceof Response) return body;
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }
    return new Response('not found', { status: 404 });
  }) as Fetch & { calls: string[] };
  f.calls = calls;
  return f;
}

class MemoryStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

beforeEach(() => {
  (globalThis as any).localStorage = new MemoryStorage();
  clearCache();
});

const ICON_JSON = (prefix: string, names: string[]) => ({
  prefix, width: 24, height: 24,
  icons: Object.fromEntries(names.map((n) => [n, { body: `<path fill="currentColor" d="M0 0h24v24H0z"/>` }])),
});

describe('iconify', () => {
  it('searches sets for a kind, pages with start/limit and builds thumbnails in one request per set', async () => {
    const f = fakeFetch([
      ['https://api.iconify.design/search?', (u: string) => ({ icons: u.includes('start=48') ? ['noto:cat'] : Array.from({ length: 48 }, (_, i) => (i % 2 ? `noto:c${i}` : `twemoji:c${i}`)) })],
      [/\/noto\.json\?icons=/, (u: string) => ICON_JSON('noto', new URL(u).searchParams.get('icons')!.split(','))],
      [/\/twemoji\.json\?icons=/, (u: string) => ICON_JSON('twemoji', new URL(u).searchParams.get('icons')!.split(','))],
    ]);
    const p1 = await searchIconify('sticker', 'cat', 0, f);
    expect(f.calls[0]).toContain('query=cat');
    expect(f.calls[0]).toContain('limit=48');
    expect(f.calls[0]).toContain('prefixes=fluent-emoji-flat,noto,twemoji,fluent-emoji,openmoji');
    expect(p1.items).toHaveLength(48);
    expect(p1.next).toBe(48);
    expect(p1.items[0]).toMatchObject({ kind: 'sticker', source: 'iconify', icon: 'twemoji:c0', title: 'C0' });
    expect(p1.items[0]!.thumb).toMatch(/^data:image\/svg\+xml/);
    expect(p1.items[0]!.credit.license).toBe('CC BY 4.0');
    // the 48 thumbnails came from 2 batch requests, not 48
    expect(f.calls.filter((u) => u.includes('.json?icons='))).toHaveLength(2);
    const p2 = await searchIconify('sticker', 'cat', 48, f);
    expect(f.calls.at(-2)).toContain('start=48');
    expect(p2.items.map((i) => i.icon)).toEqual(['noto:cat']);
    expect(p2.next).toBeNull();
  });

  it('browses sets round-robin without a query', async () => {
    const f = fakeFetch([
      ['https://api.iconify.design/collection?prefix=fluent-color', { categories: { A: ['a1', 'a2'] }, uncategorized: ['a3'] }],
      ['https://api.iconify.design/collection?prefix=streamline-color', { categories: { B: ['b1'] } }],
      ['https://api.iconify.design/collection?prefix=flat-color-icons', { uncategorized: ['c1', 'c2'] }],
      [/\.json\?icons=/, (u: string) => { const x = new URL(u); return ICON_JSON(x.pathname.slice(1, -5), x.searchParams.get('icons')!.split(',')); }],
    ]);
    const p = await browseIconify('graphic', 0, f);
    expect(p.items.map((i) => i.icon)).toEqual(['fluent-color:a1', 'streamline-color:b1', 'flat-color-icons:c1', 'fluent-color:a2', 'flat-color-icons:c2', 'fluent-color:a3']);
    expect(p.next).toBeNull();
  });

  it('builds SVGs from icon JSON (sizes, offsets, aliases)', () => {
    const data = { prefix: 'x', width: 24, height: 24, icons: { a: { body: '<path d="M1 1"/>', width: 32, left: -2 } }, aliases: { b: { parent: 'a' }, c: { parent: 'a', rotate: 1 } } };
    expect(buildSvg(data, 'a')).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24" viewBox="-2 0 32 24"><path d="M1 1"/></svg>');
    expect(buildSvg(data, 'b')).toContain('<path d="M1 1"/>');
    expect(buildSvg(data, 'c')).toBeNull();
    expect(buildSvg(data, 'zz')).toBeNull();
  });

  it('caches icons it has loaded', async () => {
    const f = fakeFetch([[/\/mdi\.json/, ICON_JSON('mdi', ['home'])]]);
    await loadIcons(['mdi:home'], f);
    await loadIcons(['mdi:home'], f);
    expect(f.calls).toHaveLength(1);
  });

  it('tells which SVGs our reader can draw exactly', () => {
    expect(isSimpleSvg('<svg><path fill="#f00" d="M0 0"/></svg>')).toBe(true);
    expect(isSimpleSvg('<svg><path fill="url(#g)" d="M0 0"/></svg>')).toBe(false);
    expect(isSimpleSvg('<svg><g transform="translate(1 1)"><path d="M0 0"/></g></svg>')).toBe(false);
    expect(isSimpleSvg('<svg><use href="#a"/></svg>')).toBe(false);
  });
});

describe('openverse', () => {
  it('names licences like CC does', () => {
    expect(licenseName('by', '4.0')).toBe('CC BY 4.0');
    expect(licenseName('by-sa', '3.0')).toBe('CC BY-SA 3.0');
    expect(licenseName('cc0', '1.0')).toBe('CC0 1.0');
    expect(licenseName('pdm', '1.0')).toBe('PDM 1.0');
  });

  it('maps photo results with credit, fallback thumbnail and paging', async () => {
    const f = fakeFetch([['https://api.openverse.org/v1/images/', { page_count: 3, results: [{ id: 'abc', title: 'Green field', creator: 'Ana', license: 'by', license_version: '4.0', url: 'https://x/full.jpg', thumbnail: 'https://api.openverse.org/v1/images/abc/thumb/', foreign_landing_url: 'https://x/page', width: 600, height: 400, source: 'flickr' }] }]]);
    const p = await searchImages('field', { category: 'photograph', page: 2 }, f);
    expect(f.calls[0]).toContain('q=field');
    expect(f.calls[0]).toContain('license_type=commercial,modification');
    expect(f.calls[0]).toContain('category=photograph');
    expect(f.calls[0]).toContain('page=2');
    expect(p.next).toBe(3);
    const [it] = p.items;
    expect(it).toMatchObject({ key: 'openverse:abc', kind: 'photo', url: 'https://x/full.jpg', fallback: 'https://api.openverse.org/v1/images/abc/thumb/', width: 600, height: 400 });
    expect(creditLine(it!.credit)).toBe('"Green field" by Ana (CC BY 4.0) https://x/page');
  });

  it('maps audio results (duration in seconds, file name tidied)', async () => {
    const f = fakeFetch([['https://api.openverse.org/v1/audio/', { page_count: 1, results: [{ id: 'r1', title: 'Rain, Moderate.wav', creator: 'InspectorJ', license: 'by', license_version: '4.0', url: 'https://cdn.freesound.org/a.mp3', duration: 60116, filesize: 1379890 }, { id: 'nourl' }] }]]);
    const p = await searchAudio('rain', { category: 'sound_effect' }, f);
    expect(f.calls[0]).toContain('category=sound_effect');
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toMatchObject({ kind: 'audio', title: 'Rain, Moderate', url: 'https://cdn.freesound.org/a.mp3', preview: 'https://cdn.freesound.org/a.mp3', duration: 60.116 });
    expect(p.next).toBeNull();
  });
});

describe('wikimedia commons', () => {
  const page = (title: string, info: object, derivatives?: object[]) => ({ title, index: 1, imageinfo: [info], videoinfo: derivatives ? [{ derivatives }] : undefined });

  it('builds the search URL with the kind filter', () => {
    const u = commonsUrl('photo', 'sunset', 24);
    expect(u).toContain('origin=*');
    expect(decodeURIComponent(u)).toContain('gsrsearch=sunset filetype:bitmap incategory:Quality_images');
    expect(u).toContain('gsroffset=24');
    expect(decodeURIComponent(commonsUrl('video', 'ocean'))).toContain('ocean filetype:video');
  });

  it('maps photos: big originals are fetched as a 1920px thumbnail; credit from extmetadata', async () => {
    const f = fakeFetch([['https://commons.wikimedia.org/', { continue: { gsroffset: 24 }, query: { pages: { 1: page('File:Sunset_2007-1.jpg', {
      url: 'https://upload.wikimedia.org/a/Sunset.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Sunset_2007-1.jpg', mime: 'image/jpeg', width: 4000, height: 3000, size: 5e6,
      thumburl: 'https://upload.wikimedia.org/thumb/a/Sunset.jpg/330px-Sunset.jpg?utm_source=x',
      extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<a href="//x">Alves&amp;Gaspar</a>' } },
    }) } } }]]);
    const p = await searchCommons('photo', 'sunset', 0, f);
    expect(p.next).toBe(24);
    expect(p.items[0]).toMatchObject({ key: 'commons:Sunset_2007-1.jpg', kind: 'photo', title: 'Sunset 2007-1', thumb: 'https://upload.wikimedia.org/thumb/a/Sunset.jpg/330px-Sunset.jpg', url: 'https://upload.wikimedia.org/thumb/a/Sunset.jpg/1920px-Sunset.jpg', fallback: 'https://upload.wikimedia.org/thumb/a/Sunset.jpg/960px-Sunset.jpg' });
    expect(p.items[0]!.credit).toMatchObject({ creator: 'Alves&Gaspar', license: 'CC BY-SA 4.0', source: 'Wikimedia Commons' });
  });

  it('maps videos to a WebM rendition (480p to add, 240p to preview) and audio to its MP3', async () => {
    const ds = [
      { src: 'https://u/orig.webm', type: 'video/webm; codecs="vp9"', width: 1920, height: 1080 },
      { src: 'https://u/t.240p.vp9.webm', type: 'video/webm; codecs="vp9"', transcodekey: '240p.vp9.webm', width: 426, height: 240, bandwidth: 300000 },
      { src: 'https://u/t.480p.vp9.webm', type: 'video/webm; codecs="vp9"', transcodekey: '480p.vp9.webm', width: 854, height: 480, bandwidth: 740000 },
      { src: 'https://u/t.360p.mov', type: 'video/quicktime', transcodekey: '360p.mpeg4.mov', width: 640, height: 360 },
    ];
    expect(pickVideo(ds, 480)!.src).toBe('https://u/t.480p.vp9.webm');
    expect(pickVideo(ds, 240)!.src).toBe('https://u/t.240p.vp9.webm');
    const f = fakeFetch([['https://commons.wikimedia.org/', { query: { pages: {
      1: page('File:Ocean.webm', { url: 'https://u/orig.webm', mime: 'video/webm', duration: 15.5, thumburl: 'https://u/thumb/330px--Ocean.webm.jpg', extmetadata: {} }, ds),
    } } }]]);
    const v = await searchCommons('video', 'ocean', 0, f);
    expect(v.items[0]).toMatchObject({ kind: 'video', url: 'https://u/t.480p.vp9.webm', preview: 'https://u/t.240p.vp9.webm', width: 854, height: 480, duration: 15.5, size: Math.round((740000 * 15.5) / 8) });
    expect(v.next).toBeNull();
    clearCache();
    const g = fakeFetch([['https://commons.wikimedia.org/', { query: { pages: {
      1: page('File:Piano.ogg', { url: 'https://u/Piano.ogg', mime: 'application/ogg', duration: 65 }, [{ src: 'https://u/Piano.ogg', type: 'audio/ogg' }, { src: 'https://u/Piano.ogg.mp3', type: 'audio/mpeg' }]),
    } } }]]);
    const a = await searchCommons('audio', 'piano', 0, g);
    expect(a.items[0]).toMatchObject({ kind: 'audio', url: 'https://u/Piano.ogg.mp3', duration: 65, title: 'Piano' });
  });

  it('thumbAt swaps the width of a thumbnail URL', () => {
    expect(thumbAt('https://u/thumb/a/b.jpg/330px-b.jpg', 1280)).toBe('https://u/thumb/a/b.jpg/1280px-b.jpg');
  });
});

describe('nasa', () => {
  it('maps search results and resolves files from the item manifest', async () => {
    const f = fakeFetch([
      ['https://images-api.nasa.gov/search', { collection: { items: [{ href: 'http://images-assets.nasa.gov/video/Moon 1/collection.json', data: [{ title: 'Go to the Moon', nasa_id: 'Moon 1', center: 'HQ' }], links: [{ href: 'http://images-assets.nasa.gov/video/Moon 1/Moon 1~thumb.jpg', rel: 'preview', render: 'image' }] }], links: [{ rel: 'next' }] } }],
      ['https://images-assets.nasa.gov/video/Moon%201/collection.json', ['http://images-assets.nasa.gov/video/Moon 1/Moon 1~orig.mp4', 'http://images-assets.nasa.gov/video/Moon 1/Moon 1~mobile.mp4', 'http://images-assets.nasa.gov/video/Moon 1/Moon 1~preview.mp4']],
    ]);
    const p = await searchNasa('video', 'moon', 1, f);
    expect(f.calls[0]).toContain('media_type=video');
    expect(p.next).toBe(2);
    const it = p.items[0]!;
    expect(it).toMatchObject({ key: 'nasa:Moon 1', thumb: 'https://images-assets.nasa.gov/video/Moon%201/Moon%201~thumb.jpg', manifest: 'https://images-assets.nasa.gov/video/Moon%201/collection.json' });
    expect(it.credit.license).toMatch(/NASA/);
    const full = await resolveNasa(it, f);
    expect(full.url).toBe('https://images-assets.nasa.gov/video/Moon%201/Moon%201~mobile.mp4');
    expect(full.preview).toBe('https://images-assets.nasa.gov/video/Moon%201/Moon%201~preview.mp4');
  });

  it('picks files by kind', () => {
    expect(pickNasaFiles('photo', ['a~orig.jpg', 'a~large.jpg', 'a~thumb.jpg']).url).toBe('a~large.jpg');
    expect(pickNasaFiles('audio', ['a.wav', 'a~128k.mp3']).url).toBe('a~128k.mp3');
    expect(fixUrl('http://x/a b.jpg')).toBe('https://x/a%20b.jpg');
  });
});

describe('combined feed', () => {
  const item = (key: string): Item => ({ key, kind: 'photo', source: 'openverse', title: key, thumb: '', credit: { title: key, license: 'CC0', source: 's' } });
  const src = (id: Source['id'], pages: string[][], fail = false): Source => ({
    id, label: id, first: 0,
    page: async (_q, c) => {
      if (fail) throw new Error(`${id} down`);
      const i = c as number;
      return { items: (pages[i] ?? []).map(item), next: i + 1 < pages.length ? i + 1 : null };
    },
  });

  it('interleaves sources round-robin', () => {
    expect(interleave([[1, 2, 3], [4], [5, 6]])).toEqual([1, 4, 5, 2, 6, 3]);
  });

  it('merges pages, drops duplicates, stops when every source is done', async () => {
    const feed = createFeed([src('openverse', [['a1', 'a2'], ['a3']]), src('commons', [['b1', 'a1']])], 'q');
    expect((await feed.next()).map((i) => i.key)).toEqual(['a1', 'b1', 'a2']);
    expect(feed.done).toBe(false);
    expect((await feed.next()).map((i) => i.key)).toEqual(['a3']);
    expect(feed.done).toBe(true);
  });

  it('keeps going when one source fails, fails when all do', async () => {
    const feed = createFeed([src('openverse', [['a1']]), src('commons', [], true)], 'q');
    expect((await feed.next()).map((i) => i.key)).toEqual(['a1']);
    expect(feed.failed).toEqual(['commons']);
    await expect(createFeed([src('commons', [], true)], 'q').next()).rejects.toThrow('commons down');
  });

  it('chooses sources per kind', () => {
    expect(sourcesFor('photo').map((s) => s.id)).toEqual(['openverse', 'commons']);
    expect(sourcesFor('photo', { only: 'nasa' }).map((s) => s.id)).toEqual(['nasa']);
    expect(sourcesFor('video').map((s) => s.id)).toEqual(['commons', 'nasa']);
    expect(sourcesFor('audio', { audio: 'music' }).map((s) => s.id)).toEqual(['openverse', 'commons']);
    expect(sourcesFor('sticker').map((s) => s.id)).toEqual(['iconify']);
    expect(sourcesFor('illustration').map((s) => s.id)).toEqual(['doodles', 'openverse']);
  });
});

describe('http', () => {
  it('caches JSON answers', async () => {
    const f = fakeFetch([['https://a/', { ok: 1 }]]);
    expect(await getJson('https://a/x', f)).toEqual({ ok: 1 });
    expect(await getJson('https://a/x', f)).toEqual({ ok: 1 });
    expect(f.calls).toHaveLength(1);
  });

  function streamed(chunks: number[], length?: number): Fetch {
    return (async () => new Response(new ReadableStream({
      start(c) { for (const n of chunks) c.enqueue(new Uint8Array(n)); c.close(); },
    }), { headers: { 'content-type': 'video/webm', ...(length ? { 'content-length': String(length) } : {}) } })) as Fetch;
  }

  it('downloads with progress', async () => {
    const seen: number[] = [];
    const got = await download('https://v', { fetch: streamed([10, 30], 40), onProgress: (p) => seen.push(p) });
    expect(got.bytes.length).toBe(40);
    expect(got.mime).toBe('video/webm');
    expect(seen).toEqual([0, 0.25, 1, 1]);
  });

  it('refuses files over the limit (from the header or while streaming)', async () => {
    await expect(download('https://v', { fetch: streamed([10], 5000), maxBytes: 100 })).rejects.toBeInstanceOf(TooLargeError);
    await expect(download('https://v', { fetch: streamed([60, 60]), maxBytes: 100 })).rejects.toBeInstanceOf(TooLargeError);
  });

  it('strips HTML from credits', () => {
    expect(stripHtml('<a href="x">Ana &amp; Bo</a>&nbsp;')).toBe('Ana & Bo');
  });
});

describe('helpers', () => {
  it('guesses MIME types for media served generically', () => {
    expect(mimeFor('https://u/a.webm', 'video/webm', 'video')).toBe('video/webm');
    expect(mimeFor('https://u/a.mp4', 'application/octet-stream', 'video')).toBe('video/mp4');
    expect(mimeFor('https://u/a.ogg', 'application/ogg', 'audio')).toBe('audio/ogg');
    expect(mimeFor('https://jamendo/?trackid=1&format=mp32', '', 'audio')).toBe('audio/mpeg');
    expect(mimeFor('https://u/x.html', 'text/html', 'image')).toBe('text/html');
  });

  it('remembers recently used things, newest first, without duplicates', () => {
    remember('content', 'a', { n: 1 });
    remember('shape', 'rect', 'rect');
    remember('content', 'a', { n: 2 });
    expect(recent().map((r) => r.key)).toEqual(['content:a', 'shape:rect']);
    expect(recent(['content'])[0]!.data).toEqual({ n: 2 });
  });

  it('font combinations: plain sourced pairs, searchable, Fontsource ids', () => {
    expect(COMBOS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(COMBOS.map((c) => c.id)).size).toBe(COMBOS.length);
    for (const c of COMBOS) {
      expect(c.lines).toHaveLength(2);
      expect(c.lines[0]!.family).not.toBe(c.lines[1]!.family);
      expect(c.description).not.toBe('');
      // no invented decoration: no colours, no fixed copy, only the font names
      for (const l of c.lines) { expect(l.color).toBeUndefined(); expect(l.text).toBe(l.family); }
    }
    expect(findCombos('archivo black').map((c) => c.id)).toContain('brutalist');
    expect(findCombos('editorial').length).toBeGreaterThan(0);
    expect(fontId('Playfair Display')).toBe('playfair-display');
    expect(fontId('Press Start 2P')).toBe('press-start-2p');
  });
});

describe('open catalogues', () => {
  it('palettes, gradients and patterns are the real upstream data', async () => {
    const { GRADIENTS, PALETTES, loadPatterns, patternTile } = await import('../src/lib/apps.ts');
    expect(new Set(PALETTES.map((p) => p.catalog))).toEqual(new Set(['Open Color', 'Tailwind CSS']));
    expect(PALETTES.find((p) => p.id === 'open-color-red')!.colors.slice(0, 2)).toEqual(['#fff5f5', '#ffe3e3']);
    expect(PALETTES.find((p) => p.id === 'tailwind-rose')!.colors[0]).toBe('#fff1f2');
    for (const p of PALETTES) for (const c of p.colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(GRADIENTS.length).toBeGreaterThan(300);
    for (const g of GRADIENTS) for (const c of g.colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    const patterns = await loadPatterns();
    expect(patterns.length).toBeGreaterThan(80);
    expect(patterns.map((p) => p.id)).toContain('jigsaw');
    for (const p of patterns) { expect(p.width).toBeGreaterThan(0); expect(patternTile(p, '#123456')).toContain('#123456'); expect(p.svg).not.toContain('<script'); }
  });

  it('avatars offer only styles under an open licence', async () => {
    const { AVATAR_STYLES } = await import('../src/lib/apps.ts');
    expect(AVATAR_STYLES.length).toBeGreaterThanOrEqual(8);
    for (const s of AVATAR_STYLES) expect(s.licence).toMatch(/^(CC0|CC BY 4\.0|MIT)/);
  });

  it('Open Doodles list and search', async () => {
    const { searchDoodles } = await import('../src/lib/content/doodles.ts');
    const f = (async () => new Response(JSON.stringify([{ id: 'coffee', title: 'Coffee', width: 1024, height: 768 }, { id: 'reading', title: 'Reading', width: 1024, height: 768 }]))) as typeof fetch;
    const all = await searchDoodles('', 0, f);
    expect(all.items.map((i) => i.title)).toEqual(['Coffee', 'Reading']);
    expect(all.items[0]).toMatchObject({ kind: 'illustration', source: 'doodles', url: '/illustrations/open-doodles/coffee.svg', credit: { creator: 'Pablo Stanley', license: 'CC0' } });
    expect((await searchDoodles('read', 0, f)).items).toHaveLength(1);
  });
});
