import { describe, expect, it } from 'vitest';
import {
  addElements, chart, createDoc, decompose, followConnectors, freehand, grid, GRIDS, FRAMES, hitTest, lineDistance, lineEnds, lineRoute, parseDoc, parseSvg,
  pruneAssets, qrCode, qrUpdate, removeElements, setLineEnds, shape, table, tableAddCol, tableAddRow, tableCellAt, tableColWidth, tableFitRows,
  tableRemoveCol, tableRemoveRow, tableSetCell, updateElements, line, frame, type LineElement,
} from '../src/index.ts';

describe('lines', () => {
  it('keeps ends relative to a box spanning them', () => {
    const l = line({ x: 100, y: 50 }, { x: 20, y: 90 }, { end: 'arrow' });
    expect([l.x, l.y, l.w, l.h]).toEqual([20, 50, 80, 40]);
    expect(lineEnds(l)).toEqual([{ x: 100, y: 50 }, { x: 20, y: 90 }]);
    // moving the box moves both ends
    expect(lineEnds({ ...l, x: 30 })[0]).toEqual({ x: 110, y: 50 });
  });

  it('routes elbow and curved lines and measures distance to them', () => {
    const l = line({ x: 0, y: 0 }, { x: 100, y: 40 }, { route: 'elbow' });
    expect(lineRoute(l)).toEqual({ kind: 'poly', pts: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 40 }, { x: 100, y: 40 }] });
    expect(lineDistance(l, { x: 50, y: 20 })).toBeCloseTo(0);
    expect(lineDistance(l, { x: 20, y: 30 })).toBeGreaterThan(20);
    const c = { ...l, route: 'curved' as const };
    expect(lineRoute(c).kind).toBe('cubic');
    expect(lineDistance(c, { x: 50, y: 20 })).toBeLessThan(1);
  });

  it('hit tests near the stroke only', () => {
    let doc = createDoc({ width: 200, height: 200 });
    const l = line({ x: 0, y: 0 }, { x: 200, y: 200 });
    doc = addElements(doc, doc.pages[0]!.id, [l]);
    expect(hitTest(doc.pages[0]!, { x: 100, y: 101 })?.id).toBe(l.id);
    expect(hitTest(doc.pages[0]!, { x: 150, y: 40 })).toBeNull(); // inside the box, far from the line
  });

  it('decomposes markers: a triangle trims the stroke, an arrow does not', () => {
    const d = decompose(line({ x: 0, y: 0 }, { x: 100, y: 0 }, { end: 'triangle', start: 'arrow', stroke: { color: '#ff0000', width: 4 } }));
    expect(d.paths).toHaveLength(3);
    expect(d.paths[0]!.d.startsWith('M0 0L')).toBe(true);
    expect(d.paths[0]!.d.endsWith('L100 0')).toBe(false);
    expect(d.paths[2]!.fill).toEqual({ type: 'solid', color: '#ff0000' });
  });
});

describe('connectors', () => {
  it('follow the elements they are stuck to, and let go of deleted ones', () => {
    let doc = createDoc({ width: 400, height: 400 });
    const a = shape('rect', { x: 0, y: 0, w: 100, h: 100 }), b = shape('ellipse', { x: 300, y: 300, w: 50, h: 50 });
    const base = line({ x: 0, y: 0 }, { x: 1, y: 1 });
    const l: LineElement = { ...base, ...setLineEnds(base, { x: 100, y: 50 }, { x: 325, y: 300 }, { start: { elementId: a.id, point: { x: 1, y: 0.5 } }, end: { elementId: b.id, point: { x: 0.5, y: 0 } } }) } as LineElement;
    doc = addElements(doc, doc.pages[0]!.id, [a, b, l]);
    expect(followConnectors(doc)).toBe(doc); // nothing moved
    doc = followConnectors(updateElements(doc, [a.id], { x: 50, y: 20 }));
    const moved = doc.pages[0]!.elements[2] as LineElement;
    expect(lineEnds(moved)[0]).toEqual({ x: 150, y: 70 });
    expect(lineEnds(moved)[1]).toEqual({ x: 325, y: 300 });
    // a rotated target: the side point turns with it
    doc = followConnectors(updateElements(doc, [a.id], { rotation: 90 }));
    const turned = lineEnds(doc.pages[0]!.elements[2] as LineElement)[0];
    expect(turned.x).toBeCloseTo(100);
    expect(turned.y).toBeCloseTo(120);
    doc = followConnectors(removeElements(doc, [b.id]));
    const gone = doc.pages[0]!.elements[1] as LineElement;
    expect(gone.end.attach).toBeUndefined();
    expect(gone.start.attach?.elementId).toBe(a.id);
  });
});

describe('frames and grids', () => {
  it('has at least 8 frame shapes and a dozen grids of 2–9 cells', () => {
    expect(FRAMES.length).toBeGreaterThanOrEqual(8);
    expect(GRIDS.length).toBeGreaterThanOrEqual(12);
    for (const g of GRIDS) {
      expect(g.cells.length).toBeGreaterThanOrEqual(2);
      expect(g.cells.length).toBeLessThanOrEqual(9);
      const area = g.cells.reduce((s, [, , w, h]) => s + w * h, 0);
      expect(area).toBeCloseTo(1, 5); // cells tile the whole area
    }
  });
  it('grid frames fill the area with gaps', () => {
    const fs = grid('2v', { x: 0, y: 0, w: 200, h: 100 }, 10);
    expect(fs.map((f) => [f.x, f.w])).toEqual([[0, 95], [105, 95]]);
  });
  it('an empty frame needs no asset; parse keeps the new element types', () => {
    let doc = createDoc({ width: 100, height: 100 });
    doc = addElements(doc, doc.pages[0]!.id, [frame('star', { x: 0, y: 0, w: 50, h: 50 }), table(2, 2, { x: 0, y: 0, w: 50, h: 50 }), chart('pie', { x: 0, y: 0, w: 50, h: 50 }), line({ x: 0, y: 0 }, { x: 9, y: 9 })]);
    doc = { ...doc, assets: { x: { mime: 'image/png' } } };
    expect(pruneAssets(doc).assets).toEqual({});
    expect(parseDoc(JSON.parse(JSON.stringify(doc))).pages[0]!.elements.map((e) => e.type)).toEqual(['image', 'table', 'chart', 'line']);
  });
});

describe('tables', () => {
  const t0 = () => table(2, 2, { x: 0, y: 0, w: 200, h: 100 });
  it('adds and removes rows and columns', () => {
    let t = t0();
    t = { ...t, ...tableAddRow(t, 0) };
    expect(t.rows).toHaveLength(3);
    expect(t.h).toBe(150);
    expect(t.rows.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    t = { ...t, ...tableAddCol(t, 1) };
    expect(t.cols).toHaveLength(3);
    expect(t.cells.every((r) => r.length === 3)).toBe(true);
    t = { ...t, ...tableRemoveRow(t, 0), };
    t = { ...t, ...tableRemoveCol(t, 0) };
    expect([t.rows.length, t.cols.length, t.h]).toEqual([2, 2, 100]);
  });
  it('finds cells, sets text, widths and fits rows', () => {
    let t = t0();
    expect(tableCellAt(t, { x: 150, y: 80 })).toEqual({ r: 1, c: 1 });
    t = { ...t, ...tableSetCell(t, 1, 1, { text: 'hi', fill: '#ff0000' }) };
    expect(t.cells[1]![1]).toEqual({ text: 'hi', fill: '#ff0000' });
    t = { ...t, ...tableColWidth(t, 0, 150) };
    expect(t.cols[0]! * t.w).toBeCloseTo(150);
    expect(t.cols[1]! * t.w).toBeCloseTo(50);
    const fit = tableFitRows(t, [0, 120])!;
    expect(fit.h).toBe(170);
  });
  it('decomposes into fills, borders and cell text boxes', () => {
    const t = { ...t0(), cells: [[{ text: 'A', fill: '#eeeeee' }, { text: '' }], [{ text: '' }, { text: 'B' }]] };
    const d = decompose(t);
    expect(d.paths.filter((p) => p.fill)).toHaveLength(1);
    expect(d.paths.some((p) => p.stroke)).toBe(true);
    expect(d.texts.map((x) => x.el.text)).toEqual(['A', 'B']);
    expect(d.texts[1]!.el.x).toBeGreaterThan(100);
  });
});

describe('charts', () => {
  it('bars per value with nice gridlines; pie slices per value', () => {
    const c = chart('column', { x: 0, y: 0, w: 400, h: 300 });
    const d = decompose(c);
    expect(d.paths.filter((p) => p.fill && p.d.split('M').length - 1 === c.labels.length)).toHaveLength(2); // one path per series, a bar per label
    expect(d.texts.map((t) => t.el.text)).toEqual(expect.arrayContaining(['Jan', 'May', '0', '40', '2025']));
    const pie = decompose(chart('donut', { x: 0, y: 0, w: 300, h: 300 }));
    expect(pie.paths.filter((p) => p.d.includes('A'))).toHaveLength(4);
  });
});

describe('QR, drawing and SVG icons', () => {
  it('makes a QR code path and updates it', () => {
    const q = qrCode('https://example.com', { x: 0, y: 0, w: 100, h: 80 });
    expect([q.w, q.h]).toEqual([80, 80]);
    expect(q.paths).toHaveLength(2);
    expect(q.viewBox.w).toBe(25 + 4); // version 2 at ecc M, plus the quiet zone
    const u = qrUpdate(q, 'x');
    expect(u.viewBox!.w).toBe(21 + 4);
  });
  it('smooths a stroke into curves', () => {
    const p = freehand([{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }, { x: 30, y: 10 }], { color: '#000000', size: 4, brush: 'pen' })!;
    expect(p.paths[0]!.d).toMatch(/^M0 0C/);
    expect(p.x).toBe(-3);
    expect(p.paths[0]!.stroke!.width).toBe(4);
    expect(freehand([{ x: 5, y: 5 }], { color: '#000000', size: 4, brush: 'highlighter' })!.opacity).toBe(0.4);
  });
  it('parses icon SVG: currentColor, groups, shapes, strokes, even-odd', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><clipPath id="a"><path d="M0 0h1v1z"/></clipPath></defs>
      <g fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></g>
      <rect x="2" y="2" width="4" height="4" rx="1" fill="#f00" fill-opacity=".5"/><path fill-rule="evenodd" d="M0 0h24v24H0z"/></svg>`;
    const r = parseSvg(svg, '#123456')!;
    expect(r.viewBox).toEqual({ x: 0, y: 0, w: 24, h: 24 });
    expect(r.paths).toHaveLength(4);
    expect(r.paths[0]).toMatchObject({ fill: null, stroke: { color: '#123456', width: 2 } });
    expect(r.paths[2]!.fill).toEqual({ type: 'solid', color: '#ff000080' });
    expect(r.paths[3]).toMatchObject({ fill: { type: 'solid', color: '#000000' }, evenOdd: true });
    expect(parseSvg('<svg viewBox="0 0 1 1"></svg>')).toBeNull();
  });
});
