/** Product mockups: see a page on a T-shirt, a mug, a billboard… */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MOCKUP_CATEGORIES } from '@digital-canvas/render';
import type { Context } from '../context.ts';
import { listMockups, renderPageMockup } from '../mockups.ts';
import { pageRef } from '../schemas.ts';
import { b64, json, pageOf, safe, type Result } from './util.ts';

const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '').trim().slice(0, 80) || 'design';

export function registerMockupTools(server: McpServer, ctx: Context): void {
  server.registerTool('list_mockups', {
    title: 'List product mockups',
    description: `Photoreal product mockups a page can be previewed on (T-shirts, bags, mugs, posters, billboards, phones…). Returns id, label, category (${MOCKUP_CATEGORIES.join(', ')}), aspect (width/height of the print area: the page is cover-fitted to it, so pick one close to the design's shape) and, for products whose colour can change, the suggested colours. Then render_mockup.`,
    inputSchema: { category: z.string().optional().describe(`One of ${MOCKUP_CATEGORIES.join(', ')}.`) },
    annotations: { readOnlyHint: true },
  }, safe(async ({ category }) => {
    const all = await listMockups();
    const list = category ? all.filter((m) => m.category.toLowerCase() === category.toLowerCase()) : all;
    return json({
      mockups: list.map((m) => ({ id: m.id, label: m.label, category: m.category, aspect: m.aspect, ...(m.tint ? { colors: m.colors ?? [] } : {}) })),
      ...(all.length ? {} : { note: 'The mockup library is not published yet.' }),
    });
  }));

  server.registerTool('render_mockup', {
    title: 'Preview a page on a product mockup',
    description: 'Composite a page onto a product mockup (from list_mockups) with the product\'s lighting and folds, and return the image to look at. `color` recolours the product when the mockup allows it (#rrggbb; default its first colour). `save: true` also saves it to Exports like export_image.',
    inputSchema: {
      design_id: z.string(), page: pageRef.optional().describe('Default page 1.'),
      mockup_id: z.string(),
      color: z.string().optional().describe('Product colour, #rrggbb.'),
      fit: z.enum(['contain', 'cover']).optional().describe('contain = whole design visible (default on apparel, packaging, home); cover = fill the print area, cropping edges (default on screens, signs, prints).'),
      format: z.enum(['png', 'jpg']).optional().describe('Default png.'),
      size: z.number().int().min(200).max(4096).optional().describe('Longest side in px (default 1024; never more than the mockup itself, often 1600). Use a big size with save for a deliverable.'),
      save: z.boolean().optional(),
    },
    annotations: { readOnlyHint: false },
  }, safe(async ({ design_id, page, mockup_id, color, fit, format, size, save }) => {
    const file = await ctx.open(design_id);
    const { page: pg, index } = pageOf(file.doc, page);
    const fmt = format ?? 'png';
    const mime = fmt === 'jpg' ? 'image/jpeg' : 'image/png';
    const r = await renderPageMockup(file, pg, mockup_id, { color, ...(fit ? { fit } : {}), format: fmt === 'jpg' ? 'jpeg' : 'png', maxSide: size ?? 1024 });
    const info: Record<string, unknown> = { page: index + 1, mockup: r.mockup.id, label: r.mockup.label, imagePx: [r.width, r.height], ...(r.color ? { color: r.color } : {}), ...(r.mockup.credit ? { credit: r.mockup.credit } : {}) };
    if (save) {
      const res = await ctx.ws.saveExport(`${safeName(file.doc.title)} - ${safeName(r.mockup.label)}.${fmt}`, r.bytes, mime);
      info.saved = { name: res.name, size: res.size, ...(res.link ? { link: res.link } : {}), ...(res.path ? { path: res.path } : {}) };
    }
    const content: Result['content'] = [{ type: 'image', data: b64(r.bytes), mimeType: mime }, { type: 'text', text: JSON.stringify(info) }];
    return { content };
  }));
}
