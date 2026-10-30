/**
 * Reads `.penpot` files (binfile-v3: a zip of JSON plus media) and yields the
 * boards `catalog.ts` picks, as `SourceBoard`s. Files are downloaded once to
 * ~/.cache/digital-canvas/penpot.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { createDoc, type AssetMeta, type Doc } from '@digital-canvas/scene';
import { assetId } from '@digital-canvas/storage';
import { DROP, ROOT, convertBoard, type ConvertContext, type PShape } from './convert.ts';
import type { Credit, SourceBoard, TemplateSource } from './source.ts';
import type { CatalogFile } from './catalog.ts';

const CACHE = join(homedir(), '.cache/digital-canvas/penpot');
const FILES = 'https://penpot.github.io/penpot-files/';

/** Penpot's built-in fonts and renamed families → the Google family. */
const FONT_ALIAS: Record<string, string> = { sourcesanspro: 'Source Sans 3', 'source sans pro': 'Source Sans 3' };

async function download(file: string): Promise<Uint8Array> {
  mkdirSync(CACHE, { recursive: true });
  const local = join(CACHE, file.replace(/[^\w.-]+/g, '_'));
  if (existsSync(local)) return new Uint8Array(readFileSync(local));
  const url = file.startsWith('http') ? file : FILES + encodeURIComponent(file);
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      writeFileSync(local, bytes);
      return bytes;
    } catch (e) {
      if (attempt >= 5) throw new Error(`download ${file}: ${e instanceof Error ? e.message : e}`);
      await new Promise((ok) => setTimeout(ok, 5000 * attempt));
    }
  }
}

export interface PenpotFile {
  name: string;
  pages: { id: string; name: string; shapes: Map<string, PShape> }[];
  /** Penpot media id → storage object id. */
  media: Map<string, { mediaId: string; mtype: string; width: number; height: number; name: string }>;
  /** Board id → storage object id of its rendered thumbnail. */
  thumbs: Map<string, string>;
  objects: Map<string, Uint8Array>;
  objectMeta: Map<string, { mtype: string }>;
}

export function readPenpot(bytes: Uint8Array): PenpotFile {
  const zip = unzipSync(bytes);
  const json = (k: string): PShape => JSON.parse(strFromU8(zip[k]!));
  const out: PenpotFile = { name: '', pages: [], media: new Map(), thumbs: new Map(), objects: new Map(), objectMeta: new Map() };
  const names = Object.keys(zip);
  out.name = json('manifest.json').files?.[0]?.name ?? '';
  for (const n of names) {
    let m: RegExpExecArray | null;
    if ((m = /^files\/[^/]+\/pages\/([^/]+)\.json$/.exec(n))) {
      const page = { id: m[1]!, name: String(json(n).name ?? ''), shapes: new Map<string, PShape>() };
      const pre = n.slice(0, -5) + '/';
      for (const k of names) if (k.startsWith(pre) && k.endsWith('.json')) { const s = json(k); page.shapes.set(s.id, s); }
      out.pages.push(page);
    } else if (/^files\/[^/]+\/media\/[^/]+\.json$/.test(n)) {
      const j = json(n);
      out.media.set(j.id, { mediaId: j.mediaId, mtype: j.mtype, width: j.width, height: j.height, name: String(j.name ?? '') });
    } else if (/^files\/[^/]+\/thumbnails\/frame\//.test(n) && n.endsWith('.json')) {
      const j = json(n);
      out.thumbs.set(j.frameId, j.mediaId);
    } else if ((m = /^objects\/([^/.]+)\.json$/.exec(n))) {
      out.objectMeta.set(m[1]!, { mtype: json(n).contentType ?? json(n).mtype ?? '' });
    } else if ((m = /^objects\/([^/.]+)\.(\w+)$/.exec(n))) {
      out.objects.set(m[1]!, zip[n]!);
    }
  }
  return out;
}

export function penpotSource(files: CatalogFile[]): TemplateSource {
  return {
    name: 'Penpot Hub',
    async *boards() {
      for (const f of files) {
        const pf = readPenpot(await download(f.file));
        for (const pick of f.boards) {
          const page = pf.pages.find((p) => pick.page === undefined || pick.page.test(p.name)) && pf.pages.filter((p) => pick.page === undefined || pick.page.test(p.name));
          for (const p of page ?? []) {
            const boards = [...p.shapes.values()].filter((s) => s.type === 'frame' && s.parentId === ROOT && s.id !== ROOT && pick.board.test(s.name)).sort((a, b) => a.x - b.x || a.y - b.y);
            let n = 0;
            for (const b of boards) {
              const suffix = boards.length > 1 ? ++n : 0;
              yield await toBoard(pf, p.shapes, b, f, pick, suffix, p.name);
            }
          }
        }
      }
    },
  };
}

async function toBoard(pf: PenpotFile, shapes: Map<string, PShape>, board: PShape, f: CatalogFile, pick: CatalogFile['boards'][number], n: number, pageName: string): Promise<SourceBoard> {
  const assets = new Map<string, Uint8Array>();
  const docAssets: Record<string, AssetMeta> = {};
  const seen = new Map<string, string>();
  const images = new Set<string>();
  const lossy = new Map<string, number>();
  const valign = new Map<string, 'center' | 'bottom'>();
  const id = `${pick.id}${n ? `-${n}` : ''}`;
  let seq = 0;
  // assets are hashed, which is async: collect them first
  const pending: { media: string; bytes: Uint8Array; mime: string; width: number; height: number }[] = [];
  for (const [mid, m] of pf.media) {
    const bytes = pf.objects.get(m.mediaId);
    if (bytes) pending.push({ media: mid, bytes, mime: m.mtype, width: m.width, height: m.height });
  }
  const hashed = new Map<string, { asset: string; bytes: Uint8Array; meta: AssetMeta }>();
  for (const p of pending) hashed.set(p.media, { asset: await assetId(p.bytes, p.mime), bytes: p.bytes, meta: { mime: p.mime, width: p.width, height: p.height, name: `${f.title} by ${f.author} (${f.licence})` } });
  const ctx: ConvertContext = {
    shapes,
    image(mid, box) {
      const h = hashed.get(mid);
      if (!h) return null;
      images.add(pf.media.get(mid)?.name ?? mid);
      if (pick.stripImages) return (box?.w ?? 0) >= 100 && (box?.h ?? 0) >= 100 ? '' : DROP;
      if (!seen.has(mid)) { seen.set(mid, h.asset); assets.set(h.asset, h.bytes); docAssets[h.asset] = h.meta; }
      return h.asset;
    },
    font(fontId, family) {
      // text with no font set uses Penpot's default
      const key = (family ?? fontId ?? 'sourcesanspro').toLowerCase();
      if (FONT_ALIAS[key]) return FONT_ALIAS[key]!;
      if (family && (fontId?.startsWith('gfont-') || fontId?.startsWith('custom-'))) return family;
      return null;
    },
    lossy: (w) => lossy.set(w, (lossy.get(w) ?? 0) + 1),
    valign,
    nextId: () => `${id}_e${++seq}`,
  };
  const { background, elements } = convertBoard(board, ctx);
  const title = (n && pick.titles?.[n - 1]) || (n ? `${pick.title} ${n}` : pick.title);
  const blank = createDoc({ title, width: Math.round(board.width), height: Math.round(board.height) });
  const stamp = '2026-10-30T00:00:00.000Z';
  const doc: Doc = { ...blank, id: `tpl_${id}`, title, assets: docAssets, createdAt: stamp, updatedAt: stamp, pages: [{ id: `${id}_p1`, name: pageName.slice(0, 60), background, elements }] };
  const credit: Credit = {
    author: f.author, ...(f.authorUrl ? { authorUrl: f.authorUrl } : {}), catalog: 'Penpot Hub', sourceUrl: `https://penpot.app/penpothub/libraries-templates/${f.slug}`,
    fileUrl: f.file.startsWith('http') ? f.file : FILES + encodeURIComponent(f.file), licence: f.licence, licenceUrl: f.licenceUrl,
    note: pick.stripImages ? 'Converted to our format. Photos and logos the licence does not cover were removed.' : 'Converted to our format.',
  };
  const thumb = pf.thumbs.get(board.id);
  const preview = thumb ? pf.objects.get(thumb) : undefined;
  return { id, title, category: pick.category, tags: pick.tags, doc, assets, credit, ...(preview ? { preview } : {}), lossy: [...lossy].map(([k, v]) => `${k} ×${v}`), valign, images: [...images] };
}
