/** Pages as HTML/CSS: read a page as HTML, write HTML to a page (laid out like a browser would). */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { findElement } from '@digital-canvas/scene';
import type { Context } from '../context.ts';
import { applyHtml } from '../html/apply.ts';
import { elementHtml, pageHtml } from '../html/sync.ts';
import { pageOutline } from '../outline.ts';
import { pageRef } from '../schemas.ts';
import { json, pageOf, safe } from './util.ts';

export const HTML_GUIDE = `## Pages as HTML (set_page_html / get_page_html)
Write a page the way you would write a web page and let the layout engine place everything: no x/y guessing. <body> is the page (its size is fixed to the page; its background becomes the page background). The page keeps the HTML, so get_page_html gives it back and changing a class (font-size, gap, columns) reflows the whole page.
- Layout: display block | flex | grid | none · flex-direction, flex-wrap, justify-content, align-items, align-self, flex, flex-grow/shrink/basis, gap · grid-template-columns (px, fr, repeat(N, …), minmax) + grid-column: span N (rows are automatic; no grid-template-areas) · width/height/min-/max- (px, %, em, rem, vw, vh, calc) · padding · margin (auto centres) · position relative/absolute + top/right/bottom/left · aspect-ratio · box-sizing · z-index · text-align centres inline-blocks. Margins do not collapse.
- Text: font-family (any Google Font; generic sans-serif = Inter), font-size, font-weight (≥600 = bold), font-style, color, text-align, line-height, letter-spacing, text-transform, text-decoration, white-space. Inline <b>, <i>, <span style> become styled runs; <br> breaks lines; <ul>/<ol> get bullets/numbers.
- Boxes: background-color, background: linear-gradient(…), background-image: url(…) (cover/contain), border (uniform → outline; single sides → lines, dashed/dotted ok), border-radius, opacity, transform: rotate(…).
- Pictures: <img src="asset:ID"> (from list_assets / import_*), "drive:FILE_ID", "https://…", "icon:mdi:phone" (Iconify; colour = CSS color, size = font-size or width), "qr:https://…", inline <svg> paths. object-fit cover (default) | contain, object-position. Images without a size use their natural size.
- Extras CSS can't say: data-spec='{"effect":{"type":"shadow"},"animation":{"type":"rise"}}' (any add_elements field), data-group (keep a box's elements as one group; top-level boxes are grouped by themselves), data-name.
- Not drawn: box-shadow, ::before/::after, overflow clipping, tables (use grid/flex). The reply lists overflow warnings (text that does not fit its box, boxes past the page edge): fix them and send again.
- Keys: every node gets data-k="k12". Keep them when you edit HTML you got from get_page_html so elements keep their ids, animations and photo edits. <dc-element data-id="…"> keeps an element HTML can't describe (charts, lines, videos…) at its place.`;

export function registerHtmlTools(server: McpServer, ctx: Context): void {
  server.registerTool('set_page_html', {
    title: 'Lay out a page from HTML/CSS',
    description: [
      'Write a whole page (or add to it) as HTML + CSS; a browser-like layout engine (flexbox, grid, blocks, absolute) places everything and measures text with the real fonts. Use this instead of many add_elements/update_elements calls: menus, posters, slides, price lists, anything with rows, columns or cards.',
      'mode "replace" (default): the page becomes exactly this HTML and keeps it as its layout source, so get_page_html returns it and edits reflow. Nodes keep their elements through data-k (ids, animations, effects survive). mode "append": add the HTML on top of what is there (no layout memory).',
      'Returns ids, counts and warnings (overflow, unsupported CSS). Then render_page to look. Read dcanvas://guide "Pages as HTML" for the CSS that works.',
    ].join('\n'),
    inputSchema: {
      design_id: z.string(),
      page: pageRef.optional().describe('Default: page 1.'),
      html: z.string().min(1).describe('A full page: <style>…</style><body>…</body> (a fragment is wrapped in <body>).'),
      mode: z.enum(['replace', 'append']).optional(),
      outline: z.boolean().optional().describe('Also return the page outline (element ids, texts, boxes). Default false.'),
    },
  }, safe(async ({ design_id, page, html, mode, outline }) => {
    let res: Awaited<ReturnType<typeof applyHtml>> | null = null;
    const out = await ctx.edit(design_id, async (file) => {
      const { page: pg } = pageOf(file.doc, page);
      res = await applyHtml(ctx, file, pg.id, html, { mode: mode ?? 'replace' });
      return { pageId: pg.id };
    });
    const r = res!;
    const body: Record<string, unknown> = { elements: r.count, top_level_ids: r.ids.slice(0, 60), ...(r.kept ? { kept: r.kept } : {}), ...(r.removed ? { removed: r.removed } : {}), ...(r.warnings.length ? { warnings: r.warnings } : { warnings: [] }) };
    if (outline) {
      const doc = (await ctx.open(design_id)).doc;
      const p = doc.pages.find((x) => x.id === out.pageId)!;
      body.outline = pageOutline(p, doc.pages.indexOf(p), doc, false);
    }
    if (out.missingFonts?.length) body.missingFonts = out.missingFonts;
    return json(body);
  }));

  server.registerTool('get_page_html', {
    title: 'Read a page as HTML/CSS',
    description: 'A page as HTML you can edit and send back with set_page_html. A page laid out from HTML returns its own source (with data-k keys), with changes made in the editor since then written in. Any other page comes back as absolutely placed nodes (data-id = element id), which set_page_html reads back unchanged: turn parts of it into flex/grid to make them reflow. element_id: just that element (and its group).',
    inputSchema: { design_id: z.string(), page: pageRef.optional(), element_id: z.string().optional() },
    annotations: { readOnlyHint: true },
  }, safe(async ({ design_id, page, element_id }) => {
    const doc = (await ctx.open(design_id)).doc;
    if (element_id) {
      const hit = findElement(doc, element_id);
      if (!hit) return json({ error: `no element "${element_id}"` });
      return { content: [{ type: 'text', text: elementHtml(hit.element) }] };
    }
    const { page: pg, index } = pageOf(doc, page);
    const r = pageHtml(doc, pg);
    const head = `<!-- page ${index + 1} of ${doc.pages.length} · ${doc.width}×${doc.height}px · ${r.mode === 'layout' ? 'layout source (edit and send back with set_page_html)' : 'absolute (no layout source yet)'}${r.changed.length ? ` · editor changes carried over: ${r.changed.slice(0, 12).join('; ')}` : ''} -->\n`;
    return { content: [{ type: 'text', text: head + r.html }] };
  }));
}
