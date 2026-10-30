/**
 * list_mockups / render_mockup on the synthetic fixture library
 * (e2e/fixtures/mockups, made by tools/mockups/fixtures.ts), from disk and
 * over HTTP with the disk cache.
 */
import { createServer as httpServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { engine } from '../src/engine.ts';
import { decodeRgba, listMockups, resetMockups } from '../src/mockups.ts';
import { FIXTURES, harness, type Harness } from './helpers.ts';

const LIB = fileURLToPath(new URL('mockups/', FIXTURES));
let h: Harness;
let id = '';

const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

async function pixels(b64: string) {
  const { ck } = await engine();
  const img = decodeRgba(ck, new Uint8Array(Buffer.from(b64, 'base64')), 'result');
  return { ...img, at: (x: number, y: number) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)) };
}

beforeAll(async () => {
  process.env.DC_MOCKUPS_DIR = LIB;
  resetMockups();
  h = await harness();
  const r = await h.call('create_design', { title: 'Mock me', width: 1000, height: 1000 });
  id = r.json.id;
  const bg = await h.call('set_page', { design_id: id, page: 1, background: '#e01010' });
  expect(bg.isError, bg.text).toBe(false);
});

afterAll(async () => {
  delete process.env.DC_MOCKUPS_DIR;
  resetMockups();
  await h.close();
});

describe('mockup tools', () => {
  it('list_mockups lists the library with categories and aspects', async () => {
    const tools = (await h.client.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(['list_mockups', 'render_mockup']));
    const r = await h.call('list_mockups');
    expect(r.isError, r.text).toBe(false);
    expect(r.json.mockups.map((m: { id: string }) => m.id)).toEqual(['fx-poster', 'fx-mug', 'fx-billboard']);
    const mug = r.json.mockups.find((m: { id: string }) => m.id === 'fx-mug');
    expect(mug).toMatchObject({ label: 'Mug', category: 'Home', colors: ['#ffffff', '#1f3a93', '#c0392b', '#111111'] });
    expect(mug.aspect).toBeCloseTo(1.273, 2);
    const outdoor = await h.call('list_mockups', { category: 'outdoor' });
    expect(outdoor.json.mockups.map((m: { id: string }) => m.id)).toEqual(['fx-billboard']);
    const guide = await h.client.readResource({ uri: 'dcanvas://guide' });
    expect(String((guide.contents[0] as { text: string }).text)).toContain('render_mockup');
  });

  it('render_mockup puts the page in the print area only', async () => {
    const r = await h.call('render_mockup', { design_id: id, mockup_id: 'fx-poster' });
    expect(r.isError, r.text).toBe(false);
    expect(r.images).toHaveLength(1);
    expect(r.images[0]!.mimeType).toBe('image/png');
    const bytes = new Uint8Array(Buffer.from(r.images[0]!.data, 'base64'));
    expect(isPng(bytes)).toBe(true);
    const info = JSON.parse(r.raw.content[1].text);
    expect(info).toMatchObject({ page: 1, mockup: 'fx-poster', imagePx: [800, 1000], credit: 'Synthetic test mockup (CC0)' });
    const p = await pixels(r.images[0]!.data);
    expect([p.width, p.height]).toEqual([800, 1000]);
    const [r0, g0, b0] = p.at(400, 500); // middle of the print area
    expect(r0).toBeGreaterThan(180); expect(g0).toBeLessThan(50); expect(b0).toBeLessThan(50);
    const [wr, wg] = p.at(40, 40); // wall
    expect(Math.abs(wr! - wg!)).toBeLessThan(25);
  });

  it('a product colour recolours the mug body, not the print', async () => {
    const white = await pixels((await h.call('render_mockup', { design_id: id, mockup_id: 'fx-mug', color: '#ffffff' })).images[0]!.data);
    const blue = await h.call('render_mockup', { design_id: id, mockup_id: 'fx-mug', color: '#1f3a93' });
    expect(JSON.parse(blue.raw.content[1].text).color).toBe('#1f3a93');
    const b = await pixels(blue.images[0]!.data);
    // the body below the print band (y 600) is tinted; the print (centre) stays red
    const [wr, , wb] = white.at(470, 615), [br, , bb] = b.at(470, 615);
    expect(wr! - br!).toBeGreaterThan(60);
    expect(bb!).toBeGreaterThan(br! + 40);
    expect(wb!).toBeGreaterThan(150);
    expect(b.at(470, 400)[0]!).toBeGreaterThan(150);
    expect(b.at(470, 400)[2]!).toBeLessThan(60);
  });

  it('jpg, small sizes, saving and errors', async () => {
    const j = await h.call('render_mockup', { design_id: id, mockup_id: 'fx-billboard', format: 'jpg', size: 400, save: true });
    expect(j.isError, j.text).toBe(false);
    expect(j.images[0]!.mimeType).toBe('image/jpeg');
    const info = JSON.parse(j.raw.content[1].text);
    expect(info.imagePx).toEqual([400, 267]);
    expect(info.saved.name).toBe('Mock me - Billboard.jpg');
    expect(existsSync(info.saved.path)).toBe(true);
    const bad = await h.call('render_mockup', { design_id: id, mockup_id: 'nope' });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('list_mockups');
    const badColor = await h.call('render_mockup', { design_id: id, mockup_id: 'fx-mug', color: 'blue' });
    expect(badColor.isError).toBe(true);
  });

  it('without a local library the files come over HTTP and are cached on disk', async () => {
    let hits = 0;
    const web: Server = httpServer((req, res) => {
      hits++;
      const path = join(LIB, decodeURIComponent((req.url ?? '').replace(/^\/mockups\//, '')));
      if (!path.startsWith(LIB) || !existsSync(path)) { res.writeHead(404).end(); return; }
      res.writeHead(200).end(readFileSync(path));
    });
    await new Promise<void>((r) => web.listen(0, '127.0.0.1', r));
    const env = { ...process.env };
    try {
      process.env.DC_MOCKUPS_DIR = '';
      process.env.DC_MOCKUPS_URL = `http://127.0.0.1:${(web.address() as { port: number }).port}/mockups/`;
      process.env.DC_MOCKUPS_CACHE = mkdtempSync(join(tmpdir(), 'dc-mockup-cache-'));
      resetMockups();
      expect((await listMockups()).length).toBe(3);
      const r = await h.call('render_mockup', { design_id: id, mockup_id: 'fx-poster', size: 300 });
      expect(r.isError, r.text).toBe(false);
      const first = hits;
      expect(first).toBe(5); // index + base, uv-hi, uv-lo, shade
      resetMockups();
      await h.call('render_mockup', { design_id: id, mockup_id: 'fx-poster', size: 300 });
      expect(hits).toBe(first); // from the disk cache
      expect(existsSync(join(process.env.DC_MOCKUPS_CACHE, 'fx-poster', 'uv-hi.png'))).toBe(true);
    } finally {
      process.env.DC_MOCKUPS_DIR = env.DC_MOCKUPS_DIR;
      delete process.env.DC_MOCKUPS_URL;
      delete process.env.DC_MOCKUPS_CACHE;
      resetMockups();
      web.close();
    }
  });
});
