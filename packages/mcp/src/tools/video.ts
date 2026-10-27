/** Video: assemble a reel from clips, sound, captions. */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  addAudio, createDoc, isVideo, newId, pageDuration, pageStart, removeAudio, removeElements, totalDuration, updateAudio, walk,
  type Doc, type Element, type Page, type TextElement,
} from '@digital-canvas/scene';
import { ToolError, round, type Context, type MediaRef } from '../context.ts';
import { buildElements, fitTexts } from '../build.ts';
import { embedFonts } from '../fonts.ts';
import { designOutline } from '../outline.ts';
import { animation, color, fill as fillSchema, textEffect } from '../schemas.ts';
import { sizeFrom } from './designs.ts';
import { json, safe } from './util.ts';

const media = {
  asset: z.string().optional(), url: z.string().optional(), driveFileId: z.string().optional(),
};

const captionStyle = z.object({
  fontFamily: z.string().optional().describe('Default "Montserrat".'),
  fontSize: z.number().positive().optional().describe('Default 6.5% of the width (70 px on a reel).'),
  color: color.optional().describe('Default white.'),
  bold: z.boolean().optional().describe('Default true.'),
  uppercase: z.boolean().optional(),
  effect: textEffect.nullable().optional().describe('Default a black highlight box ({type:"background", color:"#000000", transparency:25}); null = none.'),
  y: z.number().optional().describe('Top of the caption box, px (default 68% of the height: inside the Reels safe zone).'),
  animation: animation.optional().describe('e.g. {type:"pop"} or {type:"typewriter"}. Default none.'),
}).describe('How captions look.');

/** Split a transcript into caption chunks over [start, end], timed by length. */
export function chunkTranscript(text: string, start: number, end: number, maxWords = 5): { start: number; end: number; text: string }[] {
  const sentences = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  for (const s of sentences) {
    const words = s.split(' ').filter(Boolean);
    for (let i = 0; i < words.length; i += maxWords) chunks.push(words.slice(i, i + maxWords).join(' '));
  }
  const weight = chunks.map((c) => c.length + 8);
  const total = weight.reduce((a, b) => a + b, 0);
  const out: { start: number; end: number; text: string }[] = [];
  let t = start;
  chunks.forEach((c, i) => {
    const d = ((end - start) * weight[i]!) / total;
    out.push({ start: round(t, 2), end: round(t + d, 2), text: c });
    t += d;
  });
  return out;
}

/** Caption text elements with per-page timing, for timeline-time captions. */
async function captionElements(ctx: Context, file: { doc: Doc; assets: Map<string, Uint8Array> }, caps: { start: number; end: number; text: string }[], style: z.infer<typeof captionStyle> = {}, warnings: string[] = []): Promise<{ byPage: Map<string, Element[]>; fit: Map<string, { autoW: boolean; autoH: boolean; shrink: boolean; centreX: boolean }> }> {
  const doc = file.doc;
  const W = doc.width, H = doc.height;
  const byPage = new Map<string, Element[]>();
  const fit = new Map<string, { autoW: boolean; autoH: boolean; shrink: boolean; centreX: boolean }>();
  const pages = doc.pages.filter((p) => !p.hidden);
  for (const c of caps) {
    if (!(c.end > c.start)) throw new ToolError(`caption "${c.text.slice(0, 30)}": end must be after start`);
    for (const p of pages) {
      const ps = pageStart(doc, p.id), pe = ps + pageDuration(p);
      const a = Math.max(c.start, ps), b = Math.min(c.end, pe);
      if (b - a < 0.05) continue;
      const spec = {
        type: 'text' as const, name: 'Caption', text: c.text, x: W * 0.08, y: style.y ?? H * 0.68, w: W * 0.84,
        fontFamily: style.fontFamily ?? 'Montserrat', fontSize: style.fontSize ?? Math.round(W * 0.065), color: style.color ?? '#ffffff',
        bold: style.bold ?? true, uppercase: style.uppercase, align: 'center' as const, lineHeight: 1.15,
        ...(style.effect === null ? {} : { effect: style.effect ?? { type: 'background' as const, color: '#000000', transparency: 25, roundness: 40, spread: 40 } }),
        ...(style.animation ? { animation: style.animation } : {}),
        timing: { start: round(a - ps, 2), end: round(b - ps, 2) },
      };
      const built = await buildElements(ctx, file as never, [spec as never], warnings, fit);
      byPage.set(p.id, [...(byPage.get(p.id) ?? []), ...built.elements]);
    }
  }
  return { byPage, fit };
}

export function registerVideoTools(server: McpServer, ctx: Context): void {
  server.registerTool('assemble_video', {
    title: 'Assemble a video / reel',
    description: 'Build a video in one call: one page per clip or photo (each filling the frame, cropped to fit), trimmed, with optional on-screen text per clip, transitions between them, background music with fades, captions from a transcript, and title/end cards. Default size is a 1080×1920 reel. Then: render_page (with `at`), check_design, export_video.',
    inputSchema: {
      title: z.string(),
      preset: z.string().optional().describe('Default "instagram-reel" (1080×1920). Also youtube-shorts, tiktok-video, video (1920×1080), video-square…'),
      clips: z.array(z.object({
        ...media,
        trimStart: z.number().min(0).optional(), trimEnd: z.number().min(0).optional(),
        duration: z.number().positive().optional().describe('Seconds on screen (photos: default 3; videos: the trimmed length).'),
        text: z.string().optional().describe('On-screen text for this clip (lower third).'),
        focus: z.object({ x: z.number(), y: z.number() }).optional().describe('Which point of the picture to keep in frame (0..1).'),
        muted: z.boolean().optional(),
        animation: animation.optional().describe('For photos, e.g. {type:"fade"} or {type:"pop"}.'),
      })).min(1).max(60),
      transition: z.object({ type: z.enum(['dissolve', 'fade', 'slide', 'wipe', 'zoom']), duration: z.number().positive().optional(), direction: z.enum(['left', 'right', 'up', 'down']).optional() }).optional().describe('Between every two clips.'),
      title_card: z.object({ text: z.string(), subtitle: z.string().optional(), background: fillSchema.optional(), color: color.optional(), fontFamily: z.string().optional(), duration: z.number().positive().optional() }).optional(),
      end_card: z.object({ text: z.string(), subtitle: z.string().optional(), background: fillSchema.optional(), color: color.optional(), fontFamily: z.string().optional(), duration: z.number().positive().optional() }).optional(),
      music: z.object({ ...media, offset: z.number().min(0).optional().describe('Start this far into the song.'), volume: z.number().min(0).max(1).optional(), fadeIn: z.number().min(0).optional(), fadeOut: z.number().min(0).optional() }).optional(),
      mute_clips: z.boolean().optional().describe('Silence the clips\' own sound (e.g. under music).'),
      transcript: z.string().optional().describe('Voice-over/caption text spread over the whole video as timed captions.'),
      caption_style: captionStyle.optional(),
      text_style: z.object({ fontFamily: z.string().optional(), color: color.optional(), fontSize: z.number().optional() }).optional().describe('Look of the per-clip text.'),
    },
  }, safe(async (a) => {
    const size = sizeFrom({ preset: a.preset ?? 'instagram-reel' });
    let doc = createDoc({ title: a.title, width: size.width, height: size.height, unit: size.unit });
    const W = doc.width, H = doc.height;
    const file = { doc: { ...doc, pages: [] as Page[] }, assets: new Map<string, Uint8Array>() };
    const warnings: string[] = [];
    const fit = new Map<string, { autoW: boolean; autoH: boolean; shrink: boolean; centreX: boolean }>();
    const card = async (c: NonNullable<typeof a.title_card>, name: string) => {
      const specs: never[] = [
        { type: 'text', name: `${name} title`, text: c.text, x: W * 0.08, y: H * (c.subtitle ? 0.38 : 0.42), w: W * 0.84, fontFamily: c.fontFamily ?? 'Anton', fontSize: Math.round(W * 0.11), color: c.color ?? '#ffffff', align: 'center', lineHeight: 1, animation: { type: 'rise' } } as never,
        ...(c.subtitle ? [{ type: 'text', name: `${name} subtitle`, text: c.subtitle, x: W * 0.1, y: H * 0.56, w: W * 0.8, fontFamily: 'Montserrat', fontSize: Math.round(W * 0.045), color: c.color ?? '#ffffff', align: 'center', animation: { type: 'fade', duration: 1 } } as never] : []),
      ];
      const built = await buildElements(ctx, file as never, specs, warnings, fit);
      const { looseFill } = await import('@digital-canvas/scene');
      file.doc.pages.push({ id: newId('p_'), name, background: looseFill(c.background ?? '#111111') ?? { type: 'solid', color: '#111111' }, duration: c.duration ?? 2.5, elements: built.elements, ...(file.doc.pages.length && a.transition ? { transition: a.transition } : {}) });
    };
    if (a.title_card) await card(a.title_card, 'Title card');
    for (const [i, c] of a.clips.entries()) {
      const { id, info } = await ctx.attach(file as never, { asset: c.asset, url: c.url, driveFileId: c.driveFileId });
      if (info.kind === 'audio') throw new ToolError(`clip ${i + 1} is a sound file`, 'put music in `music`');
      const specs: never[] = [{ type: info.kind, asset: id, x: 0, y: 0, w: W, h: H, name: `Clip ${i + 1}`, ...(c.focus ? { focus: c.focus } : {}),
        ...(info.kind === 'video' ? { trimStart: c.trimStart, trimEnd: c.trimEnd, muted: c.muted ?? a.mute_clips } : {}), ...(c.animation ? { animation: c.animation } : {}) } as never];
      if (c.text) specs.push({ type: 'text', name: 'Clip text', text: c.text, x: W * 0.08, y: H * (a.transcript ? 0.16 : 0.6), w: W * 0.84, fontFamily: a.text_style?.fontFamily ?? 'Montserrat', fontSize: a.text_style?.fontSize ?? Math.round(W * 0.07), bold: true, color: a.text_style?.color ?? '#ffffff', align: 'center', effect: { type: 'shadow', offset: 20, blur: 40, transparency: 40, color: '#000000' }, animation: { type: 'rise' } } as never);
      const built = await buildElements(ctx, file as never, specs, warnings, fit);
      const len = info.kind === 'video' ? Math.max(0.3, Math.min(c.trimEnd ?? info.duration ?? 5, info.duration ?? Infinity) - (c.trimStart ?? 0)) : 3;
      file.doc.pages.push({ id: newId('p_'), background: { type: 'solid', color: '#000000' }, duration: round(c.duration ?? len, 2), elements: built.elements, ...(file.doc.pages.length && a.transition ? { transition: a.transition } : {}) });
    }
    if (a.end_card) await card(a.end_card, 'End card');
    doc = file.doc as Doc;
    const total = totalDuration(doc);
    if (a.music) {
      const { id, info } = await ctx.attach(file as never, a.music);
      if (info.kind !== 'audio' && info.kind !== 'video') throw new ToolError('music must be an audio file');
      const avail = (info.duration ?? total) - (a.music.offset ?? 0);
      file.doc = addAudio(file.doc as Doc, { asset: id, start: 0, offset: a.music.offset ?? 0, duration: round(Math.min(total, avail), 2), volume: a.music.volume ?? 0.8, fadeIn: a.music.fadeIn ?? 0.5, fadeOut: a.music.fadeOut ?? 1.5, name: 'Music' }).doc;
    }
    if (a.transcript) {
      const caps = chunkTranscript(a.transcript, 0.2, total - 0.2);
      const r = await captionElements(ctx, file as never, caps, a.caption_style, warnings);
      for (const [k, v] of r.fit) fit.set(k, v);
      file.doc = { ...(file.doc as Doc), pages: (file.doc as Doc).pages.map((p) => ({ ...p, elements: [...p.elements, ...(r.byPage.get(p.id) ?? [])] })) };
    }
    const f = file as unknown as { doc: Doc; assets: Map<string, Uint8Array> };
    await embedFonts(f);
    await fitTexts(f, fit);
    await ctx.save(f);
    return json({ id: f.doc.id, title: f.doc.title, duration: round(totalDuration(f.doc)), pages: f.doc.pages.length, outline: designOutline(f.doc), ...(warnings.length ? { warnings } : {}), editorUrl: ctx.editorLink(f.doc.id), next: 'render_thumbnail_grid, render_page with `at` on a few pages, check_design, then export_video.' });
  }));

  server.registerTool('set_audio', {
    title: 'Music & sound',
    description: 'Add, change or remove a sound on the design\'s timeline (background music, voice-over, effects): where it starts, which part of the file, volume, fade in/out. Adding sound makes the design a video. `duration` defaults to the rest of the video.',
    inputSchema: {
      design_id: z.string(),
      action: z.enum(['add', 'update', 'remove']),
      id: z.string().optional().describe('update/remove: the sound id (open_design → audio).'),
      ...media,
      start: z.number().min(0).optional().describe('Seconds into the video where it starts (default 0).'),
      offset: z.number().min(0).optional().describe('Seconds into the file to start from (default 0).'),
      duration: z.number().positive().optional(),
      volume: z.number().min(0).max(1).optional(), fadeIn: z.number().min(0).optional(), fadeOut: z.number().min(0).optional(),
      name: z.string().optional(),
    },
  }, safe(async (a) => {
    const r = await ctx.edit(a.design_id, async (file) => {
      let doc = file.doc;
      if (a.action === 'remove') {
        if (!a.id || !doc.audio?.some((x) => x.id === a.id)) throw new ToolError(`no sound "${a.id}"`, 'ids are in open_design → audio');
        file.doc = removeAudio(doc, a.id);
        return { removed: a.id };
      }
      if (a.action === 'update') {
        if (!a.id || !doc.audio?.some((x) => x.id === a.id)) throw new ToolError(`no sound "${a.id}"`, 'ids are in open_design → audio');
        const patch = Object.fromEntries(Object.entries({ start: a.start, offset: a.offset, duration: a.duration, volume: a.volume, fadeIn: a.fadeIn, fadeOut: a.fadeOut, name: a.name }).filter(([, v]) => v !== undefined));
        file.doc = updateAudio(doc, a.id, patch);
        return { updated: a.id };
      }
      const { id, info, meta } = await ctx.attach(file, { asset: a.asset, url: a.url, driveFileId: a.driveFileId, name: a.name } as MediaRef);
      if (info.kind === 'image') throw new ToolError('that file is an image, not a sound');
      doc = file.doc;
      if (!isVideo(doc) || !doc.pages.some((p) => p.duration !== undefined)) doc = { ...doc, pages: doc.pages.map((p) => ({ ...p, duration: pageDuration(p) })) };
      const total = totalDuration(doc);
      const start = a.start ?? 0;
      const avail = (meta.duration ?? Infinity) - (a.offset ?? 0);
      const res = addAudio(doc, { asset: id, start, offset: a.offset ?? 0, duration: round(Math.min(a.duration ?? total - start, avail), 2), volume: a.volume ?? 1, ...(a.fadeIn ? { fadeIn: a.fadeIn } : {}), ...(a.fadeOut ? { fadeOut: a.fadeOut } : {}), name: a.name ?? meta.name ?? 'Sound' });
      file.doc = res.doc;
      return { added: res.id, length: meta.duration ? round(meta.duration) : undefined, videoDuration: round(total) };
    });
    return json(r);
  }));

  server.registerTool('add_captions', {
    title: 'Add timed captions',
    description: 'Timed text on top of a video: either exact `captions` [{start, end, text}] in seconds of the whole video, or a `transcript` spread evenly between `start` and `end` (in chunks of up to `words_per_caption`). Captions are text elements named "Caption" that show only during their time (they cross page boundaries correctly). `replace` removes earlier captions first.',
    inputSchema: {
      design_id: z.string(),
      captions: z.array(z.object({ start: z.number().min(0), end: z.number().min(0), text: z.string() })).optional(),
      transcript: z.string().optional(),
      start: z.number().min(0).optional(), end: z.number().min(0).optional(),
      words_per_caption: z.number().int().min(1).max(20).optional().describe('Default 5.'),
      style: captionStyle.optional(),
      replace: z.boolean().optional(),
    },
  }, safe(async (a) => {
    if (!a.captions?.length && !a.transcript?.trim()) throw new ToolError('give `captions` or `transcript`');
    const warnings: string[] = [];
    const r = await ctx.edit(a.design_id, async (file) => {
      if (!isVideo(file.doc)) throw new ToolError('this design is not a video', 'give its pages durations (set_page duration) or use assemble_video');
      if (a.replace) file.doc = removeElements(file.doc, file.doc.pages.flatMap((p) => [...walk(p.elements)]).filter((e) => e.name === 'Caption').map((e) => e.id));
      const total = totalDuration(file.doc);
      const caps = a.captions?.length ? a.captions : chunkTranscript(a.transcript!, a.start ?? 0.2, Math.min(a.end ?? total - 0.2, total), a.words_per_caption ?? 5);
      const { byPage, fit } = await captionElements(ctx, file, caps, a.style, warnings);
      file.doc = { ...file.doc, pages: file.doc.pages.map((p) => ({ ...p, elements: [...p.elements, ...(byPage.get(p.id) ?? [])] })) };
      await embedFonts(file);
      await fitTexts(file, fit);
      return { captions: caps.length, elements: [...byPage.values()].reduce((n, l) => n + l.length, 0) };
    });
    return json({ ...r, ...(warnings.length ? { warnings } : {}), next: 'render_page with `at` inside a caption\'s time to see it.' });
  }));
}

export type { TextElement };
