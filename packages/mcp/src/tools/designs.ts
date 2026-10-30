/** Design CRUD: list, open, create (from a size or a template), copy, rename, resize, delete, link. */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createDoc, isVideo, looseFill, newId, resizeDoc, searchPresets, setTitle, totalDuration, type Doc, type Page } from '@digital-canvas/scene';
import { ToolError, round, type Context } from '../context.ts';
import { POPULAR_PRESETS, findPreset, fitPages, loadTemplate, loadTemplateAssets } from '../library.ts';
import { designOutline } from '../outline.ts';
import { fill as fillSchema } from '../schemas.ts';
import { json, safe } from './util.ts';
import { PRESETS } from '@digital-canvas/scene';

export function sizeFrom(args: { preset?: string; width?: number; height?: number; unit?: 'px' | 'in' | 'mm' | 'cm' }): { width: number; height: number; unit: 'px' | 'in' | 'mm' | 'cm'; print?: boolean; video?: boolean; label: string } {
  if (args.preset) {
    const p = findPreset(args.preset);
    if (!p) throw new ToolError(`no size preset "${args.preset}"`, `try one of: ${POPULAR_PRESETS.join(', ')} — or list_size_presets, or give width and height`);
    return { width: p.width, height: p.height, unit: p.unit, print: p.print, video: p.video, label: `${p.name} (${p.id})` };
  }
  if (args.width && args.height) return { width: args.width, height: args.height, unit: args.unit ?? 'px', label: `${args.width}×${args.height} ${args.unit ?? 'px'}` };
  throw new ToolError('give a `preset` (e.g. "instagram-post", "instagram-reel", "a4", "poster-a3", "youtube-thumbnail") or `width` and `height`');
}

export function registerDesignTools(server: McpServer, ctx: Context): void {
  server.registerTool('list_designs', {
    title: 'List designs',
    description: 'Your Digital Canvas designs (newest first), optionally filtered by words in the title. Returns ids to use with every other tool.',
    inputSchema: { query: z.string().optional().describe('Words in the title.'), limit: z.number().int().min(1).max(200).optional().describe('Default 30.') },
    annotations: { readOnlyHint: true },
  }, safe(async ({ query, limit }) => {
    const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const all = (await ctx.ws.store.list()).filter((m) => words.every((w) => m.title.toLowerCase().includes(w)));
    return json({
      total: all.length,
      designs: all.slice(0, limit ?? 30).map((m) => ({ id: m.id, title: m.title, size: [Math.round(m.width), Math.round(m.height)], updated: m.updatedAt })),
      where: ctx.ws.label,
    });
  }));

  server.registerTool('open_design', {
    title: 'Open a design (outline)',
    description: 'The design as a compact outline: size, pages (background, duration, transition) and every element with its id, type, box [x, y, w, h] in px and key properties (text, font, colours, asset, timing, animation). Use the ids with update_elements etc. To SEE it, call render_page.',
    inputSchema: { design_id: z.string(), pages: z.array(z.number().int().min(1)).optional().describe('Only detail these page numbers (others are summarised).') },
    annotations: { readOnlyHint: true },
  }, safe(async ({ design_id, pages }) => {
    const file = await ctx.open(design_id);
    return json({ ...designOutline(file.doc, { pages }), editorUrl: ctx.editorLink(file.doc.id) });
  }));

  server.registerTool('list_size_presets', {
    title: 'Find a design size',
    description: 'Search the 270+ standard sizes (social posts, stories, reels, YouTube, presentations, A4/letter, posters, flyers, cards, ads…). Use the id as create_design `preset`.',
    inputSchema: { query: z.string().optional().describe('e.g. "instagram", "poster", "a4", "business card". Empty = the most used.') },
    annotations: { readOnlyHint: true },
  }, safe(async ({ query }) => {
    const list = query?.trim() ? searchPresets(query) : POPULAR_PRESETS.map((id) => PRESETS.find((p) => p.id === id)!).filter(Boolean);
    return json(list.slice(0, 40).map((p) => ({ id: p.id, name: p.name, size: `${p.width}×${p.height} ${p.unit}`, ...(p.video ? { video: true } : {}) })));
  }));

  server.registerTool('create_design', {
    title: 'Create a design',
    description: 'Start a new design from a size preset (instagram-post 1080×1080, instagram-portrait 1080×1350, instagram-story / instagram-reel / youtube-shorts / tiktok-video 1080×1920, youtube-thumbnail 1280×720, presentation 1920×1080, a4, letter, poster-a3, flyer-a4, business-card…) or custom width×height, optionally from a template (see list_templates). Video presets (reels, shorts) start with timed pages. Returns the id and outline.',
    inputSchema: {
      title: z.string().min(1).max(120),
      preset: z.string().optional().describe('Size preset id or name (see list_size_presets).'),
      width: z.number().positive().optional(), height: z.number().positive().optional(),
      unit: z.enum(['px', 'in', 'mm', 'cm']).optional().describe('Unit of width/height (default px).'),
      template: z.string().optional().describe('Template id (list_templates): its pages are scaled to the size (or the template\'s own size when no size is given).'),
      pages: z.number().int().min(1).max(50).optional().describe('Number of blank pages (default 1).'),
      background: fillSchema.optional().describe('Background of the blank pages.'),
      page_duration: z.number().positive().optional().describe('Seconds per page: makes it a video (default 5 for video presets).'),
    },
  }, safe(async (a) => {
    let size: ReturnType<typeof sizeFrom> | null = null;
    let tpl: Doc | null = null;
    if (a.template) {
      try { tpl = await loadTemplate(a.template); } catch { throw new ToolError(`no template "${a.template}"`, 'call list_templates for ids'); }
    }
    if (a.preset || (a.width && a.height)) size = sizeFrom(a);
    else if (!tpl) size = sizeFrom(a);
    let doc = createDoc({ title: a.title, width: size?.width ?? tpl!.width, height: size?.height ?? tpl!.height, unit: size?.unit ?? 'px', print: size?.print });
    const bg = a.background !== undefined ? looseFill(a.background) : null;
    let pages: Page[];
    let assets = {};
    if (tpl) {
      pages = fitPages(tpl, doc.width, doc.height).pages;
      assets = tpl.assets;
      if (tpl.fonts) doc = { ...doc, fonts: tpl.fonts };
    } else {
      pages = Array.from({ length: a.pages ?? 1 }, () => ({ id: newId('p_'), background: bg ?? { type: 'solid', color: '#ffffff' }, elements: [] }));
    }
    const dur = a.page_duration ?? (size?.video ? 5 : undefined);
    if (dur) pages = pages.map((p) => ({ ...p, duration: p.duration ?? dur }));
    doc = { ...doc, pages, assets };
    const file = { doc, assets: tpl ? await loadTemplateAssets(tpl) : new Map<string, Uint8Array>() };
    const { missingFonts } = await ctx.save(file);
    return json({
      id: file.doc.id, title: file.doc.title, size: `${round(file.doc.width)}×${round(file.doc.height)} px${size ? ` · ${size.label}` : ''}`,
      ...(isVideo(file.doc) ? { video: true, duration: totalDuration(file.doc) } : {}),
      ...(missingFonts.length ? { missingFonts } : {}),
      outline: designOutline(file.doc), editorUrl: ctx.editorLink(file.doc.id),
      next: tpl ? 'Replace the template texts (update_elements or apply_template replace_text), add your images, then render_page to look at it.' : 'Add elements (add_elements), then render_page to look at it.',
    });
  }));

  server.registerTool('duplicate_design', {
    title: 'Duplicate a design',
    description: 'A full copy (new id) — e.g. before trying a different direction.',
    inputSchema: { design_id: z.string(), title: z.string().optional() },
  }, safe(async ({ design_id, title }) => {
    const file = await ctx.open(design_id);
    const now = new Date().toISOString();
    file.doc = { ...file.doc, id: newId('d_'), title: title ?? `${file.doc.title} (copy)`, createdAt: now, updatedAt: now };
    await ctx.save(file);
    return json({ id: file.doc.id, title: file.doc.title, editorUrl: ctx.editorLink(file.doc.id) });
  }));

  server.registerTool('rename_design', {
    title: 'Rename a design',
    inputSchema: { design_id: z.string(), title: z.string().min(1).max(120) },
  }, safe(async ({ design_id, title }) => {
    await ctx.edit(design_id, (f) => { f.doc = setTitle(f.doc, title); });
    return json({ id: design_id, title });
  }));

  server.registerTool('resize_design', {
    title: 'Resize into a new design',
    description: 'Copy a design to another size (like Canva\'s Magic Resize): elements are scaled and re-centred, full-page backgrounds keep covering. Great for social packs (post → story → thumbnail). Check the result with render_page; tweak positions after.',
    inputSchema: {
      design_id: z.string(),
      preset: z.string().optional(), width: z.number().positive().optional(), height: z.number().positive().optional(), unit: z.enum(['px', 'in', 'mm', 'cm']).optional(),
      title: z.string().optional(),
    },
  }, safe(async (a) => {
    const size = sizeFrom(a);
    const file = await ctx.open(a.design_id);
    const src = file.doc;
    const base = resizeDoc(src, { width: size.width, height: size.height, unit: size.unit, print: size.print, title: a.title ?? `${src.title} (${size.label})` });
    // fitPages also scales line ends, table and chart text (resizeDoc scales boxes only)
    file.doc = { ...base, pages: fitPages(src, base.width, base.height).pages };
    await ctx.save(file);
    return json({ id: file.doc.id, title: file.doc.title, size: `${round(file.doc.width)}×${round(file.doc.height)}`, editorUrl: ctx.editorLink(file.doc.id), next: 'render_page / check_design the new size and fix what needs it.' });
  }));

  server.registerTool('delete_design', {
    title: 'Delete a design',
    description: 'Moves the design to the bin (Google Drive keeps it 30 days; a local folder keeps it in .trash/).',
    inputSchema: { design_id: z.string() },
    annotations: { destructiveHint: true },
  }, safe(async ({ design_id }) => {
    await ctx.open(design_id);
    await ctx.ws.store.remove(design_id);
    return json({ deleted: design_id, where: ctx.ws.kind === 'drive' ? 'Google Drive bin (restorable for 30 days)' : '.trash/ in the folder' });
  }));

  server.registerTool('open_in_editor', {
    title: 'Link to the editor',
    description: 'A link that opens the design in the Digital Canvas web editor (signed in with the same Google account), for the user to fine-tune by hand.',
    inputSchema: { design_id: z.string() },
    annotations: { readOnlyHint: true },
  }, safe(async ({ design_id }) => {
    const file = await ctx.open(design_id);
    return json({ url: ctx.editorLink(design_id), title: file.doc.title, ...(ctx.ws.kind === 'folder' ? { note: 'This design is a local .dcanvas file; in the editor use Open › a folder on this computer and pick the same folder.' } : {}) });
  }));
}
