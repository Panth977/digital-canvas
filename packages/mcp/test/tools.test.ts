/**
 * Every tool against a local folder workspace (no network: fonts are offline,
 * Iconify and downloads are served locally or stubbed).
 */
import { createServer as httpServer, type Server } from 'node:http';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { emptyBrand } from '@digital-canvas/storage';
import { ffmpeg } from '../src/media.ts';
import { chunkTranscript } from '../src/tools/video.ts';
import { clipWebm, harness, isPng, samplePng, toneMp3, type Harness } from './helpers.ts';

let h: Harness;
let png: Uint8Array;
let photo: string;
let web: Server;
let base = '';
const hasFfmpeg = !!ffmpeg();

const ICON_JSON = { prefix: 'mdi', icons: { star: { body: '<path fill="currentColor" d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2L9.19 8.63L2 9.24l5.46 4.73L5.82 21z"/>' } }, width: 24, height: 24 };

beforeAll(async () => {
  h = await harness();
  png = await samplePng();
  photo = (await h.ws.putAsset(png, 'image/png', 'Night sky.png')).id;
  const files: Record<string, [string, Uint8Array]> = { '/photo.png': ['image/png', png], '/clip.webm': ['video/webm', clipWebm()], '/tone.mp3': ['audio/mpeg', toneMp3()] };
  web = httpServer((req, res) => {
    const f = files[req.url ?? ''];
    if (!f) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': f[0], 'content-length': f[1].length }).end(Buffer.from(f[1]));
  });
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(web.address() as { port: number }).port}`;
  // Iconify answers from a stub; everything else goes to the real fetch (only localhost is used)
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://api.iconify.design/search')) return new Response(JSON.stringify({ icons: ['mdi:star', 'mdi:heart'] }), { headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://api.iconify.design/')) return new Response(JSON.stringify({ ...ICON_JSON, icons: { ...ICON_JSON.icons, heart: ICON_JSON.icons.star } }), { headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://')) return new Response('offline in tests', { status: 503 });
    return real(input as never, init);
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await h.close();
  web.close();
});

const make = async (args: Record<string, unknown> = {}) => {
  const r = await h.call('create_design', { title: 'Test', preset: 'instagram-post', ...args });
  expect(r.isError, r.text).toBe(false);
  return r.json.id as string;
};

describe('designs', () => {
  it('lists the tools, resources and prompts', async () => {
    const tools = (await h.client.listTools()).tools.map((t) => t.name);
    for (const n of ['list_designs', 'open_design', 'create_design', 'add_elements', 'render_page', 'check_design', 'apply_template', 'assemble_video', 'export_video', 'search_stock'])
      expect(tools).toContain(n);
    const res = (await h.client.listResources()).resources.map((r) => r.uri);
    expect(res).toContain('dcanvas://guide');
    expect(res).toContain('dcanvas://templates');
    const prompts = (await h.client.listPrompts()).prompts.map((p) => p.name);
    expect(prompts).toEqual(expect.arrayContaining(['make-poster', 'make-reel-from-folder', 'brand-social-pack']));
    const p = await h.client.getPrompt({ name: 'make-poster', arguments: { brief: 'Bake sale on Friday' } });
    expect(JSON.stringify(p.messages)).toContain('render_page');
    const guide = await h.client.readResource({ uri: 'dcanvas://guide' });
    expect(String((guide.contents[0] as { text: string }).text)).toContain('Typography');
  });

  it('create (preset, custom size, video preset), list, open, rename, duplicate, resize, delete, link', async () => {
    const id = await make({ title: 'Launch post' });
    const custom = await h.call('create_design', { title: 'Banner', width: 50, height: 20, unit: 'mm' });
    expect(custom.json.size).toMatch(/^189(\.\d+)?×75\.\d+ px/);
    const reel = await h.call('create_design', { title: 'Reel', preset: 'reel' });
    expect(reel.json.video).toBe(true);
    expect(reel.json.outline.size).toEqual([1080, 1920]);

    const bad = await h.call('create_design', { title: 'x', preset: 'nope-size-xyz' });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/How to fix: .*instagram-post/);

    const list = await h.call('list_designs', { query: 'launch' });
    expect(list.json.designs.map((d: { id: string }) => d.id)).toEqual([id]);
    expect((await h.call('open_design', { design_id: id })).json.pages[0].elements).toEqual([]);
    expect((await h.call('open_design', { design_id: 'missing' })).text).toMatch(/list_designs/);

    await h.call('rename_design', { design_id: id, title: 'Launch post v2' });
    expect((await h.call('open_design', { design_id: id })).json.title).toBe('Launch post v2');
    const copy = await h.call('duplicate_design', { design_id: id });
    expect(copy.json.id).not.toBe(id);
    const story = await h.call('resize_design', { design_id: id, preset: 'instagram-story' });
    expect(story.json.size).toBe('1080×1920');
    expect((await h.call('open_in_editor', { design_id: id })).json.url).toBe(`https://digital-canvas-p977.web.app/#/d/${id}`);
    expect((await h.call('list_size_presets', { query: 'youtube thumbnail' })).json[0].id).toBe('youtube-thumbnail');

    await h.call('delete_design', { design_id: copy.json.id });
    expect(existsSync(join(h.dir, '.trash'))).toBe(true);
    expect((await h.call('list_designs')).json.designs.some((d: { id: string }) => d.id === copy.json.id)).toBe(false);
  });
});

describe('editing', () => {
  it('adds every element type in one batch, with measured text and media boxes', async () => {
    const id = await make();
    const r = await h.call('add_elements', {
      design_id: id,
      elements: [
        { type: 'image', asset: photo, x: 0, y: 0, w: 1080, h: 1080, filter: { name: 'vivid' } },
        { type: 'shape', shape: 'circle', x: 40, y: 40, w: 100, h: 100, fill: { colors: ['#ff7e5f', '#feb47b'], angle: 45 } },
        { type: 'text', text: 'Hello world', fontSize: 80, color: '#ffffff', y: 400, effect: { type: 'shadow' }, animation: { type: 'rise' } },
        { type: 'line', x1: 100, y1: 900, x2: 980, y2: 900, color: '#ffffff', strokeWidth: 6, endMarker: 'arrow' },
        { type: 'icon', icon: 'mdi:star', x: 900, y: 40, w: 120, h: 120, color: '#ffd700' },
        { type: 'qr', text: 'https://example.org', x: 860, y: 860, w: 180 },
        { type: 'chart', chart: 'column', labels: ['A', 'B'], series: [{ name: 'S', values: [1, 2] }], x: 100, y: 500, w: 400, h: 300 },
        { type: 'table', rows: [['Item', 'Price'], ['Tea', '$2']], x: 600, y: 500, w: 400 },
        { type: 'group', children: [{ type: 'shape', shape: 'rect', x: 10, y: 1000, w: 50, h: 50, fill: 'red' }, { type: 'text', text: 'g', x: 70, y: 1000, fontSize: 30 }] },
        { type: 'text', text: 'oops', fontSize: 40, bogus: 1 },
      ],
    });
    expect(r.isError, r.text).toBe(false);
    const added = r.json.added;
    expect(added.map((e: { type: string }) => e.type)).toEqual(['image', 'shape', 'text', 'line', 'path', 'path', 'chart', 'table', 'group', 'text']);
    const t = added[2];
    expect(t.box[3]).toBeGreaterThan(80); // measured, not guessed
    expect(t.box[0]).toBeCloseTo((1080 - t.box[2]) / 2, 0); // hugged and centred
    expect(added[4].colors).toEqual(['#ffd700']);
    expect(added[5].qr).toBe('https://example.org');
    expect(r.json.warnings.join(' ')).toMatch(/"bogus"/);

    // contain-fit keeps the picture's shape
    const c = await h.call('add_elements', { design_id: id, elements: [{ type: 'image', asset: photo, fit: 'contain', x: 0, y: 0, w: 600, h: 600 }] });
    expect(c.json.added[0].box).toEqual([0, 100, 600, 400]);
    // wrong type for the file
    const wrong = await h.call('add_elements', { design_id: id, elements: [{ type: 'video', asset: photo }] });
    expect(wrong.isError).toBe(true);
    expect(wrong.text).toMatch(/use type "image"/);
    const missing = await h.call('add_elements', { design_id: id, elements: [{ type: 'image', asset: 'nope.png' }] });
    expect(missing.text).toMatch(/list_assets/);
  });

  it('updates (text refits, style, picture swap, null removes), deletes, arranges, aligns, groups', async () => {
    const id = await make();
    const a = await h.call('add_elements', { design_id: id, elements: [
      { type: 'text', text: 'Short', x: 100, y: 100, w: 400, fontSize: 60, animation: { type: 'fade' } },
      { type: 'shape', shape: 'rect', x: 0, y: 0, w: 200, h: 200, fill: '#ff0000' },
      { type: 'shape', shape: 'rect', x: 500, y: 500, w: 100, h: 100, fill: '#00ff00' },
      { type: 'shape', shape: 'rect', x: 900, y: 800, w: 100, h: 100, fill: '#0000ff' },
    ] });
    const [text, r1, r2, r3] = a.json.added.map((e: { id: string }) => e.id);
    const before = a.json.added[0].box[3];
    const u = await h.call('update_elements', { design_id: id, updates: [
      { id: text, text: 'A much longer line of text that has to wrap onto several lines', animation: null, color: '#123456' },
      { id: r1, fill: { colors: ['#000000', '#ffffff'] }, radius: 20 },
    ] });
    expect(u.isError, u.text).toBe(false);
    expect(u.json.updated[0].box[3]).toBeGreaterThan(before * 2);
    expect(u.json.updated[0].animation).toBeUndefined();
    expect(u.json.updated[0].color).toBe('#123456');
    expect(u.json.updated[1].fill).toMatch(/^linear/);
    expect((await h.call('update_elements', { design_id: id, updates: [{ id: 'zzz', x: 1 }] })).text).toMatch(/open_design/);

    const shrink = await h.call('update_elements', { design_id: id, updates: [{ id: text, h: 80, autoFit: 'shrink' }] });
    expect(shrink.json.updated[0].font).not.toMatch(/ 60$/);

    const ar = await h.call('arrange_elements', { design_id: id, ids: [r1], how: 'front' });
    expect(ar.json.order_bottom_to_top.at(-1)).toBe(r1);
    const al = await h.call('align_elements', { design_id: id, ids: [r2], align: 'center' });
    expect(al.json.aligned[0].box[0]).toBe(490);
    const dist = await h.call('align_elements', { design_id: id, ids: [r1, r2, r3], distribute: 'horizontal' });
    expect(dist.isError).toBe(false);
    const g = await h.call('group_elements', { design_id: id, ids: [r2, r3] });
    const moved = await h.call('update_elements', { design_id: id, updates: [{ id: g.json.group, x: 0 }] });
    expect(moved.json.updated[0].children[0].box[0]).toBe(0);
    const ug = await h.call('group_elements', { design_id: id, ids: [g.json.group], ungroup: true });
    expect(ug.json.children).toHaveLength(2);
    await h.call('delete_elements', { design_id: id, ids: [r1] });
    expect((await h.call('open_design', { design_id: id })).json.pages[0].elements.some((e: { id: string }) => e.id === r1)).toBe(false);
  });

  it('pages: add, duplicate, move, delete, settings, background media with overlay, transition', async () => {
    const id = await make({ pages: 2 });
    const add = await h.call('add_page', { design_id: id, after: 1, background: '#222222' });
    expect(add.json.page).toBe(2);
    const dup = await h.call('duplicate_page', { design_id: id, page: 2 });
    expect(dup.json.page).toBe(3);
    await h.call('move_page', { design_id: id, page: 3, to: 1 });
    const s = await h.call('set_page', { design_id: id, page: 1, background_media: { asset: photo, overlay: '#00000066' }, duration: 3, transition: { type: 'slide', direction: 'left' } });
    expect(s.isError, s.text).toBe(false);
    expect(s.json.page.elements.map((e: { name: string }) => e.name)).toEqual(['Background', 'Background tint']);
    expect(s.json.page.transition).toBe('slide-left');
    await h.call('delete_page', { design_id: id, page: 4 });
    const out = await h.call('open_design', { design_id: id });
    expect(out.json.pageCount).toBe(3);
    expect(out.json.video).toBe(true);
    const lone = await make();
    expect((await h.call('delete_page', { design_id: lone, page: 1 })).isError).toBe(true);
  });

  it('templates: list, outline resource, apply with replace_text (scaled to the design)', async () => {
    const list = await h.call('list_templates', { query: 'sale' });
    expect(list.json.templates[0].id).toBe('ig-sale-bold');
    const res = await h.client.readResource({ uri: 'dcanvas://template/ig-sale-bold' });
    const outline = JSON.parse(String((res.contents[0] as { text: string }).text));
    const sale = outline.pages[0].elements.find((e: { text?: string }) => e.text === 'SALE');
    const id = await make({ preset: 'instagram-portrait' });
    const r = await h.call('apply_template', { design_id: id, template_id: 'ig-sale-bold', replace_text: [{ match: sale.id, text: 'DEALS' }, { match: 'UP TO', text: '50% OFF' }, { match: 'not there', text: 'x' }] });
    expect(r.isError, r.text).toBe(false);
    const texts = r.json.pages[0].elements.filter((e: { type: string }) => e.type === 'text').map((e: { text: string }) => e.text);
    expect(texts).toContain('DEALS');
    expect(texts).toContain('50% OFF');
    expect(r.json.warnings.join()).toMatch(/not there/);
    expect(r.json.template_ids_to_new_ids[sale.id]).toMatch(/^e_/);
    const fromTpl = await h.call('create_design', { title: 'From template', template: 'yt-vlog' });
    expect(fromTpl.json.outline.size).toEqual([1280, 720]);
  });

  it('brand kit: read and apply (colours, fonts, logo)', async () => {
    expect((await h.call('get_brand_kit')).json.empty).toBe(true);
    const kit = emptyBrand('Acme');
    kit.palettes = [{ id: 'p', name: 'Main', colors: ['#0055ff', '#ff3366'] }];
    kit.fonts.heading = { fontFamily: 'Inter', fontSize: 80, bold: true, italic: false, uppercase: true, letterSpacing: 0 };
    kit.logos = [{ id: 'l', asset: photo, mime: 'image/png', name: 'Logo', width: 1200, height: 800 }];
    await h.ws.store.saveBrand({ kit, assets: new Map([[photo, png]]) });
    expect((await h.call('get_brand_kit')).json.palettes[0].colors).toEqual(['#0055ff', '#ff3366']);
    const id = await make();
    await h.call('add_elements', { design_id: id, elements: [{ type: 'shape', shape: 'rect', x: 0, y: 0, w: 1080, h: 500, fill: '#e53935' }, { type: 'text', text: 'Big news', fontSize: 120 }] });
    const r = await h.call('apply_brand', { design_id: id, logo: 'top-right' });
    expect(r.isError, r.text).toBe(false);
    expect(r.json.recolored['#e53935']).toBe('#0055ff');
    const out = await h.call('open_design', { design_id: id });
    const els = out.json.pages[0].elements;
    expect(els[0].fill).toBe('#0055ff');
    expect(els[1].font).toMatch(/uppercase/);
    expect(els.at(-1).name).toBe('Logo');
  });
});

describe('assets & content', () => {
  it('imports from a URL (probed), lists uploads, stock search + import, fonts offline, Drive needs Drive', async () => {
    const img = await h.call('import_from_url', { url: `${base}/photo.png`, name: 'From web' });
    expect(img.json).toMatchObject({ kind: 'image', width: 1200, height: 800 });
    const vid = await h.call('import_from_url', { url: `${base}/clip.webm` });
    expect(vid.json.kind).toBe('video');
    expect(vid.json.duration).toBeCloseTo(2, 0);
    const list = await h.call('list_assets', { kind: 'video' });
    expect(list.json.assets[0]).toMatchObject({ id: vid.json.id, kind: 'video', size: [320, 240] });
    expect((await h.call('import_from_url', { url: `${base}/missing.png` })).isError).toBe(true);

    const icons = await h.call('search_stock', { kind: 'icon', query: 'star' });
    expect(icons.json.results[0]).toMatchObject({ icon: 'mdi:star', kind: 'icon' });
    const imp = await h.call('import_stock', { result: { kind: 'photo', url: `${base}/photo.png`, credit: '"Sky" by Someone (CC BY 4.0)' } });
    expect(imp.json.name).toMatch(/CC BY/);
    expect((await h.call('import_stock', { result: { kind: 'icon' } })).text).toMatch(/type: "icon"/);

    const fonts = await h.call('search_fonts', { query: 'mont' });
    expect(fonts.json.fonts.some((f: { family: string }) => f.family === 'Montserrat')).toBe(true);
    expect((await h.call('search_drive', { query: 'x' })).text).toMatch(/local folder/);
  });
});

describe('seeing the result', () => {
  it('render_page returns a PNG (with numbered outlines), the grid shows every page', async () => {
    const id = await make({ pages: 3 });
    await h.call('add_elements', { design_id: id, elements: [{ type: 'text', text: 'Look', fontSize: 100 }] });
    const r = await h.call('render_page', { design_id: id, show_ids: true, size: 512 });
    expect(r.images).toHaveLength(1);
    expect(r.images[0]!.mimeType).toBe('image/png');
    expect(isPng(r.images[0]!.data)).toBe(true);
    const meta = JSON.parse(r.text);
    expect(meta.imagePx).toEqual([512, 512]);
    expect(Object.keys(meta.labels)).toEqual(['1']);
    const g = await h.call('render_thumbnail_grid', { design_id: id });
    expect(isPng(g.images[0]!.data)).toBe(true);
    expect(JSON.parse(g.text).pages).toBe(3);
    expect((await h.call('render_page', { design_id: id, page: 9 })).text).toMatch(/page number/);
  });

  it('check_design finds overflow, low contrast, off-page, overlap, tiny and placeholder text, covered elements', async () => {
    const id = await make();
    const a = await h.call('add_elements', { design_id: id, elements: [
      { type: 'shape', shape: 'rect', x: 0, y: 0, w: 1080, h: 1080, fill: '#f5f5f5' },
      { type: 'text', text: 'Pale on pale', x: 100, y: 100, w: 800, fontSize: 60, color: '#e0e0e0' },
      { type: 'text', text: 'Edge', x: 1000, y: 300, w: 300, fontSize: 60, color: '#111111' },
      { type: 'text', text: 'Lorem ipsum dolor', x: 100, y: 500, w: 800, fontSize: 40, color: '#111111' },
      { type: 'text', text: 'Overlap here', x: 120, y: 510, w: 800, fontSize: 40, color: '#111111' },
      { type: 'text', text: 'tiny', x: 100, y: 700, fontSize: 10, color: '#111111' },
      { type: 'text', text: 'One two three four five six seven eight nine ten', x: 100, y: 850, w: 300, h: 40, fontSize: 40, color: '#111111' },
      { type: 'shape', shape: 'rect', x: 400, y: 950, w: 50, h: 50, fill: '#ff0000' },
      { type: 'text', text: 'NIGHT MARKET', x: 600, y: 600, w: 300, fontSize: 90, color: '#111111' },
      { type: 'shape', shape: 'rect', x: 380, y: 930, w: 100, h: 100, fill: '#0000ff' },
    ] });
    const ids = a.json.added.map((e: { id: string }) => e.id);
    // the last text was given an explicit h: force it back small to simulate overflow
    await h.call('update_elements', { design_id: id, updates: [{ id: ids[6], h: 40 }] });
    const r = await h.call('check_design', { design_id: id });
    const codes = (code: string) => r.json.issues.filter((i: { code: string }) => i.code === code).map((i: { element: string }) => i.element);
    expect(codes('low_contrast')).toContain(ids[1]);
    expect(codes('off_page')).toContain(ids[2]);
    expect(codes('placeholder_text')).toContain(ids[3]);
    expect(codes('text_overlap')).toContain(ids[3]);
    expect(codes('tiny_text')).toContain(ids[5]);
    expect(codes('text_overflow')).toContain(ids[6]);
    expect(codes('hidden_behind')).toContain(ids[7]);
    expect(codes('word_broken')).toContain(ids[8]);
    for (const i of r.json.issues) expect(i.fix.length).toBeGreaterThan(5);
    // fixing it clears the finding
    await h.call('update_elements', { design_id: id, updates: [{ id: ids[1], color: '#111111' }] });
    const again = await h.call('check_design', { design_id: id });
    expect(again.json.issues.some((i: { code: string; element: string }) => i.code === 'low_contrast' && i.element === ids[1])).toBe(false);
    const clean = await make();
    await h.call('add_elements', { design_id: clean, elements: [{ type: 'text', text: 'Fine', fontSize: 80, color: '#111111', y: 400 }] });
    expect((await h.call('check_design', { design_id: clean })).json.issues).toEqual([]);
  });
});

describe('video', () => {
  it('splits a transcript into timed chunks', () => {
    const c = chunkTranscript('One two three four five six. Seven eight.', 0, 10, 3);
    expect(c.map((x) => x.text)).toEqual(['One two three', 'four five six.', 'Seven eight.']);
    expect(c[0]!.start).toBe(0);
    expect(c.at(-1)!.end).toBe(10);
  });

  it('assembles a reel (clip + photo, transition, music with fades, captions, cards), sound and captions tools', async () => {
    const vid = (await h.ws.putAsset(clipWebm(), 'video/webm', 'clip.webm')).id;
    const tone = (await h.ws.putAsset(toneMp3(), 'audio/mpeg', 'tone.mp3')).id;
    const r = await h.call('assemble_video', {
      title: 'Reel', clips: [{ asset: vid, trimEnd: 1.5, text: 'Day one' }, { asset: photo, duration: 2, animation: { type: 'fade' } }],
      transition: { type: 'dissolve', duration: 0.4 }, music: { asset: tone, fadeOut: 1 }, transcript: 'Hello there. This is a reel.',
      title_card: { text: 'Hi', duration: 1 },
    });
    expect(r.isError, r.text).toBe(false);
    expect(r.json.duration).toBeCloseTo(4.5, 1);
    expect(r.json.outline.size).toEqual([1080, 1920]);
    const pages = r.json.outline.pages;
    expect(pages[1].elements[0]).toMatchObject({ type: 'video', clip: [0, 1.5] });
    expect(pages[1].transition).toBe('dissolve');
    expect(r.json.outline.audio[0]).toMatchObject({ fadeOut: 1, start: 0 });
    const caps = pages.flatMap((p: { elements: { name?: string; timing?: number[] }[] }) => p.elements.filter((e) => e.name === 'Caption'));
    expect(caps.length).toBeGreaterThanOrEqual(2);
    for (const c of caps) expect(c.timing).toBeDefined();

    const id = r.json.id;
    const add = await h.call('set_audio', { design_id: id, action: 'add', asset: tone, start: 1, volume: 0.5, fadeIn: 0.5 });
    expect(add.json.added).toMatch(/^a_/);
    await h.call('set_audio', { design_id: id, action: 'update', id: add.json.added, volume: 0.3 });
    await h.call('set_audio', { design_id: id, action: 'remove', id: add.json.added });
    const cap = await h.call('add_captions', { design_id: id, captions: [{ start: 0.5, end: 2, text: 'Across pages' }], replace: true });
    expect(cap.json).toMatchObject({ captions: 1, elements: 2 });

    const at = await h.call('render_page', { design_id: id, page: 2, at: 0.6 });
    expect(isPng(at.images[0]!.data)).toBe(true);
  });

  it.skipIf(!hasFfmpeg)('exports a 2-second reel as MP4 (and polls the job)', async () => {
    const vid = (await h.ws.putAsset(clipWebm(), 'video/webm', 'clip.webm')).id;
    const tone = (await h.ws.putAsset(toneMp3(), 'audio/mpeg', 'tone.mp3')).id;
    const r = await h.call('assemble_video', { title: 'Two seconds', clips: [{ asset: vid, trimEnd: 1 }, { asset: photo, duration: 1 }], transition: { type: 'slide' }, music: { asset: tone }, transcript: 'Two seconds of fun.' });
    const e = await h.call('export_video', { design_id: r.json.id, max_side: 480, fps: 24 });
    expect(e.isError, e.text).toBe(false);
    const done = e.json.state === 'done' ? e.json : (await h.call('get_export', { job_id: e.json.job_id, wait_seconds: 60 })).json;
    expect(done.state).toBe('done');
    expect(done.mime).toBe('video/mp4');
    const bytes = readFileSync(done.path);
    expect(bytes.subarray(4, 8).toString()).toBe('ftyp');
    const { probe } = await import('../src/media.ts');
    const info = await probe(new Uint8Array(bytes));
    expect(info.width).toBe(270);
    expect(info.height).toBe(480);
    expect(info.duration).toBeGreaterThan(1.9);
    expect(info.duration).toBeLessThan(2.3);
    expect((await h.call('get_export', { job_id: 'nope', wait_seconds: 0 })).isError).toBe(true);
  }, 120_000);
});

describe('exports', () => {
  it('PNG/JPG per page, vector PDF, GIF — saved to Exports with links', async () => {
    const id = await make({ pages: 2, title: 'Exported' });
    await h.call('add_elements', { design_id: id, elements: [{ type: 'text', text: 'Export me', fontSize: 90, animation: { type: 'pop' } }] });
    const img = await h.call('export_image', { design_id: id, format: 'jpg', scale: 0.5 });
    expect(img.isError, img.text).toBe(false);
    expect(img.json.files.map((f: { name: string }) => f.name)).toEqual(['Exported - page 1.jpg', 'Exported - page 2.jpg']);
    expect(img.raw.content.some((c: { type: string }) => c.type === 'resource_link')).toBe(true);
    expect(img.images[0]!.mimeType).toBe('image/jpeg');
    const pdf = await h.call('export_pdf', { design_id: id });
    expect(readFileSync(pdf.json.path).subarray(0, 4).toString()).toBe('%PDF');
    const gif = await h.call('export_gif', { design_id: id, pages: [1], size: 200 });
    expect(gif.isError, gif.text).toBe(false);
    expect(gif.images[0]!.mimeType).toBe('image/gif');
    expect(readdirSync(join(h.dir, 'Exports')).filter((f) => f.startsWith('Exported')).sort()).toEqual(['Exported - page 1.jpg', 'Exported - page 2.jpg', 'Exported.gif', 'Exported.pdf']);
  });
});
