/**
 * Comment threads (review): a manager pins comments on a page, an element or
 * a moment of a video; whoever edits reads them, makes the changes, replies
 * and resolves. Comments live outside the design file (Drive: the file's own
 * Drive comments), so commenting never overwrites anyone's edits.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  findElement, formatTime, isVideo, makeAnchor, pageAtTime, pageStart, pinPlace, sortComments,
  type CommentAuthor, type DesignComment, type Doc, type Element,
} from '@digital-canvas/scene';
import type { CommentStore } from '@digital-canvas/storage';
import { ToolError, round, type Context } from '../context.ts';
import { json, pageOf, safe } from './util.ts';

function storeOf(ctx: Context): CommentStore {
  const c = ctx.ws.store.comments;
  if (!c) throw new ToolError('comments are not available in this workspace');
  return c;
}

const t2 = (n: number) => Math.round(n * 100) / 100;
const who = (a: CommentAuthor) => (a.me ? `${a.name} (you)` : a.name);

function describe(e: Element): string {
  const t = e.type === 'text' ? `"${(e as { text: string }).text.replace(/\s+/g, ' ').slice(0, 40)}"` : '';
  return [e.name ?? e.type, t].filter(Boolean).join(' ');
}

/** Numbers are positions in reading order over every thread (open and resolved), so they stay put when filtering. */
export function numbered(doc: Doc, all: DesignComment[]): Map<string, number> {
  return new Map(sortComments(doc, all).map((c, i) => [c.id, i + 1]));
}

function view(doc: Doc, c: DesignComment, n: number) {
  const out: Record<string, unknown> = { n, id: c.id, text: c.text, author: who(c.author), created: c.createdAt, resolved: c.resolved };
  if (c.updatedAt !== c.createdAt) out.updated = c.updatedAt;
  const a = c.anchor;
  if (!a) out.on = 'whole design';
  else {
    const place = pinPlace(doc, a);
    const idx = doc.pages.findIndex((p) => p.id === place.page);
    out.page = idx >= 0 ? idx + 1 : 'deleted page';
    if (idx >= 0) out.page_id = place.page;
    if (a.el) {
      out.element_id = a.el;
      const hit = findElement(doc, a.el);
      if (hit) out.element = describe(hit.element);
      else out.element_gone = true;
    }
    out.point = [round(place.x), round(place.y)];
    if (a.t != null && idx >= 0) {
      const start = pageStart(doc, place.page!);
      out.time = t2(start + a.t);
      out.at = formatTime(start + a.t) + (a.t1 != null ? `–${formatTime(start + a.t1)}` : '');
      out.page_time = a.t;
      if (a.t1 != null) out.time_end = t2(start + a.t1);
    }
  }
  if (c.replies.length) out.replies = c.replies.map((r) => ({ id: r.id, author: who(r.author), ...(r.text ? { text: r.text } : {}), ...(r.action ? { action: r.action } : {}), created: r.createdAt }));
  return out;
}

export function registerCommentTools(server: McpServer, ctx: Context): void {
  server.registerTool('list_comments', {
    title: 'Read comments',
    description: 'The review comments on a design: each thread with its number, id, text, author, where it is pinned (page, element id + what it is, point in px, and for videos the time "m:ss.s" from the start) and its replies. Open threads only unless include_resolved. To see where the pins are, render_page with show_comments. Typical loop for an editor: list_comments → make each change → reply_comment with what you did → resolve_comment.',
    inputSchema: {
      design_id: z.string(),
      include_resolved: z.boolean().optional().describe('Also resolved threads (default false).'),
      page: z.union([z.number().int().min(1), z.string()]).optional().describe('Only this page (number or id).'),
    },
    annotations: { readOnlyHint: true },
  }, safe(async ({ design_id, include_resolved, page }) => {
    const file = await ctx.open(design_id);
    const doc = file.doc;
    const all = await storeOf(ctx).list(doc.id);
    const nums = numbered(doc, all);
    const pageId = page !== undefined ? pageOf(doc, page).page.id : undefined;
    const shown = sortComments(doc, all)
      .filter((c) => include_resolved || !c.resolved)
      .filter((c) => !pageId || (c.anchor && pinPlace(doc, c.anchor).page === pageId));
    return json({
      open: all.filter((c) => !c.resolved).length,
      resolved: all.filter((c) => c.resolved).length,
      comments: shown.map((c) => view(doc, c, nums.get(c.id)!)),
      editorUrl: ctx.editorLink(doc.id),
    });
  }));

  server.registerTool('add_comment', {
    title: 'Add a comment',
    description: 'Pin a review comment on a design: on a page (optionally at a point x/y in px), on an element (element_id; the pin follows it when it moves), and for videos at a moment (time = seconds from the start of the video, time_end for a range; the page is found from the time when not given). Without page, element or time it is about the whole design. Returns the comment id.',
    inputSchema: {
      design_id: z.string(),
      text: z.string().min(1).describe('What should change (plain text; new lines allowed).'),
      page: z.union([z.number().int().min(1), z.string()]).optional().describe('Page number or id.'),
      element_id: z.string().optional(),
      x: z.number().optional().describe('Point on the page in px (with y).'),
      y: z.number().optional(),
      time: z.number().min(0).optional().describe('Video: seconds from the start of the whole video.'),
      time_end: z.number().min(0).optional().describe('Video: end of the range, seconds from the start.'),
    },
  }, safe(async ({ design_id, text, page, element_id, x, y, time, time_end }) => {
    const file = await ctx.open(design_id);
    const doc = file.doc;
    const point = x !== undefined && y !== undefined ? { x, y } : undefined;
    let anchor;
    if (page !== undefined || element_id || point || time !== undefined) {
      let pageId: string;
      let local: number | undefined;
      let localEnd: number | undefined;
      if (element_id) {
        const hit = findElement(doc, element_id);
        if (!hit) throw new ToolError(`no element "${element_id}" in this design`, 'open_design lists element ids');
        pageId = hit.page.id;
      } else if (page !== undefined) pageId = pageOf(doc, page).page.id;
      else if (time !== undefined) pageId = pageAtTime(doc, time).page.id;
      else pageId = doc.pages[0]!.id;
      if (time !== undefined) {
        const start = pageStart(doc, pageId);
        local = time - start;
        const dur = doc.pages.find((p) => p.id === pageId)!.duration ?? 5;
        if (local < -0.01 || local > dur + 0.01) throw new ToolError(`time ${time}s is not on that page (it runs ${round(start)}–${round(start + dur)}s)`, 'leave out page/element to pick the page from the time');
        local = Math.max(0, local);
        if (time_end !== undefined) localEnd = time_end - start;
      }
      if (time === undefined && time_end !== undefined) throw new ToolError('time_end needs time');
      anchor = makeAnchor(doc, { page: pageId, element: element_id, point, time: local, timeEnd: localEnd });
    }
    const c = await storeOf(ctx).add(doc.id, text, anchor);
    const all = await storeOf(ctx).list(doc.id).catch(() => [c]);
    return json({ comment: view(doc, c, numbered(doc, all).get(c.id) ?? all.length), video: isVideo(doc) || undefined });
  }));

  server.registerTool('reply_comment', {
    title: 'Reply to a comment',
    description: 'Add a reply to a comment thread, e.g. what you changed or a question back.',
    inputSchema: { design_id: z.string(), comment_id: z.string(), text: z.string().min(1) },
  }, safe(async ({ design_id, comment_id, text }) => {
    const file = await ctx.open(design_id);
    const r = await storeOf(ctx).reply(file.doc.id, comment_id, text);
    return json({ reply_id: r.id, comment_id });
  }));

  server.registerTool('edit_comment', {
    title: 'Edit a comment',
    description: 'Change the text of your own comment (or of your reply, with reply_id). Only the author may edit.',
    inputSchema: { design_id: z.string(), comment_id: z.string(), text: z.string().min(1), reply_id: z.string().optional() },
    annotations: { idempotentHint: true },
  }, safe(async ({ design_id, comment_id, text, reply_id }) => {
    const file = await ctx.open(design_id);
    await storeOf(ctx).edit(file.doc.id, comment_id, text, reply_id);
    return json({ edited: reply_id ?? comment_id });
  }));

  server.registerTool('resolve_comment', {
    title: 'Resolve a comment',
    description: 'Mark a thread done (resolved, the default) or reopen it (resolved: false), optionally with a note (e.g. what you changed). Anyone who may comment can resolve.',
    inputSchema: { design_id: z.string(), comment_id: z.string(), resolved: z.boolean().optional(), text: z.string().optional().describe('A note added with it.') },
    annotations: { idempotentHint: true },
  }, safe(async ({ design_id, comment_id, resolved, text }) => {
    const file = await ctx.open(design_id);
    await storeOf(ctx).setResolved(file.doc.id, comment_id, resolved ?? true, text);
    return json({ comment_id, resolved: resolved ?? true });
  }));

  server.registerTool('delete_comment', {
    title: 'Delete a comment',
    description: 'Delete a whole comment thread, or one reply (reply_id). Only the author may delete (Drive rule).',
    inputSchema: { design_id: z.string(), comment_id: z.string(), reply_id: z.string().optional() },
    annotations: { destructiveHint: true },
  }, safe(async ({ design_id, comment_id, reply_id }) => {
    const file = await ctx.open(design_id);
    await storeOf(ctx).remove(file.doc.id, comment_id, reply_id);
    return json({ deleted: reply_id ?? comment_id });
  }));
}
