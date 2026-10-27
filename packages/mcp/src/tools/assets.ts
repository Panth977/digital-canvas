/** Assets & content: uploads, Google Drive, stock search/import, fonts. */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ToolError, round, type Context } from '../context.ts';
import { SUGGESTED, searchFonts } from '../fonts.ts';
import { STOCK_KINDS, searchStock, stockUrl, type Kind } from '../stock.ts';
import { json, safe } from './util.ts';

const kindOf = (mime: string) => mime.split('/')[0];

export function registerAssetTools(server: McpServer, ctx: Context): void {
  server.registerTool('list_assets', {
    title: 'List uploads',
    description: 'Files in the user\'s uploads library (Google Drive "Digital Canvas/assets", shared by all designs): photos, videos, sounds, with ids to use as `asset` in add_elements / set_page / set_audio. Newest first.',
    inputSchema: {
      kind: z.enum(['image', 'video', 'audio']).optional(),
      query: z.string().optional().describe('Words in the file name.'),
      limit: z.number().int().min(1).max(500).optional().describe('Default 50.'),
    },
    annotations: { readOnlyHint: true },
  }, safe(async ({ kind, query, limit }) => {
    const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const list = (await ctx.ws.listAssets()).filter((a) => (!kind || kindOf(a.mime) === kind) && ['image', 'video', 'audio'].includes(kindOf(a.mime)!) && words.every((w) => (a.name ?? '').toLowerCase().includes(w)));
    return json({
      total: list.length,
      assets: list.slice(0, limit ?? 50).map((a) => ({ id: a.id, kind: kindOf(a.mime), name: a.name, ...(a.width ? { size: [a.width, a.height] } : {}), ...(a.duration ? { duration: round(a.duration) } : {}), ...(a.thumbnailUrl ? { thumb: a.thumbnailUrl } : {}) })),
      ...(list.length === 0 ? { tip: 'Nothing here yet: search_drive for the user\'s own photos/videos, or search_stock for free ones, then import them.' } : {}),
    });
  }));

  server.registerTool('search_drive', {
    title: 'Search Google Drive',
    description: 'Find the user\'s own photos, videos and audio in Google Drive by name, or list a folder. With whole-Drive access (granted in the app: Uploads › Google Drive) this covers all of Drive; otherwise only files this app created or was given. Import a hit with import_from_drive (or pass driveFileId straight to add_elements).',
    inputSchema: {
      query: z.string().optional().describe('Words in the file name. Empty = recent files.'),
      kind: z.enum(['image', 'video', 'audio', 'all']).optional(),
      folder_id: z.string().optional().describe('List this folder (ids of folders appear in results).'),
      page_token: z.string().optional(),
    },
    annotations: { readOnlyHint: true },
  }, safe(async ({ query, kind, folder_id, page_token }) => {
    if (!ctx.ws.searchDrive) throw new ToolError('this server works on a local folder, not Google Drive', 'use list_assets, import_from_url or search_stock');
    const r = await ctx.ws.searchDrive({ query, kind: kind ?? 'all', folderId: folder_id, pageToken: page_token });
    return json({
      wholeDrive: r.wholeDrive,
      items: r.items.slice(0, 60).map((i) => ({ fileId: i.fileId, name: i.name, kind: i.kind, ...(i.width ? { size: [i.width, i.height] } : {}), ...(i.duration ? { duration: round(i.duration) } : {}), ...(i.thumbnailUrl ? { thumb: i.thumbnailUrl } : {}), ...(i.modifiedTime ? { modified: i.modifiedTime.slice(0, 10) } : {}) })),
      ...(r.nextPageToken ? { next_page_token: r.nextPageToken } : {}),
      ...(!r.wholeDrive ? { note: 'Only files this app can see. For the whole Drive, the user connects it once in the app (Uploads › Google Drive).' } : {}),
    });
  }));

  server.registerTool('import_from_drive', {
    title: 'Import from Drive',
    description: 'Copy a Google Drive file (photo, video or audio) into the uploads library; returns its asset id, size and duration.',
    inputSchema: { file_id: z.string(), name: z.string().optional() },
  }, safe(async ({ file_id, name }) => {
    const a = await ctx.importMedia({ driveFileId: file_id, name });
    return json(a);
  }));

  server.registerTool('import_from_url', {
    title: 'Import from a URL',
    description: 'Download a photo, video or audio file from a public URL into the uploads library; returns its asset id. Pass the credit line as `name` for licensed content.',
    inputSchema: { url: z.string().url(), name: z.string().optional() },
  }, safe(async ({ url, name }) => json(await ctx.importMedia({ url, name }))));

  server.registerTool('search_stock', {
    title: 'Search free stock',
    description: 'Free, commercially usable content: kind "photo" (Openverse + Wikimedia Commons; NASA with source "nasa"), "video" (Wikimedia Commons + NASA), "audio" (Openverse music/sound effects + Commons), "illustration" (Openverse), and Iconify vectors: "icon" (Phosphor, Tabler, Material…), "graphic" (colour icons, flags, weather), "sticker" (emoji). Icons/graphics/stickers: use the `icon` name directly in add_elements {type:"icon"}. Photos/videos/audio: import_stock the result to get an asset id. Keep the credit (it is stored as the asset name).',
    inputSchema: {
      kind: z.enum(STOCK_KINDS as [Kind, ...Kind[]]),
      query: z.string().describe('What to look for, in English (e.g. "coffee beans", "city night", "upbeat").'),
      source: z.enum(['openverse', 'commons', 'nasa', 'iconify']).optional(),
      audio_category: z.enum(['music', 'sound_effect']).optional(),
      limit: z.number().int().min(1).max(40).optional().describe('Default 12.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safe(async ({ kind, query, source, audio_category, limit }) => {
    const r = await searchStock(kind, query, { source, limit, audio: audio_category });
    return json({ results: r.items, ...(r.failed.length ? { unavailable: r.failed } : {}), ...(!r.items.length ? { tip: 'No results: try simpler English words or another kind/source.' } : {}) });
  }));

  server.registerTool('import_stock', {
    title: 'Import a stock result',
    description: 'Download a search_stock result (photo, video, audio, illustration) into the uploads library with its credit; returns the asset id. Pass the result object as returned (at least kind + url, or kind + manifest for NASA).',
    inputSchema: {
      result: z.object({ kind: z.enum(STOCK_KINDS as [Kind, ...Kind[]]), url: z.string().optional(), manifest: z.string().optional(), fallback: z.string().optional(), title: z.string().optional(), credit: z.string().optional() }).passthrough(),
    },
    annotations: { openWorldHint: true },
  }, safe(async ({ result }) => {
    if (['icon', 'graphic', 'sticker'].includes(result.kind)) throw new ToolError('icons, graphics and stickers need no import', 'add them with add_elements { type: "icon", icon: "<prefix:name>" }');
    const url = await stockUrl(result);
    const name = result.credit ?? result.title;
    try {
      return json(await ctx.importMedia({ url, name }));
    } catch (e) {
      if (!result.fallback) throw e;
      return json({ ...(await ctx.importMedia({ url: result.fallback, name })), note: 'the full-size file failed; imported the smaller preview' });
    }
  }));

  server.registerTool('search_fonts', {
    title: 'Find fonts',
    description: 'Search the ~2,000 Google Fonts (via Fontsource) by name and/or category. Any family returned can be used as `fontFamily`; it is embedded in the design automatically. Empty query = popular picks.',
    inputSchema: {
      query: z.string().optional(),
      category: z.enum(['sans-serif', 'serif', 'display', 'handwriting', 'monospace']).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safe(async ({ query, category }) => {
    try {
      const list = await searchFonts(query ?? '', category, 30);
      return json({ fonts: list.map((f) => ({ family: f.family, category: f.category, weights: f.weights })), ...(!query ? { pairings: ['Anton + Montserrat (bold promo)', 'Playfair Display + Lato (elegant)', 'Bebas Neue + Poppins (modern)', 'DM Serif Display + DM Sans (editorial)', 'Pacifico + Montserrat (playful)'] } : {}) });
    } catch {
      return json({ fonts: Object.entries(SUGGESTED).flatMap(([c, fams]) => fams.map((family) => ({ family, category: c }))), note: 'font catalogue offline; these popular families are known to work' });
    }
  }));
}
