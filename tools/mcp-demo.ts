/**
 * End-to-end demo of the Digital Canvas MCP server, driven exactly like an
 * agent would: the official MCP client SDK talks to `@digital-canvas/mcp`
 * over stdio (local folder store, no Google account). It makes a poster from
 * local sample assets, looks at it, runs check_design, fixes what it finds and
 * exports a PNG.
 *
 *   npx tsx tools/mcp-demo.ts [outDir=/tmp/orch27-rw]
 *
 * Writes <outDir>/mcp-demo-1-draft.png, -2-labels.png, -3-fixed.png, -export.png.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { samplePng } from '../packages/mcp/test/helpers.ts';

const out = process.argv[2] ?? '/tmp/orch27-rw';
mkdirSync(out, { recursive: true });
const root = fileURLToPath(new URL('..', import.meta.url));
const store = mkdtempSync(join(tmpdir(), 'dc-mcp-demo-'));

// local "assets": a photo-like picture and the e2e video clip, served over http
const files: Record<string, [string, Uint8Array]> = {
  '/hero.png': ['image/png', await samplePng(1600, 2000, '#7c2d12', '#1c1917')],
  '/clip.webm': ['video/webm', new Uint8Array(readFileSync(join(root, 'e2e/fixtures/clip.webm')))],
};
const web = createServer((req, res) => {
  const f = files[req.url ?? ''];
  if (!f) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': f[0] }).end(Buffer.from(f[1]));
});
await new Promise<void>((r) => web.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(web.address() as { port: number }).port}`;

const client = new Client({ name: 'mcp-demo', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: join(root, 'node_modules/.bin/tsx'),
  args: [join(root, 'packages/mcp/src/main.ts'), '--store', 'folder', store],
  stderr: 'inherit',
}));

type Content = { type: string; text?: string; data?: string; mimeType?: string };
async function call(name: string, args: Record<string, unknown> = {}): Promise<{ json: any; images: Content[] }> {
  const r = (await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 })) as { content: Content[]; isError?: boolean };
  const text = r.content.find((c) => c.type === 'text')?.text ?? '';
  if (r.isError) throw new Error(`${name}: ${text}`);
  console.log(`→ ${name}`, text.length > 220 ? `${text.slice(0, 220)}…` : text);
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* plain */ }
  return { json, images: r.content.filter((c) => c.type === 'image') };
}
const save = (name: string, img: Content) => { const p = join(out, name); writeFileSync(p, Buffer.from(img.data!, 'base64')); console.log(`  saved ${p}`); };

const { tools } = await client.listTools();
console.log(`${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`);

// 1. gather assets
const hero = (await call('import_from_url', { url: `${base}/hero.png`, name: 'Hero photo (sample)' })).json;
await call('list_assets');

// 2. a poster from a size preset with the photo as background
const design = (await call('create_design', { title: 'Night Market poster', preset: 'instagram-portrait' })).json;
const id = design.id as string;
await call('set_page', { design_id: id, page: 1, background_media: { asset: hero.id, focus: { x: 0.6, y: 0.4 } } });

// a first draft with deliberate mistakes an agent might make
const draft = (await call('add_elements', {
  design_id: id,
  elements: [
    { type: 'text', name: 'Kicker', text: 'FRIDAY 7 PM · OLD TOWN SQUARE', x: 80, y: 90, w: 920, fontSize: 30, bold: true, letterSpacing: 4, color: '#3f2a1d' },
    { type: 'text', name: 'Headline', text: 'NIGHT MARKET', x: 80, y: 760, w: 600, fontSize: 150, bold: true, color: '#ffffff', lineHeight: 0.95 },
    { type: 'text', name: 'Body', text: 'Street food, live music and 60 local makers under the lights.', x: 80, y: 1080, w: 700, fontSize: 18, color: '#d6d3d1' },
    { type: 'shape', name: 'Button', shape: 'rect', x: 80, y: 1200, w: 380, h: 84, radius: 42, fill: '#f59e0b' },
    { type: 'text', name: 'CTA', text: 'Free entry', x: 80, y: 1222, w: 380, fontSize: 34, bold: true, color: '#ffffff', align: 'center' },
    { type: 'icon', icon: 'ph:moon-stars-fill', x: 880, y: 1150, w: 140, h: 140, color: '#fbbf24' },
  ],
})).json;
const idOf = (name: string) => draft.added.find((e: { name?: string }) => e.name === name)?.id as string;

// 3. look at it
save('mcp-demo-1-draft.png', (await call('render_page', { design_id: id })).images[0]!);
save('mcp-demo-2-labels.png', (await call('render_page', { design_id: id, show_ids: true })).images[0]!);

// 4. critique
const check = (await call('check_design', { design_id: id })).json;
console.log('\ncheck_design:', check.summary);
for (const i of check.issues) console.log(`  [${i.severity}] ${i.code} ${i.element ?? ''}: ${i.message}\n     fix: ${i.fix}`);

// 5. fix what it found (as an agent would, from the issue list)
const updates: Record<string, Record<string, unknown>> = {};
const upd = (eid: string, patch: Record<string, unknown>) => { updates[eid] = { ...updates[eid], id: eid, ...patch }; };
for (const i of check.issues) {
  if (!i.element) continue;
  if (i.code === 'low_contrast') upd(i.element, { color: '#ffffff', effect: { type: 'shadow', offset: 10, blur: 40, transparency: 40, color: '#000000' } });
  if (i.code === 'tiny_text') upd(i.element, { fontSize: 34 });
  if (i.code === 'text_overflow') upd(i.element, { h: undefined });
  if (i.code === 'word_broken') upd(i.element, { w: 920 });
}
// a darker bottom gradient for legibility, and the headline on one line per word
await call('add_elements', { design_id: id, position: 'bottom', elements: [{ type: 'shape', name: 'Shade', shape: 'rect', x: 0, y: 600, w: 1080, h: 750, fill: { colors: ['#00000000', '#000000cc'], angle: 180 } }] });
await call('arrange_elements', { design_id: id, ids: [(await call('open_design', { design_id: id })).json.pages[0].elements.find((e: { name?: string }) => e.name === 'Shade').id], how: 'forward' });
upd(idOf('Headline'), { w: 920 });
if (Object.keys(updates).length) await call('update_elements', { design_id: id, updates: Object.values(updates) });
// keep the body below the (now wider) headline
const now = (await call('open_design', { design_id: id })).json.pages[0].elements;
const head = now.find((e: { name?: string }) => e.name === 'Headline');
const body = now.find((e: { name?: string }) => e.name === 'Body');
await call('update_elements', { design_id: id, updates: [{ id: body.id, y: Math.round(head.box[1] + head.box[3] + 30) }] });
await call('update_elements', { design_id: id, updates: [{ id: idOf('Button'), y: Math.round(head.box[1] + head.box[3] + 30 + body.box[3] + 50) }, { id: idOf('CTA'), y: Math.round(head.box[1] + head.box[3] + 30 + body.box[3] + 50 + 20) }] });

const after = (await call('check_design', { design_id: id })).json;
console.log('\nafter fixes:', after.summary);
for (const i of after.issues) console.log(`  [${i.severity}] ${i.code} ${i.element ?? ''}: ${i.message}`);
save('mcp-demo-3-fixed.png', (await call('render_page', { design_id: id })).images[0]!);

// 6. export
const exp = (await call('export_image', { design_id: id, format: 'png' })).json;
copyFileSync(exp.files[0].path, join(out, 'mcp-demo-export.png'));
console.log(`  saved ${join(out, 'mcp-demo-export.png')}`);
console.log(`\nDone. Designs in ${store}`);

await client.close();
web.close();
