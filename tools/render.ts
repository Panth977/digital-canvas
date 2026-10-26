/**
 * Render a page of a `.dcanvas` file to PNG with the same CanvasKit renderer the editor uses.
 *
 *   npx tsx tools/render.ts <file.dcanvas> <out.png> [page=1] [scale=1]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { FontLibrary, Renderer } from '@digital-canvas/render';
import { unpack } from '@digital-canvas/storage';

const [file, out, pageArg = '1', scaleArg = '1'] = process.argv.slice(2);
if (!file || !out) {
  console.error('usage: tsx tools/render.ts <file.dcanvas> <out.png> [page] [scale]');
  process.exit(1);
}
const require = createRequire(import.meta.url);
const ck = await require('canvaskit-wasm/bin/canvaskit.js')();
const fonts = new FontLibrary(ck);
await fonts.loadBundled(new URL('../apps/web/public/fonts/', import.meta.url).href, async (u) => readFileSync(new URL(u)).buffer as ArrayBuffer);
const r = new Renderer(ck, fonts);
const { doc, assets } = unpack(new Uint8Array(readFileSync(file)));
for (const [id, bytes] of assets) r.setImage(id, bytes);
const page = doc.pages[Number(pageArg) - 1]!;
writeFileSync(out, r.exportPage(doc, page, { scale: Number(scaleArg) }));
console.log(`rendered page ${pageArg} → ${out}`);
