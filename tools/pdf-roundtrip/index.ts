/**
 * The proof of PDF import: source → design → PDF, compared page by page with poppler.
 *
 *   npx tsx tools/pdf-roundtrip/index.ts <dir|file.pdf…> [--out report.html] [--max-pages 12] [--only substr]
 *
 * For each file: import, pack and unpack as a .dcanvas (so storage is in the loop), export,
 * render source and export with `pdftoppm -r 150`, diff per page. A pixel mismatches when any channel is off by
 * more than TOL/255. Also renders the design with the editor's renderer, compares `pdftotext`
 * word for word, and edits one word to show only that spot changes.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { exportVectorPdf, FontLibrary, Renderer } from '@digital-canvas/render';
import { exactText, type Doc, type TextElement } from '@digital-canvas/scene';
import { pack, unpack } from '@digital-canvas/storage';
import { encodePng } from '../../packages/pdf/src/png.ts';
import { importPdfNode } from '../../packages/pdf/src/node.ts';

export const TOL = 16;
const DPI = 150;

const args = process.argv.slice(2);
const flag = (n: string, d: string) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]!; args.splice(i, 2); return v; };
/** Corpus files that need a password to open. */
const PASSWORDS: Record<string, string> = { 'password-fixture': 'secret' };
const out = flag('--out', '/tmp/orch27-rw/r18-pdf-report.html');
const maxPages = Number(flag('--max-pages', '12'));
const only = flag('--only', '');
const noSource = args.includes('--no-source');
if (noSource) args.splice(args.indexOf('--no-source'), 1);
const quick = args.includes('--quick');
if (quick) args.splice(args.indexOf('--quick'), 1);
const files = args.flatMap((a) => (statSync(a).isDirectory() ? readdirSync(a).filter((f) => f.endsWith('.pdf')).map((f) => join(a, f)) : [a])).filter((f) => basename(f).includes(only));

const require = createRequire(import.meta.url);
const ck = await require('canvaskit-wasm/bin/full/canvaskit.js')();
const fontDir = new URL('../../apps/web/public/fonts/', import.meta.url).href;
const assetsDir = out.replace(/\.html$/, '');
mkdirSync(assetsDir, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'r18-'));

interface Ppm { w: number; h: number; px: Uint8Array }

function readPpm(path: string): Ppm {
  const b = readFileSync(path);
  let i = 2; const nums: number[] = [];
  while (nums.length < 3) {
    while (b[i] === 10 || b[i] === 32) i++;
    let v = 0;
    while (b[i]! >= 48 && b[i]! <= 57) v = v * 10 + b[i++]! - 48;
    nums.push(v);
  }
  return { w: nums[0]!, h: nums[1]!, px: b.subarray(i + 1) };
}

function rasterize(pdf: string, page: number, stem: string): Ppm {
  const pw = PASSWORDS[basename(pdf, '.pdf')];
  execFileSync('pdftoppm', [...(pw ? ['-upw', pw] : []), '-r', String(DPI), '-f', String(page), '-l', String(page), '-singlefile', pdf, stem], { stdio: 'ignore' });
  return readPpm(`${stem}.ppm`);
}

interface Diff { share: number; box: [number, number, number, number] | null; image: Uint8Array; w: number; h: number }

function diff(a: Ppm, b: Ppm, tol = TOL): Diff {
  const w = Math.max(a.w, b.w), h = Math.max(a.h, b.h);
  const img = new Uint8Array(w * h * 3);
  let bad = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const oa = x < a.w && y < a.h ? (y * a.w + x) * 3 : -1, ob = x < b.w && y < b.h ? (y * b.w + x) * 3 : -1;
    const at = (y * w + x) * 3;
    let off = oa < 0 || ob < 0;
    if (!off) off = Math.abs(a.px[oa]! - b.px[ob]!) > tol || Math.abs(a.px[oa + 1]! - b.px[ob + 1]!) > tol || Math.abs(a.px[oa + 2]! - b.px[ob + 2]!) > tol;
    if (off) {
      bad++;
      img[at] = 230; img[at + 1] = 20; img[at + 2] = 60;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    } else {
      // the page faded, so red reads against it
      const g = oa >= 0 ? (a.px[oa]! + a.px[oa + 1]! + a.px[oa + 2]!) / 3 : 255;
      img[at] = img[at + 1] = img[at + 2] = 200 + g * 0.2;
    }
  }
  return { share: bad / (w * h), box: x1 >= 0 ? [x0, y0, x1, y1] : null, image: img, w, h };
}

const words = (pdf: string): string[] => {
  try { return execFileSync('pdftotext', ['-q', pdf, '-'], { maxBuffer: 1 << 28 }).toString('utf8').split(/\s+/).filter(Boolean); } catch { return []; }
};

function wordMatch(a: string[], b: string[]): number {
  if (!a.length) return 1;
  const count = new Map<string, number>();
  for (const w of b) count.set(w, (count.get(w) ?? 0) + 1);
  let hit = 0;
  for (const w of a) { const c = count.get(w) ?? 0; if (c) { hit++; count.set(w, c - 1); } }
  return hit / a.length;
}

/** 3×3 box blur: edges that differ only by anti-aliasing cancel out. */
function blur(p: Ppm): Ppm {
  const px = new Uint8Array(p.px.length);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) for (let c = 0; c < 3; c++) {
    let sum = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = x + dx, Y = y + dy;
      if (X < 0 || Y < 0 || X >= p.w || Y >= p.h) continue;
      sum += p.px[(Y * p.w + X) * 3 + c]!; n++;
    }
    px[(y * p.w + x) * 3 + c] = sum / n;
  }
  return { w: p.w, h: p.h, px };
}

const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

interface Row { file: string; page: number; pdfShare: number; canvasShare: number | null; src: string; ours: string; dif: string; canvas?: string }
interface FileRow { file: string; pages: number; tested: number; worst: number; mean: number; canvasWorst: number; canvasLoose: number; words: number; flat: string[]; notes: string[]; ms: number; size: [number, number]; edit: string; texts: number; paths: number; images: number; error?: string; pagesMatch: boolean }

const rows: Row[] = [], fileRows: FileRow[] = [];

function saveRgb(p: Ppm, path: string): void { writeFileSync(path, encodePng(p.px, p.w, p.h, 3)); }

for (const f of files) {
  const name = basename(f, '.pdf');
  const t0 = Date.now();
  const row: FileRow = { file: name, pages: 0, tested: 0, worst: 0, mean: 0, canvasWorst: 0, canvasLoose: 0, words: 1, flat: [], notes: [], ms: 0, size: [statSync(f).size, 0], edit: '', texts: 0, paths: 0, images: 0, pagesMatch: true };
  fileRows.push(row);
  try {
    const srcBytes = new Uint8Array(readFileSync(f));
    const info = execFileSync('pdfinfo', [...(PASSWORDS[name] ? ['-upw', PASSWORDS[name]!] : []), f]).toString();
    const total = Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? 1);
    const step = Math.max(1, Math.ceil(total / maxPages));
    const pick = Array.from({ length: total }, (_, i) => i + 1).filter((_, i) => i % step === 0);
    const r = await importPdfNode(srcBytes, { pages: pick, title: name, password: PASSWORDS[name] });
    row.pages = total; row.tested = pick.length;
    row.texts = r.report.texts; row.paths = r.report.paths; row.images = r.report.images;
    row.notes = r.report.notes;
    row.flat = [...new Set(r.report.flattened.map((x) => x.why))];
    const packed = pack({ doc: r.doc, assets: r.assets });
    const { doc, assets } = unpack(packed);
    const fonts = new FontLibrary(ck);
    await fonts.loadBundled(fontDir, async (u) => readFileSync(new URL(u)).buffer as ArrayBuffer);
    const renderer = new Renderer(ck, fonts);
    for (const fnt of doc.fonts ?? []) { const b = assets.get(fnt.asset); if (b) fonts.add(fnt.family, b, fnt.subset); }
    for (const [id, b] of assets) if (doc.assets[id]?.mime.startsWith('image/')) renderer.setImage(id, b);
    // --no-source: what a file exports like without its original objects (encrypted files, or the source removed)
    if (noSource) delete doc.pdf!.source;
    const bytes = await exportVectorPdf(renderer, doc, { assets, title: name });
    row.size[1] = bytes.length;
    const ours = join(tmp, `${name}.pdf`);
    writeFileSync(ours, bytes);
    const sub = join(tmp, `${name}.src.pdf`);
    writeFileSync(sub, srcBytes);
    const oursPages = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [ours]).toString())?.[1] ?? 0);
    row.pagesMatch = oursPages === pick.length;
    const a: string[] = [], b: string[] = [];
    let sum = 0;
    for (let i = 0; i < pick.length; i++) {
      const pg = pick[i]!;
      const s = rasterize(f, pg, join(tmp, 's'));
      const o = rasterize(ours, i + 1, join(tmp, 'o'));
      const d = diff(s, o);
      sum += d.share;
      row.worst = Math.max(row.worst, d.share);
      let cShare: number | null = null, canvasName: string | undefined;
      if (!quick) {
        const page = doc.pages[i]!;
        const k = DPI / 96;
        const png = renderer.renderPageRgba(doc, page, s.w, s.h);
        const rgb = new Uint8Array(s.w * s.h * 3);
        for (let q = 0; q < s.w * s.h; q++) {
          const al = png.data[q * 4 + 3]! / 255;
          for (let c = 0; c < 3; c++) rgb[q * 3 + c] = png.data[q * 4 + c]! * al + 255 * (1 - al);
        }
        const c = { w: s.w, h: s.h, px: rgb };
        const cd = diff(s, c);
        cShare = cd.share;
        row.canvasWorst = Math.max(row.canvasWorst, cd.share);
        // Skia and Splash anti-alias glyph edges differently: this one looks past that
        row.canvasLoose = Math.max(row.canvasLoose, diff(blur(s), blur(c), 64).share);
        canvasName = `${name}-${pg}-canvas.png`;
        saveRgb(c, join(assetsDir, canvasName));
        void k;
      }
      const stem = `${name}-${pg}`;
      saveRgb(s, join(assetsDir, `${stem}-src.png`));
      saveRgb(o, join(assetsDir, `${stem}-ours.png`));
      writeFileSync(join(assetsDir, `${stem}-diff.png`), encodePng(d.image, d.w, d.h, 3));
      rows.push({ file: name, page: pg, pdfShare: d.share, canvasShare: cShare, src: `${stem}-src.png`, ours: `${stem}-ours.png`, dif: `${stem}-diff.png`, canvas: canvasName });
      if (pick.length < total) { /* words compared on the same pages below */ }
      a.push(...execText(f, pg)); b.push(...execText(ours, i + 1));
    }
    row.mean = sum / Math.max(1, pick.length);
    row.words = wordMatch(a, b);
    row.edit = quick ? '' : await editTest(doc, assets, renderer, ours, name);
    renderer.dispose();
    fonts.dispose();
  } catch (e) {
    row.error = String((e as Error).stack ?? e).slice(0, 300);
    row.worst = 1;
  }
  row.ms = Date.now() - t0;
  console.log(`${name.padEnd(28)} ${String(row.tested).padStart(3)}/${String(row.pages).padEnd(3)} worst ${pct(row.worst)} canvas ${pct(row.canvasWorst)}/${pct(row.canvasLoose)} words ${(row.words * 100).toFixed(1)}% ${row.ms}ms ${row.error ?? ''} ${row.edit}`);
  writeReport();
}

function execText(pdf: string, page: number): string[] {
  try { const pw = PASSWORDS[basename(pdf, '.pdf')]; return execFileSync('pdftotext', [...(pw ? ['-upw', pw] : []), '-q', '-f', String(page), '-l', String(page), pdf, '-'], { maxBuffer: 1 << 28 }).toString('utf8').split(/\s+/).filter(Boolean); } catch { return []; }
}

/** Change one word on the first page with text; everything off that box must stay the same. */
async function editTest(doc: Doc, assets: Map<string, Uint8Array>, renderer: Renderer, base: string, name: string): Promise<string> {
  for (let i = 0; i < doc.pages.length; i++) {
    const page = doc.pages[i]!;
    const texts = page.elements.filter((e): e is TextElement => e.type === 'text' && !!exactText(e) && !e.exact!.runs.some((r) => r.mode === 3) && /[A-Za-z]{4,}/.test(e.text) && e.rotation === 0);
    // the topmost of the longest: a design may stack a shadow copy under its text
    const el = texts.reverse().sort((a, b) => b.text.length - a.text.length)[0];
    if (!el) continue;
    const word = /[A-Za-z]{4,}/.exec(el.text)![0];
    const text = el.text.replace(word, word.split('').reverse().join(''));
    const edited: Doc = { ...doc, pages: doc.pages.map((p, k) => (k !== i ? p : { ...p, elements: p.elements.map((e) => (e === el ? { ...el, text, runs: undefined } : e)) })) };
    const bytes = await exportVectorPdf(renderer, edited, { assets, title: name });
    const path = join(tmp, `${name}.edit.pdf`);
    writeFileSync(path, bytes);
    const d = diff(rasterize(base, i + 1, join(tmp, 'a')), rasterize(path, i + 1, join(tmp, 'b')));
    if (!d.box) return 'edit: nothing changed!';
    // page px → pixels of this render (an imported page may sit letterboxed on the design)
    const b = page.pdfPage;
    const k = b ? (DPI / 72) / b.scale : DPI / 96, ox = b?.x ?? 0, oy = b?.y ?? 0;
    const pad = el.h * k;
    const X = (el.x - ox) * k, Y = (el.y - oy) * k, H = el.h * k;
    const inside = d.box[0] >= X - pad && d.box[1] >= Y - pad && d.box[3] <= Y + H + pad;
    return `edit "${word}": ${inside ? 'only that line changed' : `SPILLED ${d.box.join(',')} vs ${[X, Y, el.w * k, H].map(Math.round).join(',')}`}`;
  }
  return 'edit: no text';
}

function writeReport(): void {
  const worst = [...rows].sort((a, b) => b.pdfShare - a.pdfShare);
  const over = rows.filter((r) => r.pdfShare >= 0.005);
  const summary = fileRows.map((r) => `<tr class="${r.error || r.worst >= 0.005 ? 'bad' : ''}"><td>${esc(r.file)}</td><td>${r.tested}/${r.pages}</td><td>${pct(r.mean)}</td><td>${pct(r.worst)}</td><td>${pct(r.canvasWorst)}</td><td>${pct(r.canvasLoose)}</td><td>${(r.words * 100).toFixed(1)}%</td><td>${r.texts}/${r.paths}/${r.images}</td><td>${esc(r.flat.join('; '))}</td><td>${esc(r.edit)}</td><td>${(r.size[0] / 1024).toFixed(0)} → ${(r.size[1] / 1024).toFixed(0)} KB</td><td>${(r.ms / 1000).toFixed(1)} s</td><td>${esc(r.error ?? '')}</td></tr>`).join('');
  const dir = basename(assetsDir);
  const cards = worst.map((r) => `<section><h3>${esc(r.file)} p.${r.page}: export ${pct(r.pdfShare)}${r.canvasShare === null ? '' : `, canvas ${pct(r.canvasShare)}`}</h3><div class="row"><figure><img loading="lazy" src="${dir}/${r.src}"><figcaption>source</figcaption></figure><figure><img loading="lazy" src="${dir}/${r.ours}"><figcaption>ours (export)</figcaption></figure><figure><img loading="lazy" src="${dir}/${r.dif}"><figcaption>diff</figcaption></figure>${r.canvas ? `<figure><img loading="lazy" src="${dir}/${r.canvas}"><figcaption>editor canvas</figcaption></figure>` : ''}</div></section>`).join('');
  writeFileSync(out, `<!doctype html><meta charset=utf-8><title>r18 PDF round trip</title><style>body{font:14px system-ui;margin:24px;color:#222}table{border-collapse:collapse;font-size:12px}td,th{border:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top}.bad{background:#fee}.row{display:flex;gap:8px}figure{margin:0;flex:1;min-width:0}img{width:100%;border:1px solid #ccc}figcaption{font-size:11px;color:#666}section{margin:24px 0}</style><h1>PDF import round trip</h1><p>${rows.length} pages from ${fileRows.length} files, rendered with pdftoppm at ${DPI} dpi. A pixel mismatches when a channel differs by more than ${TOL}/255. Target: under 0.5 % on every page. Pages over target: ${over.length}.</p><table><tr><th>file</th><th>pages tested</th><th>mean</th><th>worst</th><th>canvas worst</th><th>canvas, blurred, tol 64</th><th>words kept</th><th>text/paths/images</th><th>flattened</th><th>one-word edit</th><th>size</th><th>time</th><th>error</th></tr>${summary}</table><h2>Pages, worst first</h2>${cards}`);
}

writeReport();
rmSync(tmp, { recursive: true, force: true });
const bad = rows.filter((r) => r.pdfShare >= 0.005).length;
console.log(`${rows.length} pages, ${bad} over 0.5 %; report ${out} (${dirname(out)})`);
process.exit(0);
