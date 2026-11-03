import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { harness, type Harness } from './helpers.ts';

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
});
