/**
 * set_page_html: HTML/CSS → canvas elements on a page.
 *
 *   parse + cascade (dom.ts) → pictures attached, fonts embedded → Yoga layout
 *   with CanvasKit text measuring (layout.ts) → element specs → buildElements
 *   (the same path add_elements takes) → merged with the elements the same
 *   nodes made before (ids, animations, filters and effects survive) → page.
 *
 * In "replace" mode the HTML becomes the page's layout source (Page.layout),
 * so get_page_html gives it back and a later edit reflows instead of nudging
 * coordinates.
 */
import { loadYoga, type Yoga } from 'yoga-layout/load';
import render from 'dom-serializer';
import type { Element as DomElement, ChildNode } from 'domhandler';
import { fitGroup, looseFill, newId, scaleElement, walk, type Element, type Fill, type Page, type TextElement } from '@digital-canvas/scene';
import type { ProjectFile } from '@digital-canvas/storage';
import { ToolError, round, type Context } from '../context.ts';
import { buildElements } from '../build.ts';
import { embedFonts } from '../fonts.ts';
import { withRenderer } from '../engine.ts';
import { cssColor, cssGradient, cssUrl, lenPx, words, type LenCtx } from './css.ts';
import { parseHtml, type SNode } from './dom.ts';
import { layout, type Box } from './layout.ts';
import { keysOnPage, sigOf } from './sync.ts';
import type { ElementSpec } from '../schemas.ts';

let yoga: Promise<Yoga> | null = null;
const Y = () => (yoga ??= loadYoga());

type Obj = Record<string, unknown>;

/** A spec with where it came from. */
interface Item { spec: Obj; lk?: string; matchId?: string; children?: Item[]; keep?: { id: string; box: Box }; group?: boolean }

export interface ApplyResult {
  /** Top-level element ids, in paint order. */
  ids: string[];
  /** Elements made or updated (all levels). */
  count: number;
  kept: number;
  removed: number;
  warnings: string[];
}

export interface ApplyOptions { mode: 'replace' | 'append' }

/** Which media reference an <img src> means. */
function srcRef(src: string): { kind: 'media'; ref: Obj } | { kind: 'icon'; name: string } | { kind: 'qr'; text: string } | { kind: 'svg'; json: string } | null {
  const s = src.trim();
  if (s.startsWith('asset:')) return { kind: 'media', ref: { asset: s.slice(6) } };
  if (s.startsWith('drive:')) return { kind: 'media', ref: { driveFileId: s.slice(6) } };
  if (s.startsWith('icon:')) return { kind: 'icon', name: s.slice(5) };
  if (s.startsWith('qr:')) return { kind: 'qr', text: s.slice(3) };
  if (s.startsWith('svg:')) return { kind: 'svg', json: s.slice(4) };
  if (/^https?:\/\//i.test(s)) return { kind: 'media', ref: { url: s } };
  if (/^[a-f0-9]{16,}\.[a-z0-9]+$/i.test(s)) return { kind: 'media', ref: { asset: s } };
  return null;
}

export async function applyHtml(ctx: Context, file: ProjectFile, pageId: string, html: string, opts: ApplyOptions): Promise<ApplyResult> {
  const doc0 = file.doc;
  const page0 = doc0.pages.find((p) => p.id === pageId)!;
  const W = doc0.width, H = doc0.height;
  const usedKeys = opts.mode === 'replace' ? keysOnPage(page0) : new Set<string>([...keysOnPage(page0)]);
  let parsed;
  try { parsed = parseHtml(html, { width: W, height: H, usedKeys }); }
  catch (e) { throw new ToolError(`could not read the HTML: ${e instanceof Error ? e.message : String(e)}`); }
  const warnings = [...parsed.warnings];
  const warn = (w: string) => { if (!warnings.includes(w) && warnings.length < 60) warnings.push(w); };
  const root = parsed.root;

  const all: SNode[] = [];
  const collect = (n: SNode) => { all.push(n); n.children.forEach(collect); };
  collect(root);

  // ---- pictures: attach once, learn their natural size
  const natural = new Map<SNode, { w: number; h: number }>();
  const pictures = new Map<SNode, Obj>();
  const dropped = new Set<SNode>();
  await Promise.all(all.filter((n) => n.kind === 'img').map(async (n) => {
    const r = srcRef(n.src!);
    if (!r) { warn(`<img src="${n.src}">: use asset:<id>, drive:<fileId>, https://…, icon:<set:name> or qr:<text>; skipped`); dropped.add(n); return; }
    if (r.kind === 'icon') { natural.set(n, { w: n.text.fontSize, h: n.text.fontSize }); pictures.set(n, { type: 'icon', icon: r.name, color: n.style.color ? cssColor(n.style.color) ?? n.text.color : n.text.color }); return; }
    if (r.kind === 'qr') { natural.set(n, { w: 240, h: 240 }); pictures.set(n, { type: 'qr', text: r.text, color: n.text.color, background: cssColor(n.style['background-color']) ?? '#ffffff' }); return; }
    if (r.kind === 'svg') {
      const v = JSON.parse(r.json) as { viewBox: { x: number; y: number; w: number; h: number }; paths: { d: string; fill?: string; stroke?: string }[] };
      if (!v.paths.length) { warn('<svg> without paths skipped'); dropped.add(n); return; }
      natural.set(n, { w: v.viewBox.w, h: v.viewBox.h });
      const col = n.text.color;
      pictures.set(n, { type: 'path', viewBox: v.viewBox, paths: v.paths.map((p) => ({ d: p.d, fill: p.fill && p.fill !== 'none' ? cssColor(p.fill) ?? col : p.stroke ? null : col, ...(p.stroke ? { stroke: { color: cssColor(p.stroke) ?? col, width: 2 } } : {}) })) });
      return;
    }
    try {
      const { id, info } = await ctx.attach(file, r.ref as never);
      if (info.kind !== 'image' && info.kind !== 'video') throw new Error(`it is ${info.kind}`);
      natural.set(n, { w: info.width ?? 400, h: info.height ?? 300 });
      pictures.set(n, { type: info.kind, asset: id });
    } catch (e) {
      warn(`<img src="${n.src}"> could not be used: ${e instanceof Error ? e.message : String(e)}`);
      dropped.add(n);
    }
  }));
  // background images too
  const bgImages = new Map<SNode, string>();
  await Promise.all(all.filter((n) => n.kind === 'box' && /url\(/i.test(n.style['background-image'] ?? '')).map(async (n) => {
    const u = cssUrl(n.style['background-image']);
    const r = u ? srcRef(u) : null;
    if (!r || r.kind !== 'media') { warn(`background-image ${n.style['background-image']}: use url(asset:<id>), url(drive:<id>) or url(https://…)`); return; }
    try { const { id } = await ctx.attach(file, r.ref as never); bgImages.set(n, id); }
    catch (e) { warn(`background-image ${u} could not be used: ${e instanceof Error ? e.message : String(e)}`); }
  }));
  if (dropped.size) {
    const prune = (n: SNode) => { n.children = n.children.filter((c) => !dropped.has(c)); n.children.forEach(prune); };
    prune(root);
  }

  // ---- text: real elements to measure (fonts embedded first)
  const texts = all.filter((n) => n.kind === 'text');
  const textSpec = (n: SNode, box?: Box): Obj => {
    const t = n.text, c = n.content!;
    return {
      type: 'text', text: c.text, ...(c.runs ? { runs: c.runs.map((r) => ({ text: r.text, ...(r.style ?? {}) })) } : {}),
      fontFamily: t.fontFamily, fontSize: round(t.fontSize, 2), color: t.color, bold: t.bold, italic: t.italic, underline: t.underline, strike: t.strike,
      align: t.align, lineHeight: round(t.lineHeight, 3), letterSpacing: round(t.letterSpacing, 2), uppercase: t.uppercase,
      x: box?.x ?? 0, y: box?.y ?? 0, w: Math.max(1, box?.w ?? 1000), h: Math.max(1, box?.h ?? 100),
    };
  };
  const measureEls = new Map<SNode, TextElement>();
  if (texts.length) {
    const built = await buildElements(ctx, file, texts.map((n) => textSpec(n)) as unknown as ElementSpec[], []);
    built.elements.forEach((e, i) => measureEls.set(texts[i]!, e as TextElement));
    // embed the faces with a scratch page holding the texts, then drop it
    const scratch: Page = { id: newId('p_'), background: { type: 'solid', color: '#ffffff' }, elements: [...measureEls.values()] };
    file.doc = { ...file.doc, pages: [...file.doc.pages, scratch] };
    const { missing } = await embedFonts(file);
    file.doc = { ...file.doc, pages: file.doc.pages.filter((p) => p.id !== scratch.id) };
    if (missing.length) warn(`font(s) not found on Google Fonts, drawn with Inter: ${missing.join(', ')} (search_fonts lists real names)`);
  }

  // ---- layout
  const page = file.doc.pages.find((p) => p.id === pageId)!;
  const currentById = new Map<string, Element>();
  for (const e of walk(page.elements)) currentById.set(e.id, e);
  const Yg = await Y();
  const minW = new Map<SNode, number>();
  const out = await withRenderer(file, (r) => {
    const cache = new Map<string, { w: number; h: number }>();
    return { minW, ...layout(Yg, root, { width: W, height: H }, {
      text(n, maxW) {
        const el = measureEls.get(n);
        if (!el) return { w: 0, h: 0 };
        const k = `${n.key}|${maxW === undefined ? '-' : Math.round(maxW * 100)}`;
        const hit = cache.get(k);
        if (hit) return hit;
        const nat = r.textWidth({ ...el, w: 100000 }) + 2;
        const w = maxW === undefined ? nat : Math.min(nat, maxW);
        const h = r.fitText({ ...el, w: Math.max(1, w) }).h;
        const v = { w, h };
        cache.set(k, v);
        return v;
      },
      minWidth(n) {
        const hit = minW.get(n);
        if (hit !== undefined) return hit;
        const el = measureEls.get(n);
        let v = 0;
        if (el) for (const w of new Set(el.text.split(/\s+/).filter(Boolean))) v = Math.max(v, r.textWidth({ ...el, text: w, runs: undefined, w: 100000 }) + 2);
        minW.set(n, v);
        return v;
      },
      image: (n) => natural.get(n) ?? null,
      keep: (n) => { const e = currentById.get(n.keepId!); return e ? { w: e.w, h: e.h } : null; },
    }) };
  }, []);
  out.warnings.forEach(warn);

  // ---- boxes → specs
  const lc = (n: SNode): LenCtx => ({ em: n.text.fontSize, rem: 16, vw: W, vh: H });
  const rot = (n: SNode) => { const m = n.style.transform?.match(/rotate\(\s*(-?[\d.]+)(deg|turn|rad)?\s*\)/); if (!m) return 0; const v = parseFloat(m[1]!); return m[2] === 'turn' ? v * 360 : m[2] === 'rad' ? (v * 180) / Math.PI : v; };
  const opacityOf = (n: SNode) => { const v = parseFloat(n.style.opacity ?? '1'); return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1; };
  const radiusOf = (n: SNode, b: Box) => { const v = n.style['border-radius']; if (!v) return 0; const p = lenPx(v, lc(n), Math.min(b.w, b.h)); return Math.min(p ?? 0, Math.min(b.w, b.h) / 2); };
  const named = (n: SNode) => n.dom.attribs['data-name'] ?? n.dom.attribs.id ?? n.dom.attribs.class?.trim().split(/\s+/)[0];

  const borders = (n: SNode) => (['top', 'right', 'bottom', 'left'] as const).map((s) => ({
    side: s, w: n.style[`border-${s}-style`] === 'none' ? 0 : lenPx(n.style[`border-${s}-width`], lc(n)) ?? 0,
    color: cssColor(n.style[`border-${s}-color`]) ?? n.text.color, dash: n.style[`border-${s}-style`] === 'dashed' ? 'dashed' : n.style[`border-${s}-style`] === 'dotted' ? 'dotted' : 'solid',
  }));

  const transformWarned = new Set<string>();
  const emit = (n: SNode, alpha: number, depth: number): Item[] => {
    const b = out.boxes.get(n);
    if (!b) return [];
    const a = alpha * opacityOf(n);
    const name = named(n);
    const look = (spec: Obj): Obj => ({ ...spec, ...(a < 1 ? { opacity: round(a, 3) } : {}), ...(rot(n) ? { rotation: rot(n) } : {}), ...(n.spec ?? {}) });
    if (n.kind === 'text') {
      const parent = n; // the text leaf shares its owner's key
      const mw = out.minW.get(n) ?? 0;
      const tb = mw > b.w ? { ...b, w: mw } : b;
      return [{ spec: { ...textSpec(n, tb), ...(a < 1 ? { opacity: round(a, 3) } : {}), ...(rot(n) ? { rotation: rot(n) } : {}) }, lk: `${parent.key}:t`, matchId: n.dom.attribs['data-id'] }];
    }
    if (n.kind === 'keep') return [{ spec: {}, keep: { id: n.keepId!, box: b }, lk: `${n.key}:keep`, matchId: n.keepId }];
    if (n.kind === 'img') {
      const pic = pictures.get(n);
      if (!pic) return [];
      const fit = (n.style['object-fit'] ?? 'cover').trim();
      const pos = n.style['object-position'];
      const focus = pos ? (() => { const w = words(pos).map((x) => (x === 'left' || x === 'top' ? 0 : x === 'right' || x === 'bottom' ? 1 : x === 'center' ? 0.5 : x.endsWith('%') ? parseFloat(x) / 100 : 0.5)); return { x: w[0] ?? 0.5, y: w[1] ?? w[0] ?? 0.5 }; })() : undefined;
      const spec: Obj = { ...pic, x: b.x, y: b.y, w: b.w, h: b.h, ...(pic.type === 'image' || pic.type === 'video' ? { fit: fit === 'contain' || fit === 'scale-down' ? 'contain' : 'cover', ...(focus ? { focus } : {}), ...(radiusOf(n, b) ? { radius: round(radiusOf(n, b), 1) } : {}) } : {}), ...(name ? { name } : {}) };
      return [{ spec: look(spec), lk: `${n.key}:img`, matchId: n.matchId }];
    }
    // box
    const items: Item[] = [];
    const isRoot = n === root;
    const bgColor = cssColor(n.style['background-color']);
    const grad = n.style['background-image'] && /gradient/i.test(n.style['background-image']) ? cssGradient(n.style['background-image']) : null;
    const fill: Fill | null = grad ?? (bgColor && bgColor !== '#00000000' ? { type: 'solid', color: bgColor } : null);
    const bs = borders(n);
    const uniform = bs.every((x) => x.w === bs[0]!.w && x.color === bs[0]!.color && x.dash === bs[0]!.dash);
    const stroke = uniform && bs[0]!.w > 0 ? { color: bs[0]!.color, width: bs[0]!.w, dash: bs[0]!.dash } : null;
    if (!isRoot) {
      if (n.style['box-shadow'] && n.style['box-shadow'] !== 'none') warn('box-shadow is not drawn; use a second box behind (offset, darker) for a shadow');
      if (fill || stroke) {
        // the canvas draws strokes centred on the edge: inset by half to stay inside the border box like CSS
        const inset = stroke ? stroke.width / 2 : 0;
        items.push({ spec: look({ type: 'shape', shape: 'rect', x: b.x + inset, y: b.y + inset, w: Math.max(1, b.w - 2 * inset), h: Math.max(1, b.h - 2 * inset), fill, stroke, radius: round(Math.max(0, radiusOf(n, b) - inset), 1), ...(name ? { name } : {}) }), lk: `${n.key}:bg`, matchId: n.matchId });
      }
      if (!uniform) for (const s of bs) {
        if (s.w <= 0) continue;
        const r = s.side === 'top' ? { x: b.x, y: b.y, w: b.w, h: s.w } : s.side === 'bottom' ? { x: b.x, y: b.y + b.h - s.w, w: b.w, h: s.w } : s.side === 'left' ? { x: b.x, y: b.y, w: s.w, h: b.h } : { x: b.x + b.w - s.w, y: b.y, w: s.w, h: b.h };
        if (s.dash === 'solid') items.push({ spec: look({ type: 'shape', shape: 'rect', ...r, fill: { type: 'solid', color: s.color }, stroke: null, radius: 0 }), lk: `${n.key}:b${s.side[0]}` });
        else {
          const horiz = s.side === 'top' || s.side === 'bottom';
          const cy = r.y + r.h / 2, cx = r.x + r.w / 2;
          items.push({ spec: look({ type: 'line', ...(horiz ? { x1: r.x, y1: cy, x2: r.x + r.w, y2: cy } : { x1: cx, y1: r.y, x2: cx, y2: r.y + r.h }), stroke: { color: s.color, width: s.w, dash: s.dash } }), lk: `${n.key}:b${s.side[0]}` });
        }
      }
      const bi = bgImages.get(n);
      if (bi) {
        const contain = (n.style['background-size'] ?? '').includes('contain');
        items.push({ spec: look({ type: 'image', asset: bi, x: b.x, y: b.y, w: b.w, h: b.h, fit: contain ? 'contain' : 'cover', ...(radiusOf(n, b) ? { radius: round(radiusOf(n, b), 1) } : {}) }), lk: `${n.key}:bi` });
      }
    } else {
      const bi = bgImages.get(n);
      if (bi) items.push({ spec: { type: 'image', asset: bi, x: 0, y: 0, w: W, h: H, fit: 'cover' }, lk: `${n.key}:bi` });
    }
    if (rot(n) && !transformWarned.has(n.key) && n.children.length) { transformWarned.add(n.key); if (!n.group && depth > 1) warn(`transform: rotate on a box with content only turns its background; add data-group to turn it all (${name ?? n.key})`); }
    const kids = out.order.get(n) ?? n.children;
    for (const c of kids) items.push(...emit(c, a, depth + 1));
    if (isRoot) return items;
    const groupIt = n.group || (depth === 1 && items.length > 1);
    if (groupIt && items.length > 1) return [{ spec: { type: 'group', ...(name ? { name } : {}), ...(rot(n) && n.group ? { rotation: rot(n) } : {}) }, children: items, lk: `${n.key}:g`, matchId: n.matchId, group: true }];
    return items;
  };
  const items = emit(root, 1, 0);

  // ---- build leaves in one batch, then assemble groups
  const leaves: Item[] = [];
  const flat = (list: Item[]) => list.forEach((i) => (i.children ? flat(i.children) : !i.keep && leaves.push(i)));
  flat(items);
  const built = leaves.length ? await buildElements(ctx, file, leaves.map((l) => l.spec) as unknown as ElementSpec[], warnings) : { elements: [] as Element[] };
  const madeOf = new Map<Item, Element>();
  leaves.forEach((l, i) => {
    let e = built.elements[i]!;
    const s = l.spec as { x: number; y: number; w: number; h: number; type: string; fit?: string };
    // layout boxes win (text, shapes); pictures keep the crop buildElements chose
    if (s.type === 'text' || s.type === 'shape') e = { ...e, x: s.x, y: s.y, w: s.w, h: s.h };
    madeOf.set(l, e);
  });

  // ---- merge with what these nodes made before
  const prevByLk = new Map<string, Element>();
  for (const e of walk(page.elements)) if (e.lk) prevByLk.set(e.lk, e);
  const used = new Set<string>();
  let kept = 0, count = 0;
  const merge = (prev: Element | undefined, made: Element): Element => {
    if (!prev || prev.type !== made.type || used.has(prev.id)) return made;
    used.add(prev.id);
    const m: Element = { ...prev, ...made, id: prev.id } as Element;
    const p = prev as unknown as Obj, o = m as unknown as Obj;
    if (made.type === 'text') {
      if (!(made as TextElement).runs) delete o.runs;
      const pt = prev as TextElement;
      if (pt.exact && (pt.text !== (made as TextElement).text || JSON.stringify(pt.style) !== JSON.stringify((made as TextElement).style))) delete o.exact;
      if (!('effect' in (made as unknown as Obj)) && p.effect) o.effect = p.effect;
    }
    if (made.type === 'image' && prev.type === 'image' && prev.asset === made.asset && Math.abs(prev.w - made.w) < 0.5 && Math.abs(prev.h - made.h) < 0.5 && prev.crop) o.crop = prev.crop;
    return m;
  };
  const prevFor = (it: Item): Element | undefined => {
    if (it.lk && prevByLk.has(it.lk)) return prevByLk.get(it.lk);
    if (it.matchId && currentById.has(it.matchId)) return currentById.get(it.matchId);
    return undefined;
  };
  const assemble = (list: Item[]): Element[] => list.flatMap((it): Element[] => {
    if (it.keep) {
      const e = currentById.get(it.keep.id);
      if (!e) { warn(`<dc-element data-id="${it.keep.id}">: no such element on this page; skipped`); return []; }
      used.add(e.id);
      kept++;
      const b = it.keep.box;
      let moved: Element;
      if (Math.abs(b.w - e.w) < 0.5 && Math.abs(b.h - e.h) < 0.5) moved = scaleElement(e, 1, b.x - e.x, b.y - e.y);
      else if (e.type === 'group' || e.type === 'line') { const s = b.w / Math.max(1, e.w); moved = scaleElement(e, s, b.x - e.x * s, b.y - e.y * s); }
      else moved = { ...e, x: b.x, y: b.y, w: b.w, h: b.h };
      return [{ ...moved, ...(it.lk ? { lk: it.lk } : {}) }];
    }
    if (it.children) {
      const kids = assemble(it.children);
      if (!kids.length) return [];
      const prev = prevFor(it);
      const g = fitGroup({ ...(prev && prev.type === 'group' && !used.has(prev.id) ? prev : {}), id: prev && prev.type === 'group' && !used.has(prev.id) ? prev.id : newId('e_'), type: 'group', x: 0, y: 0, w: 1, h: 1, rotation: (it.spec.rotation as number) ?? 0, opacity: 1, children: kids, ...(it.spec.name ? { name: it.spec.name as string } : {}), ...(it.lk ? { lk: it.lk } : {}) } as Element);
      if (prev) used.add(prev.id);
      count++;
      return [g];
    }
    const made = madeOf.get(it);
    if (!made) return [];
    count++;
    const m = merge(prevFor(it), made);
    return [{ ...m, ...(it.lk && opts.mode === 'replace' ? { lk: it.lk } : {}) } as Element];
  });
  let elements = assemble(items);
  if (opts.mode === 'append') elements = elements.map(function strip(e): Element { const { lk: _lk, ...rest } = e as Element & { lk?: string }; return (rest.type === 'group' ? { ...rest, children: rest.children.map(strip) } : rest) as Element; });

  // ---- the page
  const bodyFill: Fill | null = (() => {
    const g = root.style['background-image'] && /gradient/i.test(root.style['background-image']) ? cssGradient(root.style['background-image']) : null;
    if (g) return g;
    const c = cssColor(root.style['background-color']);
    return c && c !== '#00000000' ? looseFill(c) : null;
  })();
  let next: Page;
  if (opts.mode === 'replace') {
    const sig: Record<string, [string, number, number, number, number]> = {};
    for (const e of walk(elements)) if (e.lk) sig[e.lk] = sigOf(e);
    next = { ...page, elements, ...(bodyFill ? { background: bodyFill } : {}), layout: { html: sourceOf(parsed), sig } };
  } else {
    next = { ...page, elements: [...page.elements, ...elements] };
  }
  file.doc = { ...file.doc, pages: file.doc.pages.map((p) => (p.id === pageId ? next : p)) };
  const { missing } = await embedFonts(file);
  if (missing.length) warn(`font(s) not found: ${missing.join(', ')}`);
  return { ids: elements.map((e) => e.id), count, kept, removed: opts.mode === 'replace' ? countRemoved(page.elements, used, elements) : 0, warnings: warnings.slice(0, 40) };
}

function countRemoved(before: readonly Element[], used: Set<string>, after: readonly Element[]): number {
  const now = new Set([...walk(after)].map((e) => e.id));
  return [...walk(before)].filter((e) => !now.has(e.id) && !used.has(e.id)).length;
}

const isEl = (n: ChildNode): n is DomElement => n.type === 'tag' || n.type === 'style' || n.type === 'script';

/** The annotated source to keep: one <style> with every sheet, then the body (data-id only on kept elements). */
function sourceOf(parsed: ReturnType<typeof parseHtml>): string {
  let body: DomElement | null = null;
  const find = (n: ChildNode) => { if (body || !isEl(n)) return; if (n.name === 'body') body = n; else n.children.forEach(find); };
  parsed.doc.children.forEach(find);
  const clean = (el: DomElement) => {
    el.children = el.children.filter((c) => !(isEl(c) && (c.name === 'style' || c.name === 'script')) && c.type !== 'comment');
    if (el.name !== 'dc-element') delete el.attribs['data-id'];
    el.children.forEach((c) => isEl(c) && clean(c));
  };
  clean(body!);
  const css = parsed.css.trim();
  return `${css ? `<style>\n${css}\n</style>\n` : ''}${render(body!, { encodeEntities: 'utf8' })}`;
}
