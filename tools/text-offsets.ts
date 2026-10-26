/**
 * Measure how far our text sits from Canva's, per font: for each text box, slide our rendering over
 * Canva's export and find the best (dx, dy). Prints the median offset per fontRef in em.
 *
 *   npx tsx tools/text-offsets.ts <file.dcanvas> <pages-dir> <ref-dir>
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { CanvasKit } from 'canvaskit-wasm';
import { FontLibrary, Renderer } from '@digital-canvas/render';
import { unpack } from '@digital-canvas/storage';

const [file, pagesDir, refDir] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const ck: CanvasKit = await require('canvaskit-wasm/bin/full/canvaskit.js')();
const fonts = new FontLibrary(ck);
await fonts.loadBundled(new URL('../apps/web/public/fonts/', import.meta.url).href, async (u) => readFileSync(new URL(u)).buffer as ArrayBuffer);
const { doc, assets } = unpack(new Uint8Array(readFileSync(file!)));
for (const f of doc.fonts ?? []) { const b = assets.get(f.asset); if (b) fonts.add(f.family, b); }
const r = new Renderer(ck, fonts);
const info = (w: number, h: number) => ({ width: w, height: h, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB });
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const byRef = new Map<string, { dx: number; dy: number }[]>();
doc.pages.forEach((page, pi) => {
  const refImg = ck.MakeImageFromEncoded(readFileSync(join(refDir!, `page${pi + 1}.png`)))!;
  const W0 = refImg.width(), H0 = refImg.height(), s = W0 / doc.width;
  const ref = refImg.readPixels(0, 0, info(W0, H0)) as Uint8Array;
  const canva = JSON.parse(readFileSync(join(pagesDir!, `page${pi + 1}.json`), 'utf8'));
  const refs: string[] = [];
  const walk = (els: any[]) => { for (const e of els) { if (e.children) walk(e.children); else if (e.type === 'text') refs.push(e.textRegions[0].formatting.fontRef.split(',')[0]); } };
  walk(canva.elements);
  const texts = page.elements.filter((e) => e.type === 'text');
  texts.forEach((t, k) => {
    if (t.type !== 'text' || t.rotation) return;
    const pad = t.style.fontSize * 0.6;
    const x0 = Math.round((t.x - pad) * s), y0 = Math.round((t.y - pad) * s), W = Math.round((t.w + 2 * pad) * s), H = Math.round((t.h + 2 * pad) * s);
    if (x0 < 0 || y0 < 0 || x0 + W > W0 || y0 + H > H0) return;
    const c = hex(t.style.color);
    const surf = ck.MakeSurface(W, H)!; const cv = surf.getCanvas(); cv.clear(ck.TRANSPARENT);
    cv.scale(s, s); cv.translate(pad - t.x, pad - t.y); r.drawElement(cv, t);
    const img = surf.makeImageSnapshot(); const ours = img.readPixels(0, 0, info(W, H)) as Uint8Array; img.delete(); surf.delete();
    const R = Math.round(t.style.fontSize * 0.4 * s);
    // ink pixels of our rendering, thinned to a few thousand
    const ink: number[] = [];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (ours[(j * W + i) * 4 + 3]! >= 128) ink.push(i, j);
    const step = Math.max(1, Math.round(ink.length / 2 / 3000));
    const pts: number[] = [];
    for (let k2 = 0; k2 < ink.length; k2 += 2 * step) pts.push(ink[k2]!, ink[k2 + 1]!);
    const score = (dx: number, dy: number) => {
      let hit = 0;
      for (let k2 = 0; k2 < pts.length; k2 += 2) {
        const X = x0 + pts[k2]! + dx, Y = y0 + pts[k2 + 1]! + dy;
        if (X < 0 || Y < 0 || X >= W0 || Y >= H0) continue;
        const q = (Y * W0 + X) * 4;
        if (Math.hypot(ref[q]! - c[0]!, ref[q + 1]! - c[1]!, ref[q + 2]! - c[2]!) < 60) hit++;
      }
      return pts.length ? hit / (pts.length / 2) : 0;
    };
    // coarse grid, then refine around the best
    let best = { dx: 0, dy: 0, sc: -1 };
    const coarse = Math.max(1, Math.round(R / 30));
    for (let dy = -R; dy <= R; dy += coarse) for (let dx = -R; dx <= R; dx += coarse) {
      const sc = score(dx, dy);
      if (sc > best.sc) best = { dx, dy, sc };
    }
    const c0 = { ...best };
    for (let dy = c0.dy - coarse; dy <= c0.dy + coarse; dy++) for (let dx = c0.dx - coarse; dx <= c0.dx + coarse; dx++) {
      const sc = score(dx, dy);
      if (sc > best.sc) best = { dx, dy, sc };
    }
    const key = refs[k] ?? '?';
    if (best.sc > 0.5) { const l = byRef.get(key) ?? []; l.push({ dx: best.dx / s / t.style.fontSize, dy: best.dy / s / t.style.fontSize }); byRef.set(key, l); }
  });
});
const med = (a: number[]) => a.sort((x, y) => x - y)[a.length >> 1]!;
for (const [k, l] of byRef) console.log(`${k}: n=${l.length}  dx ${med(l.map((o) => o.dx)).toFixed(3)}em  dy ${med(l.map((o) => o.dy)).toFixed(3)}em`);
// FONTS=<fonts.json>: add the measured offsets to its dx/dy (run again after re-importing; converges).
if (process.env.FONTS) {
  const { writeFileSync } = await import('node:fs');
  const map = JSON.parse(readFileSync(process.env.FONTS, 'utf8'));
  for (const [k, l] of byRef) if (map[k]) {
    map[k].dx = +((map[k].dx ?? 0) + med(l.map((o) => o.dx))).toFixed(4);
    map[k].dy = +((map[k].dy ?? 0) + med(l.map((o) => o.dy))).toFixed(4);
  }
  writeFileSync(process.env.FONTS, JSON.stringify(map, null, 1));
  console.log('updated', process.env.FONTS);
}
