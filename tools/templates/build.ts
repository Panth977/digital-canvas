/**
 * Build the template library: tools/templates/library.ts → apps/web/src/templates/*.json
 * (+ index.json) and apps/web/public/templates/*.png thumbnails.
 *
 *   npx tsx tools/templates/build.ts            (all)
 *   npx tsx tools/templates/build.ts menu-cafe   (some, by id)
 *
 * Needs the network once (Google Fonts, Iconify); both are cached under ~/.cache/digital-canvas.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { completeDoc, parseSvg, walk, type Doc, type Element, type PathElement, type TextElement } from '@digital-canvas/scene';
import { FontLibrary, Renderer } from '@digital-canvas/render';
import { googleFont } from '../google-fonts.ts';
import { TEMPLATES, CATEGORIES, type TemplateDef } from './library.ts';

const ROOT = new URL('../../', import.meta.url);
const OUT_JSON = new URL('apps/web/src/templates/', ROOT);
const OUT_PNG = new URL('apps/web/public/templates/', ROOT);
const ICON_CACHE = join(homedir(), '.cache/digital-canvas/iconify');
mkdirSync(OUT_JSON, { recursive: true });
mkdirSync(OUT_PNG, { recursive: true });
mkdirSync(ICON_CACHE, { recursive: true });

const only = new Set(process.argv.slice(2));
const require = createRequire(import.meta.url);
const ck = await require('canvaskit-wasm/bin/full/canvaskit.js')();
const fonts = new FontLibrary(ck);
await fonts.loadBundled(new URL('apps/web/public/fonts/', ROOT).href, async (u) => readFileSync(new URL(u)).buffer as ArrayBuffer);
const renderer = new Renderer(ck, fonts);

async function iconSvg(name: string): Promise<string | null> {
  const file = join(ICON_CACHE, `${name.replace(':', '__')}.svg`);
  if (existsSync(file)) return readFileSync(file, 'utf8');
  const [prefix, icon] = name.split(':');
  const r = await fetch(`https://api.iconify.design/${prefix}/${icon}.svg`);
  if (!r.ok) return null;
  const svg = await r.text();
  if (!svg.startsWith('<svg')) return null;
  writeFileSync(file, svg);
  return svg;
}

const loadedFamilies = new Set<string>(['Inter']);
async function loadFamily(family: string): Promise<void> {
  if (loadedFamilies.has(family)) return;
  loadedFamilies.add(family);
  const faces = await googleFont(family);
  if (!faces.length) throw new Error(`Google Fonts has no "${family}"`);
  for (const f of faces) fonts.add(family, f.bytes, undefined, { weight: f.weight, italic: f.italic });
}

/** Stable ids, so rebuilding doesn't churn the JSON. */
function renumber(doc: Doc, prefix: string): Doc {
  let n = 0;
  const el = (e: Element): Element => {
    const id = `${prefix}_e${++n}`;
    return e.type === 'group' ? { ...e, id, children: e.children.map(el) } : { ...e, id };
  };
  return { ...doc, id: `tpl_${prefix}`, pages: doc.pages.map((p, i) => ({ ...p, id: `${prefix}_p${i + 1}`, elements: p.elements.map(el) })) };
}

async function build(t: TemplateDef): Promise<{ doc: Doc; warnings: string[] }> {
  const { doc: raw, icons, warnings } = completeDoc({ title: t.title, width: t.width, height: t.height, pages: t.pages });
  let doc: Doc = { ...raw, bleed: t.print ? Math.round((3 * 96) / 25.4 * 100) / 100 : 0, createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z' };
  // bake icons in as vectors, at their place in the stacking order
  const pages = doc.pages.map((p) => ({ ...p, elements: [...p.elements] }));
  const inserted = new Map<number, number>();
  for (const ic of [...icons].sort((a, b) => a.page - b.page || a.index - b.index)) {
    const svg = await iconSvg(ic.icon);
    const parsed = svg && parseSvg(svg, ic.color);
    if (!parsed) { warnings.push(`icon ${ic.icon} not found`); continue; }
    const s = Math.min(ic.box.w / parsed.viewBox.w, ic.box.h / parsed.viewBox.h);
    const w = parsed.viewBox.w * s, h = parsed.viewBox.h * s;
    const el: PathElement = {
      id: 'x', type: 'path', name: ic.icon, x: ic.box.x + (ic.box.w - w) / 2, y: ic.box.y + (ic.box.h - h) / 2, w, h, rotation: ic.box.rotation, opacity: ic.box.opacity,
      viewBox: parsed.viewBox, paths: parsed.paths.map((p) => (p.stroke ? { ...p, stroke: { ...p.stroke, width: p.stroke.width * s } } : p)),
    };
    const k = inserted.get(ic.page) ?? 0;
    pages[ic.page]!.elements.splice(ic.index + k, 0, el);
    inserted.set(ic.page, k + 1);
  }
  doc = { ...doc, pages: t.video ? pages.map((p) => ({ ...p, duration: 4 })) : pages };
  // fonts, then measure text boxes with the real renderer
  for (const p of doc.pages) for (const e of walk(p.elements)) if (e.type === 'text') await loadFamily(e.style.fontFamily);
  for (const p of doc.pages) for (const e of walk(p.elements)) if (e.type === 'chart' || e.type === 'table') await loadFamily(e.style.fontFamily);
  const fit = (e: Element): Element => (e.type === 'text' ? { ...e, h: Math.ceil(renderer.fitText(e as TextElement).h) } : e);
  doc = { ...doc, pages: doc.pages.map((p) => ({ ...p, elements: p.elements.map(fit) })) };
  return { doc: renumber(doc, t.id), warnings };
}

export interface TemplateEntry {
  id: string;
  title: string;
  category: string;
  tags: string;
  width: number;
  height: number;
  pages: number;
  fonts: string[];
  video?: boolean;
}

const index: TemplateEntry[] = existsSync(new URL('index.json', OUT_JSON)) && only.size ? JSON.parse(readFileSync(new URL('index.json', OUT_JSON), 'utf8')) : [];
for (const t of TEMPLATES) {
  if (only.size && !only.has(t.id)) continue;
  const { doc, warnings } = await build(t);
  const families = new Set<string>();
  for (const p of doc.pages) for (const e of walk(p.elements)) if (e.type === 'text' || e.type === 'table' || e.type === 'chart') families.add(e.style.fontFamily);
  writeFileSync(new URL(`${t.id}.json`, OUT_JSON), JSON.stringify(doc));
  const scale = Math.min(1, 400 / Math.max(doc.width, doc.height)) * (Math.max(doc.width, doc.height) < 400 ? 400 / Math.max(doc.width, doc.height) : 1);
  writeFileSync(new URL(`${t.id}.png`, OUT_PNG), renderer.exportPage(doc, doc.pages[0]!, { scale }));
  const entry: TemplateEntry = { id: t.id, title: t.title, category: t.category, tags: t.tags, width: doc.width, height: doc.height, pages: doc.pages.length, fonts: [...families].sort(), ...(t.video ? { video: true } : {}) };
  const at = index.findIndex((x) => x.id === t.id);
  if (at >= 0) index[at] = entry; else index.push(entry);
  console.log(`${t.id.padEnd(24)} ${doc.pages.length}p ${[...families].join(', ')}${warnings.length ? `  ⚠ ${warnings.join('; ')}` : ''}`);
}
index.sort((a, b) => CATEGORIES.indexOf(a.category as never) - CATEGORIES.indexOf(b.category as never) || TEMPLATES.findIndex((t) => t.id === a.id) - TEMPLATES.findIndex((t) => t.id === b.id));
writeFileSync(new URL('index.json', OUT_JSON), JSON.stringify(index, null, 1));
console.log(`${index.length} templates`);
