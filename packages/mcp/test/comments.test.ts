/** Review comments over MCP: pin on element / point / video moment, reply, resolve, edit, delete; pins on render_page. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { harness, isPng, type Harness } from './helpers.ts';

vi.setConfig({ testTimeout: 30_000 });
let h: Harness;
beforeAll(async () => { h = await harness(); });

describe('MCP comments', () => {
  it('manager comments, editor replies and resolves, manager deletes', async () => {
    const id = (await h.call('create_design', { title: 'Review me', preset: 'instagram-post' })).json.id as string;
    const add = await h.call('add_elements', { design_id: id, elements: [{ type: 'text', text: 'Big sale', x: 100, y: 100, w: 400, h: 120, fontSize: 80 }] });
    expect(add.isError, add.text).toBe(false);
    const el = add.json.added[0].id as string;

    const a = await h.call('add_comment', { design_id: id, text: 'Make the headline bigger', element_id: el });
    expect(a.isError, a.text).toBe(false);
    expect(a.json.comment).toMatchObject({ n: 1, page: 1, element_id: el, resolved: false });
    expect(a.json.comment.element).toContain('Big sale');
    const b = await h.call('add_comment', { design_id: id, text: 'Logo here', page: 1, x: 900, y: 950 });
    expect(b.json.comment.point).toEqual([900, 950]);
    const whole = await h.call('add_comment', { design_id: id, text: 'Overall: warmer colours' });
    expect(whole.json.comment.on).toBe('whole design');
    expect(existsSync(join(h.dir, '.comments', `${id}.json`))).toBe(true);

    // the pin follows the element
    await h.call('update_elements', { design_id: id, updates: [{ id: el, x: 300 }] });
    let list = await h.call('list_comments', { design_id: id });
    expect(list.json.open).toBe(3);
    expect(list.json.comments.map((c: { text: string }) => c.text)).toEqual(['Overall: warmer colours', 'Make the headline bigger', 'Logo here']);
    expect(list.json.comments[1].point).toEqual([700, 100]);

    const cid = a.json.comment.id as string;
    expect((await h.call('reply_comment', { design_id: id, comment_id: cid, text: 'Now 120 px' })).isError).toBe(false);
    expect((await h.call('resolve_comment', { design_id: id, comment_id: cid, text: 'done' })).isError).toBe(false);
    list = await h.call('list_comments', { design_id: id });
    expect(list.json).toMatchObject({ open: 2, resolved: 1 });
    list = await h.call('list_comments', { design_id: id, include_resolved: true });
    const t = list.json.comments.find((c: { id: string }) => c.id === cid);
    expect(t.resolved).toBe(true);
    expect(t.replies.map((r: { text?: string; action?: string }) => [r.text, r.action])).toEqual([['Now 120 px', undefined], ['done', 'resolve']]);

    expect((await h.call('edit_comment', { design_id: id, comment_id: b.json.comment.id, text: 'Logo bottom-right' })).isError).toBe(false);
    expect((await h.call('delete_comment', { design_id: id, comment_id: whole.json.comment.id })).isError).toBe(false);
    list = await h.call('list_comments', { design_id: id, include_resolved: true });
    expect(list.json.comments.map((c: { text: string }) => c.text)).toEqual(['Make the headline bigger', 'Logo bottom-right']);

    const shot = await h.call('render_page', { design_id: id, show_comments: true });
    expect(isPng(shot.images[0]!.data)).toBe(true);
    expect(JSON.parse(shot.text).comments).toEqual([{ n: 2, id: b.json.comment.id, text: 'Logo bottom-right' }]);

    // comments never go into the design file
    const file = readFileSync(join(h.dir, 'Review me.dcanvas'));
    expect(file.includes(Buffer.from('Logo bottom-right'))).toBe(false);
  });

  it('video comments are time-coded; the page comes from the time', async () => {
    const id = (await h.call('create_design', { title: 'Reel', preset: 'instagram-reel' })).json.id as string;
    await h.call('set_page', { design_id: id, page: 1, duration: 4 });
    await h.call('add_page', { design_id: id });
    await h.call('set_page', { design_id: id, page: 2, duration: 3 });
    const c = await h.call('add_comment', { design_id: id, text: 'Cut this earlier', time: 5.5, time_end: 6.25 });
    expect(c.isError, c.text).toBe(false);
    expect(c.json.comment).toMatchObject({ page: 2, time: 5.5, time_end: 6.25, page_time: 1.5, at: '0:05.5–0:06.3' });
    const bad = await h.call('add_comment', { design_id: id, text: 'x', page: 1, time: 6 });
    expect(bad.isError).toBe(true);
    expect((await h.call('add_comment', { design_id: id, text: '' })).isError).toBe(true);
    expect((await h.call('add_comment', { design_id: id, text: 'x', element_id: 'nope' })).isError).toBe(true);
  });
});
