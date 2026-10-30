/**
 * Build the template library from open catalogues:
 *   apps/web/src/templates/*.json + index.json, apps/web/public/templates/<id>.png,
 *   apps/web/public/templates/assets/<asset>, LICENSES-TEMPLATES (see writeLicences).
 *
 *   npx tsx tools/templates/penpot-import/build.ts [--dry] [--only id,id] [--review dir]
 *
 * Every board is rendered with our renderer and compared with the file's own
 * preview; boards on the DROPPED list (decided by looking at --review output)
 * and boards that score badly stay out. Needs the network once (Penpot files,
 * Google Fonts); both are cached under ~/.cache/digital-canvas.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CanvasKit, Image } from 'canvaskit-wasm';
import { walk, type Doc, type Element, type TextElement } from '@digital-canvas/scene';
import { FontLibrary, Renderer } from '@digital-canvas/render';
import { googleFont } from '../../google-fonts.ts';
import { CATALOG, DROPPED } from './catalog.ts';
import { penpotSource } from './penpot.ts';
import { ALLOWED_LICENCES, type SourceBoard, type TemplateSource } from './source.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const dry = process.argv.includes('--dry');
const review = arg('--review');
const only = arg('--only') ? new Set(arg('--only')!.split(',')) : null;
/** Mean difference per channel (0–255) above which a board with a preview is refused. */
const MAX_MAE = 26;

const SOURCES: TemplateSource[] = [penpotSource(CATALOG)];

const require = createRequire(import.meta.url);
const ck: CanvasKit = await require('canvaskit-wasm/bin/full/canvaskit.js')();
const fonts = new FontLibrary(ck);
await fonts.loadBundled(`file://${ROOT}/apps/web/public/fonts/`, async (u) => readFileSync(new URL(u)).buffer as ArrayBuffer);
const renderer = new Renderer(ck, fonts);

const loaded = new Set<string>(['Inter']);
async function loadFamily(family: string): Promise<boolean> {
  if (loaded.has(family)) return true;
  for (let i = 0; i < 4; i++) {
    try {
      const faces = await googleFont(family);
      if (!faces.length) return false;
      for (const f of faces) fonts.add(family, f.bytes, undefined, { weight: f.weight, italic: f.italic });
      loaded.add(family);
      return true;
    } catch { await new Promise((ok) => setTimeout(ok, 5000)); }
  }
  return false;
}

const families = (doc: Doc) => {
  const out = new Set<string>();
  for (const p of doc.pages) for (const e of walk(p.elements)) {
    if (e.type === 'text') { out.add(e.style.fontFamily); for (const r of e.runs ?? []) if (r.style?.fontFamily) out.add(r.style.fontFamily); }
    if (e.type === 'table' || e.type === 'chart') out.add(e.style.fontFamily);
  }
  return out;
};

/** Measure text with the real renderer: heights, and vertical alignment inside fixed boxes. */
function fitTexts(b: SourceBoard): Doc {
  const fit = (e: Element): Element => {
    if (e.type !== 'text') return e;
    const h = Math.ceil(renderer.fitText(e as TextElement).h);
    const va = b.valign.get(e.id);
    const y = va === 'center' ? e.y + (e.h - h) / 2 : va === 'bottom' ? e.y + e.h - h : e.y;
    return { ...e, y, h };
  };
  return { ...b.doc, pages: b.doc.pages.map((p) => ({ ...p, elements: p.elements.map(fit) })) };
}

const pixels = (img: Image) => img.readPixels(0, 0, { width: img.width(), height: img.height(), colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array;

/** Draw an encoded image onto white at w×h (previews may be transparent), as RGBA. */
function flat(bytes: Uint8Array, w: number, h: number): Uint8Array | null {
  const img = ck.MakeImageFromEncoded(bytes);
  if (!img) return null;
  const s = ck.MakeSurface(w, h)!;
  const c = s.getCanvas();
  c.clear(ck.WHITE);
  const p = new ck.Paint();
  c.drawImageRectOptions(img, ck.XYWHRect(0, 0, img.width(), img.height()), ck.XYWHRect(0, 0, w, h), ck.FilterMode.Linear, ck.MipmapMode.Linear, p);
  p.delete();
  const shot = s.makeImageSnapshot();
  const px = pixels(shot);
  shot.delete(); s.delete(); img.delete();
  return px;
}

function mae(a: Uint8Array, b: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!);
  return sum / (a.length * 0.75);
}

/** Side by side: their preview | our render. */
function sideBySide(left: Uint8Array | undefined, right: Uint8Array, w: number, h: number): Uint8Array {
  const s = ck.MakeSurface(w * 2 + 12, h)!;
  const c = s.getCanvas();
  c.clear(ck.Color(255, 0, 255));
  const p = new ck.Paint();
  const put = (bytes: Uint8Array, x: number) => {
    const img = ck.MakeImageFromEncoded(bytes);
    if (img) { c.drawImageRectOptions(img, ck.XYWHRect(0, 0, img.width(), img.height()), ck.XYWHRect(x, 0, w, h), ck.FilterMode.Linear, ck.MipmapMode.Linear, p); img.delete(); }
  };
  if (left) put(left, 0);
  put(right, w + 12);
  p.delete();
  const shot = s.makeImageSnapshot();
  const png = shot.encodeToBytes()!;
  shot.delete(); s.delete();
  return png;
}

interface Report { id: string; title: string; author: string; mae: number | null; verdict: string; lossy: string[]; assets: number; bytes: number }
const report: Report[] = [];
const kept: { b: SourceBoard; doc: Doc; fonts: string[] }[] = [];

if (review) mkdirSync(review, { recursive: true });
for (const src of SOURCES) for await (const b of src.boards()) {
  if (only && !only.has(b.id)) continue;
  if (!ALLOWED_LICENCES.has(b.credit.licence)) throw new Error(`${b.id}: licence ${b.credit.licence} is not on the allowed list`);
  const fams = families(b.doc);
  const missing: string[] = [];
  for (const f of fams) if (!(await loadFamily(f))) missing.push(f);
  const doc = fitTexts(b);
  for (const [id, bytes] of b.assets) renderer.setImage(id, bytes);
  const scale = Math.min(1, 1000 / Math.max(doc.width, doc.height));
  const ours = renderer.exportPage(doc, doc.pages[0]!, { scale });
  const W = Math.max(8, Math.round(doc.width * scale)), H = Math.max(8, Math.round(doc.height * scale));
  let score: number | null = null;
  if (b.preview) {
    const a = flat(b.preview, 200, Math.max(8, Math.round((200 * H) / W))), c = flat(ours, 200, Math.max(8, Math.round((200 * H) / W)));
    if (a && c) score = mae(a, c);
  }
  if (review) writeFileSync(join(review, `${b.id}.png`), sideBySide(b.preview, ours, W, H));
  const dropped = DROPPED[b.id];
  const verdict = dropped ? `dropped: ${dropped}` : missing.length ? `dropped: font ${missing.join(', ')} unavailable` : score !== null && score > MAX_MAE ? `dropped: differs from preview (${score.toFixed(1)})` : 'kept';
  report.push({ id: b.id, title: b.title, author: b.credit.author, mae: score, verdict, lossy: b.lossy, assets: b.assets.size, bytes: [...b.assets.values()].reduce((n, x) => n + x.length, 0) });
  if (b.images.length) console.log(`   images: ${b.images.join(' | ').slice(0, 300)}`);
  console.log(`${b.id.padEnd(30)} ${doc.width}×${doc.height} mae=${score?.toFixed(1) ?? '  - '} imgs=${b.assets.size} ${verdict}${b.lossy.length ? `  [${b.lossy.join('; ')}]` : ''}`);
  if (verdict === 'kept') kept.push({ b, doc, fonts: [...fams].sort() });
}

const kb = report.filter((r) => r.verdict === 'kept').reduce((n, r) => n + r.bytes, 0) / 1024;
console.log(`\n${report.filter((r) => r.verdict === 'kept').length} kept, ${report.filter((r) => r.verdict !== 'kept').length} dropped, assets ${Math.round(kb)} KB`);
if (review) writeFileSync(join(review, 'report.json'), JSON.stringify(report, null, 1));

if (!dry) {
  const json = join(ROOT, 'apps/web/src/templates'), pub = join(ROOT, 'apps/web/public/templates');
  rmSync(json, { recursive: true, force: true });
  rmSync(pub, { recursive: true, force: true });
  mkdirSync(json, { recursive: true });
  mkdirSync(join(pub, 'assets'), { recursive: true });
  const index = [];
  for (const { b, doc, fonts: fams } of kept) {
    writeFileSync(join(json, `${b.id}.json`), JSON.stringify(doc));
    const scale = Math.min(1, 400 / Math.max(doc.width, doc.height));
    writeFileSync(join(pub, `${b.id}.png`), renderer.exportPage(doc, doc.pages[0]!, { scale }));
    for (const [id, bytes] of b.assets) writeFileSync(join(pub, 'assets', id), bytes);
    index.push({ id: b.id, title: b.title, category: b.category, tags: b.tags, width: doc.width, height: doc.height, pages: doc.pages.length, fonts: fams, assets: Object.keys(doc.assets), credit: b.credit });
  }
  writeFileSync(join(json, 'index.json'), JSON.stringify(index, null, 1));
  console.log(`wrote ${index.length} templates`);
}
