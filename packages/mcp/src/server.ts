/**
 * The Digital Canvas MCP server: tools, resources and prompts over one
 * workspace (the user's Google Drive, or a local folder).
 */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Context, type ServerOptions } from './context.ts';
import { GUIDE, WORKFLOW } from './guide.ts';
import { loadTemplate, templateThumb, templates } from './library.ts';
import { designOutline } from './outline.ts';
import { registerAssetTools } from './tools/assets.ts';
import { registerDesignTools } from './tools/designs.ts';
import { registerEditTools } from './tools/edit.ts';
import { registerExportTools, runJob } from './tools/export.ts';
import { registerVideoTools } from './tools/video.ts';
import { registerViewTools } from './tools/view.ts';
import type { Workspace } from './workspace.ts';

export const VERSION = '0.1.0';

const INSTRUCTIONS = `Digital Canvas is an open-source design editor (like Canva). With these tools you make posters, social posts, carousels, thumbnails, slides and video reels from the user's own assets (Google Drive) and free stock, and export PNG/JPG/PDF/GIF/MP4 to their Drive.

How to work well:
${WORKFLOW}

Read the resource dcanvas://guide for sizes, type scales, font pairings, filters, animations and video tips. Always look at your work with render_page before you call it done.`;

export function createServer(ws: Workspace, opts: ServerOptions = {}): McpServer {
  const ctx = new Context(ws, opts);
  const server = new McpServer({ name: opts.name ?? 'digital-canvas', version: VERSION, title: 'Digital Canvas' }, { instructions: INSTRUCTIONS, capabilities: { logging: {} } });

  registerDesignTools(server, ctx);
  registerEditTools(server, ctx);
  registerAssetTools(server, ctx);
  registerViewTools(server, ctx);
  registerVideoTools(server, ctx);
  registerExportTools(server, ctx);

  // ---- resources

  server.registerResource('guide', 'dcanvas://guide', { title: 'Design guide for agents', description: 'Workflow, coordinates, sizes, typography, colour, pictures, effects, video and export tips.', mimeType: 'text/markdown' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: GUIDE }] }));

  server.registerResource('templates', 'dcanvas://templates', { title: 'Template catalogue', description: 'Every built-in template: id, title, category, size, pages, fonts, preview URL.', mimeType: 'application/json' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(templates().map((t) => ({ ...t, preview: templateThumb(t.id, ctx.editorUrl) }))) }] }));

  server.registerResource('template', new ResourceTemplate('dcanvas://template/{id}', {
    list: async () => ({ resources: templates().map((t) => ({ uri: `dcanvas://template/${t.id}`, name: t.title, description: `${t.category} · ${t.width}×${t.height}`, mimeType: 'application/json' })) }),
  }), { title: 'Template outline', description: 'A template\'s pages and elements (ids, texts, boxes) — use the ids in apply_template replace_text.', mimeType: 'application/json' },
  async (uri, { id }) => {
    const doc = await loadTemplate(String(id));
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ ...designOutline(doc), preview: templateThumb(String(id), ctx.editorUrl) }) }] };
  });

  server.registerResource('design', new ResourceTemplate('dcanvas://design/{id}', {
    list: async () => ({ resources: (await ws.store.list()).slice(0, 100).map((m) => ({ uri: `dcanvas://design/${m.id}`, name: m.title, description: `${Math.round(m.width)}×${Math.round(m.height)} · ${m.updatedAt}`, mimeType: 'application/json' })) }),
  }), { title: 'Design document', description: 'The full document.json of a design (the open Digital Canvas format).', mimeType: 'application/json' },
  async (uri, { id }) => {
    const file = await ws.store.open(String(id));
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(file.doc) }] };
  });

  // ---- prompts

  server.registerPrompt('make-poster', {
    title: 'Make a poster or social graphic',
    description: 'Design a poster / post / flyer / thumbnail from the user\'s assets and brand, look at it, critique and export.',
    argsSchema: {
      brief: z.string().describe('What it is for and what it must say.'),
      format: z.string().optional().describe('Preset, e.g. instagram-post, instagram-story, poster-a3, youtube-thumbnail, flyer-a4.'),
      assets: z.string().optional().describe('Where the photos are: a Drive folder or file names, or "stock".'),
    },
  }, ({ brief, format, assets }) => ({
    messages: [{ role: 'user', content: { type: 'text', text: `Make a ${format ?? 'poster'} with Digital Canvas.

Brief: ${brief}
${assets ? `Use these assets: ${assets}\n` : ''}
Work like a senior designer:
1. get_brand_kit; find the pictures (${assets ? 'search_drive / list_assets for the ones named' : 'list_assets, then search_drive, then search_stock if needed'}) and import the best 1–3.
2. list_templates for this format (design_id or preset); use one if it fits the brief, else create_design with preset "${format ?? 'poster-a3'}".
3. Compose: one clear focal point, a strong headline (2–6 words), supporting line, call to action / details; generous margins; at most 2 fonts and 3 colours (brand first).
4. render_page with show_ids; improve hierarchy, spacing and alignment. Then check_design and fix every error and warning; render again.
5. export_image (png) — and export_pdf if it is for print. Give me the link and the editor link (open_in_editor).` } }],
  }));

  server.registerPrompt('make-reel-from-folder', {
    title: 'Make a reel from a folder of clips',
    description: 'Turn the user\'s photos/videos (a Drive folder or uploads) into a 1080×1920 reel with music, captions and transitions, then export MP4.',
    argsSchema: {
      folder: z.string().describe('Drive folder name or id, or "uploads".'),
      topic: z.string().describe('What the reel is about / the hook.'),
      length: z.string().optional().describe('Target seconds, e.g. "20".'),
      voiceover: z.string().optional().describe('Transcript to caption, if any.'),
    },
  }, ({ folder, topic, length, voiceover }) => ({
    messages: [{ role: 'user', content: { type: 'text', text: `Make a vertical reel (instagram-reel) about: ${topic}. Target length: ${length ?? '15–30'} seconds.

Material: ${folder === 'uploads' ? 'list_assets (kind video and image)' : `search_drive for the folder "${folder}" (then list it with folder_id) and import the clips/photos you pick (import_from_drive)`}.
Steps:
1. Look at what is there; pick the strongest 4–10 shots in a story order (hook in the first 2 s, payoff at the end). Trim clips to 1.5–4 s each (trimStart/trimEnd).
2. Music: list_assets kind audio, or search_stock kind "audio" audio_category "music" (upbeat/cinematic to taste) and import_stock it.
3. assemble_video with clips, a short title_card hook, end_card with the call to action, transition {type:"dissolve", duration:0.4}, music with fades${voiceover ? `, transcript: the voice-over text below` : ''}.
4. render_thumbnail_grid, render_page at a few moments (at: seconds) to check framing (focus), text legibility, safe zones; check_design and fix.
5. export_video and give me the link.
${voiceover ? `\nVoice-over / captions:\n${voiceover}` : ''}` } }],
  }));

  server.registerPrompt('brand-social-pack', {
    title: 'Brand social pack',
    description: 'One message as an on-brand set: Instagram post, story, LinkedIn post and YouTube thumbnail (resized and adjusted), all exported.',
    argsSchema: { message: z.string().describe('The announcement / offer / quote.'), sizes: z.string().optional().describe('Comma-separated presets (default instagram-post, instagram-story, linkedin-post, youtube-thumbnail).') },
  }, ({ message, sizes }) => ({
    messages: [{ role: 'user', content: { type: 'text', text: `Create an on-brand social pack for: "${message}".
Sizes: ${sizes ?? 'instagram-post, instagram-story, linkedin-post, youtube-thumbnail'}.
1. get_brand_kit (colours, fonts, logo). Pick or import one hero picture (list_assets / search_drive / search_stock).
2. Design the first size properly (template or blank), apply_brand (logo in a corner), render_page, check_design, fix.
3. resize_design into each other size; for each: render_page, re-balance the layout for the new shape (move/resize with update_elements; stories need the text inside the safe zone), check_design.
4. export_image for all; reply with the links in a short list.` } }],
  }));

  server.registerPrompt('improve-design', {
    title: 'Critique and improve a design',
    description: 'Look at an existing design, list what to improve, and fix it.',
    argsSchema: { design_id: z.string() },
  }, ({ design_id }) => ({
    messages: [{ role: 'user', content: { type: 'text', text: `Improve design ${design_id}: open_design, render_page (show_ids) for each page, check_design. Write down the 3–6 most important improvements (hierarchy, contrast, spacing, alignment, consistency, text length), make them with update_elements / add_elements, then render again to confirm and summarise what changed.` } }],
  }));

  return server;
}

export { runJob };
export type { ServerOptions };
