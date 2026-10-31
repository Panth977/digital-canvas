/** The animation depth over MCP: the tools take it, the guide lists it, exports hold it. */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ANIMATIONS, TRANSITIONS } from '@digital-canvas/scene';
import { ffmpeg } from '../src/node/index.ts';
import { GUIDE } from '../src/guide.ts';
import { clipWebm, harness, isPng, type Harness } from './helpers.ts';

vi.setConfig({ testTimeout: 30_000 });
let h: Harness;
beforeAll(async () => { h = await harness(); });
const make = async () => (await h.call('create_design', { title: 'Motion', preset: 'instagram-post' })).json.id as string;

describe('MCP animations', () => {
  it('list_animations has every set and transition; the guide names them', async () => {
    const r = await h.call('list_animations', {});
    expect(r.json.sets.map((s: { set: string }) => s.set)).toEqual(['Basic', 'Exaggerate', 'Photo motion', 'Text', 'Writing', 'Ambient']);
    expect(r.json.transitions).toHaveLength(TRANSITIONS.length);
    for (const a of ANIMATIONS) expect(GUIDE, a.type).toContain(a.type);
    for (const t of TRANSITIONS) expect(GUIDE, t.type).toContain(t.type);
  });

  it('elements and pages take the new options; render_page shows the moment', async () => {
    const id = await make();
    const add = await h.call('add_elements', { design_id: id, elements: [
      { type: 'text', text: 'Hello motion', fontSize: 90, animation: { type: 'burst', by: 'letter', order: 'random', phase: 'both', intensity: 0.8, duration: 1 } },
      { type: 'shape', shape: 'rect', w: 200, h: 200, animation: { type: 'custom', duration: 2, path: { points: [[0, 0, 0], [300, -100, 0.5], [600, 0, 1]], style: 'bounce', rotation: 'follow', fade: true } } },
      { type: 'shape', shape: 'ellipse', w: 100, h: 100, animation: { type: 'wiggle' } },
    ] });
    expect(add.isError, add.text).toBe(false);
    const open = await h.call('open_design', { design_id: id });
    expect(open.text).toContain('burst');
    const shot = await h.call('render_page', { design_id: id, at: 0.3 });
    expect(isPng(shot.images[0]!.data)).toBe(true);
    const pg = await h.call('set_page', { design_id: id, page: 1, duration: 3, animation: { type: 'pop', by: 'page' }, transition: null });
    expect(pg.isError, pg.text).toBe(false);
  });

  it('a transition of the new set goes on a page', async () => {
    const id = await make();
    await h.call('add_page', { design_id: id });
    const r = await h.call('set_page', { design_id: id, page: 2, duration: 2, transition: { type: 'colorwipe', direction: 'left', color: '#ff0066', duration: 1.2 } });
    expect(r.isError, r.text).toBe(false);
    expect((await h.call('open_design', { design_id: id })).text).toContain('colorwipe');
    expect((await h.call('set_page', { design_id: id, page: 2, transition: { type: 'nope' } })).isError).toBe(true);
    expect((await h.call('add_elements', { design_id: id, elements: [{ type: 'text', text: 'x', animation: { type: 'nope' } }] })).isError).toBe(true);
  });

  it('find_replace lists, then replaces across pages', async () => {
    const id = await make();
    await h.call('add_page', { design_id: id });
    await h.call('add_elements', { design_id: id, page: 1, elements: [{ type: 'text', text: 'Old name here' }] });
    await h.call('add_elements', { design_id: id, page: 2, elements: [{ type: 'text', text: 'old Name again' }] });
    const f = await h.call('find_replace', { design_id: id, find: 'old name' });
    expect(f.json.count).toBe(2);
    expect(f.json.matches[1].page).toBe(2);
    expect((await h.call('find_replace', { design_id: id, find: 'Old name', match_case: true })).json.count).toBe(1);
    const r = await h.call('find_replace', { design_id: id, find: 'old name', replace: 'New' });
    expect(r.json.replaced).toBe(2);
    expect((await h.call('find_replace', { design_id: id, find: 'New' })).json.count).toBe(2);
  });

  it.skipIf(!ffmpeg())('clip speed: 2× is half as long, picture and sound; 0.25× four times as long', async () => {
    const vid = (await h.ws.putAsset(clipWebm(), 'video/webm', 'clip.webm')).id;
    const { probe } = await import('../src/media.ts');
    const info = await probe(clipWebm());
    const len = info.duration ?? 2;
    for (const speed of [2, 0.5]) {
      const r = await h.call('assemble_video', { title: `Speed ${speed}`, clips: [{ asset: vid, speed }] });
      expect(r.isError, r.text).toBe(false);
      const pages = (await h.call('open_design', { design_id: r.json.id })).json.pages;
      expect(pages[0].duration).toBeCloseTo(len / speed, 0);
      const e = await h.call('export_video', { design_id: r.json.id, max_side: 320, fps: 12 });
      const done = e.json.state === 'done' ? e.json : (await h.call('get_export', { job_id: e.json.job_id, wait_seconds: 60 })).json;
      expect(done.state, JSON.stringify(done)).toBe('done');
      const out = await probe(new Uint8Array(readFileSync(done.path)));
      expect(out.duration).toBeCloseTo(len / speed, 0);
    }
  }, 120_000);

});
