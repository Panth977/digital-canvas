/** Font plugins in designs: the user's own font faces, embedded like Google Fonts are. */
import { walk, type FontPlugin, type PluginLibrary } from '@digital-canvas/scene';
import type { ProjectFile } from '@digital-canvas/storage';
import { ToolError, type Context } from './context.ts';

interface Store { loadPlugins?(): Promise<PluginLibrary>; pluginAsset?(id: string): Promise<Uint8Array | null> }
const st = (ctx: Context) => ctx.ws.store as Store;

/** Put a font plugin's faces into a design (doc.fonts + assets). */
export async function embedPluginFont(ctx: Context, file: ProjectFile, p: FontPlugin): Promise<void> {
  const store = st(ctx);
  if (!store.pluginAsset) throw new ToolError('this workspace cannot keep plugins');
  const fonts = [...(file.doc.fonts ?? [])];
  const assets = { ...file.doc.assets };
  for (const f of p.faces) {
    if (fonts.some((x) => x.asset === f.asset)) continue;
    const bytes = await store.pluginAsset(f.asset);
    if (!bytes) throw new ToolError(`font file ${f.asset} of "${p.name}" is missing`);
    file.assets.set(f.asset, bytes);
    assets[f.asset] = { mime: f.mime, name: `${p.family} ${f.weight}${f.italic ? ' italic' : ''}` };
    fonts.push({ family: p.family, asset: f.asset, weight: f.weight, italic: f.italic });
  }
  file.doc = { ...file.doc, fonts, assets };
}

/** Fonts the design names that are the user's font plugins: embed them (before the Google Fonts lookup). */
export async function embedUserFonts(ctx: Context, file: ProjectFile): Promise<void> {
  const s = st(ctx);
  if (!s.loadPlugins) return;
  const have = new Set((file.doc.fonts ?? []).map((f) => f.family.toLowerCase()));
  const want = new Set<string>();
  for (const pg of file.doc.pages) for (const e of walk(pg.elements)) if (e.type === 'text') {
    want.add(e.style.fontFamily.toLowerCase());
    for (const r of e.runs ?? []) if (r.style?.fontFamily) want.add(r.style.fontFamily.toLowerCase());
  }
  const missing = [...want].filter((f) => !have.has(f));
  if (!missing.length) return;
  const lib = await s.loadPlugins().catch(() => null);
  for (const p of lib?.plugins ?? []) if (p.kind === 'font' && missing.includes(p.family.toLowerCase())) await embedPluginFont(ctx, file, p);
}

