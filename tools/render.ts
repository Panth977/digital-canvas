/**
 * Render a `.dcanvas` file with the same CanvasKit renderer the editor uses.
 *
 *   npx tsx tools/render.ts <file.dcanvas> <out.png> [page=1] [scale=1]
 *   npx tsx tools/render.ts <file.dcanvas> <out.pdf> [dpi=300]          (every page)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { FontLibrary, Renderer, exportPdf } from '@digital-canvas/render';
import { unpack } from '@digital-canvas/storage';

const [file, out, pageArg = '1', scaleArg = '1'] = process.argv.slice(2);
if (!file || !out) {
  console.error('usage: tsx tools/render.ts <file.dcanvas> <out.png> [page] [scale]');
  process.exit(1);
}
const require = createRequire(import.meta.url);
const ck = await require('canvaskit-wasm/bin/full/canvaskit.js')();
const fonts = new FontLibrary(ck);
await fonts.loadBundled(new URL('../apps/web/public/fonts/', import.meta.url).href, async (u) => readFileSync(new URL(u)).buffer as ArrayBuffer);
const r = new Renderer(ck, fonts);
const { doc, assets } = unpack(new Uint8Array(readFileSync(file)));
for (const f of doc.fonts ?? []) { const b = assets.get(f.asset); if (b) fonts.add(f.family, b); }
for (const [id, bytes] of assets) if (doc.assets[id]?.mime.startsWith('image/')) r.setImage(id, bytes);
if (out.endsWith('.pdf')) {
  const dpi = Number(process.argv[4] ?? 300);
  writeFileSync(out, await exportPdf(r, doc, { dpi }));
  console.log(`rendered ${doc.pages.length} page(s) at ${dpi} dpi → ${out}`);
} else {
  const page = doc.pages[Number(pageArg) - 1]!;
  writeFileSync(out, r.exportPage(doc, page, { scale: Number(scaleArg) }));
  console.log(`rendered page ${pageArg} → ${out}`);
}
