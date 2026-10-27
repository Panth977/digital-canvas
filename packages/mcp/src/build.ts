/**
 * Agent element specs → scene elements, and patches → updated elements.
 * Shapes, text, lines, charts, tables and paths go through the scene's
 * "loose" reader; pictures, clips, icons and QR codes are resolved here.
 */
import {
  completePage, coverCrop, defaultEffect, defaultImageEffect, filterPreset, fitGroup, line, looseColor, looseFill, newId, qrCode, qrUpdate,
  type Animation, type Element, type ImageEffect, type ImageElement, type PathElement, type ShapeKind, type TextEffect, type TextElement, type TextRun,
  type TextStyle, type VideoElement, type Doc,
} from '@digital-canvas/scene';
import type { ProjectFile } from '@digital-canvas/storage';
import { ToolError, round, type Context } from './context.ts';
import { iconElements, iconPath } from './stock.ts';
import type { ElementPatch, ElementSpec } from './schemas.ts';
import { withRenderer } from './engine.ts';

type Obj = Record<string, unknown>;
const SHAPE_ALIAS: Record<string, ShapeKind> = { circle: 'ellipse', square: 'rect' };
const shapeKind = (s: string): ShapeKind => SHAPE_ALIAS[s] ?? (s as ShapeKind);

/** Keys each element type understands (others are reported). */
const COMMON = ['type', 'name', 'x', 'y', 'w', 'h', 'rotation', 'opacity', 'locked', 'hidden', 'animation', 'timing', 'id'];
const KEYS: Record<string, string[]> = {
  text: ['text', 'fontFamily', 'fontSize', 'color', 'bold', 'italic', 'underline', 'strike', 'uppercase', 'align', 'lineHeight', 'letterSpacing', 'list', 'curve', 'gradient', 'effect', 'anchor', 'runs', 'autoFit'],
  shape: ['shape', 'fill', 'stroke', 'radius'],
  line: ['x1', 'y1', 'x2', 'y2', 'color', 'strokeWidth', 'stroke', 'startMarker', 'endMarker', 'route'],
  image: ['asset', 'url', 'driveFileId', 'fit', 'focus', 'mask', 'filter', 'adjust', 'effect', 'radius'],
  video: ['asset', 'url', 'driveFileId', 'fit', 'focus', 'mask', 'filter', 'adjust', 'effect', 'radius', 'trimStart', 'trimEnd', 'loop', 'muted', 'volume'],
  icon: ['icon', 'color'],
  qr: ['text', 'color', 'background'],
  chart: ['chart', 'labels', 'series', 'colors', 'legend', 'grid', 'fontFamily', 'fontSize', 'color'],
  table: ['rows', 'headerFill', 'fontFamily', 'fontSize', 'color', 'stroke'],
  path: ['d', 'viewBox', 'fill', 'stroke', 'paths'],
  group: ['children'],
};
KEYS.arrow = KEYS.line!;

function unknownKeys(spec: Obj, type: string): string[] {
  const ok = new Set([...COMMON, ...(KEYS[type] ?? [])]);
  return Object.keys(spec).filter((k) => !ok.has(k) && spec[k] !== undefined);
}

function cleanAnimation(a: unknown): Animation | undefined {
  if (!a || typeof a !== 'object') return undefined;
  const o = a as Obj;
  return { type: o.type as Animation['type'], ...(typeof o.duration === 'number' ? { duration: o.duration } : {}), ...(typeof o.direction === 'string' ? { direction: o.direction as Animation['direction'] } : {}) };
}

function textEffect(v: Obj): TextEffect {
  const base = defaultEffect(v.type as TextEffect['type']) as unknown as Obj;
  const out: Obj = { ...base };
  for (const k of Object.keys(base)) if (v[k] !== undefined) out[k] = k === 'color' ? looseColor(v[k]) ?? base[k] : v[k];
  return out as unknown as TextEffect;
}

function imageEffect(v: Obj): ImageEffect {
  const base = defaultImageEffect(v.type as ImageEffect['type']) as unknown as Obj;
  const out: Obj = { ...base };
  for (const k of Object.keys(base)) if (v[k] !== undefined) out[k] = ['color', 'light', 'dark'].includes(k) ? looseColor(v[k]) ?? base[k] : v[k];
  return out as unknown as ImageEffect;
}

function runsFrom(spec: Obj): TextRun[] | undefined {
  if (!Array.isArray(spec.runs) || !spec.runs.length) return undefined;
  return (spec.runs as Obj[]).map((r) => {
    const style: Partial<TextStyle> = {};
    const c = looseColor(r.color);
    if (c) style.color = c;
    for (const k of ['bold', 'italic', 'underline'] as const) if (typeof r[k] === 'boolean') style[k] = r[k] as boolean;
    if (typeof r.fontFamily === 'string') style.fontFamily = r.fontFamily;
    if (typeof r.fontSize === 'number') style.fontSize = r.fontSize;
    return { text: String(r.text ?? ''), ...(Object.keys(style).length ? { style } : {}) };
  });
}

/** Cover crop that keeps `focus` (0..1 of the picture) in view. */
function focusCrop(iw: number, ih: number, w: number, h: number, focus?: { x: number; y: number }) {
  const c = coverCrop(iw, ih, w, h);
  if (!focus) return undefined;
  const cl = (v: number, size: number) => Math.max(0, Math.min(1 - size, v - size / 2));
  return { ...c, x: cl(focus.x, c.w), y: cl(focus.y, c.h) };
}

/** Text, shape, line, chart, table, path through the loose reader (one element). */
function viaLoose(spec: Obj, doc: Doc): Element | null {
  const s: Obj = { ...spec };
  if (spec.type === 'shape' && typeof spec.shape === 'string') s.shape = shapeKind(spec.shape);
  if ((spec.type === 'line' || spec.type === 'arrow') && spec.stroke && typeof spec.stroke === 'object') {
    const st = spec.stroke as Obj;
    s.stroke = { color: st.color ?? spec.color ?? '#1f2328', width: st.width ?? spec.strokeWidth ?? 4, dash: st.dash };
  }
  if (spec.type === 'table' && Array.isArray(spec.rows)) s.rows = spec.rows;
  if (spec.type === 'chart' && (spec.fontFamily || spec.fontSize || spec.color)) s.style = { fontFamily: spec.fontFamily, fontSize: spec.fontSize, color: spec.color };
  if (spec.type === 'text' && spec.runs && !spec.text) s.text = (runsFrom(spec) ?? []).map((r) => r.text).join('');
  const page = completePage({ elements: [s] }, { width: doc.width, height: doc.height });
  return page.elements[0] ?? null;
}

/** Apply the fields every element shares (name, box extras, animation, timing). */
function common<T extends Element>(el: T, spec: Obj): T {
  const out: Obj = { ...el };
  if (typeof spec.name === 'string') out.name = spec.name;
  for (const k of ['locked', 'hidden'] as const) if (typeof spec[k] === 'boolean') out[k] = spec[k];
  if (spec.animation) out.animation = cleanAnimation(spec.animation);
  if (spec.timing && typeof spec.timing === 'object') out.timing = { ...(spec.timing as Obj) };
  return out as T;
}

export interface BuildResult {
  elements: Element[];
  warnings: string[];
  /** Text elements to measure after fonts are in (id → how). */
  fit: Map<string, { autoW: boolean; autoH: boolean; shrink: boolean; centreX: boolean }>;
}

export async function buildElements(ctx: Context, file: ProjectFile, specs: ElementSpec[], warnings: string[] = [], fit = new Map<string, { autoW: boolean; autoH: boolean; shrink: boolean; centreX: boolean }>()): Promise<BuildResult> {
  const out: Element[] = [];
  // icons in one batch
  const iconNames = specs.filter((s) => s.type === 'icon' && typeof s.icon === 'string').map((s) => s.icon!.trim());
  const icons = iconNames.length ? await iconElements(iconNames).catch(() => new Map<string, string>()) : new Map<string, string>();
  for (const [i, spec0] of specs.entries()) {
    const spec = spec0 as unknown as Obj;
    const where = `element ${i + 1} (${spec.type})`;
    const extra = unknownKeys(spec, String(spec.type));
    if (extra.length) warnings.push(`${where}: ignored ${extra.map((k) => `"${k}"`).join(', ')} (not used by ${spec.type} elements)`);
    const doc = file.doc;
    const W = doc.width, H = doc.height;
    let el: Element | null = null;
    switch (spec.type) {
      case 'text': {
        if (!spec.text && !spec.runs) throw new ToolError(`${where}: text needs \`text\``);
        const t = viaLoose(spec, doc) as TextElement | null;
        if (!t) throw new ToolError(`${where}: could not read this text element`);
        const runs = runsFrom(spec);
        if (runs) { t.runs = runs; t.text = runs.map((r) => r.text).join(''); }
        if (spec.effect && typeof spec.effect === 'object') t.effect = textEffect(spec.effect as Obj);
        if (spec.anchor) t.anchor = spec.anchor as TextElement['anchor'];
        el = t;
        fit.set(t.id, { autoW: spec.w === undefined, autoH: spec.h === undefined, shrink: spec.autoFit === 'shrink', centreX: spec.x === undefined });
        break;
      }
      case 'shape': case 'line': case 'arrow': case 'chart': case 'table': case 'path': {
        if (spec.type === 'path' && !spec.d && !spec.paths) throw new ToolError(`${where}: path needs \`d\` (SVG path data) and \`viewBox\``);
        el = viaLoose(spec, doc);
        if (!el) throw new ToolError(`${where}: could not read it`, 'check the field names against the add_elements schema');
        break;
      }
      case 'image': case 'video': {
        const { id, info } = await ctx.attach(file, { asset: spec.asset as string | undefined, url: spec.url as string | undefined, driveFileId: spec.driveFileId as string | undefined, name: spec.name as string | undefined });
        if (info.kind !== spec.type) throw new ToolError(`${where}: that file is ${info.kind === 'audio' ? 'a sound' : `a ${info.kind}`}, not a ${spec.type}`, info.kind === 'audio' ? 'use set_audio for music and sounds' : `use type "${info.kind}"`);
        const iw = info.width ?? 1000, ih = info.height ?? 1000;
        let w = spec.w as number | undefined, h = spec.h as number | undefined;
        const contain = spec.fit === 'contain';
        if (w === undefined && h === undefined) { const s = Math.min((W * 0.6) / iw, (H * 0.6) / ih); w = iw * s; h = ih * s; }
        else if (w === undefined) w = (h! * iw) / ih;
        else if (h === undefined) h = (w * ih) / iw;
        else if (contain) { const s = Math.min(w / iw, h / ih); const cw = iw * s, ch = ih * s; spec.x = (spec.x as number ?? (W - w) / 2) + (w - cw) / 2; spec.y = (spec.y as number ?? (H - h) / 2) + (h - ch) / 2; w = cw; h = ch; }
        const x = typeof spec.x === 'number' ? spec.x : (W - w!) / 2, y = typeof spec.y === 'number' ? spec.y : (H - h!) / 2;
        const base = { id: newId('e_'), x, y, w: w!, h: h!, rotation: (spec.rotation as number) ?? 0, opacity: (spec.opacity as number) ?? 1, radius: (spec.radius as number) ?? 0, asset: id };
        const crop = focusCrop(iw, ih, w!, h!, spec.focus as { x: number; y: number } | undefined);
        const pic: ImageElement | VideoElement = spec.type === 'image'
          ? { ...base, type: 'image', ...(spec.mask ? { mask: shapeKind(String(spec.mask)) } : {}) }
          : { ...base, type: 'video', ...(spec.trimStart !== undefined ? { trimStart: spec.trimStart as number } : {}), ...(spec.trimEnd !== undefined ? { trimEnd: spec.trimEnd as number } : {}),
            ...(spec.loop ? { loop: true } : {}), ...(spec.muted ? { muted: true } : {}), ...(spec.volume !== undefined ? { volume: spec.volume as number } : {}) };
        if (crop) pic.crop = crop;
        if (spec.mask && spec.type === 'video') warnings.push(`${where}: masks apply to images only`);
        lookOf(pic, spec, warnings, where);
        if (spec.type === 'video' && info.duration && spec.trimEnd !== undefined && (spec.trimEnd as number) > info.duration) warnings.push(`${where}: trimEnd ${spec.trimEnd}s is past the clip's end (${round(info.duration)}s)`);
        el = pic;
        break;
      }
      case 'icon': {
        const name = String(spec.icon ?? '').trim();
        if (!/^[a-z0-9-]+:[a-z0-9-]+$/i.test(name)) throw new ToolError(`${where}: \`icon\` must be an Iconify name like "mdi:instagram"`, 'find names with search_stock (kind "icon", "graphic" or "sticker")');
        const svg = icons.get(name);
        if (!svg) throw new ToolError(`${where}: icon "${name}" was not found on Iconify`, 'search_stock kind "icon" lists real names');
        const size = (spec.w as number) ?? (spec.h as number) ?? Math.round(Math.min(W, H) * 0.12);
        const bw = (spec.w as number) ?? size, bh = (spec.h as number) ?? size;
        const box = { x: (spec.x as number) ?? (W - bw) / 2, y: (spec.y as number) ?? (H - bh) / 2, w: bw, h: bh, rotation: spec.rotation as number, opacity: spec.opacity as number };
        const p = iconPath(svg, looseColor(spec.color) ?? '#1f2328', box, name);
        if (!p) throw new ToolError(`${where}: icon "${name}" could not be read`);
        el = { ...p, id: newId('e_') } as PathElement;
        break;
      }
      case 'qr': {
        if (!spec.text) throw new ToolError(`${where}: qr needs \`text\` (the URL or data to encode)`);
        const s = (spec.w as number) ?? (spec.h as number) ?? Math.round(Math.min(W, H) * 0.25);
        const light = spec.background === null ? null : looseColor(spec.background) ?? '#ffffff';
        el = qrCode(String(spec.text), { x: (spec.x as number) ?? (W - s) / 2, y: (spec.y as number) ?? (H - s) / 2, w: s, h: s }, looseColor(spec.color) ?? '#000000', light);
        break;
      }
      case 'group': {
        const kids = Array.isArray(spec.children) ? spec.children as ElementSpec[] : [];
        if (!kids.length) throw new ToolError(`${where}: group needs \`children\``);
        const inner = await buildElements(ctx, file, kids, warnings, fit);
        el = fitGroup({ id: newId('e_'), type: 'group', x: 0, y: 0, w: 1, h: 1, rotation: 0, opacity: (spec.opacity as number) ?? 1, children: inner.elements });
        break;
      }
      default:
        throw new ToolError(`${where}: unknown type`, 'type is one of text, shape, line, arrow, image, video, icon, qr, chart, table, path, group');
    }
    if (el) out.push(common(el, spec));
  }
  return { elements: out, warnings, fit };
}

function lookOf(pic: ImageElement | VideoElement, spec: Obj, warnings: string[], where: string): void {
  if (spec.filter && typeof spec.filter === 'object') {
    const f = spec.filter as Obj;
    const preset = filterPreset(String(f.name));
    if (preset) pic.filter = { name: preset.name, intensity: typeof f.intensity === 'number' ? f.intensity : 100 };
    else warnings.push(`${where}: no filter named "${f.name}" (see the design guide resource for names)`);
  } else if (spec.filter === null) delete pic.filter;
  if (spec.adjust && typeof spec.adjust === 'object') pic.adjust = { ...pic.adjust, ...(spec.adjust as object) };
  if (spec.effect && typeof spec.effect === 'object') {
    const t = (spec.effect as Obj).type;
    if (['shadow', 'glow', 'duotone', 'pixelate', 'outline'].includes(String(t))) pic.effect = imageEffect(spec.effect as Obj);
    else warnings.push(`${where}: "${t}" is not an image effect (shadow, glow, duotone, pixelate, outline)`);
  } else if (spec.effect === null) delete pic.effect;
}

// ---------------------------------------------------------------- measuring text

/**
 * Size text boxes with the real renderer (fonts must be embedded first):
 * heights follow the text, missing widths hug it, "shrink" lowers the font
 * size until the text fits its box.
 */
export async function fitTexts(file: ProjectFile, fit: BuildResult['fit']): Promise<void> {
  if (!fit.size) return;
  const doc = file.doc;
  await withRenderer(file, (r) => {
    const fix = (e: Element): Element => {
      if (e.type === 'group') return fitGroup({ ...e, children: e.children.map(fix) });
      const how = e.type === 'text' ? fit.get(e.id) : undefined;
      if (!how || e.type !== 'text') return e;
      let t: TextElement = e;
      if (how.autoW && !t.curve) {
        const max = Math.max(40, doc.width - 2 * Math.round(doc.width * 0.06));
        const w = Math.min(max, r.textWidth(t) + 4);
        t = { ...t, w };
        if (how.centreX) t.x = (doc.width - w) / 2;
      }
      if (how.shrink) {
        let size = t.style.fontSize;
        const fits = (s: number) => {
          const tt = scaleText(t, s / t.style.fontSize);
          return r.fitText(tt).h <= t.h + 0.5 && (tt.curve || r.textWidth({ ...tt, list: undefined }) <= t.w + 1 || t.text.includes(' '));
        };
        while (size > 6 && !fits(size)) size = Math.floor(size * 0.94);
        if (size !== t.style.fontSize) t = scaleText(t, size / t.style.fontSize);
        return t;
      }
      if (how.autoH || t.curve) {
        const s = r.fitText(t);
        t = { ...t, h: Math.ceil(s.h), ...(t.curve ? { w: Math.ceil(s.w) } : {}) };
      }
      return t;
    };
    file.doc = { ...doc, pages: doc.pages.map((p) => ({ ...p, elements: p.elements.map(fix) })) };
  });
}

function scaleText(t: TextElement, k: number): TextElement {
  return {
    ...t,
    style: { ...t.style, fontSize: Math.max(4, Math.round(t.style.fontSize * k * 10) / 10) },
    ...(t.runs ? { runs: t.runs.map((r) => (r.style?.fontSize ? { ...r, style: { ...r.style, fontSize: r.style.fontSize * k } } : r)) } : {}),
  };
}

// ---------------------------------------------------------------- patches

const STYLE_KEYS = ['fontFamily', 'fontSize', 'bold', 'italic', 'underline', 'strike', 'uppercase', 'align', 'lineHeight', 'letterSpacing'] as const;

/**
 * One patch → the changed element (a new object). Geometry patches on groups
 * are applied by the caller through `updateElements` so children follow.
 */
export async function patchElement(ctx: Context, file: ProjectFile, el: Element, patch: ElementPatch, warnings: string[]): Promise<{ el: Element; refit: boolean }> {
  const p = patch as unknown as Obj;
  const where = `${el.id} (${el.type})`;
  const extra = unknownKeys(p, el.type === 'path' ? (el.qr ? 'qr' : 'icon') : el.type).filter((k) => !(el.type === 'path' && KEYS.path!.includes(k)));
  if (extra.length) warnings.push(`${where}: ignored ${extra.map((k) => `"${k}"`).join(', ')} (not used by ${el.type} elements)`);
  const o: Obj = { ...el };
  for (const k of ['name', 'x', 'y', 'w', 'h', 'rotation', 'opacity', 'locked', 'hidden'] as const) if (p[k] !== undefined) o[k] = p[k];
  if (p.animation === null) delete o.animation; else if (p.animation) o.animation = cleanAnimation(p.animation);
  if (p.timing === null) delete o.timing; else if (p.timing) o.timing = { ...(p.timing as Obj) };
  let refit = false;
  switch (el.type) {
    case 'text': {
      const style: Obj = { ...el.style };
      for (const k of STYLE_KEYS) if (p[k] !== undefined) { style[k] = p[k]; refit = true; }
      if (p.color !== undefined) style.color = looseColor(p.color) ?? style.color;
      o.style = style;
      if (p.runs) { const runs = runsFrom(p)!; o.runs = runs; o.text = runs.map((r) => r.text).join(''); refit = true; }
      else if (typeof p.text === 'string' && p.text !== el.text) { o.text = p.text; delete o.runs; refit = true; }
      else if (o.runs && (p.color !== undefined || p.fontFamily !== undefined || p.fontSize !== undefined)) {
        // a whole-box style change wins over the runs' own values for that property
        o.runs = (o.runs as TextRun[]).map((r) => {
          if (!r.style) return r;
          const s: Obj = { ...r.style };
          if (p.color !== undefined) delete s.color;
          if (p.fontFamily !== undefined) delete s.fontFamily;
          if (p.fontSize !== undefined) delete s.fontSize;
          return Object.keys(s).length ? { ...r, style: s } : { text: r.text };
        });
      }
      if (p.effect === null) delete o.effect; else if (p.effect && typeof p.effect === 'object') o.effect = textEffect(p.effect as Obj);
      if (p.gradient === null) delete o.gradient; else if (p.gradient !== undefined) { const g = looseFill(p.gradient); if (g?.type === 'linear') o.gradient = g; }
      if (p.list === null) delete o.list; else if (p.list) o.list = p.list;
      if (p.curve !== undefined) { if (p.curve) o.curve = p.curve; else delete o.curve; refit = true; }
      if (p.anchor) o.anchor = p.anchor;
      if (p.w !== undefined) refit = true;
      if (p.h !== undefined) refit = false;
      break;
    }
    case 'shape':
      if (p.shape) o.shape = shapeKind(String(p.shape));
      if (p.fill !== undefined) o.fill = p.fill === null ? null : looseFill(p.fill) ?? el.fill;
      if (p.stroke !== undefined) o.stroke = p.stroke === null ? null : { color: looseColor((p.stroke as Obj).color) ?? '#1f2328', width: ((p.stroke as Obj).width as number) ?? 2, dash: ((p.stroke as Obj).dash as 'solid') ?? 'solid' };
      if (p.radius !== undefined) o.radius = p.radius;
      if (p.color !== undefined && p.fill === undefined) o.fill = looseFill(p.color);
      break;
    case 'line': {
      const ax = el.x + el.start.x, ay = el.y + el.start.y, bx = el.x + el.end.x, by = el.y + el.end.y;
      let next = el;
      if ([p.x1, p.y1, p.x2, p.y2].some((v) => v !== undefined)) {
        const L = line({ x: (p.x1 as number) ?? ax, y: (p.y1 as number) ?? ay }, { x: (p.x2 as number) ?? bx, y: (p.y2 as number) ?? by }, { stroke: el.stroke, route: el.route, start: el.start.marker, end: el.end.marker });
        next = { ...el, x: L.x, y: L.y, w: L.w, h: L.h, start: { ...el.start, x: L.start.x, y: L.start.y }, end: { ...el.end, x: L.end.x, y: L.end.y } };
        Object.assign(o, { x: next.x, y: next.y, w: next.w, h: next.h, start: next.start, end: next.end });
      }
      const stroke = { ...el.stroke };
      if (p.color !== undefined) stroke.color = looseColor(p.color) ?? stroke.color;
      if (p.strokeWidth !== undefined) stroke.width = p.strokeWidth as number;
      if (p.stroke && typeof p.stroke === 'object') { const s = p.stroke as Obj; if (s.color) stroke.color = looseColor(s.color) ?? stroke.color; if (s.width) stroke.width = s.width as number; if (s.dash) stroke.dash = s.dash as 'solid'; }
      o.stroke = stroke;
      if (p.startMarker) o.start = { ...(o.start as object), marker: p.startMarker };
      if (p.endMarker) o.end = { ...(o.end as object), marker: p.endMarker };
      if (p.route) o.route = p.route;
      break;
    }
    case 'image': case 'video': {
      if (p.asset || p.url || p.driveFileId) {
        const { id, info } = await ctx.attach(file, { asset: p.asset as string, url: p.url as string, driveFileId: p.driveFileId as string, name: p.name as string });
        if (info.kind !== el.type) throw new ToolError(`${where}: that file is a ${info.kind}; it can't replace a ${el.type}`);
        o.asset = id;
        delete o.crop;
        delete o.poster;
        if (p.focus || (info.width && info.height)) {
          const c = focusCrop(info.width ?? 1, info.height ?? 1, (o.w as number), (o.h as number), p.focus as { x: number; y: number } | undefined);
          if (c) o.crop = c;
        }
      } else if (p.focus) {
        const m = file.doc.assets[el.asset];
        const c = m?.width ? focusCrop(m.width, m.height!, (o.w as number), (o.h as number), p.focus as { x: number; y: number }) : undefined;
        if (c) o.crop = c;
      } else if ((p.w !== undefined || p.h !== undefined) && el.crop) {
        // a new box shape: refit the crop from the picture's size
        const m = file.doc.assets[el.type === 'video' ? el.asset : el.asset];
        if (m?.width) o.crop = coverCrop(m.width, m.height!, o.w as number, o.h as number);
      }
      if (p.radius !== undefined) o.radius = p.radius;
      if (p.mask !== undefined && el.type === 'image') o.mask = shapeKind(String(p.mask));
      for (const k of ['trimStart', 'trimEnd', 'loop', 'muted', 'volume'] as const) if (p[k] !== undefined && el.type === 'video') o[k] = p[k];
      lookOf(o as unknown as ImageElement, p, warnings, where);
      break;
    }
    case 'path': {
      if (el.qr !== undefined) {
        if (typeof p.text === 'string') Object.assign(o, qrUpdate(el, p.text));
        if (p.color !== undefined) {
          const c = looseColor(p.color) ?? '#000000';
          const paths = [...(o.paths as PathElement['paths'])];
          paths[paths.length - 1] = { ...paths[paths.length - 1]!, fill: { type: 'solid', color: c } };
          o.paths = paths;
        }
      } else if (p.color !== undefined || p.fill !== undefined) {
        const c = looseColor(p.color ?? p.fill);
        if (c) o.paths = el.paths.map((x) => ({ ...x, fill: x.fill ? { type: 'solid', color: c } : null, stroke: x.stroke ? { ...x.stroke, color: c } : null }));
      }
      if (typeof p.d === 'string') o.paths = [{ d: p.d, fill: looseFill(p.fill ?? p.color) ?? { type: 'solid', color: '#1f2328' }, stroke: null }];
      if (p.viewBox) o.viewBox = p.viewBox;
      break;
    }
    case 'chart':
      for (const k of ['labels', 'series', 'legend', 'grid'] as const) if (p[k] !== undefined) o[k] = p[k];
      if (p.chart) o.chart = p.chart;
      if (p.colors) o.colors = (p.colors as string[]).map((c) => looseColor(c) ?? '#888888');
      if (p.fontFamily || p.fontSize || p.color) o.style = { ...el.style, ...(p.fontFamily ? { fontFamily: p.fontFamily } : {}), ...(p.fontSize ? { fontSize: p.fontSize } : {}), ...(p.color ? { color: looseColor(p.color) ?? el.style.color } : {}) };
      if (Array.isArray(o.series) && Array.isArray(o.labels)) o.series = (o.series as { name: string; values: number[] }[]).map((s) => ({ ...s, values: (o.labels as string[]).map((_, i) => s.values[i] ?? 0) }));
      break;
    case 'table':
      if (Array.isArray(p.rows)) {
        const rows = p.rows as string[][];
        if (rows.length !== el.cells.length || rows.some((r, i) => r.length !== el.cells[i]!.length)) throw new ToolError(`${where}: rows must keep the table's shape (${el.cells.length}×${el.cells[0]?.length ?? 0})`, 'delete it and add a new table to change its size');
        o.cells = el.cells.map((row, r) => row.map((c, k) => ({ ...c, text: rows[r]![k]! })));
      }
      if (p.fontFamily || p.fontSize || p.color) o.style = { ...el.style, ...(p.fontFamily ? { fontFamily: p.fontFamily } : {}), ...(p.fontSize ? { fontSize: p.fontSize } : {}), ...(p.color ? { color: looseColor(p.color) ?? el.style.color } : {}) };
      break;
    case 'group':
      break;
  }
  return { el: o as unknown as Element, refit };
}
