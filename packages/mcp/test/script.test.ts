import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { harness, type Harness } from './helpers.ts';

let h: Harness;
beforeAll(async () => { h = await harness(); });
afterAll(async () => { await h.close(); });

describe('run_script', () => {
  it('runs many tool calls, saves once, returns only the result', async () => {
    const d = await h.call('create_design', { preset: 'instagram-post', title: 'script' });
    const id = d.json.id;
    let saves = 0;
    const orig = h.ws.store.save.bind(h.ws.store);
    h.ws.store.save = async (f: any) => { saves++; return orig(f); };
    const r = await h.call('run_script', { code: `
      const ids = [];
      for (let i = 0; i < 40; i++) {
        const a = await dc.add_elements({ design_id: ${JSON.stringify(id)}, elements: [{ type: 'shape', shape: 'rect', x: i * 20, y: 10, w: 15, h: 15, fill: '#ff0000' }] });
        ids.push(a.added[0].id);
      }
      await dc.update_elements({ design_id: ${JSON.stringify(id)}, updates: ids.map((id) => ({ id, fill: '#00ff00' })) });
      console.log('made', ids.length);
      dc.show(await dc.render_page({ design_id: ${JSON.stringify(id)}, page: 1 }));
      return { n: ids.length };
    ` });
    h.ws.store.save = orig;
    expect(r.isError, r.text).toBe(false);
    expect(r.json.ok).toBe(true);
    expect(r.json.result).toEqual({ n: 40 });
    expect(r.json.logs).toBe('made 40');
    expect(r.json.calls).toBe(42);
    expect(r.images.length).toBe(1);
    expect(saves).toBe(1);
    const doc = (await h.ws.store.open(id)).doc;
    expect(doc.pages[0]!.elements.length).toBe(40);
    expect((doc.pages[0]!.elements[5] as any).fill.color).toBe('#00ff00');
  });

  it('saves nothing when the script throws, and says where', async () => {
    const d = await h.call('create_design', { preset: 'instagram-post', title: 'script2' });
    const id = d.json.id;
    const r = await h.call('run_script', { code: `
      await dc.add_elements({ design_id: ${JSON.stringify(id)}, elements: [{ type: 'text', text: 'hi' }] });
      await dc.update_elements({ design_id: ${JSON.stringify(id)}, updates: [{ id: 'nope', x: 1 }] });
    ` });
    expect(r.isError).toBe(true);
    expect(r.json.error).toMatch(/no element "nope"/);
    expect(r.json.not_saved).toEqual([id]);
    const doc = (await h.ws.store.open(id)).doc;
    expect(doc.pages[0]!.elements.length).toBe(0);
  });

  it('is a sandbox: no host globals, time limit holds', async () => {
    const r = await h.call('run_script', { code: `return [typeof fetch, typeof require, typeof process, typeof setTimeout];` });
    expect(r.json.result).toEqual(['undefined', 'undefined', 'undefined', 'undefined']);
    const loop = await h.call('run_script', { code: `while (true) {}`, timeout_s: 5 });
    expect(loop.isError).toBe(true);
    expect(loop.json.error).toMatch(/interrupted|time is up/i);
  }, 30_000);

  it('checks arguments against the tool schema', async () => {
    const r = await h.call('run_script', { code: `try { await dc.add_elements({}); } catch (e) { return e.message; }` });
    expect(r.json.result).toMatch(/add_elements: design_id/);
  });
});
