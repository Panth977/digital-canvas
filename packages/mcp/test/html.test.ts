import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { harness, samplePng, type Harness } from './helpers.ts';

let h: Harness;
beforeAll(async () => { h = await harness(); });
afterAll(async () => { await h.close(); });

const MENU = `<style>
body{background:#fff7e6;padding:40px;font-family:Inter;display:flex;flex-direction:column;gap:24px}
h1{font-size:72px;margin:0;color:#7a2e0e;text-align:center}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:20px}
.card{background:#ffffff;border-radius:16px;padding:20px;display:flex;flex-direction:column;gap:8px}
.row{display:flex;justify-content:space-between;font-size:28px}
.price{font-weight:700;color:#c2410c}
</style>
<body>
<h1>Menu</h1>
<div class="grid">
  <div class="card"><div class="row"><span>Lassi</span><span class="price">₹40</span></div><div class="row"><span>Chhas</span><span class="price">₹20</span></div></div>
  <div class="card"><div class="row"><span>Basundi</span><span class="price">₹120</span></div></div>
</div>
</body>`;

describe('set_page_html / get_page_html', () => {
  it('lays out flex + grid and keeps the source', async () => {
    const d = await h.call('create_design', { preset: 'instagram-post', title: 'menu' });
    const id = d.json.id;
    const r = await h.call('set_page_html', { design_id: id, html: MENU, outline: true });
    expect(r.isError, r.text).toBe(false);
    expect(r.json.warnings).toEqual([]);
    const doc = (await h.ws.store.open(id)).doc;
    const page = doc.pages[0]!;
    expect(page.layout?.html).toContain('data-k');
    expect(page.background).toEqual({ type: 'solid', color: '#fff7e6' });
    const flat: any[] = [];
    const walk = (els: any[]) => els.forEach((e) => { flat.push(e); if (e.children) walk(e.children); });
    walk(page.elements);
    const title = flat.find((e) => e.type === 'text' && e.text === 'Menu');
    expect(title.x).toBeCloseTo(40, 0);
    expect(title.w).toBeCloseTo(1000, 0);
    expect(title.style.align).toBe('center');
    const lassi = flat.find((e) => e.text === 'Lassi');
    const price = flat.find((e) => e.text === '₹40');
    expect(lassi.y).toBeCloseTo(price.y, 0);
    expect(price.x + price.w).toBeLessThanOrEqual(540 - 10 - 20 + 1); // right edge of card 1 content
    const basundi = flat.find((e) => e.text === 'Basundi');
    expect(basundi.x).toBeGreaterThan(540); // second column
    const cards = flat.filter((e) => e.type === 'shape');
    expect(cards.length).toBe(2);
    expect(cards[0].radius).toBe(16);

    // edit the CSS: everything reflows, ids stay
    const g = await h.call('get_page_html', { design_id: id });
    expect(g.text).toContain('layout source');
    const bigger = g.text.replace('.row{display:flex;justify-content:space-between;font-size:28px}', '.row{display:flex;justify-content:space-between;font-size:40px}');
    const r2 = await h.call('set_page_html', { design_id: id, html: bigger });
    expect(r2.isError, r2.text).toBe(false);
    const doc2 = (await h.ws.store.open(id)).doc;
    const flat2: any[] = [];
    const walk2 = (els: any[]) => els.forEach((e) => { flat2.push(e); if (e.children) walk2(e.children); });
    walk2(doc2.pages[0]!.elements);
    const lassi2 = flat2.find((e) => e.text === 'Lassi');
    expect(lassi2.id).toBe(lassi.id);
    expect(lassi2.style.fontSize).toBe(40);
    const chhas = flat.find((e) => e.text === 'Chhas'), chhas2 = flat2.find((e) => e.text === 'Chhas');
    expect(chhas2.y).toBeGreaterThan(chhas.y);
  });

  it('carries editor changes back into the source', async () => {
    const d = await h.call('create_design', { preset: 'instagram-post', title: 't' });
    const id = d.json.id;
    await h.call('set_page_html', { design_id: id, html: MENU });
    const doc = (await h.ws.store.open(id)).doc;
    const flat: any[] = [];
    const walk = (els: any[]) => els.forEach((e) => { flat.push(e); if (e.children) walk(e.children); });
    walk(doc.pages[0]!.elements);
    const basundi = flat.find((e) => e.text === 'Basundi');
    await h.call('update_elements', { design_id: id, updates: [{ id: basundi.id, text: 'Rabdi', color: '#ff0000' }] });
    const title = flat.find((e) => e.text === 'Menu');
    await h.call('update_elements', { design_id: id, updates: [{ id: title.id, y: title.y + 30 }] });
    const g = await h.call('get_page_html', { design_id: id });
    expect(g.text).toContain('Rabdi');
    expect(g.text).toMatch(/top:30px/);
    const r = await h.call('set_page_html', { design_id: id, html: g.text });
    expect(r.isError, r.text).toBe(false);
    const doc2 = (await h.ws.store.open(id)).doc;
    const flat2: any[] = [];
    const walk2 = (els: any[]) => els.forEach((e) => { flat2.push(e); if (e.children) walk2(e.children); });
    walk2(doc2.pages[0]!.elements);
    const rabdi = flat2.find((e) => e.text === 'Rabdi');
    expect(rabdi.id).toBe(basundi.id);
    expect(rabdi.style.color).toBe('#ff0000');
    expect(flat2.find((e) => e.text === 'Menu').y).toBeCloseTo(title.y + 30, 0);
  });

  it('round-trips a page that was not made from HTML', async () => {
    const d = await h.call('create_design', { preset: 'instagram-post', title: 't' });
    const id = d.json.id;
    const png = await samplePng(400, 300);
    const up = await h.ws.putAsset(png, 'image/png', 'p.png');
    await h.call('add_elements', { design_id: id, elements: [
      { type: 'shape', shape: 'rect', x: 100, y: 100, w: 300, h: 200, fill: '#123456', radius: 12 },
      { type: 'text', text: 'Hello world', x: 120, y: 120, w: 400, fontSize: 48, color: '#ffffff', fontFamily: 'Inter' },
      { type: 'image', asset: up.id, x: 500, y: 500, w: 400, h: 300, filter: { name: 'fresco', intensity: 60 } },
      { type: 'qr', text: 'https://example.com', x: 800, y: 50, w: 200 },
    ] });
    const before = (await h.ws.store.open(id)).doc.pages[0]!.elements;
    const g = await h.call('get_page_html', { design_id: id });
    expect(g.text).toContain('absolute');
    const r = await h.call('set_page_html', { design_id: id, html: g.text });
    expect(r.isError, r.text).toBe(false);
    const after = (await h.ws.store.open(id)).doc.pages[0]!.elements;
    expect(after.map((e) => e.id)).toEqual(before.map((e) => e.id));
    for (const [i, e] of after.entries()) {
      const b = before[i]!;
      expect(e.x).toBeCloseTo(b.x, 0); expect(e.y).toBeCloseTo(b.y, 0); expect(e.w).toBeCloseTo(b.w, 0);
      if (e.type !== 'text') expect(e.h).toBeCloseTo(b.h, 0);
    }
    expect((after[2] as any).filter?.name).toBe('fresco');
  });

  it('CSS animations: @keyframes, built-ins, delays, page transition, both ways', async () => {
    const d = await h.call('create_design', { preset: 'instagram-post', title: 'anim' });
    const id = d.json.id;
    const html = `<style>
@keyframes wobbleIn { 0% { transform: translate(-50%, 0) rotate(-10deg); opacity: 0 } 60% { transform: rotate(4deg) } 100% { transform: none; opacity: 1 } }
body { --dc-transition: slide 0.6s left; --dc-duration: 6s; padding: 40px }
h1 { animation: wobbleIn 1.2s 0.5s; margin: 0 }
.tag { animation: rise 0.8s; --dc-by: word; background: #222; color: #fff; padding: 10px }
</style><body><h1>Hello</h1><p class="tag">Fresh every day</p><img src="qr:x" style="width:100px;animation:pulse 1s infinite"></body>`;
    const r = await h.call('set_page_html', { design_id: id, html });
    expect(r.isError, r.text).toBe(false);
    expect(r.json.warnings).toEqual([]);
    const page = (await h.ws.store.open(id)).doc.pages[0]!;
    expect(page.transition).toEqual({ type: 'slide', duration: 0.6, direction: 'left' });
    expect(page.duration).toBe(6);
    const flat: any[] = [];
    const walk = (els: any[]) => els.forEach((e) => { flat.push(e); if (e.children) walk(e.children); });
    walk(page.elements);
    const h1 = flat.find((e) => e.text === 'Hello');
    expect(h1.animation.type).toBe('keyframes');
    expect(h1.animation.duration).toBe(1.2);
    expect(h1.animation.keyframes.f.length).toBe(3);
    expect(h1.timing).toEqual({ start: 0.5 });
    const tag = flat.find((e) => e.type === 'group' && e.children.some((c: any) => c.text === 'Fresh every day'));
    expect(tag.animation).toMatchObject({ type: 'rise', duration: 0.8, by: 'word' });
    // canvas → HTML → canvas keeps them
    const g = await h.call('get_page_html', { design_id: id });
    expect(g.text).toContain('wobbleIn');
    await h.call('update_elements', { design_id: id, updates: [{ id: h1.id, animation: { type: 'pop', duration: 0.4 } }] });
    const g2 = await h.call('get_page_html', { design_id: id });
    expect(g2.text).toMatch(/animation:\s*pop 0.4s/);
    const r2 = await h.call('set_page_html', { design_id: id, html: g2.text });
    expect(r2.isError, r2.text).toBe(false);
    const p2 = (await h.ws.store.open(id)).doc.pages[0]!;
    const flat2: any[] = [];
    const walk2 = (els: any[]) => els.forEach((e) => { flat2.push(e); if (e.children) walk2(e.children); });
    walk2(p2.elements);
    expect(flat2.find((e) => e.text === 'Hello').animation).toMatchObject({ type: 'pop', duration: 0.4 });
    expect(p2.transition?.type).toBe('slide');
  });

  it('absolute export carries keyframe animations and reads them back', async () => {
    const d = await h.call('create_design', { preset: 'instagram-post', title: 'abs-anim' });
    const id = d.json.id;
    await h.call('add_elements', { design_id: id, elements: [{ type: 'text', text: 'Hi', x: 100, y: 100, fontSize: 60, animation: { type: 'bounceIn', duration: 1 } }] });
    await h.call('set_page', { design_id: id, page: 1, transition: { type: 'dissolve', duration: 0.5 } }).catch(() => null);
    const before = (await h.ws.store.open(id)).doc.pages[0]!.elements[0] as any;
    const g = await h.call('get_page_html', { design_id: id });
    expect(g.text).toContain('animation:bounceIn 1s');
    await h.call('set_page_html', { design_id: id, html: g.text });
    const after = (await h.ws.store.open(id)).doc.pages[0]!.elements[0] as any;
    expect(after.id).toBe(before.id);
    expect(after.animation).toEqual(before.animation);
  });
});
