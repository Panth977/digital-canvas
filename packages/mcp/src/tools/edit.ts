/** Editing: elements (add, update, delete, order, align, group), pages, templates, brand. */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  aabb, addPage, arrange, distribute, duplicatePage, findElement, groupElements, looseFill, movePage, newId, removeElements, removePage,
  ungroupElements, updateElements, updatePage, walk, mapLists, fitGroup, type Doc, type Element, type Page, type Transition,
} from '@digital-canvas/scene';
import { ToolError, round, type Context } from '../context.ts';
import { buildElements, fitTexts, patchElement } from '../build.ts';
import { embedFonts } from '../fonts.ts';
import { applyBrand, fitPages, loadTemplate, mergeAssets, replaceTexts, searchTemplates, templateThumb } from '../library.ts';
import { elementOutline, pageOutline } from '../outline.ts';
import { animation, elementPatch, elementSpec, fill as fillSchema, pageRef } from '../schemas.ts';
import { json, pageOf, safe } from './util.ts';
import { isVideo } from '@digital-canvas/scene';

/** Swap an element (found by id, also inside groups) for a new version; its group refits. */
function replaceElement(doc: Doc, el: Element): Doc {
  return {
    ...doc,
    updatedAt: new Date().toISOString(),
    pages: doc.pages.map((p) => ({ ...p, elements: mapLists(p.elements, (list) => (list.some((e) => e.id === el.id) ? list.map((e) => (e.id === el.id ? el : e)) : list)) })),
  };
}

const brief = (doc: Doc, ids: string[]) => ids.map((id) => {
  const e = findElement(doc, id)?.element;
  return e ? elementOutline(e, doc, 3) : { id, gone: true };
});

export function registerEditTools(server: McpServer, ctx: Context): void {
  server.registerTool('add_elements', {
    title: 'Add elements',
    description: [
      'Add one or many elements to a page in one call (they stack in order: later = on top). Types:',
      '• text {text, fontFamily (any Google Font), fontSize, color, bold, align, lineHeight, letterSpacing, uppercase, effect, runs, autoFit} — height is measured; leave w out to hug the text.',
      '• shape {shape: rect|ellipse|triangle|diamond|pentagon|hexagon|star|arrow, fill (colour or {colors,angle} gradient), stroke, radius} — also semi-transparent overlays on photos ("#00000080").',
      '• line / arrow {x1,y1,x2,y2,color,strokeWidth,startMarker,endMarker}',
      '• image / video {asset | url | driveFileId, fit cover|contain, focus, mask, radius, filter, adjust, effect; video: trimStart, trimEnd, loop, muted, volume}',
      '• icon {icon: "mdi:instagram", color} (Iconify, vector) • qr {text} • chart {chart, labels, series} • table {rows} • path {d, viewBox, fill} • group {children}.',
      'Common: x, y, w, h (px, top-left origin; default centred), rotation, opacity, name, animation {type: rise|pan|fade|pop|wipe|typewriter|baseline|drift|tumble}, timing {start,end} (video).',
      'Returns the new ids and their measured boxes. Then render_page to look at the result.',
    ].join('\n'),
    inputSchema: {
      design_id: z.string(),
      page: pageRef.optional().describe('Default: page 1.'),
      elements: z.array(elementSpec).min(1).max(100),
      position: z.enum(['top', 'bottom']).optional().describe('"bottom" puts them behind everything (e.g. a background photo). Default top.'),
    },
  }, safe(async ({ design_id, page, elements, position }) => {
    const warnings: string[] = [];
    const out = await ctx.edit(design_id, async (file) => {
      const { page: pg } = pageOf(file.doc, page);
      const built = await buildElements(ctx, file, elements, warnings);
      const doc = file.doc;
      file.doc = { ...doc, pages: doc.pages.map((p) => (p.id === pg.id ? { ...p, elements: position === 'bottom' ? [...built.elements, ...p.elements] : [...p.elements, ...built.elements] } : p)) };
      // the page lasts as long as its longest clip (like the editor)
      const clips = built.elements.flatMap((e) => [...walk([e])]).filter((e) => e.type === 'video');
      if (clips.length) {
        const need = Math.max(...clips.map((c) => (c.type === 'video' ? Math.min(c.trimEnd ?? file.doc.assets[c.asset]?.duration ?? 5, file.doc.assets[c.asset]?.duration ?? Infinity) - (c.trimStart ?? 0) : 0)));
        const cur = file.doc.pages.find((p) => p.id === pg.id)!;
        if (cur.duration === undefined || (cur.duration < need && need < 600)) file.doc = updatePage(file.doc, pg.id, { duration: round(Math.max(need, 0.5), 2) });
      }
      const { missing } = await embedFonts(file);
      if (missing.length) warnings.push(`font(s) not found on Google Fonts, drawn with Inter: ${missing.join(', ')} (search_fonts lists real names)`);
      await fitTexts(file, built.fit);
      return { ids: built.elements.map((e) => e.id) };
    });
    return json({ added: brief((await ctx.open(design_id)).doc, out.ids), ...(warnings.length ? { warnings } : {}) });
  }));

  server.registerTool('update_elements', {
    title: 'Update elements',
    description: 'Change many elements in one call: each update has the element `id` plus only the fields to change (same fields as add_elements: x, y, w, h, text, fontSize, color, fill, asset/url to swap a picture, focus, animation, timing… null removes animation/timing/effect). Text boxes re-measure their height unless you give h. Moving a group moves its children.',
    inputSchema: { design_id: z.string(), updates: z.array(elementPatch).min(1).max(200) },
  }, safe(async ({ design_id, updates }) => {
    const warnings: string[] = [];
    const fit = new Map<string, { autoW: boolean; autoH: boolean; shrink: boolean; centreX: boolean }>();
    const ids: string[] = [];
    await ctx.edit(design_id, async (file) => {
      for (const u of updates) {
        const hit = findElement(file.doc, u.id);
        if (!hit) throw new ToolError(`no element "${u.id}" in this design`, 'use ids from open_design or add_elements');
        const { el, refit } = await patchElement(ctx, file, hit.element, u, warnings);
        if (el.type === 'group') {
          // through updateElements so the children follow the group's new box
          const { id: _id, type: _t, children: _c, ...patch } = el as Element & Record<string, unknown>;
          file.doc = updateElements(file.doc, [u.id], patch as never);
        } else {
          // replace the element (so removed fields really go), then let containers refit
          file.doc = replaceElement(file.doc, el);
        }
        if (el.type === 'text' && (refit || u.autoFit === 'shrink')) fit.set(u.id, { autoW: false, autoH: u.h === undefined, shrink: u.autoFit === 'shrink', centreX: false });
        ids.push(u.id);
      }
      const { missing } = await embedFonts(file);
      if (missing.length) warnings.push(`font(s) not found on Google Fonts, drawn with Inter: ${missing.join(', ')}`);
      await fitTexts(file, fit);
    });
    return json({ updated: brief((await ctx.open(design_id)).doc, ids), ...(warnings.length ? { warnings } : {}) });
  }));

  server.registerTool('delete_elements', {
    title: 'Delete elements',
    inputSchema: { design_id: z.string(), ids: z.array(z.string()).min(1) },
    annotations: { destructiveHint: true },
  }, safe(async ({ design_id, ids }) => {
    await ctx.edit(design_id, (file) => {
      const missing = ids.filter((id) => !findElement(file.doc, id));
      if (missing.length === ids.length) throw new ToolError(`none of these ids are in the design: ${missing.join(', ')}`);
      file.doc = removeElements(file.doc, ids);
    });
    return json({ deleted: ids });
  }));

  server.registerTool('arrange_elements', {
    title: 'Change stacking order',
    description: 'Bring elements forward/backward, to the front (top) or the back (behind everything) within their page or group.',
    inputSchema: { design_id: z.string(), ids: z.array(z.string()).min(1), how: z.enum(['forward', 'backward', 'front', 'back']) },
  }, safe(async ({ design_id, ids, how }) => {
    const r = await ctx.edit(design_id, (file) => {
      file.doc = arrange(file.doc, ids, how);
      const pg = file.doc.pages.find((p) => p.elements.some((e) => ids.includes(e.id)));
      return { order: pg?.elements.map((e) => e.id) };
    });
    return json({ order_bottom_to_top: r.order });
  }));

  server.registerTool('align_elements', {
    title: 'Align or distribute',
    description: 'Align elements to the page (default) or to each other (left, center, right, top, middle, bottom), and/or distribute 3+ elements with equal spacing horizontally or vertically.',
    inputSchema: {
      design_id: z.string(), ids: z.array(z.string()).min(1),
      align: z.enum(['left', 'center', 'right', 'top', 'middle', 'bottom']).optional(),
      to: z.enum(['page', 'selection']).optional().describe('Align to the page (default) or the elements\' combined box.'),
      distribute: z.enum(['horizontal', 'vertical']).optional(),
    },
  }, safe(async ({ design_id, ids, align, to, distribute: dist }) => {
    if (!align && !dist) throw new ToolError('give `align` and/or `distribute`');
    await ctx.edit(design_id, (file) => {
      let doc = file.doc;
      const els = ids.map((id) => findElement(doc, id)?.element).filter((e): e is Element => !!e);
      if (!els.length) throw new ToolError('none of these ids are in the design');
      if (align) {
        const boxes = els.map((e) => ({ e, b: aabb(e) }));
        const frame = to === 'selection' && els.length > 1
          ? (() => { const x = Math.min(...boxes.map((b) => b.b.x)), y = Math.min(...boxes.map((b) => b.b.y)); return { x, y, w: Math.max(...boxes.map((b) => b.b.x + b.b.w)) - x, h: Math.max(...boxes.map((b) => b.b.y + b.b.h)) - y }; })()
          : { x: 0, y: 0, w: doc.width, h: doc.height };
        for (const { e, b } of boxes) {
          let dx = 0, dy = 0;
          if (align === 'left') dx = frame.x - b.x;
          if (align === 'center') dx = frame.x + (frame.w - b.w) / 2 - b.x;
          if (align === 'right') dx = frame.x + frame.w - b.w - b.x;
          if (align === 'top') dy = frame.y - b.y;
          if (align === 'middle') dy = frame.y + (frame.h - b.h) / 2 - b.y;
          if (align === 'bottom') dy = frame.y + frame.h - b.h - b.y;
          doc = updateElements(doc, [e.id], { x: e.x + dx, y: e.y + dy });
        }
      }
      if (dist) {
        if (ids.length < 3) throw new ToolError('distribute needs 3 or more elements');
        doc = distribute(doc, ids, dist === 'horizontal' ? 'x' : 'y');
      }
      file.doc = doc;
    });
    return json({ aligned: brief((await ctx.open(design_id)).doc, ids) });
  }));

  server.registerTool('group_elements', {
    title: 'Group or ungroup',
    description: 'Group elements (they then move, scale and animate together) or ungroup a group.',
    inputSchema: { design_id: z.string(), ids: z.array(z.string()).min(1), ungroup: z.boolean().optional() },
  }, safe(async ({ design_id, ids, ungroup }) => {
    const r = await ctx.edit(design_id, (file) => {
      if (ungroup) { const u = ungroupElements(file.doc, ids); file.doc = u.doc; return { ids: u.ids }; }
      const g = groupElements(file.doc, ids);
      if (!g) throw new ToolError('could not group: the elements must be 2+ on the same page and list');
      file.doc = g.doc;
      return { ids: [g.id] };
    });
    return json(ungroup ? { children: r.ids } : { group: r.ids[0] });
  }));

  // ---- pages

  server.registerTool('add_page', {
    title: 'Add a page',
    description: 'Add a blank page (or a copy of a page with `copy_of`) after a page (default: at the end).',
    inputSchema: {
      design_id: z.string(), after: pageRef.optional(), copy_of: pageRef.optional(),
      background: fillSchema.optional(), duration: z.number().positive().optional().describe('Seconds (video).'),
    },
  }, safe(async ({ design_id, after, copy_of, background, duration }) => {
    const r = await ctx.edit(design_id, (file) => {
      let res: { doc: Doc; pageId: string };
      if (copy_of !== undefined) {
        res = duplicatePage(file.doc, pageOf(file.doc, copy_of).page.id);
        if (after !== undefined) {
          const at = pageOf(res.doc, after).index;
          res = { ...res, doc: movePage(res.doc, res.pageId, at + 1 > res.doc.pages.findIndex((p) => p.id === res.pageId) ? at : at + 1) };
        }
      } else {
        const ref = after !== undefined ? pageOf(file.doc, after).page.id : file.doc.pages[file.doc.pages.length - 1]!.id;
        res = addPage(file.doc, ref);
      }
      const patch: Partial<Page> = {};
      if (background !== undefined) patch.background = looseFill(background) ?? { type: 'solid', color: '#ffffff' };
      if (duration) patch.duration = duration;
      else if (isVideo(file.doc) && copy_of === undefined) patch.duration = 5;
      file.doc = updatePage(res.doc, res.pageId, patch);
      return { pageId: res.pageId, number: file.doc.pages.findIndex((p) => p.id === res.pageId) + 1 };
    });
    return json({ page: r.number, id: r.pageId });
  }));

  server.registerTool('duplicate_page', {
    title: 'Duplicate a page',
    description: 'Copy a page (with fresh element ids) right after it.',
    inputSchema: { design_id: z.string(), page: pageRef },
  }, safe(async ({ design_id, page }) => {
    const r = await ctx.edit(design_id, (file) => {
      const res = duplicatePage(file.doc, pageOf(file.doc, page).page.id);
      file.doc = res.doc;
      return { id: res.pageId, number: res.doc.pages.findIndex((p) => p.id === res.pageId) + 1 };
    });
    const doc = (await ctx.open(design_id)).doc;
    return json({ page: r.number, id: r.id, outline: pageOutline(doc.pages[r.number - 1]!, r.number - 1, doc, isVideo(doc)) });
  }));

  server.registerTool('delete_page', {
    title: 'Delete a page',
    inputSchema: { design_id: z.string(), page: pageRef },
    annotations: { destructiveHint: true },
  }, safe(async ({ design_id, page }) => {
    await ctx.edit(design_id, (file) => {
      if (file.doc.pages.length === 1) throw new ToolError('a design keeps at least one page', 'delete its elements instead, or delete_design');
      file.doc = removePage(file.doc, pageOf(file.doc, page).page.id);
    });
    return json({ deleted: page });
  }));

  server.registerTool('move_page', {
    title: 'Move a page',
    inputSchema: { design_id: z.string(), page: pageRef, to: z.number().int().min(1).describe('New page number.') },
  }, safe(async ({ design_id, page, to }) => {
    const order = await ctx.edit(design_id, (file) => {
      file.doc = movePage(file.doc, pageOf(file.doc, page).page.id, Math.min(file.doc.pages.length, to) - 1);
      return { order: file.doc.pages.map((p) => p.id) };
    });
    return json({ pages: order.order });
  }));

  server.registerTool('set_page', {
    title: 'Page settings',
    description: 'Set a page\'s background (colour/gradient, or a photo/video that covers the page with an optional tint overlay for legible text), its duration in seconds (video), its transition from the previous page (dissolve, fade through black, slide, wipe, zoom), a whole-page animation, name or notes.',
    inputSchema: {
      design_id: z.string(), page: pageRef.optional().describe('Default page 1. Use "all" for every page.').or(z.literal('all')),
      background: fillSchema.optional(),
      background_media: z.object({
        asset: z.string().optional(), url: z.string().optional(), driveFileId: z.string().optional(),
        overlay: z.string().optional().describe('A colour with alpha laid over it, e.g. "#00000066" to darken for white text.'),
        focus: z.object({ x: z.number(), y: z.number() }).optional(),
        trimStart: z.number().optional(), trimEnd: z.number().optional(), loop: z.boolean().optional(), muted: z.boolean().optional(),
      }).optional().describe('A photo or video filling the page, behind everything.'),
      duration: z.number().positive().optional().describe('Seconds this page shows (video).'),
      transition: z.object({ type: z.enum(['dissolve', 'fade', 'slide', 'wipe', 'zoom']), duration: z.number().positive().optional(), direction: z.enum(['left', 'right', 'up', 'down']).optional() }).nullable().optional().describe('How this page comes in after the previous one (video). null removes it.'),
      animation: animation.nullable().optional().describe('Animate every element of the page in, staggered (elements with their own animation keep it).'),
      name: z.string().optional(), notes: z.string().optional(),
    },
  }, safe(async (a) => {
    const warnings: string[] = [];
    await ctx.edit(a.design_id, async (file) => {
      const targets = a.page === 'all' ? file.doc.pages.map((p) => p.id) : [pageOf(file.doc, a.page as string | number | undefined).page.id];
      for (const id of targets) {
        const patch: Partial<Page> & { transition?: Transition } = {};
        if (a.background !== undefined) { const f = looseFill(a.background); if (!f) throw new ToolError('background must be a colour or { colors, angle }'); patch.background = f; }
        if (a.duration) patch.duration = a.duration;
        if (a.name !== undefined) patch.name = a.name;
        if (a.notes !== undefined) patch.notes = a.notes;
        if (a.animation) patch.animation = { type: a.animation.type, ...(a.animation.duration ? { duration: a.animation.duration } : {}), ...(a.animation.direction ? { direction: a.animation.direction } : {}) };
        if (a.transition) patch.transition = a.transition;
        file.doc = updatePage(file.doc, id, patch);
        if (a.transition === null || a.animation === null) {
          file.doc = { ...file.doc, pages: file.doc.pages.map((p) => {
            if (p.id !== id) return p;
            const q = { ...p };
            if (a.transition === null) delete q.transition;
            if (a.animation === null) delete q.animation;
            return q;
          }) };
        }
        if (a.background_media) {
          const m = a.background_media;
          const { id: asset, info } = await ctx.attach(file, m);
          if (info.kind === 'audio') throw new ToolError('that file is a sound', 'use set_audio for music');
          const els: Element[] = [];
          const built = await buildElements(ctx, file, [{ type: info.kind, asset, x: 0, y: 0, w: file.doc.width, h: file.doc.height, name: 'Background', ...(m.focus ? { focus: m.focus } : {}), ...(info.kind === 'video' ? { trimStart: m.trimStart, trimEnd: m.trimEnd, loop: m.loop, muted: m.muted } : {}) } as never], warnings);
          els.push(...built.elements);
          if (m.overlay) els.push({ id: newId('e_'), type: 'shape', shape: 'rect', name: 'Background tint', x: 0, y: 0, w: file.doc.width, h: file.doc.height, rotation: 0, opacity: 1, fill: looseFill(m.overlay), stroke: null, radius: 0 });
          file.doc = { ...file.doc, pages: file.doc.pages.map((p) => (p.id === id ? { ...p, elements: [...els, ...p.elements.filter((e) => e.name !== 'Background' && e.name !== 'Background tint')] } : p)) };
          if (info.kind === 'video' && info.duration && !a.duration) {
            const p = file.doc.pages.find((x) => x.id === id)!;
            const len = Math.min(m.trimEnd ?? info.duration, info.duration) - (m.trimStart ?? 0);
            if (p.duration === undefined) file.doc = updatePage(file.doc, id, { duration: round(len, 2) });
          }
        }
      }
    });
    const doc = (await ctx.open(a.design_id)).doc;
    const n = a.page === 'all' ? null : pageOf(doc, a.page as string | number | undefined).index;
    return json({ ...(n === null ? { pages: doc.pages.length } : { page: pageOutline(doc.pages[n]!, n, doc, isVideo(doc)) }), ...(warnings.length ? { warnings } : {}) });
  }));

  // ---- templates

  server.registerTool('list_templates', {
    title: 'Find templates',
    description: 'Search the built-in template library (Instagram posts & stories, YouTube thumbnails, flyers, posters, invitations, menus, resumes, presentations, logos, video intros…). Each result has an id, size and a preview image URL. Pass `design_id` to rank templates that fit its size first.',
    inputSchema: { query: z.string().optional(), category: z.string().optional(), design_id: z.string().optional() },
    annotations: { readOnlyHint: true },
  }, safe(async ({ query, category, design_id }) => {
    const size = design_id ? (await ctx.open(design_id)).doc : undefined;
    const list = searchTemplates(query, category, size);
    return json({
      total: list.length,
      templates: list.slice(0, 30).map((t) => ({ id: t.id, title: t.title, category: t.category, size: `${t.width}×${t.height}`, pages: t.pages, fonts: t.fonts, ...(t.video ? { video: true } : {}), preview: templateThumb(t.id, ctx.editorUrl) })),
      tip: 'Read resource dcanvas://template/<id> for a template\'s element ids and texts (to fill replace_text).',
    });
  }));

  server.registerTool('apply_template', {
    title: 'Apply a template',
    description: 'Put a template\'s pages into a design: "replace" swaps the target page for the template\'s first page, "add" inserts all its pages after the target page. Pages are scaled to the design\'s size. `replace_text` fills the template\'s texts (match = template element id, element name, or part of the current text). Afterwards: swap/add photos with update_elements / set_page background_media, then render_page.',
    inputSchema: {
      design_id: z.string(), template_id: z.string(),
      mode: z.enum(['replace', 'add']).optional().describe('Default "replace" when the target page is empty, else "add".'),
      page: pageRef.optional(),
      replace_text: z.array(z.object({ match: z.string(), text: z.string() })).optional(),
    },
  }, safe(async ({ design_id, template_id, mode, page, replace_text }) => {
    const warnings: string[] = [];
    let tpl: Doc;
    try { tpl = loadTemplate(template_id); } catch { throw new ToolError(`no template "${template_id}"`, 'call list_templates for ids'); }
    const r = await ctx.edit(design_id, async (file) => {
      const { page: target, index } = pageOf(file.doc, page);
      const how = mode ?? (target.elements.length ? 'add' : 'replace');
      const fitted = fitPages(tpl, file.doc.width, file.doc.height);
      let pages = fitted.pages;
      if (replace_text?.length) pages = replaceTexts(pages, fitted.ids, replace_text, warnings);
      mergeAssets(file, tpl);
      const list = [...file.doc.pages];
      if (how === 'replace') list.splice(index, 1, { ...pages[0]!, id: target.id, ...(target.duration ? { duration: target.duration } : {}), ...(target.notes ? { notes: target.notes } : {}) }, ...pages.slice(1));
      else list.splice(index + 1, 0, ...pages);
      file.doc = { ...file.doc, pages: list };
      const changed = new Set(pages.flatMap((p) => [...walk(p.elements)]).filter((e) => e.type === 'text').map((e) => e.id));
      await embedFonts(file);
      await fitTexts(file, new Map([...changed].map((id) => [id, { autoW: false, autoH: true, shrink: false, centreX: false }])));
      return { first: how === 'replace' ? index : index + 1, count: pages.length, ids: Object.fromEntries(fitted.ids) };
    });
    const doc = (await ctx.open(design_id)).doc;
    const video = isVideo(doc);
    return json({
      pages: doc.pages.slice(r.first, r.first + r.count).map((p, i) => pageOutline(p, r.first + i, doc, video)),
      template_ids_to_new_ids: r.ids,
      ...(warnings.length ? { warnings } : {}),
    });
  }));

  // ---- brand

  server.registerTool('get_brand_kit', {
    title: 'Brand kit',
    description: 'The user\'s brand kit (from the app\'s Brand panel): palettes, fonts for heading/subheading/body, and logos (asset ids usable as images).',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, safe(async () => {
    const b = await ctx.ws.store.loadBrand?.();
    if (!b) return json({ empty: true, note: 'No brand kit yet. The user can make one in the editor (Brand panel); meanwhile pick a palette and fonts that suit the brief.' });
    const k = b.kit;
    return json({ name: k.name, palettes: k.palettes.map((p) => ({ name: p.name, colors: p.colors })), fonts: k.fonts, logos: k.logos.map((l) => ({ asset: l.asset, name: l.name, size: l.width ? [l.width, l.height] : undefined, mime: l.mime })) });
  }));

  server.registerTool('apply_brand', {
    title: 'Apply the brand kit',
    description: 'Restyle a design with the brand kit: brand colours replace the design\'s accent colours (most used first; whites/blacks/greys stay), brand fonts replace fonts by role (largest text = heading), and optionally place the first logo in a corner. Run check_design after (contrast).',
    inputSchema: {
      design_id: z.string(),
      colors: z.boolean().optional().describe('Default true.'), fonts: z.boolean().optional().describe('Default true.'),
      logo: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'none']).optional().describe('Default none.'),
      pages: z.array(pageRef).optional().describe('Only these pages (default all).'),
    },
  }, safe(async ({ design_id, colors, fonts, logo, pages }) => {
    const brand = await ctx.ws.store.loadBrand?.();
    if (!brand) throw new ToolError('there is no brand kit yet', 'ask the user to set one up in the editor (Brand panel), or style the design directly');
    const r = await ctx.edit(design_id, async (file) => {
      const ids = pages?.map((p) => pageOf(file.doc, p).page.id);
      const res = await applyBrand(file, brand, { colors, fonts, logo, ...(ids ? { pages: ids } : {}) });
      const texts = new Set(Object.keys(res.fonts));
      await embedFonts(file);
      await fitTexts(file, new Map([...texts].map((id) => [id, { autoW: false, autoH: true, shrink: false, centreX: false }])));
      return res;
    });
    return json({ recolored: r.recolored, fonts_changed: Object.keys(r.fonts).length, ...(r.logo ? { logo: r.logo } : {}), next: 'render_page + check_design (brand colours can lower text contrast).' });
  }));
}
