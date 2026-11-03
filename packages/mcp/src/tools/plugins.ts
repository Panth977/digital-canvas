/**
 * The user's plugins over MCP: list, read, create, update, delete, apply,
 * export (.dcplugin) and install. Agents make new animations (CSS
 * @keyframes), effects (presets and SkSL shaders), fonts and photo mockups
 * the same way the Plugins panel does; everything lands in the user's own
 * library (Drive plugins.json, or the folder's).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  animationFrom, findElement, parsePlugin, removePlugin, shaderFrom, updateElements, updatePage, upsertPlugin, walk,
  type EffectPlugin, type Element, type FontPlugin, type MockupPlugin, type Plugin, type PluginLibrary,
} from '@digital-canvas/scene';
import { assetId, packPlugin, unpackPlugin, PLUGIN_EXT, PLUGIN_MIME, type ProjectFile } from '@digital-canvas/storage';
import { ToolError, type Context, type MediaRef } from '../context.ts';
import { engine } from '../engine.ts';
import { compositePage, decodeRgba } from '../mockups.ts';
import { pageRef } from '../schemas.ts';
import { compileShaderCheck, fontFileInfo, quadMockup, toSfntBytes } from '../pluginrender.ts';
import { b64, json, pageOf, safe } from './util.ts';
import { embedPluginFont } from '../pluginfonts.ts';
import { prepareMockup, type MockupEntry } from '@digital-canvas/render';

const media = z.object({
  asset: z.string().optional(), url: z.string().optional(), driveFileId: z.string().optional(), name: z.string().optional(),
}).describe('Exactly one of asset (id from list_assets), url (public https) or driveFileId.');

type Store = Required<Pick<NonNullable<Context['ws']['store']>, 'loadPlugins' | 'savePlugins' | 'pluginAsset'>>;

function storeOf(ctx: Context): Store {
  const s = ctx.ws.store as Partial<Store>;
  if (!s.loadPlugins || !s.savePlugins || !s.pluginAsset) throw new ToolError('this workspace cannot keep plugins');
  return s as Store;
}

/** A plugin by id or name. */
export async function findPlugin(ctx: Context, ref: string, kind?: Plugin['kind']): Promise<{ plugin: Plugin; lib: PluginLibrary }> {
  const lib = await storeOf(ctx).loadPlugins();
  const r = ref.trim().toLowerCase();
  const plugin = lib.plugins.find((p) => (!kind || p.kind === kind) && (p.id.toLowerCase() === r || p.name.toLowerCase() === r));
  if (!plugin) throw new ToolError(`no ${kind ?? ''} plugin "${ref}"`.replace('  ', ' '), 'list_plugins shows ids and names');
  return { plugin, lib };
}

const summary = (p: Plugin): Record<string, unknown> => ({
  id: p.id, kind: p.kind, name: p.name, ...(p.description ? { description: p.description } : {}),
  ...(p.kind === 'animation' ? { duration: p.recipe.len, ...(p.recipe.loop ? { loop: true } : {}), ...(p.recipe.exit ? { exit: true } : {}), frames: p.recipe.f.length } : {}),
  ...(p.kind === 'effect' ? { target: p.target, preset: !!p.preset, ...(p.shader ? { shader: true, params: p.shader.params } : {}) } : {}),
  ...(p.kind === 'font' ? { family: p.family, faces: p.faces.map((f) => `${f.weight}${f.italic ? ' italic' : ''}`) } : {}),
  ...(p.kind === 'mockup' ? { category: p.category, size: [p.width, p.height] } : {}),
});

/** Bytes of a media ref as a plugin file: [asset id, bytes, mime]. */
async function fileOf(ctx: Context, ref: MediaRef, as: 'font' | 'image'): Promise<{ id: string; bytes: Uint8Array; mime: string }> {
  const got = await ctx.fetchRef(ref);
  if (as === 'font') {
    const bytes = await toSfntBytes(got.bytes);
    const mime = bytes[0] === 0x4f && bytes[1] === 0x54 ? 'font/otf' : 'font/ttf';
    return { id: await assetId(bytes, mime), bytes, mime };
  }
  const mime = got.mime && got.mime.startsWith('image/') ? got.mime : (got.bytes[0] === 0x89 ? 'image/png' : 'image/jpeg');
  return { id: await assetId(got.bytes, mime), bytes: got.bytes, mime };
}

/** Build a plugin from tool arguments (files fetched, shaders compiled). */
async function pluginFrom(ctx: Context, a: Record<string, unknown>, files: Map<string, Uint8Array>, base?: Plugin): Promise<Plugin> {
  const input: Record<string, unknown> = { ...(base ?? {}), ...a };
  if (input.kind === 'font' && Array.isArray(a.faces)) {
    input.faces = await Promise.all((a.faces as Record<string, unknown>[]).map(async (f) => {
      if (typeof f.asset === 'string' && !f.url && !f.driveFileId && (await storeOf(ctx).pluginAsset(f.asset))) return f;
      const file = await fileOf(ctx, f as MediaRef, 'font');
      files.set(file.id, file.bytes);
      const info = await fontFileInfo(file.bytes).catch(() => null);
      if (!input.family && info?.family) input.family = info.family;
      return { asset: file.id, mime: file.mime, weight: (f.weight as number) ?? info?.weight ?? 400, italic: (f.italic as boolean) ?? info?.italic ?? false };
    }));
  }
  if (input.kind === 'mockup' && a.photo && typeof a.photo === 'object') {
    const file = await fileOf(ctx, a.photo as MediaRef, 'image');
    files.set(file.id, file.bytes);
    const { ck } = await engine();
    const img = decodeRgba(ck, file.bytes, 'photo');
    input.photo = file.id; input.width = img.width; input.height = img.height;
  }
  if (input.kind === 'mockup' && a.mask && typeof a.mask === 'object') {
    const file = await fileOf(ctx, a.mask as MediaRef, 'image');
    files.set(file.id, file.bytes);
    input.mask = file.id;
  }
  if (input.kind === 'animation' && typeof a.css === 'string') delete input.recipe;
  let p: Plugin;
  try { p = parsePlugin(input); } catch (e) { throw new ToolError(e instanceof Error ? e.message : String(e), 'see create_plugin\'s description for each kind\'s fields'); }
  if (p.kind === 'effect' && p.shader) {
    const c = await compileShaderCheck(p.shader.sksl);
    if (!c.ok) throw new ToolError(`the shader does not compile: ${c.error}`, 'SkSL: `uniform shader image; uniform float2 resolution; uniform float time;` + one `uniform float <param>;` each, and `half4 main(float2 p) { return image.eval(p); }`');
  }
  return p;
}

export function registerPluginTools(server: McpServer, ctx: Context): void {
  server.registerTool('list_plugins', {
    title: 'List my plugins',
    description: 'The user\'s own animations, effects (presets / shaders), fonts and photo mockups. Use them with apply_plugin (or by name: CSS `animation: <name>` in set_page_html, `font-family: <family>`, render_mockup mockup_id = a mockup plugin id).',
    inputSchema: { kind: z.enum(['animation', 'effect', 'font', 'mockup']).optional() },
    annotations: { readOnlyHint: true },
  }, safe(async ({ kind }) => {
    const lib = await storeOf(ctx).loadPlugins();
    return json({ plugins: lib.plugins.filter((p) => !kind || p.kind === kind).map(summary) });
  }));

  server.registerTool('get_plugin', {
    title: 'Read a plugin',
    description: 'Everything about one plugin: keyframes (and its CSS), shader code and params, font faces, mockup corners.',
    inputSchema: { plugin: z.string().describe('Id or name.') },
    annotations: { readOnlyHint: true },
  }, safe(async ({ plugin }) => json((await findPlugin(ctx, plugin)).plugin)));

  const createDescription = [
    'Add a plugin to the user\'s library (they see it in the Plugins panel too). Fields by kind:',
    '• animation: name, css (one CSS @keyframes block — transform translate/scale/rotate/skew, opacity, filter blur, animation-timing-function per keyframe), duration (s), loop, exit.',
    '• effect: name, target image|text|any, and preset {look: {filter, adjust, shadow, duotone, stylize…}, textEffect} and/or shader {sksl, params: [{name, label, min, max, default}], animated}. SkSL contract: `uniform shader image; uniform float2 resolution; uniform float time;` plus `uniform float <param>;` per param, and `half4 main(float2 p)` returning the new colour (`image.eval(p)` reads the element). It is compiled before saving.',
    '• font: name, family, faces: [{url | asset | driveFileId, weight, italic}] (TTF, OTF, WOFF or WOFF2), license.',
    '• mockup: name, category, photo {url | asset | driveFileId}, corners [[x,y]×4] (photo px, clockwise from top-left: the print area), shade 0..1 (how much of the photo\'s light shows on the design, default 0.8), mask {…} (optional, white = print area).',
    'Returns the plugin summary; then apply_plugin or render_mockup to see it.',
  ].join('\n');
  const pluginFields = {
    name: z.string().optional(), description: z.string().optional(), tags: z.array(z.string()).optional(),
    css: z.string().optional(), duration: z.number().optional(), loop: z.boolean().optional(), exit: z.boolean().optional(),
    target: z.enum(['image', 'text', 'any']).optional(),
    preset: z.object({}).passthrough().optional(),
    shader: z.object({ sksl: z.string(), params: z.array(z.object({ name: z.string(), label: z.string().optional(), min: z.number(), max: z.number(), default: z.number() })).optional(), animated: z.boolean().optional() }).optional(),
    family: z.string().optional(), license: z.string().optional(),
    faces: z.array(z.object({ url: z.string().optional(), asset: z.string().optional(), driveFileId: z.string().optional(), weight: z.number().optional(), italic: z.boolean().optional() })).optional(),
    category: z.string().optional(), photo: media.optional(), mask: media.optional(),
    corners: z.array(z.array(z.number()).length(2)).length(4).optional(), shade: z.number().min(0).max(1).optional(),
  };

  server.registerTool('create_plugin', {
    title: 'Create a plugin',
    description: createDescription,
    inputSchema: { kind: z.enum(['animation', 'effect', 'font', 'mockup']), ...pluginFields },
  }, safe(async (a) => {
    const files = new Map<string, Uint8Array>();
    const p = await pluginFrom(ctx, a as Record<string, unknown>, files);
    const st = storeOf(ctx);
    const lib = await st.loadPlugins();
    const clash = lib.plugins.find((x) => x.kind === p.kind && x.name.toLowerCase() === p.name.toLowerCase());
    if (clash) throw new ToolError(`there is already a ${p.kind} plugin named "${p.name}" (${clash.id})`, 'pick another name, or update_plugin it');
    await st.savePlugins(upsertPlugin(lib, p), files);
    return json({ created: summary(p) });
  }));

  server.registerTool('update_plugin', {
    title: 'Change a plugin',
    description: 'Change some fields of a plugin (same fields as create_plugin). Designs that already use it keep their copy until it is applied again.',
    inputSchema: { plugin: z.string().describe('Id or name.'), ...pluginFields },
  }, safe(async ({ plugin, ...a }) => {
    const { plugin: old, lib } = await findPlugin(ctx, plugin);
    const files = new Map<string, Uint8Array>();
    const p = await pluginFrom(ctx, { ...a, kind: old.kind, id: old.id }, files, old);
    await storeOf(ctx).savePlugins(upsertPlugin(lib, p), files);
    return json({ updated: summary(p) });
  }));

  server.registerTool('delete_plugin', {
    title: 'Delete a plugin',
    inputSchema: { plugin: z.string() },
    annotations: { destructiveHint: true },
  }, safe(async ({ plugin }) => {
    const { plugin: p, lib } = await findPlugin(ctx, plugin);
    await storeOf(ctx).savePlugins(removePlugin(lib, p.id));
    return json({ deleted: p.id });
  }));

  server.registerTool('apply_plugin', {
    title: 'Use a plugin in a design',
    description: 'animation → the elements (or the whole page when no ids) get it; effect → its preset and/or shader on the elements (params override the defaults); font → its faces go into the design and the text elements switch to it; mockup → use render_mockup with mockup_id = the plugin id instead.',
    inputSchema: {
      design_id: z.string(), plugin: z.string().describe('Id or name.'),
      element_ids: z.array(z.string()).optional(), page: pageRef.optional().describe('Page animation target when element_ids is empty (default page 1).'),
      params: z.record(z.number()).optional().describe('Shader params.'),
      duration: z.number().optional().describe('Animation seconds.'),
    },
  }, safe(async ({ design_id, plugin, element_ids, page, params, duration }) => {
    const { plugin: p } = await findPlugin(ctx, plugin);
    if (p.kind === 'mockup') throw new ToolError('mockups are not put into a design', `render_mockup with mockup_id "${p.id}"`);
    const ids = element_ids ?? [];
    let changed = 0;
    await ctx.edit(design_id, async (file) => {
      for (const id of ids) if (!findElement(file.doc, id)) throw new ToolError(`no element "${id}"`);
      if (p.kind === 'animation') {
        const anim = animationFrom(p, duration ? { duration } : {});
        if (ids.length) { file.doc = updateElements(file.doc, ids, { animation: anim } as never); changed = ids.length; }
        else { const { page: pg } = pageOf(file.doc, page); file.doc = updatePage(file.doc, pg.id, { animation: anim }); changed = 1; }
      } else if (p.kind === 'effect') {
        if (!ids.length) throw new ToolError('effects need element_ids');
        file.doc = updateElements(file.doc, ids, (e: Element) => effectPatch(p, e, params ?? {}) as never);
        changed = ids.length;
      } else if (p.kind === 'font') {
        await embedPluginFont(ctx, file, p);
        const targets = ids.length ? ids : [];
        file.doc = updateElements(file.doc, targets, (e: Element) => (e.type === 'text' ? { style: { ...e.style, fontFamily: p.family } } : {}) as never);
        changed = targets.length;
      }
    });
    return json({ applied: p.name, kind: p.kind, changed });
  }));

  server.registerTool('export_plugin', {
    title: 'Export a plugin as a .dcplugin file',
    description: 'Packs the plugin and its files into one .dcplugin file in Exports (Drive link or folder path), to share; install_plugin reads it back.',
    inputSchema: { plugin: z.string() },
  }, safe(async ({ plugin }) => {
    const { plugin: p } = await findPlugin(ctx, plugin);
    const st = storeOf(ctx);
    const bytes = await packPlugin(p, (id) => st.pluginAsset(id));
    const r = await ctx.ws.saveExport(`${p.name.replace(/[\\/:*?"<>|]+/g, '')}${PLUGIN_EXT}`, bytes, PLUGIN_MIME);
    return json({ name: r.name, size: r.size, ...(r.link ? { link: r.link } : {}), ...(r.path ? { path: r.path } : {}) });
  }));

  server.registerTool('install_plugin', {
    title: 'Install a .dcplugin',
    description: 'Add a shared plugin (.dcplugin file, or plugin JSON) to the user\'s library. A plugin with the same id is replaced.',
    inputSchema: { file: media },
  }, safe(async ({ file }) => {
    const got = await ctx.fetchRef(file as MediaRef);
    let un;
    try { un = unpackPlugin(got.bytes); } catch (e) { throw new ToolError(e instanceof Error ? e.message : String(e)); }
    const st = storeOf(ctx);
    await st.savePlugins(upsertPlugin(await st.loadPlugins(), un.plugin), un.assets);
    return json({ installed: summary(un.plugin) });
  }));
}

/** An effect plugin's changes for one element. */
export function effectPatch(p: EffectPlugin, e: Element, params: Record<string, number>): Partial<Element> {
  const out: Record<string, unknown> = {};
  if (p.preset?.look && (e.type === 'image' || e.type === 'video')) Object.assign(out, p.preset.look);
  if (p.preset?.textEffect && e.type === 'text') out.effect = p.preset.textEffect;
  const sh = shaderFrom(p, params);
  if (sh) out.shader = sh;
  return out as Partial<Element>;
}

/** A user mockup as a library-like entry plus prepared maps. */
export async function userMockup(ctx: Context, p: MockupPlugin, maxSide?: number) {
  const st = storeOf(ctx);
  const { ck } = await engine();
  const photoBytes = await st.pluginAsset(p.photo);
  if (!photoBytes) throw new ToolError(`the photo of mockup "${p.name}" is missing`);
  const photo = decodeRgba(ck, photoBytes, p.name);
  const maskBytes = p.mask ? await st.pluginAsset(p.mask) : null;
  const mask = maskBytes ? decodeRgba(ck, maskBytes, `${p.name} mask`) : null;
  const { buffers, aspect } = await quadMockup(photo, p, mask);
  const entry: MockupEntry = { id: p.id, label: p.name, category: p.category, width: photo.width, height: photo.height, aspect };
  return { entry, prepared: prepareMockup(buffers, maxSide && maxSide < Math.max(photo.width, photo.height) ? maxSide : undefined) };
}

export { compositePage, b64 };
