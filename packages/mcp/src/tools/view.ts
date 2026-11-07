/** Seeing the result: render a page or all pages, and an automatic critique. */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { pageDuration, pinPlace } from '@digital-canvas/scene';
import { numbered } from './comments.ts';
import type { Context } from '../context.ts';
import { checkDesign } from '../check.ts';
import { renderGrid, renderPage } from '../render.ts';
import { pageRef } from '../schemas.ts';
import { b64, json, pageOf, safe, type Result } from './util.ts';

export function registerViewTools(server: McpServer, ctx: Context): void {
  server.registerTool('render_page', {
    title: 'Look at a page',
    description: 'Render a page to an image so you can SEE your work (do this after every few edits, and always before exporting). `show_ids` draws numbered outlines over the elements and returns number → element id, to point at things precisely. For videos, `at` shows the page that many seconds in (animations, captions, clip frame).',
    inputSchema: {
      design_id: z.string(), page: pageRef.optional().describe('Default page 1.'),
      size: z.number().int().min(128).max(2048).optional().describe('Longest side in px (default 1024).'),
      at: z.number().min(0).optional().describe('Seconds into the page (video/animation).'),
      show_ids: z.boolean().optional(),
      show_comments: z.boolean().optional().describe('Draw the open comment pins on this page, numbered as in list_comments (resolved ones too with include_resolved).'),
      include_resolved: z.boolean().optional(),
    },
    annotations: { readOnlyHint: true },
  }, safe(async ({ design_id, page, size, at, show_ids, show_comments, include_resolved }) => {
    const file = await ctx.open(design_id);
    const { page: pg, index } = pageOf(file.doc, page);
    if (at !== undefined && at > pageDuration(pg)) throw new Error(`at=${at}s is past the end of page ${index + 1} (${pageDuration(pg)}s)`);
    let pins: { n: number; x: number; y: number; resolved?: boolean }[] | undefined;
    let pinList: { n: number; id: string; text: string }[] | undefined;
    if (show_comments && ctx.ws.store.comments) {
      const all = await ctx.ws.store.comments.list(file.doc.id);
      const nums = numbered(file.doc, all);
      const here = all.filter((c) => (include_resolved || !c.resolved) && c.anchor && pinPlace(file.doc, c.anchor).page === pg.id);
      pins = here.map((c) => ({ n: nums.get(c.id)!, ...pinPlace(file.doc, c.anchor), resolved: c.resolved }));
      pinList = here.map((c) => ({ n: nums.get(c.id)!, id: c.id, text: c.text.slice(0, 120) }));
    }
    const r = await renderPage(file, pg, { maxSide: size ?? 1024, at, labels: show_ids, pins });
    const content: Result['content'] = [
      { type: 'image', data: b64(r.bytes), mimeType: 'image/png' },
      { type: 'text', text: JSON.stringify({ page: index + 1, of: file.doc.pages.length, pagePx: [Math.round(file.doc.width), Math.round(file.doc.height)], imagePx: [r.width, r.height], ...(show_ids ? { labels: r.legend } : {}), ...(pinList ? { comments: pinList } : {}), ...(at !== undefined ? { at } : {}) }) },
    ];
    return { content };
  }));

  server.registerTool('render_thumbnail_grid', {
    title: 'Look at all pages',
    description: 'All pages (or the listed ones) side by side in one image, numbered — to check a carousel, a deck or a reel\'s flow and consistency at a glance.',
    inputSchema: { design_id: z.string(), pages: z.array(z.number().int().min(1)).optional(), size: z.number().int().min(256).max(2400).optional().describe('Longest side (default 1600).') },
    annotations: { readOnlyHint: true },
  }, safe(async ({ design_id, pages, size }) => {
    const file = await ctx.open(design_id);
    const list = pages ? pages.map((n) => file.doc.pages[n - 1]).filter((p) => !!p) : file.doc.pages;
    if (!list.length) throw new Error('no such pages');
    const r = await renderGrid(file, list, { maxSide: size });
    return { content: [{ type: 'image', data: b64(r.bytes), mimeType: 'image/png' }, { type: 'text', text: JSON.stringify({ pages: list.length, imagePx: [r.width, r.height] }) }] };
  }));

  server.registerTool('check_design', {
    title: 'Critique a design',
    description: 'Automatic design review with measured facts: text overflowing its box or broken mid-word, text cut off by the page edge or outside it, low contrast against what is actually behind it (WCAG ratio), overlapping text, tiny fonts, placeholder text and empty frames, elements hidden behind others, missing files, tight margins, Reels safe zones, clips shorter than their page, sound cut off. Each issue names the element and the fix. Run it before exporting and fix errors/warnings.',
    inputSchema: { design_id: z.string(), pages: z.array(z.number().int().min(1)).optional() },
    annotations: { readOnlyHint: true },
  }, safe(async ({ design_id, pages }) => {
    const file = await ctx.open(design_id);
    return json(await checkDesign(file, { pages }));
  }));
}
