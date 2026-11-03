/**
 * Canvas → HTML. A page laid out from HTML gives back its own source, with
 * every change made on the canvas since then written into it (moved → a
 * relative offset, resized → a width, restyled → inline styles, deleted →
 * removed, added → an absolutely placed node). Any other page becomes
 * absolutely placed HTML, one node per element, that set_page_html reads back
 * unchanged.
 */
import { parseDocument } from 'htmlparser2';
import { Element as DomElement, type ChildNode, type Document } from 'domhandler';
import render from 'dom-serializer';
import { walk, type Doc, type Element, type Fill, type Page, type TextElement } from '@digital-canvas/scene';
import { parseDecls } from './css.ts';
import { animationCss, pageCss, sheetCss } from './anim.ts';

const r1 = (v: number) => Math.round(v * 10) / 10;
const px = (v: number) => `${r1(v)}px`;

/** FNV-1a of a string, base 36. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/** The fields HTML can express, per element type: what the signature watches. */
export function cssHash(e: Element): string {
  const base = [e.type, r1(e.opacity ?? 1), r1(e.rotation ?? 0), e.animation ?? null, e.timing ?? null];
  if (e.type === 'text') return fnv(JSON.stringify([...base, e.text, e.runs ?? null, e.style]));
  if (e.type === 'shape') return fnv(JSON.stringify([...base, e.shape, e.fill, e.stroke, r1(e.radius)]));
  if (e.type === 'image') return fnv(JSON.stringify([...base, e.asset, r1(e.radius)]));
  return fnv(JSON.stringify(base));
}

export function sigOf(e: Element): [string, number, number, number, number] {
  return [cssHash(e), r1(e.x), r1(e.y), r1(e.w), r1(e.h)];
}

// ---------------------------------------------------------------- element → CSS

const q = (f: string) => (/^[\w-]+$/.test(f) && !/^\d/.test(f) ? f : `'${f.replace(/'/g, '')}'`);

export function fillCss(f: Fill | null | undefined): string | null {
  if (!f) return null;
  if (f.type === 'solid') return f.color;
  return `linear-gradient(${r1(f.angle)}deg, ${f.stops.map((s) => `${s.color} ${r1(s.offset * 100)}%`).join(', ')})`;
}

export function textCss(t: TextElement): Record<string, string> {
  const s = t.style;
  const out: Record<string, string> = {
    'font-family': q(s.fontFamily), 'font-size': px(s.fontSize), color: s.color,
    'font-weight': s.bold ? '700' : '400', 'line-height': String(r1(s.lineHeight * 100) / 100), 'text-align': s.align,
  };
  if (s.italic) out['font-style'] = 'italic';
  if (s.letterSpacing) out['letter-spacing'] = px(s.letterSpacing);
  if (s.uppercase) out['text-transform'] = 'uppercase';
  const deco = [s.underline ? 'underline' : '', s.strike ? 'line-through' : ''].filter(Boolean).join(' ');
  if (deco) out['text-decoration'] = deco;
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => esc(s).replace(/"/g, '&quot;');

/** Text content as HTML: runs → spans, line breaks → <br>. */
export function textInner(t: TextElement): string {
  const line = (s: string) => esc(s).replace(/\n/g, '<br>');
  if (!t.runs?.length) return line(t.text);
  return t.runs.map((r) => {
    const st = r.style ?? {};
    const css: string[] = [];
    if (st.fontFamily) css.push(`font-family:${q(st.fontFamily)}`);
    if (st.fontSize) css.push(`font-size:${px(st.fontSize)}`);
    if (st.color) css.push(`color:${st.color}`);
    if (st.bold !== undefined) css.push(`font-weight:${st.bold ? 700 : 400}`);
    if (st.italic !== undefined) css.push(`font-style:${st.italic ? 'italic' : 'normal'}`);
    if (st.underline !== undefined) css.push(`text-decoration:${st.underline ? 'underline' : 'none'}`);
    return css.length ? `<span style="${css.join(';')}">${line(r.text)}</span>` : line(r.text);
  }).join('');
}

const styleStr = (o: Record<string, string | number | undefined | null>) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}:${v}`).join(';');

/** Collects @keyframes while elements are written (reset per page). */
let SHEET = new Map<string, string>();

function common(e: Element, ox: number, oy: number): Record<string, string | undefined> {
  return {
    left: px(e.x - ox), top: px(e.y - oy), width: px(e.w),
    ...animationCss(e.animation, e.timing?.start, SHEET),
    ...(e.opacity !== undefined && e.opacity < 1 ? { opacity: String(r1(e.opacity * 100) / 100) } : {}),
    ...(e.rotation ? { transform: `rotate(${r1(e.rotation)}deg)` } : {}),
  };
}

/** One element as an absolutely placed node (inside a box at ox, oy). */
export function elementHtml(e: Element, ox = 0, oy = 0, indent = ''): string {
  const id = `data-id="${escAttr(e.id)}"`;
  const name = (e.name ? ` data-name="${escAttr(e.name)}"` : '') + (e.animation?.type === 'custom' ? ` data-spec="${escAttr(JSON.stringify({ animation: e.animation }))}"` : '');
  if (e.hidden) return `${indent}<dc-element ${id}${name} data-type="${e.type}" style="${styleStr({ left: px(e.x - ox), top: px(e.y - oy), width: px(e.w), height: px(e.h) })}"></dc-element>`;
  switch (e.type) {
    case 'text':
      if (e.curve || e.list || e.gradient) break;
      return `${indent}<div ${id}${name} style="${styleStr({ ...common(e, ox, oy), ...textCss(e), 'white-space': 'pre-wrap' })}">${textInner(e)}</div>`;
    case 'shape': {
      if (e.shape !== 'rect' && e.shape !== 'ellipse') break;
      const fill = fillCss(e.fill);
      return `${indent}<div ${id}${name} style="${styleStr({
        ...common(e, ox, oy), height: px(e.h),
        background: fill ?? undefined,
        border: e.stroke ? `${px(e.stroke.width)} ${e.stroke.dash ?? 'solid'} ${e.stroke.color}` : undefined,
        'border-radius': e.shape === 'ellipse' ? '50%' : e.radius ? px(e.radius) : undefined,
      })}"></div>`;
    }
    case 'image':
      return `${indent}<img ${id}${name} src="asset:${escAttr(e.asset)}" style="${styleStr({ ...common(e, ox, oy), height: px(e.h), 'border-radius': e.radius ? px(e.radius) : undefined })}">`;
    case 'group': {
      const kids = e.children.map((c) => elementHtml(c, e.x, e.y, `${indent}  `)).join('\n');
      return `${indent}<div ${id}${name} data-group style="${styleStr({ ...common(e, ox, oy), height: px(e.h) })}">\n${kids}\n${indent}</div>`;
    }
    default: break;
  }
  return `${indent}<dc-element ${id}${name} data-type="${e.type}" style="${styleStr({ ...common(e, ox, oy), height: px(e.h) })}"></dc-element>`;
}

export const ABS_STYLE = '[data-id]{position:absolute;margin:0;box-sizing:border-box}';

function bodyCss(doc: Doc, page: Page): string {
  const bg = fillCss(page.background);
  return styleStr({ width: px(doc.width), height: px(doc.height), margin: '0', position: 'relative', background: bg ?? undefined, ...pageCss(page, SHEET) });
}

/** Any page as absolutely placed HTML. */
export function absoluteHtml(doc: Doc, page: Page): string {
  SHEET = new Map();
  const body = `<body style="${bodyCss(doc, page)}">\n${page.elements.map((e) => elementHtml(e, 0, 0, '  ')).join('\n')}\n</body>`;
  const kf = sheetCss(SHEET);
  return `<style>${ABS_STYLE}${kf ? `\n${kf}` : ''}</style>\n${body}`;
}

// ---------------------------------------------------------------- the layout source, kept in sync

const safeJson = (s: string | undefined): Record<string, unknown> => { try { const v = JSON.parse(s ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };

const isEl = (n: ChildNode): n is DomElement => n.type === 'tag' || n.type === 'style' || n.type === 'script';

function setStyle(el: DomElement, patch: Record<string, string | null>): void {
  const { decls } = parseDecls(el.attribs.style ?? '');
  const cur: Record<string, string> = {};
  // keep the author's text, minus the properties we rewrite
  for (const part of (el.attribs.style ?? '').split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    if (k && !(k in patch)) cur[k] = part.slice(i + 1).trim();
  }
  void decls;
  for (const [k, v] of Object.entries(patch)) if (v !== null) cur[k] = v;
  const s = styleStr(cur);
  if (s) el.attribs.style = s; else delete el.attribs.style;
}

function inlineLen(el: DomElement, prop: string): number {
  const { decls } = parseDecls(el.attribs.style ?? '');
  const v = decls[prop];
  return v && /^-?[\d.]+(px)?$/.test(v.trim()) ? parseFloat(v) : 0;
}

/** Replace a node's children with HTML. */
function setInner(el: DomElement, html: string): void {
  const frag = parseDocument(`<div>${html}</div>`, { decodeEntities: true });
  const wrap = frag.children.find(isEl) as DomElement;
  el.children = wrap.children;
  el.children.forEach((c, i) => { c.parent = el; c.prev = el.children[i - 1] ?? null; c.next = el.children[i + 1] ?? null; });
}

function bodyOf(doc: Document): DomElement | null {
  let hit: DomElement | null = null;
  const go = (n: ChildNode) => { if (hit || !isEl(n)) return; if (n.name === 'body') hit = n; else n.children.forEach(go); };
  doc.children.forEach(go);
  return hit;
}

const ROLE_ORDER = ['g', 'bg', 'keep', 'img', 't'];

/**
 * The page's layout source with canvas edits written in. `changed` lists what
 * was carried over (for the agent to see).
 */
export function syncedHtml(doc: Doc, page: Page): { html: string; changed: string[] } {
  const L = page.layout!;
  SHEET = new Map();
  const dom = parseDocument(L.html, { lowerCaseTags: true, lowerCaseAttributeNames: true, decodeEntities: true });
  const body = bodyOf(dom);
  if (!body) return { html: absoluteHtml(doc, page), changed: ['layout source unreadable: absolute HTML instead'] };
  const changed: string[] = [];
  const byKey = new Map<string, DomElement>();
  const index = (n: ChildNode) => { if (!isEl(n)) return; if (n.attribs['data-k']) byKey.set(n.attribs['data-k'], n); n.children.forEach(index); };
  index(body);

  // present elements by key and role
  const present = new Map<string, Map<string, Element>>();
  const foreign: Element[] = [];
  const visit = (els: readonly Element[], top: boolean) => {
    for (const e of els) {
      const lk = e.lk;
      const [k, role] = lk ? lk.split(':') as [string, string] : ['', ''];
      if (lk && byKey.has(k) && L.sig[lk]) {
        if (!present.has(k)) present.set(k, new Map());
        present.get(k)!.set(role, e);
        if (e.type === 'group') visit(e.children, false);
      } else if (top) foreign.push(e);
      else foreign.push(e);
    }
  };
  visit(page.elements, true);

  // deletions: nodes that made elements, none of which (nor their descendants') are left
  const madeKeys = new Set(Object.keys(L.sig).map((s) => s.split(':')[0]!));
  const prune = (el: DomElement): boolean => {
    let alive = present.has(el.attribs['data-k'] ?? '');
    for (const c of [...el.children]) if (isEl(c) && prune(c)) alive = true;
    const k = el.attribs['data-k'];
    const made = !!k && madeKeys.has(k);
    const hadMadeInside = el.children.some((c) => isEl(c) && c.attribs['data-k'] && madeKeys.has(c.attribs['data-k']));
    if (!alive && (made || hadMadeInside) && el !== body && el.name !== 'dc-element') {
      const p = el.parent as DomElement | null;
      if (p) { p.children = p.children.filter((c) => c !== el); p.children.forEach((c, i) => { c.prev = p.children[i - 1] ?? null; c.next = p.children[i + 1] ?? null; }); }
      changed.push(`removed [data-k=${k ?? '?'}]`);
      return false;
    }
    if (el.name === 'dc-element' && !alive && k && madeKeys.has(k)) {
      const p = el.parent as DomElement | null;
      if (p) p.children = p.children.filter((c) => c !== el);
      changed.push(`removed [data-k=${k}]`);
      return false;
    }
    return alive;
  };
  for (const c of [...body.children]) if (isEl(c)) prune(c);

  // moves, sizes and styles, top down so a moved box carries its children
  const walkDom = (el: DomElement, accX: number, accY: number) => {
    let ax = accX, ay = accY;
    const k = el.attribs['data-k'];
    const roles = k ? present.get(k) : undefined;
    if (roles) {
      const primary = ROLE_ORDER.map((r) => [r, roles.get(r)] as const).find(([, e]) => e);
      if (primary) {
        const [role, e] = primary as [string, Element];
        const s = L.sig[`${k}:${role}`]!;
        const dx = e.x - s[1] - accX, dy = e.y - s[2] - accY;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          const pos = (parseDecls(el.attribs.style ?? '').decls.position ?? '').trim();
          if (pos === 'absolute' || pos === 'fixed') setStyle(el, { left: px(inlineLen(el, 'left') + dx), top: px(inlineLen(el, 'top') + dy) });
          else setStyle(el, { position: 'relative', left: px(inlineLen(el, 'left') + dx), top: px(inlineLen(el, 'top') + dy) });
          ax += dx; ay += dy;
          changed.push(`moved [data-k=${k}] by ${r1(dx)},${r1(dy)}`);
        }
        if (role !== 'g' && Math.abs(e.w - s[3]) > 0.5) {
          setStyle(el, { width: px(e.w), 'box-sizing': 'border-box' });
          changed.push(`resized [data-k=${k}] to width ${r1(e.w)}`);
        }
        if ((role === 'bg' || role === 'img' || role === 'keep') && Math.abs(e.h - s[4]) > 0.5) setStyle(el, { height: px(e.h), 'box-sizing': 'border-box' });
      }
      for (const [role, e] of roles) {
        const s = L.sig[`${k}:${role}`]!;
        if (cssHash(e) === s[0]) continue;
        changed.push(`restyled [data-k=${k}] (${role})`);
        const anim = animationCss(e.animation, e.timing?.start, SHEET);
        const look: Record<string, string | null> = {
          opacity: e.opacity < 1 ? String(r1(e.opacity * 100) / 100) : null,
          transform: e.rotation ? `rotate(${r1(e.rotation)}deg)` : null,
          animation: anim.animation ?? 'none',
          '--dc-direction': anim['--dc-direction'] ?? null, '--dc-by': anim['--dc-by'] ?? null, '--dc-phase': anim['--dc-phase'] ?? null,
          '--dc-order': anim['--dc-order'] ?? null, '--dc-intensity': anim['--dc-intensity'] ?? null,
        };
        if (e.animation?.type === 'custom') el.attribs['data-spec'] = JSON.stringify({ ...safeJson(el.attribs['data-spec']), animation: e.animation });
        if (role === 't' && e.type === 'text') {
          setStyle(el, { ...textCss(e), ...look });
          setInner(el, textInner(e));
        } else if (role === 'bg' && e.type === 'shape') {
          setStyle(el, {
            background: fillCss(e.fill) ?? 'transparent',
            border: e.stroke ? `${px(e.stroke.width)} ${e.stroke.dash ?? 'solid'} ${e.stroke.color}` : null,
            'border-radius': e.shape === 'ellipse' ? '50%' : px(e.radius),
            ...look,
          });
        } else if (role === 'img' && e.type === 'image') {
          el.attribs.src = `asset:${e.asset}`;
          setStyle(el, { 'border-radius': e.radius ? px(e.radius) : null, ...look });
        } else if (role === 'g') setStyle(el, look);
      }
    }
    for (const c of el.children) if (isEl(c)) walkDom(c, ax, ay);
  };
  walkDom(body, 0, 0);

  // elements made on the canvas: placed absolutely on the page
  let extra = '';
  if (foreign.length) {
    extra = foreign.map((e) => elementHtml(e, 0, 0, '  ')).join('\n');
    changed.push(`${foreign.length} element(s) added on the canvas, placed absolutely`);
  }
  const styles: string[] = [];
  const pull = (n: ChildNode) => { if (!isEl(n)) return; if (n.name === 'style') { styles.push(render(n.children)); return; } n.children.forEach(pull); };
  dom.children.forEach(pull);
  const strip = (el: DomElement) => { el.children = el.children.filter((c) => !(isEl(c) && c.name === 'style')); el.children.forEach((c) => isEl(c) && strip(c)); };
  strip(body);
  // the page's own settings, as they are now
  const pc = pageCss(page, SHEET);
  setStyle(body, { animation: pc.animation ?? null, '--dc-duration': pc['--dc-duration'] ?? null, '--dc-transition': pc['--dc-transition'] ?? null, '--dc-direction': pc['--dc-direction'] ?? null, '--dc-by': pc['--dc-by'] ?? null, '--dc-order': pc['--dc-order'] ?? null });
  const have = styles.join('\n');
  const newKf = [...SHEET].filter(([n]) => !new RegExp(`@keyframes\\s+${n}\\b`).test(have)).map(([, c]) => c).join('\n');
  const css = have + (foreign.length && !have.includes(ABS_STYLE) ? `\n${ABS_STYLE}` : '') + (newKf ? `\n${newKf}` : '');
  let bodyHtml = render(body, { encodeEntities: 'utf8' });
  if (extra) bodyHtml = bodyHtml.replace(/<\/body>\s*$/, `${extra}\n</body>`);
  return { html: `${css.trim() ? `<style>\n${css.trim()}\n</style>\n` : ''}${bodyHtml}`, changed };
}

/** The HTML for a page: its synced layout source, or absolute HTML. */
export function pageHtml(doc: Doc, page: Page): { html: string; mode: 'layout' | 'absolute'; changed: string[] } {
  if (page.layout?.html) {
    const { html, changed } = syncedHtml(doc, page);
    return { html, mode: 'layout', changed };
  }
  return { html: absoluteHtml(doc, page), mode: 'absolute', changed: [] };
}

/** Every layout key in use on a page (so new keys never collide). */
export function keysOnPage(page: Page): Set<string> {
  const out = new Set<string>();
  for (const e of walk(page.elements)) if (e.lk) out.add(e.lk.split(':')[0]!);
  return out;
}
