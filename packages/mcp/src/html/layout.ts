/**
 * Box tree → page boxes, with Yoga (the flexbox engine React Native uses).
 * Blocks stack as columns, flex is flex, grid becomes rows of flex cells, and
 * `position: absolute` works against the nearest positioned box. Text is
 * measured by a callback (the real CanvasKit renderer), so wrapping and
 * heights are the ones the canvas draws.
 */
import type { Node as YNode, Yoga } from 'yoga-layout/load';
import { cssLen, lenPx, words, type Decls, type Len, type LenCtx } from './css.ts';
import type { SNode } from './dom.ts';

export interface Box { x: number; y: number; w: number; h: number }

export interface Measurer {
  /** Size of a text leaf at most `maxW` wide (undefined = no limit). */
  text(node: SNode, maxW: number | undefined): { w: number; h: number };
  /** Width of the longest word (lines never break inside a word, like CSS). */
  minWidth(node: SNode): number;
  /** Natural pixel size of a picture, if known. */
  image(node: SNode): { w: number; h: number } | null;
  /** Current size of a kept element. */
  keep(node: SNode): { w: number; h: number } | null;
}

export interface LayoutOut {
  boxes: Map<SNode, Box>;
  /** Paint order of each box's children (z-index, positioned last). */
  order: Map<SNode, SNode[]>;
  warnings: string[];
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

export function layout(Y: Yoga, root: SNode, page: { width: number; height: number }, m: Measurer): LayoutOut {
  const warnings: string[] = [];
  const warn = (w: string) => { if (!warnings.includes(w) && warnings.length < 40) warnings.push(w); };
  const config = Y.Config.create();
  config.setPointScaleFactor(0);
  const ynodes = new Map<SNode, YNode>();
  const all: YNode[] = [];
  const mk = () => { const n = Y.Node.create(config); all.push(n); return n; };
  const lc = (n: SNode): LenCtx => ({ em: n.text.fontSize, rem: 16, vw: page.width, vh: page.height });

  const setLen = (n: SNode, v: string | undefined, set: (x: number | `${number}%` | 'auto' | undefined) => void) => {
    const l: Len = cssLen(v, lc(n));
    if (l === null) return;
    if (l === 'auto') set('auto');
    else if ('px' in l) set(l.px);
    else set(`${l.pct}%`);
  };

  const edge = { top: Y.EDGE_TOP, right: Y.EDGE_RIGHT, bottom: Y.EDGE_BOTTOM, left: Y.EDGE_LEFT } as const;
  const justify: Record<string, number> = { 'flex-start': Y.JUSTIFY_FLEX_START, start: Y.JUSTIFY_FLEX_START, left: Y.JUSTIFY_FLEX_START, normal: Y.JUSTIFY_FLEX_START, center: Y.JUSTIFY_CENTER, 'flex-end': Y.JUSTIFY_FLEX_END, end: Y.JUSTIFY_FLEX_END, right: Y.JUSTIFY_FLEX_END, 'space-between': Y.JUSTIFY_SPACE_BETWEEN, 'space-around': Y.JUSTIFY_SPACE_AROUND, 'space-evenly': Y.JUSTIFY_SPACE_EVENLY };
  const align: Record<string, number> = { 'flex-start': Y.ALIGN_FLEX_START, start: Y.ALIGN_FLEX_START, 'self-start': Y.ALIGN_FLEX_START, center: Y.ALIGN_CENTER, 'flex-end': Y.ALIGN_FLEX_END, end: Y.ALIGN_FLEX_END, 'self-end': Y.ALIGN_FLEX_END, stretch: Y.ALIGN_STRETCH, normal: Y.ALIGN_STRETCH, baseline: Y.ALIGN_BASELINE, 'space-between': Y.ALIGN_SPACE_BETWEEN, 'space-around': Y.ALIGN_SPACE_AROUND, 'space-evenly': Y.ALIGN_SPACE_EVENLY, auto: Y.ALIGN_AUTO };

  const displayOf = (n: SNode) => (n.style.display ?? (n.kind === 'img' ? 'inline-block' : n.tag === '#text' ? 'block' : 'block')).trim();

  /** Box-model and item properties every node has. */
  const common = (n: SNode, y: YNode, parent: { flex: boolean; row: boolean } | null) => {
    const s = n.style;
    setLen(n, s.width, (v) => y.setWidth(v));
    setLen(n, s.height, (v) => y.setHeight(v));
    setLen(n, s['min-width'], (v) => v !== 'auto' && y.setMinWidth(v));
    setLen(n, s['min-height'], (v) => v !== 'auto' && y.setMinHeight(v));
    setLen(n, s['max-width'], (v) => v !== 'auto' && y.setMaxWidth(v));
    setLen(n, s['max-height'], (v) => v !== 'auto' && y.setMaxHeight(v));
    for (const side of SIDES) {
      setLen(n, s[`margin-${side}`], (v) => y.setMargin(edge[side], v));
      setLen(n, s[`padding-${side}`], (v) => v !== 'auto' && y.setPadding(edge[side], v));
      if (s[`border-${side}-style`] !== 'none') { const b = lenPx(s[`border-${side}-width`], lc(n)); if (b) y.setBorder(edge[side], b); }
    }
    y.setBoxSizing((s['box-sizing'] ?? '').trim() === 'border-box' ? Y.BOX_SIZING_BORDER_BOX : Y.BOX_SIZING_CONTENT_BOX);
    const pos = (s.position ?? 'static').trim();
    if (pos === 'absolute' || pos === 'fixed') y.setPositionType(Y.POSITION_TYPE_ABSOLUTE);
    else if (pos === 'relative' || pos === 'sticky') y.setPositionType(Y.POSITION_TYPE_RELATIVE);
    else y.setPositionType(Y.POSITION_TYPE_STATIC);
    if (pos !== 'static') for (const side of SIDES) setLen(n, s[side], (v) => v !== 'auto' && y.setPosition(edge[side], v));
    if (s['aspect-ratio']) {
      const [a, b] = s['aspect-ratio'].split('/').map((x) => parseFloat(x));
      if (a && (b === undefined || b)) y.setAspectRatio(a / (b ?? 1));
    }
    // as a flex item
    const flexParent = parent?.flex ?? false;
    y.setFlexGrow(parseFloat(s['flex-grow'] ?? '0') || 0);
    y.setFlexShrink(s['flex-shrink'] !== undefined ? parseFloat(s['flex-shrink']) || 0 : flexParent ? 1 : 0);
    if (s['flex-basis'] && flexParent) setLen(n, s['flex-basis'], (v) => y.setFlexBasis(v));
    const as = s['align-self'] ?? s['justify-self'];
    if (as && align[as.trim()] !== undefined && flexParent) y.setAlignSelf(align[as.trim()] as never);
    // an inline-block in a block shrinks to its content
    const d = displayOf(n);
    if (!flexParent && parent && (d === 'inline-block' || d === 'inline-flex' || d === 'inline-grid' || d === 'table' || d === 'inline-table' || d === 'inline')) y.setAlignSelf(Y.ALIGN_FLEX_START);
    if (!flexParent && parent && (s['margin-left'] ?? '').trim() === 'auto' && (s['margin-right'] ?? '').trim() === 'auto') y.setAlignSelf(Y.ALIGN_CENTER);
    if (s.overflow && s.overflow !== 'visible') warn('overflow: hidden does not clip on the canvas; keep content inside its box');
  };

  /** Order children paint in: negative z, in-flow, positioned, positive z. */
  const paintOrder = (kids: SNode[]): SNode[] => {
    const z = (n: SNode) => { const v = parseInt(n.style['z-index'] ?? '', 10); return Number.isFinite(v) ? v : null; };
    const positioned = (n: SNode) => ['absolute', 'relative', 'fixed', 'sticky'].includes((n.style.position ?? '').trim());
    const rank = (n: SNode) => { const v = z(n); if (v !== null && v < 0) return [0, v]; if (v !== null && v > 0) return [3, v]; return positioned(n) || v !== null ? [2, 0] : [1, 0]; };
    return kids.map((n, i) => ({ n, i, r: rank(n) })).sort((a, b) => a.r[0]! - b.r[0]! || a.r[1]! - b.r[1]! || a.i - b.i).map((x) => x.n);
  };
  const order = new Map<SNode, SNode[]>();

  const make = (n: SNode, parent: { flex: boolean; row: boolean } | null): YNode => {
    const y = mk();
    ynodes.set(n, y);
    common(n, y, parent);
    if (n.kind === 'text') {
      y.setMeasureFunc((width, wMode, _h, _hMode) => {
        const min = m.minWidth(n);
        const max = wMode === Y.MEASURE_MODE_UNDEFINED || !Number.isFinite(width) ? undefined : Math.max(width, min);
        const s = m.text(n, max);
        return { width: wMode === Y.MEASURE_MODE_EXACTLY ? width : s.w, height: s.h };
      });
      return y;
    }
    if (n.kind === 'img' || n.kind === 'keep') {
      const nat = n.kind === 'img' ? m.image(n) : m.keep(n);
      if (nat && nat.w > 0 && nat.h > 0) {
        const hasW = !!n.style.width && n.style.width !== 'auto', hasH = !!n.style.height && n.style.height !== 'auto';
        if (!hasW && !hasH) { y.setWidth(nat.w); y.setHeight(nat.h); if (n.kind === 'img') { y.setHeight('auto'); y.setAspectRatio(nat.w / nat.h); } }
        else if (!hasW || !hasH) y.setAspectRatio(nat.w / nat.h);
      }
      return y;
    }
    // containers
    const d = displayOf(n);
    const s = n.style;
    const gapR = lenPx(s['row-gap'], lc(n)) ?? 0, gapC = lenPx(s['column-gap'], lc(n)) ?? 0;
    order.set(n, paintOrder(n.children));
    if (d === 'flex' || d === 'inline-flex') {
      const dir = (s['flex-direction'] ?? 'row').trim();
      y.setFlexDirection(dir === 'column' ? Y.FLEX_DIRECTION_COLUMN : dir === 'column-reverse' ? Y.FLEX_DIRECTION_COLUMN_REVERSE : dir === 'row-reverse' ? Y.FLEX_DIRECTION_ROW_REVERSE : Y.FLEX_DIRECTION_ROW);
      const wrap = (s['flex-wrap'] ?? 'nowrap').trim();
      y.setFlexWrap(wrap === 'wrap' ? Y.WRAP_WRAP : wrap === 'wrap-reverse' ? Y.WRAP_WRAP_REVERSE : Y.WRAP_NO_WRAP);
      y.setJustifyContent((justify[(s['justify-content'] ?? 'flex-start').trim()] ?? Y.JUSTIFY_FLEX_START) as never);
      y.setAlignItems((align[(s['align-items'] ?? 'stretch').trim()] ?? Y.ALIGN_STRETCH) as never);
      y.setAlignContent((align[(s['align-content'] ?? 'normal').trim()] ?? Y.ALIGN_STRETCH) as never);
      if (gapR) y.setGap(Y.GUTTER_ROW, gapR);
      if (gapC) y.setGap(Y.GUTTER_COLUMN, gapC);
      const row = dir.startsWith('row');
      n.children.forEach((c, i) => y.insertChild(make(c, { flex: true, row }), i));
      return y;
    }
    if (d === 'grid' || d === 'inline-grid') {
      grid(n, y, gapR, gapC);
      return y;
    }
    if (d !== 'block' && d !== 'inline-block' && d !== 'list-item' && d !== 'inline' && d !== 'flow-root' && d !== 'contents' && !d.startsWith('table')) warn(`display: ${d} is laid out as a block`);
    if (d.startsWith('table') || d === 'inline-table') warn('tables are laid out as blocks; use display:grid or flex for columns');
    y.setFlexDirection(Y.FLEX_DIRECTION_COLUMN);
    y.setAlignItems(Y.ALIGN_STRETCH);
    y.setJustifyContent(Y.JUSTIFY_FLEX_START);
    // text-align centres inline-blocks too
    n.children.forEach((c, i) => {
      const cy = make(c, { flex: false, row: false });
      const cd = displayOf(c);
      if ((cd === 'inline-block' || cd === 'inline-flex' || c.kind === 'img') && !c.style['align-self']) {
        if (n.text.align === 'center') cy.setAlignSelf(Y.ALIGN_CENTER);
        else if (n.text.align === 'right') cy.setAlignSelf(Y.ALIGN_FLEX_END);
      }
      y.insertChild(cy, i);
    });
    return y;
  };

  /** CSS grid as rows of flex cells: fr tracks grow, px tracks are fixed, spans cover the gaps between them. */
  const grid = (n: SNode, y: YNode, gapR: number, gapC: number) => {
    const s = n.style;
    if (s['grid-template-areas']) warn('grid-template-areas is not supported; place items in order (use grid-column: span N)');
    const tracks = gridTracks(s['grid-template-columns'] ?? 'none', n, lc(n), page.width, gapC);
    y.setFlexDirection(Y.FLEX_DIRECTION_COLUMN);
    y.setAlignItems(Y.ALIGN_STRETCH);
    if (gapR) y.setGap(Y.GUTTER_ROW, gapR);
    const itemsAlign = align[(s['align-items'] ?? 'stretch').trim()] ?? Y.ALIGN_STRETCH;
    const justifyItems = (s['justify-items'] ?? 'stretch').trim();
    const inflow = n.children.filter((c) => !['absolute', 'fixed'].includes((c.style.position ?? '').trim()));
    const outflow = n.children.filter((c) => !inflow.includes(c));
    let row: YNode | null = null, col = 0, rowIndex = 0;
    const newRow = () => {
      row = mk();
      row.setFlexDirection(Y.FLEX_DIRECTION_ROW);
      row.setAlignItems(itemsAlign as never);
      row.setFlexShrink(0);
      if (gapC) row.setGap(Y.GUTTER_COLUMN, gapC);
      y.insertChild(row, rowIndex++);
      col = 0;
    };
    for (const c of inflow) {
      const span = Math.max(1, Math.min(tracks.length, gridSpan(c.style['grid-column'] ?? (c.style['grid-column-start'] ? `${c.style['grid-column-start']} / ${c.style['grid-column-end'] ?? 'auto'}` : ''), tracks.length)));
      if (!row || col + span > tracks.length) newRow();
      const cy = make(c, { flex: true, row: true });
      const spanned = tracks.slice(col, col + span);
      const fr = spanned.reduce((a, t) => a + (t.fr ?? 0), 0);
      const px = spanned.reduce((a, t) => a + (t.px ?? 0), 0) + (span - 1) * gapC;
      if (!c.style.width) {
        if (fr > 0) { cy.setFlexBasis(px); cy.setFlexGrow(fr); cy.setFlexShrink(1); cy.setMinWidth(0); }
        else { cy.setWidth(px); cy.setFlexShrink(0); }
      } else {
        // a fixed-width item still takes its track's space: wrap it in a cell
        const cell = mk();
        if (fr > 0) { cell.setFlexBasis(px); cell.setFlexGrow(fr); cell.setFlexShrink(1); } else { cell.setWidth(px); cell.setFlexShrink(0); }
        cell.setFlexDirection(Y.FLEX_DIRECTION_COLUMN);
        cell.setAlignItems(justifyItems === 'center' ? Y.ALIGN_CENTER : justifyItems === 'end' ? Y.ALIGN_FLEX_END : Y.ALIGN_FLEX_START);
        cell.insertChild(cy, 0);
        row!.insertChild(cell, row!.getChildCount());
        col += span;
        continue;
      }
      if (justifyItems !== 'stretch' && justifyItems !== 'normal') warn('justify-items other than stretch needs the grid items to have a width');
      row!.insertChild(cy, row!.getChildCount());
      col += span;
    }
    // fill the last row so its cells keep the track widths
    if (row && col < tracks.length) {
      const rest = tracks.slice(col);
      const filler = mk();
      const fr = rest.reduce((a, t) => a + (t.fr ?? 0), 0);
      const px = rest.reduce((a, t) => a + (t.px ?? 0), 0) + (rest.length - 1) * gapC;
      if (fr > 0) { filler.setFlexBasis(px); filler.setFlexGrow(fr); } else filler.setWidth(px);
      (row as YNode).insertChild(filler, (row as YNode).getChildCount());
    }
    for (const c of outflow) y.insertChild(make(c, { flex: false, row: false }), y.getChildCount());
    order.set(n, paintOrder(n.children));
  };

  const yroot = make(root, null);
  yroot.setBoxSizing(Y.BOX_SIZING_BORDER_BOX);
  yroot.setWidth(page.width);
  yroot.setHeight(page.height);
  yroot.setPositionType(Y.POSITION_TYPE_RELATIVE);
  yroot.calculateLayout(page.width, page.height, Y.DIRECTION_LTR);

  // absolute boxes: Yoga gives positions relative to the parent node
  const boxes = new Map<SNode, Box>();
  const abs = (yn: YNode): { x: number; y: number } => {
    let x = 0, yy = 0;
    for (let p: YNode | null = yn; p; p = p.getParent()) { x += p.getComputedLeft(); yy += p.getComputedTop(); }
    return { x, y: yy };
  };
  for (const [n, yn] of ynodes) {
    const p = abs(yn);
    boxes.set(n, { x: p.x, y: p.y, w: yn.getComputedWidth(), h: yn.getComputedHeight() });
  }
  // overflow checks
  for (const [n, b] of boxes) {
    if (n.kind === 'text') {
      const min = m.minWidth(n);
      const need = m.text(n, Math.max(b.w, min));
      if (min > b.w + 1) warn(`text "${clip(n.content?.text)}" has a word ${Math.ceil(min)} px wide in a ${Math.round(b.w)} px box: it sticks out (widen the box, e.g. width or min-width on its column, or lower the font-size)`);
      else if (need.h > b.h + 1) warn(`text "${clip(n.content?.text)}" needs ${Math.ceil(need.h)} px of height but its box is ${Math.round(b.h)} px: it overflows (make the box taller, the text smaller, or let it grow)`);
    }
    if (b.x < -0.5 || b.y < -0.5 || b.x + b.w > page.width + 0.5 || b.y + b.h > page.height + 0.5) {
      if (n !== root && (n.kind !== 'box' || n.children.length)) warn(`${describe(n)} goes past the page edge (box ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)} on a ${page.width}×${page.height} page)`);
    }
  }
  // children that spill out of a painted parent
  for (const [n, b] of boxes) {
    if (n.kind !== 'box' || n === root) continue;
    const painted = !!(n.style['background-color'] || n.style['background-image'] || n.style['border-top-width']);
    if (!painted) continue;
    for (const c of n.children) {
      const cb = boxes.get(c);
      if (!cb || ['absolute', 'fixed'].includes((c.style.position ?? '').trim())) continue;
      if (cb.y + cb.h > b.y + b.h + 1 || cb.x + cb.w > b.x + b.w + 1) { warn(`${describe(c)} spills out of its box ${describe(n)}`); break; }
    }
  }
  yroot.freeRecursive();
  config.free();
  return { boxes, order, warnings };
}

const clip = (s?: string) => { const t = (s ?? '').replace(/\s+/g, ' ').trim(); return t.length > 40 ? `${t.slice(0, 37)}…` : t; };

function describe(n: SNode): string {
  if (n.kind === 'text') return `text "${clip(n.content?.text)}"`;
  const cls = n.dom.attribs.class ? `.${n.dom.attribs.class.trim().split(/\s+/).join('.')}` : '';
  const id = n.dom.attribs.id ? `#${n.dom.attribs.id}` : '';
  return `<${n.tag}${id}${cls}> [data-k=${n.key}]`;
}

interface Track { fr?: number; px?: number }

function gridTracks(v: string, n: SNode, c: LenCtx, pageW: number, gap: number): Track[] {
  const out: Track[] = [];
  const parse = (t: string): Track => {
    const s = t.trim();
    if (s.endsWith('fr')) return { fr: parseFloat(s) || 1 };
    const mm = s.match(/^minmax\((.*),(.*)\)$/);
    if (mm) return parse(mm[2]!.trim().endsWith('fr') ? mm[2]! : mm[1]!);
    if (s === 'auto' || s === 'min-content' || s === 'max-content') return { fr: 1 };
    const px = lenPx(s, c, pageW);
    return px === null ? { fr: 1 } : { px };
  };
  for (const w of words(v)) {
    const rep = w.match(/^repeat\(\s*([^,]+),(.*)\)$/);
    if (rep) {
      const inner = words(rep[2]!.trim());
      let count = parseInt(rep[1]!, 10);
      if (!Number.isFinite(count)) {
        // auto-fill / auto-fit: as many minimum-size tracks as fit the page width
        const min = inner[0]?.match(/^minmax\(([^,]+),/)?.[1];
        const minPx = lenPx(min ?? inner[0], c, pageW) ?? 200;
        count = Math.max(1, Math.floor((pageW + gap) / (minPx + gap)));
      }
      for (let i = 0; i < count; i++) for (const t of inner) out.push(parse(t));
    } else if (w !== 'none') out.push(parse(w));
  }
  void n;
  return out.length ? out : [{ fr: 1 }];
}

function gridSpan(v: string, total: number): number {
  const s = v.trim();
  if (!s) return 1;
  const span = s.match(/span\s+(\d+)/);
  if (span) return parseInt(span[1]!, 10);
  const parts = s.split('/').map((x) => x.trim());
  if (parts.length === 2) {
    const a = parseInt(parts[0]!, 10), b = parseInt(parts[1]!, 10);
    if (Number.isFinite(a) && Number.isFinite(b)) return Math.abs((b < 0 ? total + 2 + b : b) - a) || 1;
    if (parts[1] === '-1' || Number.isFinite(a) && parts[1] === '-1') return total;
  }
  return 1;
}

export type { Decls };
