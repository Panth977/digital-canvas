/**
 * Join `.dcanvas` files page after page (assets and fonts are merged; the first file names the design).
 *
 *   npx tsx tools/merge-dcanvas.ts <out.dcanvas> <a.dcanvas> <b.dcanvas> …
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pack, unpack } from '@digital-canvas/storage';

const [out, ...files] = process.argv.slice(2);
if (!out || !files.length) throw new Error('usage: tsx tools/merge-dcanvas.ts <out> <in>…');
const parts = files.map((f) => unpack(new Uint8Array(readFileSync(f))));
const first = parts[0]!;
const assets = new Map<string, Uint8Array>();
const doc = { ...first.doc, pages: [] as typeof first.doc.pages, assets: {} as typeof first.doc.assets, fonts: [] as NonNullable<typeof first.doc.fonts> };
parts.forEach((p, i) => {
  // asset ids from separate imports may clash (crop-1…): prefix them per part
  const rename = (id: string) => (id.startsWith('crop-') ? `p${i + 1}-${id}` : id);
  for (const [id, b] of p.assets) assets.set(rename(id), b);
  for (const [id, m] of Object.entries(p.doc.assets)) doc.assets[rename(id)] = m;
  for (const f of p.doc.fonts ?? []) if (!doc.fonts.some((x) => x.asset === f.asset)) doc.fonts.push(f);
  doc.pages.push(...p.doc.pages.map((pg) => ({ ...pg, elements: pg.elements.map((e) => ('asset' in e ? { ...e, asset: rename(e.asset) } : e)) })));
});
writeFileSync(out, pack({ doc, assets }));
console.log(`wrote ${out}: ${doc.pages.length} pages, ${assets.size} assets`);
