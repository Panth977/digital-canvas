import { describe, expect, it } from 'vitest';
import { completeDoc, designFromReply, extractJson, looseColor, looseFill, parseDoc } from '../src/index.ts';

/** A reply as Claude writes it for "Design for me" (prose around a fenced JSON block). */
const CANNED = `Here's a bold poster for your bakery opening:

\`\`\`json
{
  "pages": [{
    "background": { "type": "linear", "angle": 135, "colors": ["#fdf6ec", "#f7d9b5"] },
    "elements": [
      { "type": "shape", "shape": "rect", "x": 0, "y": 0, "w": 1080, "h": 320, "fill": "#7a3e1d", "radius": 0 },
      { "type": "text", "text": "GRAND OPENING", "x": 60, "y": 90, "w": 960, "fontSize": 110, "fontFamily": "Anton", "color": "#fff", "align": "center", "uppercase": true },
      { "type": "text", "text": "Fresh bread · Pastries · Coffee", "x": 90, "y": 420, "w": 900, "fontSize": 44, "fontWeight": 700, "color": "#7a3e1d", "align": "center" },
      { "type": "icon", "icon": "fluent-emoji-flat:croissant", "x": 440, "y": 560, "w": 200, "h": 200 },
      { "type": "circle", "x": 860, "y": 860, "w": 160, "h": 160, "color": "#e0a526" },
      { "type": "arrow", "x1": 100, "y1": 900, "x2": 400, "y2": 900, "color": "#7a3e1d", "strokeWidth": 6 },
      { "type": "chart", "chart": "donut", "labels": ["Bread", "Cake"], "values": [60, 40], "x": 100, "y": 780, "w": 220, "h": 220 },
      { "type": "table", "rows": [["Item", "Price"], ["Croissant", "₹90"]], "x": 600, "y": 600, "w": 380 },
      { "type": "video", "x": 0, "y": 0 },
      { "type": "text", "text": "" }
    ]
  }]
}
\`\`\`

Let me know if you want a different palette!`;

describe('loose documents (AI replies, hand-written JSON)', () => {
  it('turns a canned model reply into a valid page', () => {
    const { doc, icons, warnings } = designFromReply(CANNED, { width: 1080, height: 1350 });
    expect(() => parseDoc(JSON.parse(JSON.stringify(doc)))).not.toThrow();
    expect([doc.width, doc.height]).toEqual([1080, 1350]);
    const page = doc.pages[0]!;
    expect(page.background).toEqual({ type: 'linear', angle: 135, stops: [{ offset: 0, color: '#fdf6ec' }, { offset: 1, color: '#f7d9b5' }] });
    expect(page.elements.map((e) => e.type)).toEqual(['shape', 'text', 'text', 'shape', 'line', 'chart', 'table']);
    const title = page.elements[1]!;
    expect(title.type === 'text' && title.style).toMatchObject({ fontFamily: 'Anton', fontSize: 110, color: '#ffffff', align: 'center', uppercase: true });
    expect(title.h).toBeGreaterThan(100);
    const sub = page.elements[2]!;
    expect(sub.type === 'text' && sub.style.bold).toBe(true);
    const circle = page.elements[3]!;
    expect(circle.type === 'shape' && circle.shape).toBe('ellipse');
    const arrow = page.elements[4]!;
    expect(arrow.type === 'line' && arrow.end.marker).toBe('arrow');
    const chart = page.elements[5]!;
    expect(chart.type === 'chart' && chart.series[0]!.values).toEqual([60, 40]);
    const table = page.elements[6]!;
    expect(table.type === 'table' && table.cells[1]![1]!.text).toBe('₹90');
    expect(icons).toEqual([expect.objectContaining({ icon: 'fluent-emoji-flat:croissant', index: 3, page: 0 })]);
    expect(warnings).toContain('left out an element of type "video"');
    expect(new Set(page.elements.map((e) => e.id)).size).toBe(page.elements.length);
  });

  it('rejects replies without a design', () => {
    expect(() => designFromReply('Sorry, I cannot help with that.', { width: 100, height: 100 })).toThrow(/no JSON/);
    expect(() => designFromReply('```json\n{"pages": []}\n```', { width: 100, height: 100 })).toThrow(/no pages/);
    expect(() => extractJson('{ broken')).toThrow();
  });

  it('accepts a single page or bare element list', () => {
    expect(completeDoc({ elements: [{ type: 'rect', x: 1, y: 2, w: 3, h: 4, fill: 'red' }] }).doc.pages).toHaveLength(1);
    expect(completeDoc([{ background: 'navy', elements: [] }, { elements: [] }]).doc.pages).toHaveLength(2);
    expect(looseColor('FFF')).toBe('#ffffff');
    expect(looseColor('nope')).toBeNull();
    expect(looseFill(['#000', '#fff'])).toMatchObject({ type: 'linear', angle: 90 });
  });
});
