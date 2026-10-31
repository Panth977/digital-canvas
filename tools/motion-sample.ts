/**
 * A short reel of the animation set through the MCP tools and the real
 * exporter: nothing here draws frames by itself.
 *
 *   DC_OFFLINE=1 npx tsx tools/motion-sample.ts out.mp4
 */
import { copyFileSync, readFileSync } from 'node:fs';
import { harness } from '../packages/mcp/test/helpers.ts';

const out = process.argv[2] ?? 'r16-animations.mp4';
const h = await harness();
const photo = (await h.ws.putAsset(new Uint8Array(readFileSync(new URL('../apps/web/public/mockups/a-board/base.jpg', import.meta.url))), 'image/jpeg', 'Unsplash mockup photo.jpg')).id;
const id = (await h.call('create_design', { title: 'Animations', width: 1280, height: 720 })).json.id as string;

const label = (t: string, y: number) => ({ type: 'text', text: t, x: 60, y, w: 1160, fontFamily: 'Inter', fontSize: 30, color: '#7b8194', align: 'center' });
const big = (t: string, y: number, animation: unknown, color = '#14161c') => ({ type: 'text', text: t, x: 60, y, w: 1160, fontFamily: 'Anton', fontSize: 110, color, align: 'center', animation });
const box = (x: number, animation: unknown, color: string) => ({ type: 'shape', shape: 'rect', x, y: 300, w: 200, h: 200, fill: color, animation });

const PAGES: { bg: string; els: unknown[]; duration: number; transition?: unknown }[] = [
  { bg: '#fff7e6', duration: 3, els: [label('Text by letter: Burst · Bounce', 60), big('Burst of letters', 130, { type: 'burst', by: 'letter', duration: 1.4 }), big('Bounce by letter', 380, { type: 'bounce', by: 'letter', duration: 1.4 }, '#c2185b')] },
  { bg: '#10131c', duration: 3, transition: { type: 'circle', duration: 0.8 }, els: [label('Neon · Ascend by line', 60), big('Neon flicker', 130, { type: 'neon', by: 'letter', duration: 1.6 }, '#35f0ff'), big('Ascend\nby line', 340, { type: 'ascend', by: 'line', duration: 1.4 }, '#ffffff')] },
  { bg: '#e8f4ff', duration: 3.5, transition: { type: 'chop', duration: 0.8, direction: 'left' }, els: [label('Animate.css and magic.css: Bounce in · Flip · Puff · Jack · Hinge out', 60), box(70, { type: 'bounceIn', duration: 1.2 }, '#ff5252'), box(310, { type: 'flipX', duration: 1.2 }, '#7c4dff'), box(550, { type: 'puff', duration: 1.2 }, '#00bfa5'), box(790, { type: 'jack', duration: 1.2 }, '#ffab00'), box(1030, { type: 'hinge', duration: 1.6 }, '#2979ff')] },
  { bg: '#f4f0ff', duration: 3.5, transition: { type: 'colorwipe', duration: 1, color: '#7d2ae8', direction: 'left' }, els: [label('Ambient loops: Pulse · Wiggle · Flicker · Rotate · Float', 60), box(70, { type: 'pulse' }, '#ff5252'), box(310, { type: 'wiggle' }, '#7c4dff'), box(550, { type: 'flicker' }, '#00bfa5'), box(790, { type: 'rotate' }, '#ffab00'), box(1030, { type: 'float', duration: 1.5 }, '#2979ff')] },
  { bg: '#ffffff', duration: 3.5, transition: { type: 'line', duration: 0.8, direction: 'right' }, els: [label('Create an animation: a hand-drawn path, turning with it', 60), { type: 'shape', shape: 'arrow', x: 100, y: 330, w: 180, h: 120, fill: '#ff5252', animation: { type: 'custom', duration: 3, path: { points: [[0, 0, 0], [220, -150, 0.25], [470, 90, 0.5], [710, -130, 0.75], [920, 0, 1]], style: 'smooth', rotation: 'follow' } } }] },
];

let n = 0;
for (const p of PAGES) {
  if (n++) await h.call('add_page', { design_id: id });
  await h.call('set_page', { design_id: id, page: n, background: p.bg, duration: p.duration, ...(p.transition ? { transition: p.transition } : {}) });
  const r = await h.call('add_elements', { design_id: id, page: n, elements: p.els });
  if (r.isError) throw new Error(r.text);
}
await h.call('add_page', { design_id: id });
n++;
await h.call('set_page', { design_id: id, page: n, background: '#000000', duration: 4, transition: { type: 'dissolve', duration: 0.6 } });
const r = await h.call('add_elements', { design_id: id, page: n, elements: [{ type: 'image', asset: photo, x: 0, y: 0, w: 1280, h: 720, animation: { type: 'kenBurns' } }, { ...label('Photo motion: Ken Burns', 650), color: '#ffffff' }] });
if (r.isError) throw new Error(r.text);

const e = await h.call('export_video', { design_id: id, max_side: 1280, fps: 30 });
if (e.isError) throw new Error(e.text);
let done = e.json;
while (done.state !== 'done') {
  done = (await h.call('get_export', { job_id: done.job_id, wait_seconds: 60 })).json;
  if (done.state === 'failed') throw new Error(JSON.stringify(done));
}
copyFileSync(done.path, out);
console.log(out);
process.exit(0);
