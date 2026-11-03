import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { harness, samplePng, type Harness } from './helpers.ts';

let h: Harness;
beforeAll(async () => { h = await harness(); });
afterAll(async () => { await h.close(); });

const CSS = '@keyframes swoop { 0% { transform: translate(0, 120%) rotate(-8deg); opacity: 0 } 100% { transform: none; opacity: 1 } }';

describe('plugins over MCP', () => {
  it('animation plugin: create from CSS, list, use by CSS name and apply_plugin', async () => {
    const c = await h.call('create_plugin', { kind: 'animation', name: 'Swoop', css: CSS, duration: 0.9 });
    expect(c.isError, c.text).toBe(false);
    const id = c.json.created.id;
    expect(c.json.created).toMatchObject({ kind: 'animation', name: 'Swoop', duration: 0.9, frames: 2 });
    const dup = await h.call('create_plugin', { kind: 'animation', name: 'swoop', css: CSS });
    expect(dup.isError).toBe(true);
    const l = await h.call('list_plugins', { kind: 'animation' });
    expect(l.json.plugins.map((p: any) => p.id)).toContain(id);
    const anims = await h.call('list_animations', {});
    expect(anims.json.mine[0].plugin).toBe(id);

    const d = await h.call('create_design', { preset: 'instagram-post', title: 'p' });
    const r = await h.call('set_page_html', { design_id: d.json.id, html: '<body><h1 style="animation: Swoop">Hi</h1></body>' });
    expect(r.json.warnings).toEqual([]);
    const t = (await h.ws.store.open(d.json.id)).doc.pages[0]!.elements[0] as any;
    expect(t.animation).toMatchObject({ type: 'keyframes', plugin: id, duration: 0.9 });
    // apply to the page
    await h.call('apply_plugin', { design_id: d.json.id, plugin: 'Swoop' });
    expect((await h.ws.store.open(d.json.id)).doc.pages[0]!.animation).toMatchObject({ type: 'keyframes', plugin: id });
    // add_elements by plugin name
    const a = await h.call('add_elements', { design_id: d.json.id, elements: [{ type: 'text', text: 'x', animation: { type: 'keyframes', plugin: 'swoop' } }] });
    expect(a.isError, a.text).toBe(false);
    const els = (await h.ws.store.open(d.json.id)).doc.pages[0]!.elements as any[];
    expect(els.at(-1).animation.keyframes.f.length).toBe(2);
  });

  it('effect preset plugin applies to an image; export → install round trip', async () => {
    const c = await h.call('create_plugin', { kind: 'effect', name: 'Warm fade', target: 'image', preset: { look: { adjust: { temperature: 30, fade: 20 } } } });
    expect(c.isError, c.text).toBe(false);
    const ex = await h.call('export_plugin', { plugin: 'Warm fade' });
    expect(ex.isError, ex.text).toBe(false);
    expect(ex.json.path).toMatch(/\.dcplugin$/);
    const bytes = new Uint8Array(readFileSync(ex.json.path));
    await h.call('delete_plugin', { plugin: 'Warm fade' });
    expect((await h.call('list_plugins', { kind: 'effect' })).json.plugins).toEqual([]);
    const up = await h.ws.putAsset(bytes, 'application/zip', 'warm.dcplugin');
    const inst = await h.call('install_plugin', { file: { asset: up.id } });
    expect(inst.isError, inst.text).toBe(false);
    expect(inst.json.installed.name).toBe('Warm fade');
  });

  it('bad input says what to fix', async () => {
    const r = await h.call('create_plugin', { kind: 'animation', name: 'Nope', css: 'h1 { color: red }' });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/@keyframes/);
    const m = await h.call('create_plugin', { kind: 'mockup', name: 'M', corners: [[0, 0], [1, 0], [1, 1]] as any });
    expect(m.isError).toBe(true);
  });

  it('shader effect: compiled before saving, applied, changes the render', async () => {
    const bad = await h.call('create_plugin', { kind: 'effect', name: 'Broken', shader: { sksl: 'half4 main(float2 p) { return nope; }' } });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/does not compile/);
    const sksl = 'uniform shader image; uniform float2 resolution; uniform float time; uniform float amount;\nhalf4 main(float2 p) { half4 c = image.eval(p); return half4(mix(c.rgb, c.a - c.rgb, amount), c.a); }';
    const c = await h.call('create_plugin', { kind: 'effect', name: 'Invert', target: 'any', shader: { sksl, params: [{ name: 'amount', min: 0, max: 1, default: 1 }] } });
    expect(c.isError, c.text).toBe(false);
    const d = await h.call('create_design', { preset: 'instagram-post', title: 's' });
    const a = await h.call('add_elements', { design_id: d.json.id, elements: [{ type: 'shape', shape: 'rect', x: 0, y: 0, w: 1080, h: 1080, fill: '#ffffff' }] });
    const before = await h.call('render_page', { design_id: d.json.id, page: 1 });
    const ap = await h.call('apply_plugin', { design_id: d.json.id, plugin: 'Invert', element_ids: [a.json.added[0].id] });
    expect(ap.isError, ap.text).toBe(false);
    const el = (await h.ws.store.open(d.json.id)).doc.pages[0]!.elements[0] as any;
    expect(el.shader).toMatchObject({ name: 'Invert', params: { amount: 1 } });
    const after = await h.call('render_page', { design_id: d.json.id, page: 1 });
    expect(after.images[0]!.data).not.toBe(before.images[0]!.data);
  });

  it('font plugin from a WOFF2: used by CSS font-family, embedded in the design', async () => {
    const bytes = new Uint8Array(readFileSync(new URL('../../render/test/fixtures/fonts/inter-sub.woff2', import.meta.url)));
    const up = await h.ws.putAsset(bytes, 'font/woff2', 'my.woff2');
    const c = await h.call('create_plugin', { kind: 'font', name: 'My Inter', family: 'My Inter', faces: [{ asset: up.id, weight: 400 }] });
    expect(c.isError, c.text).toBe(false);
    const d = await h.call('create_design', { preset: 'instagram-post', title: 'f' });
    const r = await h.call('set_page_html', { design_id: d.json.id, html: '<body style="font-family: \'My Inter\'"><p>Hello</p></body>' });
    expect(r.isError, r.text).toBe(false);
    expect(JSON.stringify(r.json.warnings)).not.toMatch(/not found/);
    const doc = (await h.ws.store.open(d.json.id)).doc;
    expect(doc.fonts?.some((f) => f.family === 'My Inter')).toBe(true);
  });

  it('mockup plugin from a photo with corners: listed and rendered', async () => {
    const photo = await samplePng(800, 600, '#777777', '#999999');
    const up = await h.ws.putAsset(photo, 'image/png', 'wall.png');
    const c = await h.call('create_plugin', { kind: 'mockup', name: 'My wall', category: 'Walls', photo: { asset: up.id }, corners: [[200, 100], [600, 120], [590, 500], [210, 480]], shade: 0.5 });
    expect(c.isError, c.text).toBe(false);
    const l = await h.call('list_mockups', {});
    const mine = l.json.mockups.find((m: any) => m.id === c.json.created.id);
    expect(mine.category).toMatch(/My mockups/);
    const d = await h.call('create_design', { preset: 'instagram-post', title: 'm' });
    await h.call('add_elements', { design_id: d.json.id, elements: [{ type: 'shape', shape: 'rect', x: 0, y: 0, w: 1080, h: 1080, fill: '#ff0000' }] });
    const r = await h.call('render_mockup', { design_id: d.json.id, mockup_id: c.json.created.id, size: 800 });
    expect(r.isError, r.text).toBe(false);
    expect(r.images.length).toBe(1);
  });
});
