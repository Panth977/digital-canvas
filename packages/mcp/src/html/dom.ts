/**
 * HTML → a styled box tree: parse, run the cascade (user-agent defaults,
 * <style> rules by specificity, inline styles, !important), inherit the text
 * properties, and sort content into boxes, text, pictures and kept elements.
 *
 * Every element that ends up in the tree gets a layout key (`data-k`) written
 * back into the parsed document, so the source can be stored with the page and
 * matched to the canvas elements it made (see sync.ts).
 */
import { parseDocument } from 'htmlparser2';
import { Element as DomElement, Text as DomText, type ChildNode, type Document } from 'domhandler';
import { selectAll } from 'css-select';
import { cssColor, firstFamily, lenPx, parseDecls, parseSheet, type Decls, type LenCtx, type Rule } from './css.ts';

export interface TextProps {
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
  align: 'left' | 'center' | 'right' | 'justify';
  /** Multiple of the font size. */
  lineHeight: number;
  letterSpacing: number;
  uppercase: boolean;
  lowercase: boolean;
  capitalize: boolean;
  /** pre / pre-wrap / pre-line keep line breaks; pre and pre-wrap keep spaces too. */
  whiteSpace: string;
}

export interface Run {
  text: string;
  style?: Partial<Pick<TextProps, 'fontFamily' | 'fontSize' | 'bold' | 'italic' | 'underline' | 'color'>>;
}

export interface SNode {
  kind: 'box' | 'text' | 'img' | 'keep';
  /** Layout key: the `data-k` of the HTML element this came from. */
  key: string;
  tag: string;
  /** Non-inherited declarations (expanded longhands). */
  style: Decls;
  /** Inherited text properties, computed. */
  text: TextProps;
  children: SNode[];
  /** kind text: the content (runs when styles differ inside). */
  content?: { text: string; runs?: Run[] };
  /** kind img: the src. */
  src?: string;
  /** kind keep: the element id to keep as it is. */
  keepId?: string;
  /** data-id: an existing canvas element this node stands for. */
  matchId?: string;
  /** data-spec: extra element fields (effects, filters, animation…). */
  spec?: Record<string, unknown>;
  /** data-group: keep the elements of this box together as one group. */
  group?: boolean;
  dom: DomElement;
}

export interface Parsed {
  doc: Document;
  root: SNode;
  /** Page background from the body (colour or gradient), if any. */
  css: string;
  warnings: string[];
}

const UA = `
h1{font-size:2em;font-weight:bold;margin:.67em 0}h2{font-size:1.5em;font-weight:bold;margin:.83em 0}h3{font-size:1.17em;font-weight:bold;margin:1em 0}
h4{font-weight:bold;margin:1.33em 0}h5{font-size:.83em;font-weight:bold;margin:1.67em 0}h6{font-size:.67em;font-weight:bold;margin:2.33em 0}
p{margin:1em 0}ul,ol{margin:1em 0;padding-left:40px}blockquote{margin:1em 40px}hr{border-top:1px solid #888;margin:.5em 0}
b,strong,th{font-weight:bold}i,em,cite,var,dfn{font-style:italic}u,ins{text-decoration:underline}s,del,strike{text-decoration:line-through}
small{font-size:.83em}big{font-size:1.2em}code,kbd,samp,pre{font-family:Roboto Mono}pre{white-space:pre;margin:1em 0}mark{background-color:#ffff00}
center{text-align:center}a{color:inherit}figure{margin:1em 40px}
`;

const INLINE = new Set(['span', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'ins', 'strike', 'small', 'big', 'a', 'mark', 'sub', 'sup', 'label', 'code', 'kbd', 'samp', 'var', 'cite', 'dfn', 'abbr', 'q', 'font', 'time', 'data', 'bdi', 'bdo', 'tt']);
const SKIP = new Set(['head', 'style', 'script', 'meta', 'link', 'title', 'template', 'noscript', 'base']);

const INHERITED = ['font-family', 'font-size', 'font-weight', 'font-style', 'color', 'text-align', 'line-height', 'letter-spacing', 'text-transform', 'text-decoration', 'white-space', 'list-style-type', 'list-style'];

const isEl = (n: ChildNode): n is DomElement => n.type === 'tag' || n.type === 'script' || n.type === 'style';
const isText = (n: ChildNode): n is DomText => n.type === 'text';

export interface ParseOptions {
  width: number;
  height: number;
  /** Keys already used (kept stable across edits); new ones count up from here. */
  usedKeys?: Set<string>;
}

export function parseHtml(html: string, o: ParseOptions): Parsed {
  const warnings: string[] = [];
  const warn = (w: string) => { if (!warnings.includes(w) && warnings.length < 40) warnings.push(w); };
  const src = /<body[\s>]/i.test(html) ? html : `<body>${html}</body>`;
  const doc = parseDocument(src, { lowerCaseTags: true, lowerCaseAttributeNames: true, decodeEntities: true });

  // ---- style sheets (anywhere in the document)
  let css = '';
  const visit = (n: ChildNode) => { if (isEl(n)) { if (n.name === 'style') css += n.children.map((c) => (isText(c) ? c.data : '')).join('') + '\n'; else n.children.forEach(visit); } };
  doc.children.forEach(visit);
  const ua = parseSheet(UA);
  const rules = parseSheet(css, 1_000_000);

  // ---- cascade: element → declarations
  const matched = new Map<DomElement, { s: number; o: number; d: Decls }[]>();
  const important = new Map<DomElement, { s: number; o: number; d: Decls }[]>();
  const apply = (list: Rule[], ua_: boolean) => {
    for (const r of list) {
      let hits: DomElement[];
      try { hits = selectAll(r.selector.replace(/::?(before|after|first-line|first-letter|placeholder|selection|marker)\b/gi, ''), doc as never) as unknown as DomElement[]; }
      catch { warn(`CSS selector not understood, rule skipped: ${r.selector}`); continue; }
      if (/::?(before|after)\b/i.test(r.selector)) { warn(`::before / ::after content is not drawn (${r.selector}); put the text in the HTML`); continue; }
      for (const el of hits) {
        const bucket = matched.get(el) ?? [];
        bucket.push({ s: ua_ ? -1 : r.specificity, o: r.order, d: r.decls });
        matched.set(el, bucket);
        if (Object.keys(r.important).length) {
          const b2 = important.get(el) ?? [];
          b2.push({ s: r.specificity, o: r.order, d: r.important });
          important.set(el, b2);
        }
      }
    }
  };
  apply(ua, true);
  apply(rules, false);
  const declsOf = (el: DomElement): Decls => {
    const out: Decls = {};
    for (const m of (matched.get(el) ?? []).sort((a, b) => a.s - b.s || a.o - b.o)) Object.assign(out, m.d);
    const inline = el.attribs.style ? parseDecls(el.attribs.style) : null;
    if (inline) Object.assign(out, inline.decls);
    for (const m of (important.get(el) ?? []).sort((a, b) => a.s - b.s || a.o - b.o)) Object.assign(out, m.d);
    if (inline) Object.assign(out, inline.important);
    // old presentational attributes
    if (el.attribs.width && !out.width) out.width = /^\d+$/.test(el.attribs.width) ? `${el.attribs.width}px` : el.attribs.width;
    if (el.attribs.height && !out.height) out.height = /^\d+$/.test(el.attribs.height) ? `${el.attribs.height}px` : el.attribs.height;
    if (el.attribs.align && !out['text-align']) out['text-align'] = el.attribs.align;
    if (el.attribs.color && !out.color) out.color = el.attribs.color;
    if (el.attribs.bgcolor && !out['background-color']) out['background-color'] = el.attribs.bgcolor;
    return out;
  };

  // ---- keys
  const used = new Set(o.usedKeys ?? []);
  let next = 1;
  const keyFor = (el: DomElement): string => {
    const have = el.attribs['data-k'];
    if (have && !used.has(`!${have}`)) { used.add(`!${have}`); used.add(have); return have; }
    while (used.has(`k${next}`)) next++;
    const k = `k${next++}`;
    used.add(k); used.add(`!${k}`);
    el.attribs['data-k'] = k;
    return k;
  };

  // ---- inheritance
  const rootEm = 16;
  const base: TextProps = { fontFamily: 'Inter', fontSize: 16, bold: false, italic: false, underline: false, strike: false, color: '#000000', align: 'left', lineHeight: 1.2, letterSpacing: 0, uppercase: false, lowercase: false, capitalize: false, whiteSpace: 'normal' };
  const htmlEl = doc.children.find((n): n is DomElement => isEl(n) && n.name === 'html');
  const htmlDecls = htmlEl ? declsOf(htmlEl) : {};
  const remPx = lenPx(htmlDecls['font-size'], { em: rootEm, rem: rootEm, vw: o.width, vh: o.height }, rootEm) ?? rootEm;

  const inherit = (parent: TextProps, d: Decls): TextProps => {
    const t = { ...parent };
    const ctx: LenCtx = { em: parent.fontSize, rem: remPx, vw: o.width, vh: o.height };
    const v = (k: string) => (d[k] && d[k] !== 'inherit' ? d[k]!.trim() : undefined);
    const fs = v('font-size');
    if (fs) {
      const kw: Record<string, number> = { 'xx-small': 9, 'x-small': 10, small: 13, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32, 'xxx-large': 48 };
      t.fontSize = kw[fs] ?? (fs === 'smaller' ? parent.fontSize / 1.2 : fs === 'larger' ? parent.fontSize * 1.2 : lenPx(fs, ctx, parent.fontSize) ?? parent.fontSize);
    }
    const ff = v('font-family'); if (ff) t.fontFamily = firstFamily(ff);
    const fw = v('font-weight');
    if (fw) t.bold = fw === 'bold' || fw === 'bolder' ? true : fw === 'normal' || fw === 'lighter' ? false : parseInt(fw, 10) >= 600;
    const fst = v('font-style'); if (fst) t.italic = fst === 'italic' || fst === 'oblique';
    const col = v('color'); if (col) t.color = cssColor(col) ?? t.color;
    const ta = v('text-align');
    if (ta) t.align = ta === 'center' ? 'center' : ta === 'right' || ta === 'end' ? 'right' : ta === 'justify' ? 'justify' : 'left';
    const lh = v('line-height');
    if (lh) {
      if (lh === 'normal') t.lineHeight = 1.2;
      else if (/^[\d.]+$/.test(lh)) t.lineHeight = parseFloat(lh);
      else { const px = lenPx(lh, { ...ctx, em: t.fontSize }, t.fontSize); if (px !== null) t.lineHeight = px / t.fontSize; }
    } else if (fs && parent.lineHeight && d['line-height'] === undefined) { /* unitless line-height inherits as a multiple: keep */ }
    const ls = v('letter-spacing');
    if (ls) t.letterSpacing = ls === 'normal' ? 0 : lenPx(ls, { ...ctx, em: t.fontSize }, t.fontSize) ?? t.letterSpacing;
    const tt = v('text-transform');
    if (tt) { t.uppercase = tt === 'uppercase'; t.lowercase = tt === 'lowercase'; t.capitalize = tt === 'capitalize'; }
    const td = v('text-decoration');
    if (td) { t.underline = /underline/.test(td); t.strike = /line-through/.test(td); }
    const ws = v('white-space'); if (ws) t.whiteSpace = ws;
    return t;
  };

  const displayOf = (el: DomElement, d: Decls): string => {
    if (d.display) return d.display.trim().toLowerCase();
    if (el.name.startsWith('dc-')) return 'block';
    if (el.name === 'img' || el.name === 'svg') return 'inline-block';
    return INLINE.has(el.name) ? 'inline' : 'block';
  };

  const hasPaint = (d: Decls): boolean => {
    const bg = d['background-color'];
    if (bg && cssColor(bg) && cssColor(bg) !== '#00000000') return true;
    if (d['background-image'] && d['background-image'] !== 'none') return true;
    return ['top', 'right', 'bottom', 'left'].some((s) => d[`border-${s}-width`] && d[`border-${s}-style`] !== 'none' && (lenPx(d[`border-${s}-width`], { em: 16, rem: 16, vw: 1, vh: 1 }) ?? 0) > 0);
  };
  const boxy = (d: Decls) => hasPaint(d) || ['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'width', 'height', 'margin-left', 'margin-right'].some((k) => d[k] && parseFloat(d[k]!) !== 0);

  // ---- whitespace
  const collapse = (s: string, ws: string) => {
    if (ws === 'pre' || ws === 'pre-wrap' || ws === 'break-spaces') return s;
    if (ws === 'pre-line') return s.replace(/[ \t]+/g, ' ');
    return s.replace(/\s+/g, ' ');
  };
  const transform = (s: string, t: TextProps) => (t.lowercase ? s.toLowerCase() : t.capitalize ? s.replace(/(^|\s)(\S)/g, (_m, a: string, b: string) => a + b.toUpperCase()) : s);

  /** Inline content → runs, relative to the block's text style. */
  const gatherRuns = (nodes: ChildNode[], t: TextProps, block: TextProps, runs: Run[], listMarker?: string) => {
    if (listMarker) runs.push({ text: listMarker });
    for (const n of nodes) {
      if (isText(n)) { runs.push(runOf(collapse(n.data, t.whiteSpace), t, block)); continue; }
      if (!isEl(n) || SKIP.has(n.name)) continue;
      if (n.name === 'br') { runs.push({ text: '\n' }); continue; }
      const d = declsOf(n);
      if (d.display === 'none') continue;
      gatherRuns(n.children, inherit(t, d), block, runs);
    }
  };
  const runOf = (text: string, t: TextProps, block: TextProps): Run => {
    const style: Run['style'] = {};
    if (t.fontFamily !== block.fontFamily) style.fontFamily = t.fontFamily;
    if (Math.abs(t.fontSize - block.fontSize) > 0.01) style.fontSize = t.fontSize;
    if (t.bold !== block.bold) style.bold = t.bold;
    if (t.italic !== block.italic) style.italic = t.italic;
    if (t.underline !== block.underline) style.underline = t.underline;
    if (t.color !== block.color) style.color = t.color;
    let s = transform(text, t);
    if (t.uppercase && !block.uppercase) s = s.toUpperCase();
    return Object.keys(style).length ? { text: s, style } : { text: s };
  };
  /** Join runs, trim the ends and spaces around line breaks; same-style neighbours merge. */
  const finish = (runs: Run[], ws: string): { text: string; runs?: Run[] } | null => {
    const keep = ws === 'pre' || ws === 'pre-wrap' || ws === 'break-spaces';
    let list = runs.filter((r) => r.text.length);
    if (!keep) {
      // collapse spaces across run borders
      for (let i = 1; i < list.length; i++) if (/[ \n]$/.test(list[i - 1]!.text) && list[i]!.text.startsWith(' ')) list[i] = { ...list[i]!, text: list[i]!.text.slice(1) };
      list = list.map((r) => ({ ...r, text: r.text.replace(/ *\n */g, '\n') }));
      if (list.length) { list[0] = { ...list[0]!, text: list[0]!.text.replace(/^ +/, '') }; const l = list.length - 1; list[l] = { ...list[l]!, text: list[l]!.text.replace(/ +$/, '') }; }
      list = list.filter((r) => r.text.length);
    }
    const merged: Run[] = [];
    for (const r of list) {
      const last = merged[merged.length - 1];
      if (last && JSON.stringify(last.style ?? {}) === JSON.stringify(r.style ?? {})) last.text += r.text;
      else merged.push({ ...r });
    }
    const text = merged.map((r) => r.text).join('');
    if (!text.trim()) return null;
    return merged.some((r) => r.style) ? { text, runs: merged } : { text };
  };

  // ---- tree
  const parseSpec = (el: DomElement): Record<string, unknown> | undefined => {
    const s = el.attribs['data-spec'];
    if (!s) return undefined;
    try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : undefined; } catch { warn(`data-spec on <${el.name}> is not valid JSON; ignored`); return undefined; }
  };

  const textLeaf = (key: string, owner: DomElement, t: TextProps, content: { text: string; runs?: Run[] }): SNode =>
    ({ kind: 'text', key, tag: '#text', style: {}, text: t, children: [], content, dom: owner });

  const build = (el: DomElement, parentText: TextProps, parentDisplay: string): SNode | null => {
    const d = declsOf(el);
    const display = displayOf(el, d);
    if (display === 'none' || d.visibility === 'hidden') return null;
    const t = inherit(parentText, Object.fromEntries(Object.entries(d).filter(([k]) => INHERITED.includes(k))));
    const key = keyFor(el);
    const node: SNode = { kind: 'box', key, tag: el.name, style: d, text: t, children: [], dom: el };
    if (el.attribs['data-id']) node.matchId = el.attribs['data-id'];
    const spec = parseSpec(el); if (spec) node.spec = spec;
    if ('data-group' in el.attribs) node.group = true;

    if (el.name === 'dc-element') {
      if (!el.attribs['data-id']) { warn('<dc-element> needs data-id (the element to keep); skipped'); return null; }
      return { ...node, kind: 'keep', keepId: el.attribs['data-id'] };
    }
    if (el.name === 'img') {
      const src = el.attribs.src?.trim();
      if (!src) { warn('<img> without src skipped'); return null; }
      return { ...node, kind: 'img', src };
    }
    if (el.name === 'svg') {
      return { ...node, kind: 'img', src: `svg:${svgPaths(el)}` };
    }

    const flowish = display === 'flex' || display === 'inline-flex' || display === 'grid' || display === 'inline-grid';
    const list = el.name === 'li' && el.parent && isEl(el.parent as ChildNode) && ['ul', 'ol'].includes((el.parent as DomElement).name) ? el.parent as DomElement : null;
    const listStyle = list ? `${d['list-style-type'] ?? d['list-style'] ?? ''} ${declsOf(list)['list-style-type'] ?? declsOf(list)['list-style'] ?? ''}` : '';
    const marker = list && !/none/.test(listStyle) ? (list.name === 'ol' ? `${list.children.filter((c) => isEl(c) && c.name === 'li').indexOf(el) + 1}. ` : '• ') : undefined;

    // classify children
    const kids = el.children.filter((c) => !(isEl(c) && SKIP.has(c.name)) && c.type !== 'comment' && c.type !== 'directive');
    const blockLevel = (c: ChildNode): boolean => {
      if (!isEl(c)) return false;
      if (c.name === 'br') return false;
      const cd = declsOf(c);
      const disp = displayOf(c, cd);
      if (disp === 'none') return false;
      if (flowish) return true; // flex/grid items are blockified
      if (disp !== 'inline') return true;
      return boxy(cd); // an inline box with a background or padding is drawn as a box
    };
    const hasBlocks = kids.some(blockLevel);
    if (!hasBlocks) {
      const runs: Run[] = [];
      gatherRuns(kids, t, t, runs, marker);
      const content = finish(runs, t.whiteSpace);
      if (content) node.children.push(textLeaf(`${key}`, el, t, content));
      return node;
    }
    // mixed: blocks, and runs of inline content wrapped as anonymous blocks
    let pending: ChildNode[] = [];
    const flush = () => {
      if (!pending.length) return;
      const runs: Run[] = [];
      gatherRuns(pending, t, t, runs, node.children.length === 0 ? marker : undefined);
      const content = finish(runs, t.whiteSpace);
      if (content) {
        // wrap in a <div> in the source so the text keeps a key across edits
        const wrap = new DomElement('div', {}, []);
        const at = el.children.indexOf(pending[0]!);
        for (const p of pending) { const i = el.children.indexOf(p); if (i >= 0) el.children.splice(i, 1); }
        wrap.children = pending;
        for (const p of pending) p.parent = wrap;
        wrap.parent = el;
        el.children.splice(at, 0, wrap);
        relink(el);
        const k = keyFor(wrap);
        const box: SNode = { kind: 'box', key: k, tag: 'div', style: {}, text: t, children: [textLeaf(k, wrap, t, content)], dom: wrap };
        node.children.push(box);
      }
      pending = [];
    };
    for (const c of kids) {
      if (blockLevel(c)) {
        flush();
        const child = build(c as DomElement, t, display);
        if (child) node.children.push(child);
      } else if (isEl(c) || (isText(c) && (c.data.trim() || pending.length))) pending.push(c);
    }
    flush();
    void parentDisplay;
    return node;
  };

  const body = findBody(doc);
  if (!body) throw new Error('no <body>');
  const bodyDecls = declsOf(body);
  const htmlText = inherit(base, Object.fromEntries(Object.entries(htmlDecls).filter(([k]) => INHERITED.includes(k))));
  const root = build(body, htmlText, 'block');
  if (!root) throw new Error('the <body> is hidden (display: none)');
  if (htmlDecls['background-color'] && !bodyDecls['background-color'] && !bodyDecls['background-image']) root.style = { ...root.style, 'background-color': htmlDecls['background-color']! };
  return { doc, root, css, warnings };
}

function findBody(doc: Document): DomElement | null {
  let hit: DomElement | null = null;
  const walk = (n: ChildNode) => { if (hit) return; if (isEl(n)) { if (n.name === 'body') { hit = n; return; } n.children.forEach(walk); } };
  doc.children.forEach(walk);
  return hit;
}

/** Fix sibling links after moving children around. */
function relink(el: DomElement): void {
  el.children.forEach((c, i) => { c.prev = el.children[i - 1] ?? null; c.next = el.children[i + 1] ?? null; c.parent = el; });
}

/** An inline <svg> → JSON of its paths (viewBox, d, fill, stroke) for a path element. */
function svgPaths(svg: DomElement): string {
  const vb = (svg.attribs.viewbox ?? svg.attribs.viewBox ?? `0 0 ${parseFloat(svg.attribs.width ?? '24')} ${parseFloat(svg.attribs.height ?? '24')}`).split(/[\s,]+/).map(Number);
  const paths: { d: string; fill?: string; stroke?: string }[] = [];
  const rootFill = svg.attribs.fill;
  const walk = (n: ChildNode) => {
    if (!isEl(n)) return;
    const fill = n.attribs.fill ?? rootFill;
    const stroke = n.attribs.stroke ?? svg.attribs.stroke;
    const add = (d: string) => paths.push({ d, ...(fill && fill !== 'currentColor' ? { fill } : {}), ...(stroke && stroke !== 'none' && stroke !== 'currentColor' ? { stroke } : {}) });
    const a = n.attribs, f = (k: string) => parseFloat(a[k] ?? '0');
    if (n.name === 'path' && a.d) add(a.d);
    else if (n.name === 'rect') { const x = f('x'), y = f('y'), w = f('width'), h = f('height'); add(`M${x} ${y}h${w}v${h}h${-w}z`); }
    else if (n.name === 'circle' || n.name === 'ellipse') { const cx = f('cx'), cy = f('cy'), rx = n.name === 'circle' ? f('r') : f('rx'), ry = n.name === 'circle' ? f('r') : f('ry'); add(`M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0z`); }
    else if (n.name === 'polygon' || n.name === 'polyline') { const pts = (a.points ?? '').trim().split(/[\s,]+/).map(Number); if (pts.length >= 4) add(`M${pts.slice(0, 2).join(' ')}L${pts.slice(2).join(' ')}${n.name === 'polygon' ? 'z' : ''}`); }
    else if (n.name === 'line') add(`M${f('x1')} ${f('y1')}L${f('x2')} ${f('y2')}`);
    n.children.forEach(walk);
  };
  svg.children.forEach(walk);
  return JSON.stringify({ viewBox: { x: vb[0] ?? 0, y: vb[1] ?? 0, w: vb[2] ?? 24, h: vb[3] ?? 24 }, paths });
}
