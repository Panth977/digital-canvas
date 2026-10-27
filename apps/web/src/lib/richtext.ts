/**
 * The in-place rich text editor: a contenteditable that shows a text box's
 * runs as styled spans (one block per line) and reads them back. The DOM is
 * the source of truth while typing; it is rebuilt only when a style changes
 * from outside (the properties panel) or the zoom changes.
 */
import { listIndent } from '@digital-canvas/render';
import { runsOf, type TextElement, type TextRun, type TextStyle } from '@digital-canvas/scene';

const css = (s: string) => s.replace(/["\\]/g, '');

function spanCss(st: TextStyle, zoom: number): string {
  const deco = [st.underline && 'underline', st.strike && 'line-through'].filter(Boolean).join(' ') || 'none';
  return `font-family:"${css(st.fontFamily)}",Inter,sans-serif;font-size:${st.fontSize * zoom}px;font-weight:${st.bold ? 700 : 400};`
    + `font-style:${st.italic ? 'italic' : 'normal'};color:${st.color};letter-spacing:${st.letterSpacing * zoom}px;`
    + `text-decoration:${deco};text-transform:${st.uppercase ? 'uppercase' : 'none'};line-height:${st.lineHeight}`;
}

/**
 * Fill `root` with the box's text as blocks of styled spans, laid out the way
 * the canvas (Skia) lays it out: each line is as tall as its own runs need
 * (font ascent + descent, the extra line height split above and below), with
 * no CSS "strut" from the block's font. An empty line takes the size of the
 * run its line break belongs to, like Skia.
 */
export function renderRich(root: HTMLElement, el: TextElement, zoom: number): void {
  root.replaceChildren();
  const runs = runsOf(el);
  let line = document.createElement('div');
  const lines = [line];
  /** Style of the run each line starts in (for empty lines). */
  const lineStyle: Partial<TextStyle>[] = [runs[0]?.style ?? {}];
  for (const r of runs) {
    const parts = r.text.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) {
        line = document.createElement('div');
        lines.push(line);
        lineStyle.push(r.style ?? {});
      }
      if (!part) return;
      const span = document.createElement('span');
      span.dataset.s = JSON.stringify(r.style ?? {});
      span.style.cssText = spanCss({ ...el.style, ...r.style }, zoom);
      span.textContent = part;
      line.append(span);
    });
  }
  lines.forEach((l, k) => {
    // a paragraph's own alignment (set by its first run)
    const first = (l.firstChild as HTMLElement | null)?.dataset?.s;
    const align = first ? (JSON.parse(first) as Partial<TextStyle>).align : undefined;
    if (align) l.style.textAlign = align;
    if (!l.childNodes.length) {
      // an empty line: its height comes from the block's own font (a list item's: the box's)
      const st = el.list ? el.style : { ...el.style, ...lineStyle[k] };
      l.style.cssText += `font-family:"${css(st.fontFamily)}",Inter,sans-serif;font-size:${st.fontSize * zoom}px;line-height:${st.lineHeight};`;
      l.append(document.createElement('br'));
    } else {
      // no strut: only the spans set the line's height
      l.style.fontSize = '0';
      l.style.lineHeight = '0';
    }
    if (el.list) {
      l.style.display = 'list-item';
      l.style.listStyleType = el.list === 'bullet' ? 'disc' : 'decimal';
    }
  });
  root.style.paddingLeft = el.list ? `${listIndent(el) * zoom}px` : '0';
  root.append(...lines);
}

const isBlock = (n: Node) => n.nodeType === 1 && /^(DIV|P|LI)$/.test((n as Element).tagName);

/** Is `n` the last thing in its line block (nothing after it but empty text)? */
function endsLine(n: Node): boolean {
  for (let x: Node | null = n; x && !isBlock(x); x = x.parentNode) {
    for (let s = x.nextSibling; s; s = s.nextSibling) if (s.nodeType !== 3 || s.textContent) return false;
    if (x.parentNode && isBlock(x.parentNode)) return true;
  }
  return false;
}

/** Style overrides that apply to a text node: from the nearest span we made. */
function styleOf(node: Node, root: HTMLElement): Partial<TextStyle> | undefined {
  for (let n: Node | null = node.parentNode; n && n !== root; n = n.parentNode) {
    const s = (n as HTMLElement).dataset?.s;
    if (s) {
      try {
        const v = JSON.parse(s) as Partial<TextStyle>;
        return Object.keys(v).length ? v : undefined;
      } catch { return undefined; }
    }
  }
  return undefined;
}

interface Flat {
  text: string;
  runs: TextRun[];
  /** Each text node with the offset its text starts at. */
  nodes: { node: Text; start: number }[];
  /** Each line block with the offset it starts at. */
  lines: { el: Node; start: number }[];
}

/** Read the editor back: plain text, runs, and where each DOM text node sits. */
export function flatten(root: HTMLElement): Flat {
  const out: Flat = { text: '', runs: [], nodes: [], lines: [] };
  const push = (t: string, style: Partial<TextStyle> | undefined) => {
    out.text += t;
    const last = out.runs[out.runs.length - 1];
    if (last && JSON.stringify(last.style ?? {}) === JSON.stringify(style ?? {})) last.text += t;
    else out.runs.push(style ? { text: t, style } : { text: t });
  };
  const newline = () => push('\n', out.runs[out.runs.length - 1]?.style);
  const walk = (n: Node, inLine: boolean) => {
    if (n.nodeType === 3) {
      const t = (n.textContent ?? '').replace(/\u00a0/g, ' ');
      if (!t) return;
      out.nodes.push({ node: n as Text, start: out.text.length });
      push(t, styleOf(n, root));
    } else if ((n as Element).tagName === 'BR') {
      // A lone <br> keeps an empty line open; a <br> that ends its line is the browser's
      // placeholder (it shows the empty line after a break), not a break itself; any other is a line break.
      const parent = n.parentNode!;
      if (!(isBlock(parent) && parent.childNodes.length === 1) && inLine && !endsLine(n)) newline();
    } else for (const c of n.childNodes) walk(c, inLine);
  };
  // Top level: blocks are lines; loose inline nodes between blocks form a line too.
  let first = true;
  let loose = false;
  for (const c of root.childNodes) {
    if (isBlock(c)) {
      if (!first) newline();
      out.lines.push({ el: c, start: out.text.length });
      walk(c, true);
      first = false;
      loose = false;
    } else {
      if (!loose) {
        if (!first) newline();
        out.lines.push({ el: c, start: out.text.length });
        loose = true;
        first = false;
      }
      walk(c, true);
    }
  }
  return out;
}

/** Text offset of a DOM point inside the editor. */
export function offsetOf(root: HTMLElement, flat: Flat, node: Node, offset: number): number {
  if (node.nodeType === 3) {
    const hit = flat.nodes.find((x) => x.node === node);
    if (hit) return hit.start + Math.min(offset, hit.node.length);
  }
  // The line the point is in.
  let line: Flat['lines'][number] | undefined;
  if (node === root) {
    const child = root.childNodes[offset];
    if (!child) return flat.text.length;
    line = flat.lines.find((l) => l.el === child || child.contains(l.el)) ?? flat.lines.find((l) => l.el.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_PRECEDING);
    if (line) return line.start;
  } else line = flat.lines.find((l) => l.el === node || l.el.contains(node));
  if (!line) return flat.text.length;
  // The end of the last text node in that line that comes before the point.
  const point = document.createRange();
  point.setStart(node, offset);
  let pos = line.start;
  for (const x of flat.nodes) {
    if (!line.el.contains(x.node) && line.el !== x.node) continue;
    if (point.comparePoint(x.node, x.node.length) <= 0) pos = x.start + x.node.length;
  }
  return pos;
}

/** Current selection as text offsets, or null when it is outside the editor. */
export function getSelectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
  const flat = flatten(root);
  const a = offsetOf(root, flat, r.startContainer, r.startOffset), b = offsetOf(root, flat, r.endContainer, r.endOffset);
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

function pointAt(root: HTMLElement, flat: Flat, off: number): [Node, number] {
  for (const x of flat.nodes) if (off >= x.start && off <= x.start + x.node.length) return [x.node, off - x.start];
  // an empty line
  const line = [...flat.lines].reverse().find((l) => l.start <= off);
  if (line) return [line.el, 0];
  return [root, root.childNodes.length];
}

export function setSelectionOffsets(root: HTMLElement, start: number, end: number): void {
  const flat = flatten(root);
  const sel = document.getSelection();
  if (!sel) return;
  const r = document.createRange();
  const [sn, so] = pointAt(root, flat, start);
  const [en, eo] = pointAt(root, flat, end);
  r.setStart(sn, so);
  r.setEnd(en, eo);
  sel.removeAllRanges();
  sel.addRange(r);
}

/**
 * Has the browser changed the editor's structure in a way that breaks the
 * canvas's line model? (A text node or element outside our spans, a line div
 * that lost its spans, a wrapper the browser added.) Then it should be rebuilt.
 */
export function needsRebuild(root: HTMLElement): boolean {
  for (const line of root.childNodes) {
    if (line.nodeType !== 1 || (line as Element).tagName !== 'DIV') return true;
    const div = line as HTMLElement;
    const empty = div.childNodes.length === 1 && (div.firstChild as Element).tagName === 'BR';
    // a line div keeps font-size 0 only while it holds our spans
    if (empty !== (div.style.fontSize !== '0')) return true;
    if (empty) continue;
    for (const c of div.childNodes) {
      if (c.nodeType !== 1 || (c as Element).tagName !== 'SPAN' || !(c as HTMLElement).dataset.s) return true;
      for (const t of c.childNodes) if (t.nodeType !== 3) return true;
    }
  }
  return false;
}
