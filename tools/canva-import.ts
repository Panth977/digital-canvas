/**
 * Convert a Canva page (the structured JSON the Canva connector's `read-design`
 * returns inside an editing transaction) into a `.dcanvas` file.
 *
 *   npx tsx tools/canva-import.ts <page.json>[,<page2.json>…] <assets-dir> <out.dcanvas> [title]
 *
 * <assets-dir> holds `<mediaId>.png` for the images the pages use; missing ones
 * become grey placeholders. This is a test tool for comparing Digital Canvas
 * with Canva, not a full importer: fonts map to Inter, image recolouring and
 * per-run text styles are approximated (see the `gaps` it prints).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { FORMAT, VERSION, newId, DEFAULT_TEXT_STYLE, type Doc, type Element, type Page, type TextAlign } from '@digital-canvas/scene';
import { pack } from '@digital-canvas/storage';

interface CanvaEl {
  id: string;
  type: 'shape' | 'rect' | 'text' | 'group';
  top: number;
  left: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  paths?: { d: string; fill?: { color?: { color: string } } }[];
  fill?: { media?: { mediaId: string; imageBox: { top: number; left: number; width: number; height: number }; recoloring?: Record<string, string> }; flipX?: boolean; flipY?: boolean };
  textRegions?: { characters: string; formatting: { fontSize: number; fontWeight: string; fontStyle: string; color: string; textAlign: string; decoration: string; strikethrough: string; lineHeight: number; letterSpacing: number; fontRef: string } }[];
  children?: CanvaEl[];
}

interface CanvaPage {
  dimensions: { width: number; height: number };
  background?: { color?: { color: string } };
  elements: CanvaEl[];
}

const [pagesArg, assetsDir, out, title = 'Imported from Canva'] = process.argv.slice(2);
if (!pagesArg || !assetsDir || !out) {
  console.error('usage: tsx tools/canva-import.ts <page.json>[,…] <assets-dir> <out.dcanvas> [title]');
  process.exit(1);
}

const gaps = new Map<string, number>();
const gap = (what: string) => gaps.set(what, (gaps.get(what) ?? 0) + 1);
const assets = new Map<string, Uint8Array>();
const assetMeta: Doc['assets'] = {};

function pngSize(b: Uint8Array): { width: number; height: number } {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

const ALIGN: Record<string, TextAlign> = { start: 'left', left: 'left', center: 'center', end: 'right', right: 'right', justify: 'justify' };

function convert(el: CanvaEl): Element[] {
  const base = { id: newId('e_'), x: el.left, y: el.top, w: el.width, h: el.height, rotation: el.rotation ?? 0, opacity: el.opacity ?? 1 };
  if (el.type === 'group') {
    gap('groups flattened (no group element yet)');
    return (el.children ?? []).flatMap(convert);
  }
  if (el.type === 'shape') {
    const color = el.paths?.[0]?.fill?.color?.color;
    if (!color) return []; // invisible layout box
    if ((el.paths?.length ?? 0) > 1 || !/^M0 0H64V64H0z$/.test(el.paths?.[0]?.d ?? '')) gap('custom vector paths drawn as rectangles');
    return [{ ...base, type: 'shape', shape: 'rect', fill: { type: 'solid', color }, stroke: null, radius: 0 }];
  }
  if (el.type === 'rect' && el.fill?.media) {
    const m = el.fill.media;
    if (m.recoloring) gap('image recolouring ignored');
    const file = join(assetsDir!, `${m.mediaId}.png`);
    if (existsSync(file) && !assets.has(m.mediaId)) {
      const bytes = new Uint8Array(readFileSync(file));
      assets.set(m.mediaId, bytes);
      assetMeta[m.mediaId] = { mime: 'image/png', ...pngSize(bytes), name: m.mediaId };
    }
    if (!existsSync(file)) gap('images Canva would not hand over (placeholder)');
    const b = m.imageBox;
    const crop = { x: -b.left / b.width, y: -b.top / b.height, w: el.width / b.width, h: el.height / b.height };
    const exact = Math.abs(crop.x) < 1e-3 && Math.abs(crop.y) < 1e-3 && Math.abs(crop.w - 1) < 1e-3 && Math.abs(crop.h - 1) < 1e-3;
    return [{ ...base, type: 'image', asset: m.mediaId, radius: 0, ...(exact ? { crop: { x: 0, y: 0, w: 1, h: 1 } } : { crop }), flipX: el.fill.flipX || undefined, flipY: el.fill.flipY || undefined }];
  }
  if (el.type === 'text' && el.textRegions?.length) {
    const runs = el.textRegions;
    const f = runs[0]!.formatting;
    if (runs.some((r) => r.formatting.decoration !== f.decoration || r.formatting.fontWeight !== f.fontWeight)) gap('mixed styles inside one text box (first run wins)');
    gap(`font ${f.fontRef.split(',')[0]} → Inter`);
    return [{
      ...base,
      type: 'text',
      text: runs.map((r) => r.characters).join(''),
      style: {
        ...DEFAULT_TEXT_STYLE,
        fontFamily: 'Inter',
        fontSize: f.fontSize,
        bold: f.fontWeight === 'bold',
        italic: f.fontStyle === 'italic',
        underline: f.decoration === 'underline',
        strike: f.strikethrough === 'strikethrough',
        color: f.color,
        align: ALIGN[f.textAlign] ?? 'left',
        lineHeight: f.lineHeight,
        letterSpacing: f.letterSpacing * f.fontSize,
        uppercase: false,
      },
    }];
  }
  gap(`unsupported element type ${el.type}`);
  return [];
}

const canvaPages: CanvaPage[] = pagesArg.split(',').map((p) => JSON.parse(readFileSync(p, 'utf8')));
const first = canvaPages[0]!;
const pages: Page[] = canvaPages.map((cp) => ({
  id: newId('p_'),
  background: { type: 'solid', color: cp.background?.color?.color ?? '#ffffff' },
  elements: cp.elements.flatMap(convert),
}));
const now = new Date().toISOString();
const doc: Doc = {
  format: FORMAT, version: VERSION, id: newId('d_'), title, unit: 'px',
  width: first.dimensions.width, height: first.dimensions.height, bleed: 0,
  pages, assets: assetMeta, createdAt: now, updatedAt: now,
};
writeFileSync(out, pack({ doc, assets }));
console.log(`wrote ${out}: ${pages.length} page(s), ${pages.reduce((n, p) => n + p.elements.length, 0)} elements, ${assets.size} images`);
for (const [g, n] of gaps) console.log(`  gap: ${g} ×${n}`);
