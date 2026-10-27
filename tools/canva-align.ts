/**
 * Per-element correction against Canva's render: for every text box, slide our rendering over
 * Canva's export of the page and move the box to where it lines up best (coarse-to-fine search on
 * the text's own ink). Writes the corrected file in place; run it again to check (it converges).
 *
 *   npx tsx tools/canva-align.ts <file.dcanvas> <ref-dir with page1.png…> [maxShiftEm=0.5]
 *
 * Prints, per page, how many boxes moved and the median shift, and a total "fit" (share of our
 * text ink that lands on Canva pixels of the same colour) before and after.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { CanvasKit } from 'canvaskit-wasm';
import { FontLibrary, Renderer } from '@digital-canvas/render';
import { pack, unpack } from '@digital-canvas/storage';
import type { TextElement } from '@digital-canvas/scene';

const [file, refDir, maxArg = '0.5'] = process.argv.slice(2);
if (!file || !refDir) throw new Error('usage: tsx tools/canva-align.ts <file.dcanvas> <ref-dir> [maxShiftEm]');
const require = createRequire(import.meta.url);
const ck: CanvasKit = await require('canvaskit-wasm/bin/full/canvaskit.js')();
const fonts = new FontLibrary(ck);
await fonts.loadBundled(new URL('../apps/web/public/fonts/', import.meta.url).href, async (u) => readFileSync(new URL(u)).buffer as ArrayBuffer);
const project = unpack(new Uint8Array(readFileSync(file)));
const { doc } = project;
for (const f of doc.fonts ?? []) { const b = project.assets.get(f.asset); if (b) fonts.add(f.family, b, f.subset); }
const r = new Renderer(ck, fonts);
const info = (w: number, h: number) => ({ width: w, height: h, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB });
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const maxEm = Number(maxArg);
let before = 0, after = 0, n = 0;

doc.pages.forEach((page, pi) => {
  const refFile = join(refDir, `page${pi + 1}.png`);
  if (!existsSync(refFile)) return;
  const refImg = ck.MakeImageFromEncoded(readFileSync(refFile))!;
  const W0 = refImg.width(), H0 = refImg.height(), s = W0 / doc.width;
  const ref = refImg.readPixels(0, 0, info(W0, H0)) as Uint8Array;
  refImg.delete();
  const shifts: number[] = [];
  const fix = (el: (typeof page.elements)[number]): (typeof page.elements)[number] => {
    if (el.type === 'group') return { ...el, children: el.children.map(fix) };
    if (el.type !== 'text') return el;
    const t = el as TextElement;
    const pad = t.style.fontSize * maxEm;
    const bx = Math.floor((t.x - pad) * s), by = Math.floor((t.y - pad) * s);
    const BW = Math.ceil((t.w + 2 * pad) * s), BH = Math.ceil((t.h + 2 * pad) * s);
    if (BW <= 0 || BH <= 0 || BW * BH > 40e6) return el;
    const surf = ck.MakeSurface(BW, BH);
    if (!surf) return el;
    const cv = surf.getCanvas();
    cv.clear(ck.TRANSPARENT);
    cv.scale(s, s);
    cv.translate(-bx / s, -by / s);
    r.drawElement(cv, { ...t, opacity: 1 });
    const img = surf.makeImageSnapshot();
    const ours = img.readPixels(0, 0, info(BW, BH)) as Uint8Array;
    img.delete();
    surf.delete();
    // ink pixels (with their colour), thinned to a few thousand
    const ink: number[] = [];
    for (let j = 0; j < BH; j++) for (let i = 0; i < BW; i++) if (ours[(j * BW + i) * 4 + 3]! >= 160) ink.push(i, j);
    if (ink.length < 20) return el;
    const step = Math.max(1, Math.round(ink.length / 2 / 2500));
    const pts: number[] = [];
    for (let k = 0; k < ink.length; k += 2 * step) pts.push(ink[k]!, ink[k + 1]!);
    const score = (dx: number, dy: number) => {
      let hit = 0;
      for (let k = 0; k < pts.length; k += 2) {
        const i = pts[k]!, j = pts[k + 1]!;
        const X = bx + i + dx, Y = by + j + dy;
        if (X < 0 || Y < 0 || X >= W0 || Y >= H0) continue;
        const o = (j * BW + i) * 4, q = (Y * W0 + X) * 4;
        if (Math.abs(ref[q]! - ours[o]!) + Math.abs(ref[q + 1]! - ours[o + 1]!) + Math.abs(ref[q + 2]! - ours[o + 2]!) < 90) hit++;
      }
      return hit / (pts.length / 2);
    };
    const R = Math.round(t.style.fontSize * maxEm * s);
    const coarse = Math.max(1, Math.round(R / 25));
    let best = { dx: 0, dy: 0, sc: score(0, 0) };
    const sc0 = best.sc;
    for (let dy = -R; dy <= R; dy += coarse) for (let dx = -R; dx <= R; dx += coarse) {
      const sc = score(dx, dy);
      if (sc > best.sc + 0.002) best = { dx, dy, sc };
    }
    const c0 = { ...best };
    for (let dy = c0.dy - coarse; dy <= c0.dy + coarse; dy++) for (let dx = c0.dx - coarse; dx <= c0.dx + coarse; dx++) {
      const sc = score(dx, dy);
      if (sc > best.sc + 0.001) best = { dx, dy, sc };
    }
    before += sc0; after += best.sc; n++;
    // move only when it clearly fits better (a weak match may be text hidden under something)
    if (best.sc < 0.3 || best.sc < sc0 + 0.02) return el;
    shifts.push(Math.hypot(best.dx, best.dy) / s);
    return { ...t, x: t.x + best.dx / s, y: t.y + best.dy / s };
  };
  page.elements = page.elements.map(fix);
  shifts.sort((a, b) => a - b);
  console.log(`page ${pi + 1}: moved ${shifts.length} text boxes, median shift ${(shifts[shifts.length >> 1] ?? 0).toFixed(1)} px`);
});
console.log(`text fit ${(100 * before / Math.max(1, n)).toFixed(1)}% → ${(100 * after / Math.max(1, n)).toFixed(1)}% over ${n} boxes`);
writeFileSync(file, pack(project));
