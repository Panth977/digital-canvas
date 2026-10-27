/**
 * Pixel-compare a `.dcanvas` render against reference PNGs (e.g. Canva's export of the same design).
 *
 *   npx tsx tools/diff.ts <file.dcanvas> <ref-dir with page1.png…> <out-dir> [pages=all]
 *
 * Renders each page at the reference's resolution and reports, per page:
 *   match  — % of pixels whose largest channel difference is ≤ 24 (visually the same)
 *   mae    — mean absolute difference per channel (0–255)
 * and writes <out-dir>/pageN.png: reference | ours | difference heat map.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { CanvasKit, Image } from 'canvaskit-wasm';
import { FontLibrary, Renderer } from '@digital-canvas/render';
import { unpack } from '@digital-canvas/storage';

const [file, refDir, outDir, pagesArg] = process.argv.slice(2);
if (!file || !refDir || !outDir) {
  console.error('usage: tsx tools/diff.ts <file.dcanvas> <ref-dir> <out-dir> [pages e.g. 1,3]');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const require = createRequire(import.meta.url);
const ck: CanvasKit = await require('canvaskit-wasm/bin/full/canvaskit.js')();
const fonts = new FontLibrary(ck);
await fonts.loadBundled(new URL('../apps/web/public/fonts/', import.meta.url).href, async (u) => readFileSync(new URL(u)).buffer as ArrayBuffer);
const r = new Renderer(ck, fonts);
const project = unpack(new Uint8Array(readFileSync(file)));
const { doc } = project;
// Fonts embedded in the file
for (const f of doc.fonts ?? []) {
  const bytes = project.assets.get(f.asset);
  if (bytes) fonts.add(f.family, bytes);
}
// Images are decoded per page (a big design's pictures don't all fit in WASM memory at once).
type El = (typeof doc.pages)[number]['elements'][number];
const imagesIn = (els: El[]): string[] => els.flatMap((e) => (e.type === 'image' ? [e.asset] : e.type === 'video' ? [`${e.asset}.poster`] : e.type === 'group' ? imagesIn(e.children) : []));
const pageImages = (n: number) => imagesIn(doc.pages[n - 1]!.elements);

const rgba = (img: Image) => img.readPixels(0, 0, { width: img.width(), height: img.height(), colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array;
const wanted = pagesArg ? pagesArg.split(',').map(Number) : doc.pages.map((_, i) => i + 1);
const rows: string[] = [];
let total = 0;
for (const n of wanted) {
  const refFile = join(refDir, `page${n}.png`);
  if (!existsSync(refFile)) continue;
  const ids = pageImages(n);
  for (const id of ids) { const b = project.assets.get(id); if (b) r.setImage(id, b); }
  const ref = ck.MakeImageFromEncoded(readFileSync(refFile))!;
  const W = ref.width(), H = ref.height();
  const ours = ck.MakeImageFromEncoded(r.exportPage(doc, doc.pages[n - 1]!, { scale: W / doc.width }))!;
  const a = rgba(ref), b = rgba(ours);
  const heat = new Uint8Array(W * H * 4);
  let same = 0, sum = 0;
  for (let i = 0; i < W * H; i++) {
    let m = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a[i * 4 + c]! - (b[i * 4 + c] ?? 0));
      sum += d;
      if (d > m) m = d;
    }
    if (m <= 24) same++;
    // heat map: grey copy of the reference, red where they differ
    const g = (a[i * 4]! + a[i * 4 + 1]! + a[i * 4 + 2]!) / 9;
    heat[i * 4] = m > 24 ? 255 : g; heat[i * 4 + 1] = m > 24 ? 40 : g; heat[i * 4 + 2] = m > 24 ? 40 : g; heat[i * 4 + 3] = 255;
  }
  const match = (100 * same) / (W * H), mae = sum / (W * H * 3);
  total += match;
  rows.push(`page ${n}: match ${match.toFixed(2)}%  mae ${mae.toFixed(2)}`);
  // reference | ours | heat, at 1/3 size
  const s = 1 / 3, w = Math.round(W * s), h = Math.round(H * s);
  const surface = ck.MakeSurface(w * 3, h)!;
  const c = surface.getCanvas();
  const heatImg = ck.MakeImage({ width: W, height: H, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }, heat, W * 4)!;
  [ref, ours, heatImg].forEach((img, k) => c.drawImageRectOptions(img, ck.XYWHRect(0, 0, W, H), ck.XYWHRect(k * w, 0, w, h), ck.FilterMode.Linear, ck.MipmapMode.None, new ck.Paint()));
  const snap = surface.makeImageSnapshot();
  writeFileSync(join(outDir, `page${n}.png`), snap.encodeToBytes()!);
  snap.delete();
  surface.delete();
  ref.delete(); ours.delete(); heatImg.delete();
  for (const id of ids) r.forgetImage(id);
}
rows.forEach((l) => console.log(l));
console.log(`average match ${(total / rows.length).toFixed(2)}%`);
