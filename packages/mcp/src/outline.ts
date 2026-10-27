/**
 * A compact, readable outline of a design for the agent: pages, and per element
 * its id, type, box and the few properties that matter to edit it. Numbers are
 * rounded; defaults are left out.
 */
import { isVideo, pageDuration, totalDuration, type Doc, type Element, type Fill, type Page } from '@digital-canvas/scene';

const r = (v: number) => Math.round(v * 10) / 10;

export function fillText(f: Fill | null | undefined): string | undefined {
  if (!f) return undefined;
  if (f.type === 'solid') return f.color;
  return `linear ${r(f.angle)}° ${f.stops.map((s) => s.color).join('→')}`;
}

export function elementOutline(e: Element, doc: Doc, depth = 0): Record<string, unknown> {
  const o: Record<string, unknown> = { id: e.id, type: e.type };
  if (e.name) o.name = e.name;
  o.box = [r(e.x), r(e.y), r(e.w), r(e.h)];
  if (e.rotation) o.rotation = r(e.rotation);
  if (e.opacity !== 1) o.opacity = r(e.opacity);
  if (e.hidden) o.hidden = true;
  if (e.locked) o.locked = true;
  if (e.animation) o.animation = e.animation.type + (e.animation.direction ? `-${e.animation.direction}` : '');
  if (e.timing) o.timing = [e.timing.start ?? 0, e.timing.end ?? null];
  switch (e.type) {
    case 'text': {
      o.text = e.text.length > 300 ? `${e.text.slice(0, 300)}…` : e.text;
      const s = e.style;
      o.font = `${s.fontFamily} ${r(s.fontSize)}${s.bold ? ' bold' : ''}${s.italic ? ' italic' : ''}${s.uppercase ? ' uppercase' : ''}`;
      o.color = e.gradient ? fillText(e.gradient) : s.color;
      if (s.align !== 'left') o.align = s.align;
      if (e.effect) o.effect = e.effect.type;
      if (e.runs?.some((x) => x.style)) o.runs = e.runs.length;
      if (e.list) o.list = e.list;
      if (e.curve) o.curve = e.curve;
      break;
    }
    case 'shape':
      o.shape = e.shape;
      if (e.fill) o.fill = fillText(e.fill);
      if (e.stroke) o.stroke = `${e.stroke.width}px ${e.stroke.color}`;
      if (e.radius) o.radius = e.radius;
      break;
    case 'image': case 'video': {
      o.asset = e.asset || '(empty frame)';
      const m = doc.assets[e.asset];
      if (m?.name) o.source = m.name.slice(0, 80);
      if (e.type === 'image' && e.mask) o.mask = typeof e.mask === 'string' ? e.mask : 'custom';
      if (e.filter) o.filter = e.filter.name;
      if (e.effect) o.effect = e.effect.type;
      if (e.type === 'video') {
        o.clip = [e.trimStart ?? 0, e.trimEnd ?? (m?.duration !== undefined ? r(m.duration) : null)];
        if (e.loop) o.loop = true;
        if (e.muted) o.muted = true;
      }
      break;
    }
    case 'path':
      if (e.qr !== undefined) o.qr = e.qr;
      else o.colors = [...new Set(e.paths.map((p) => fillText(p.fill) ?? p.stroke?.color).filter(Boolean))].slice(0, 4);
      break;
    case 'line':
      o.from = [r(e.x + e.start.x), r(e.y + e.start.y)];
      o.to = [r(e.x + e.end.x), r(e.y + e.end.y)];
      o.stroke = `${e.stroke.width}px ${e.stroke.color}`;
      if (e.start.marker !== 'none' || e.end.marker !== 'none') o.markers = [e.start.marker, e.end.marker];
      break;
    case 'chart':
      o.chart = e.chart; o.labels = e.labels; o.series = e.series;
      break;
    case 'table':
      o.rows = e.cells.map((row) => row.map((c) => c.text));
      break;
    case 'group':
      if (depth < 4) o.children = e.children.map((c) => elementOutline(c, doc, depth + 1));
      break;
  }
  return o;
}

export function pageOutline(p: Page, i: number, doc: Doc, video: boolean): Record<string, unknown> {
  return {
    page: i + 1,
    id: p.id,
    ...(p.name ? { name: p.name } : {}),
    background: fillText(p.background),
    ...(p.hidden ? { hidden: true } : {}),
    ...(video ? { duration: pageDuration(p) } : {}),
    ...(p.animation ? { animation: p.animation.type } : {}),
    ...(p.transition ? { transition: p.transition.type + (p.transition.direction ? `-${p.transition.direction}` : '') } : {}),
    ...(p.notes ? { notes: p.notes } : {}),
    elements: p.elements.map((e) => elementOutline(e, doc)),
  };
}

export function designOutline(doc: Doc, opts: { pages?: number[] } = {}): Record<string, unknown> {
  const video = isVideo(doc);
  return {
    id: doc.id,
    title: doc.title,
    size: [r(doc.width), r(doc.height)],
    ...(doc.unit !== 'px' ? { unit: doc.unit } : {}),
    ...(doc.bleed ? { bleed: r(doc.bleed) } : {}),
    pageCount: doc.pages.length,
    ...(video ? { video: true, duration: r(totalDuration(doc)) } : {}),
    ...(doc.audio?.length ? { audio: doc.audio.map((a) => ({ id: a.id, asset: a.asset, name: a.name, start: r(a.start), offset: r(a.offset), duration: r(a.duration), volume: a.volume ?? 1, ...(a.fadeIn ? { fadeIn: a.fadeIn } : {}), ...(a.fadeOut ? { fadeOut: a.fadeOut } : {}) })) } : {}),
    ...(doc.fonts?.length ? { fonts: [...new Set(doc.fonts.map((f) => f.family))] } : {}),
    pages: doc.pages.map((p, i) => (opts.pages && !opts.pages.includes(i + 1) ? { page: i + 1, id: p.id, elements: p.elements.length } : pageOutline(p, i, doc, video))),
  };
}

/** Find a page by id or 1-based number. */
export function findPage(doc: Doc, ref: string | number | undefined): { page: Page; index: number } | null {
  if (ref === undefined) return { page: doc.pages[0]!, index: 0 };
  if (typeof ref === 'number' || /^\d+$/.test(String(ref))) {
    const i = Number(ref) - 1;
    return doc.pages[i] ? { page: doc.pages[i]!, index: i } : null;
  }
  const index = doc.pages.findIndex((p) => p.id === ref);
  return index >= 0 ? { page: doc.pages[index]!, index } : null;
}
