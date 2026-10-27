import { afterEach, describe, expect, it, vi } from 'vitest';
import { BRAND_FORMAT, DriveStore, MemoryStore, assetId, brandColors, emptyBrand, isBrandStore, normalizeHex, parseBrand, type BrandKit } from '../src/index.ts';

/** A tiny in-memory Google Drive v3, enough for DriveStore. */
function fakeDrive() {
  const files = new Map<string, { id: string; name: string; mimeType: string; parents: string[]; appProperties: Record<string, string>; trashed: boolean; modifiedTime: string; body?: Uint8Array }>();
  let n = 0;
  const calls: string[] = [];
  const matches = (f: { parents: string[]; trashed: boolean; mimeType: string; appProperties: Record<string, string> }, q: string) => {
    if (/trashed=false/.test(q) && f.trashed) return false;
    const parent = /'([^']+)' in parents/.exec(q)?.[1];
    if (parent && !f.parents.includes(parent)) return false;
    const mime = /mimeType='([^']+)'/.exec(q)?.[1];
    if (mime && f.mimeType !== mime) return false;
    for (const m of q.matchAll(/key='([^']+)' and value='([^']*)'/g)) if (f.appProperties[m[1]!] !== m[2]) return false;
    return true;
  };
  async function parseMultipart(req: Request) {
    const ct = req.headers.get('content-type')!;
    const boundary = /boundary=(\S+)/.exec(ct)![1]!;
    const buf = new Uint8Array(await req.arrayBuffer());
    const text = new TextDecoder('latin1').decode(buf);
    const parts = text.split(`--${boundary}`);
    const latin = parts[1]!.split('\r\n\r\n')[1]!.trim();
    const meta = JSON.parse(new TextDecoder().decode(Uint8Array.from(latin, (c) => c.charCodeAt(0))));
    const start = text.indexOf('\r\n\r\n', text.indexOf(parts[2]!.slice(0, 30), text.indexOf(parts[1]!) + parts[1]!.length)) + 4;
    const end = text.lastIndexOf(`\r\n--${boundary}--`);
    return { meta, body: buf.slice(start, end) };
  }
  const handler = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    calls.push(`${req.method} ${url.pathname}`);
    if (req.headers.get('authorization') !== 'Bearer t0k') return new Response('{}', { status: 401 });
    const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
    const id = /\/files\/([^/?]+)/.exec(url.pathname)?.[1];
    if (url.pathname === '/drive/v3/files' && req.method === 'GET') {
      const q = url.searchParams.get('q')!;
      return json({ files: [...files.values()].filter((f) => matches(f, q)).map(({ body, ...f }) => f) });
    }
    if (url.pathname === '/drive/v3/files' && req.method === 'POST') {
      const meta = await req.json();
      const f = { id: `f${++n}`, parents: [], appProperties: {}, trashed: false, modifiedTime: new Date().toISOString(), ...meta };
      files.set(f.id, f);
      return json({ id: f.id });
    }
    if (url.pathname.startsWith('/upload/drive/v3/files')) {
      const { meta, body } = await parseMultipart(req);
      if (id) {
        const f = files.get(id)!;
        Object.assign(f, meta, { body, modifiedTime: new Date(Date.now() + 1000).toISOString() });
        return json({ id });
      }
      const f = { id: `f${++n}`, parents: [], appProperties: {}, trashed: false, modifiedTime: new Date().toISOString(), ...meta, body };
      files.set(f.id, f);
      return json({ id: f.id });
    }
    if (id && url.searchParams.get('alt') === 'media') return new Response(files.get(id)!.body as BodyInit);
    if (id && req.method === 'PATCH') {
      Object.assign(files.get(id)!, await req.json());
      return json({ id });
    }
    return new Response('{"error":{"message":"not faked"}}', { status: 404 });
  };
  return { files, calls, handler };
}

afterEach(() => vi.unstubAllGlobals());

function sampleKit(logoAsset: string): BrandKit {
  return {
    ...emptyBrand('Vardayini'),
    palettes: [{ id: 'p1', name: 'Primary', colors: ['#1d3c78', '#f4e9d8', '#e0a526'] }, { id: 'p2', name: 'Accents', colors: ['#e0a526', '#c0392b'] }],
    fonts: {
      heading: { fontFamily: 'Playfair Display', fontSize: 72, bold: true, italic: false, uppercase: false, letterSpacing: 0 },
      subheading: { fontFamily: 'Montserrat', fontSize: 36, bold: true, italic: false, uppercase: true, letterSpacing: 2, color: '#1d3c78' },
      body: null,
    },
    logos: [{ id: 'l1', asset: logoAsset, mime: 'image/png', name: 'logo.png', width: 4, height: 4 }],
    updatedAt: '2026-10-27T10:00:00.000Z',
  };
}

describe('brand kit format', () => {
  it('parses leniently and normalises colours', () => {
    const kit = parseBrand({
      format: BRAND_FORMAT, name: 'X',
      palettes: [{ name: 'P', colors: ['#ABC', 'ff0000', 'nope', '#11223344'] }, 'junk'],
      fonts: { heading: { fontFamily: 'Inter', fontSize: 'big' }, body: { fontFamily: '' } },
      logos: [{ asset: 'a.png', mime: 'image/png' }, { asset: 3 }],
    });
    expect(kit.palettes).toHaveLength(1);
    expect(kit.palettes[0]!.colors).toEqual(['#aabbcc', '#ff0000', '#112233']);
    expect(kit.fonts.heading).toMatchObject({ fontFamily: 'Inter', fontSize: 32, bold: false });
    expect(kit.fonts.body).toBeNull();
    expect(kit.logos).toHaveLength(1);
    expect(parseBrand(null)).toEqual(emptyBrand());
    expect(() => parseBrand({ format: 'something-else' })).toThrow();
    expect(normalizeHex(' #FfF ')).toBe('#ffffff');
    expect(brandColors(sampleKit('a.png'))).toEqual(['#1d3c78', '#f4e9d8', '#e0a526', '#c0392b']);
  });
});

describe('brand storage', () => {
  it('memory store round-trips and drops unused logos', async () => {
    const store = new MemoryStore();
    expect(isBrandStore(store)).toBe(true);
    expect(await store.loadBrand()).toBeNull();
    const kit = sampleKit('logo.png');
    await store.saveBrand({ kit, assets: new Map([['logo.png', new Uint8Array([1])], ['old.png', new Uint8Array([2])]]) });
    const back = (await store.loadBrand())!;
    expect(back.kit).toEqual(kit);
    expect([...back.assets.keys()]).toEqual(['logo.png']);
  });

  it('Drive keeps brand.json in the app folder and logos in assets/', async () => {
    const drive = fakeDrive();
    vi.stubGlobal('fetch', drive.handler);
    const logo = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const id = await assetId(logo, 'image/png');
    const store = new DriveStore(async () => 't0k');
    expect(await store.loadBrand()).toBeNull();
    const kit = sampleKit(id);
    await store.saveBrand({ kit, assets: new Map([[id, logo]]) });
    await store.saveBrand({ kit: { ...kit, name: 'Vardayini 2' }, assets: new Map([[id, logo]]) });

    const files = [...drive.files.values()];
    const root = files.find((f) => f.name === 'Digital Canvas')!;
    const brand = files.filter((f) => f.name === 'brand.json');
    expect(brand).toHaveLength(1); // updated in place
    expect(brand[0]!.parents).toEqual([root.id]);
    const assetsDir = files.find((f) => f.name === 'assets')!;
    const logos = files.filter((f) => f.name === id);
    expect(logos).toHaveLength(1); // uploaded once
    expect(logos[0]!.parents).toEqual([assetsDir.id]);

    // brand.json is not a design
    expect(await store.list()).toEqual([]);

    // another device reads it back, logo included
    const other = await new DriveStore(async () => 't0k').loadBrand();
    expect(other!.kit.name).toBe('Vardayini 2');
    expect(other!.kit.palettes).toEqual(kit.palettes);
    expect(other!.kit.fonts.subheading?.uppercase).toBe(true);
    expect([...other!.assets.get(id)!]).toEqual([...logo]);
  });
});
