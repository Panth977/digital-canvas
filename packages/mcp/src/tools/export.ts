/** Exports: images, PDF, GIF, MP4 — saved to "Digital Canvas/Exports" (or the folder's Exports/). */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { exportPdf, exportVectorPdf } from '@digital-canvas/render';
import { totalDuration } from '@digital-canvas/scene';
import type { ProjectFile } from '@digital-canvas/storage';
import { ToolError, round, type Context } from '../context.ts';
import { withRenderer } from '../engine.ts';
import { LocalJobs, waitFor, type JobSpec, type JobStatus } from '../jobs.ts';
import { ffmpeg } from '../media.ts';
import { pageRef } from '../schemas.ts';
import { exportGif, exportMp4 } from '../video.ts';
import type { ExportResult, Workspace } from '../workspace.ts';
import { b64, json, pageOf, progress, safe, type Result } from './util.ts';

const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '').trim().slice(0, 80) || 'design';

/** Drive: a link; local folder: the file path. */
const where = (r: ExportResult) => (r.path ? { path: r.path } : { link: r.link });

const link = (r: ExportResult): Result['content'][number] => ({ type: 'resource_link', uri: r.link ?? `file://${r.path}`, name: r.name, mimeType: r.mime });

/** Run a job (video export) for a design: used in-process and by the Cloud Function's task queue. */
export async function runJob(ws: Workspace, spec: JobSpec, onProgress?: (p: number) => void): Promise<ExportResult> {
  const file = await ws.store.open(spec.designId);
  const bytes = await exportMp4(file, { fps: spec.fps, maxSide: spec.maxSide, onProgress });
  return ws.saveExport(`${safeName(spec.name ?? file.doc.title)}.mp4`, bytes, 'video/mp4');
}

const jobView = (s: JobStatus) => (s.state === 'done' ? { state: 'done', ...s.result } : { job_id: s.id, state: s.state, ...(s.progress !== undefined ? { progress: s.progress } : {}), ...(s.error ? { error: s.error } : {}) });

export function registerExportTools(server: McpServer, ctx: Context): void {
  const jobs = ctx.opts.jobs ?? new LocalJobs();

  server.registerTool('export_image', {
    title: 'Export as PNG/JPG',
    description: 'Export pages as PNG (sharp, transparent possible) or JPG (small, photos), saved to the user\'s Drive "Digital Canvas/Exports" (or the folder\'s Exports/). Returns links and a preview of the first pages.',
    inputSchema: {
      design_id: z.string(), pages: z.array(pageRef).optional().describe('Default all visible pages.'),
      format: z.enum(['png', 'jpg']).optional(), scale: z.number().min(0.1).max(4).optional().describe('1 = the design\'s px size (default), 2 = double.'),
      transparent: z.boolean().optional().describe('PNG without the page background.'),
      quality: z.number().int().min(1).max(100).optional().describe('JPG quality (default 92).'),
    },
  }, safe(async ({ design_id, pages, format, scale, transparent, quality }) => {
    const file = await ctx.open(design_id);
    const doc = file.doc;
    const list = pages ? pages.map((p) => pageOf(doc, p)) : doc.pages.map((page, index) => ({ page, index })).filter((x) => !x.page.hidden);
    const fmt = format ?? 'png';
    const shots = await withRenderer(file, (r) => list.map(({ page, index }) => ({ index, bytes: r.exportPage(doc, page, { scale: scale ?? 1, format: fmt === 'jpg' ? 'jpeg' : 'png', transparent, quality: quality ?? 92 }) })), list.map((x) => x.page));
    const saved: ExportResult[] = [];
    for (const s of shots) saved.push(await ctx.ws.saveExport(`${safeName(doc.title)}${shots.length > 1 || doc.pages.length > 1 ? ` - page ${s.index + 1}` : ''}.${fmt}`, s.bytes, fmt === 'jpg' ? 'image/jpeg' : 'image/png'));
    const previews = await withRenderer(file, (r) => list.slice(0, 2).map(({ page }) => r.exportPage(doc, page, { scale: Math.min(1, 768 / Math.max(doc.width, doc.height)), format: 'jpeg', quality: 80 })), list.slice(0, 2).map((x) => x.page));
    return {
      content: [
        { type: 'text', text: JSON.stringify({ files: saved.map((s) => ({ name: s.name, size: s.size, ...where(s) })) }) },
        ...saved.map(link),
        ...previews.map((p) => ({ type: 'image' as const, data: b64(p), mimeType: 'image/jpeg' })),
      ],
    };
  }));

  server.registerTool('export_pdf', {
    title: 'Export as PDF',
    description: 'All pages (or some) as one PDF at the design\'s physical size, saved to Exports. Vector by default (real text in embedded fonts, sharp at any zoom, small); `raster` renders each page as an image at `dpi` (exactly like the screen).',
    inputSchema: { design_id: z.string(), pages: z.array(pageRef).optional(), raster: z.boolean().optional(), dpi: z.number().int().min(72).max(600).optional().describe('Raster only (default 300).') },
  }, safe(async ({ design_id, pages, raster, dpi }) => {
    const file = await ctx.open(design_id);
    const ids = pages?.map((p) => pageOf(file.doc, p).page.id);
    const bytes = await withRenderer(file, (r) => (raster ? exportPdf(r, file.doc, { dpi: dpi ?? 300, ...(ids ? { pages: ids } : {}) }) : exportVectorPdf(r, file.doc, { assets: file.assets, ...(ids ? { pages: ids } : {}) })));
    const res = await ctx.ws.saveExport(`${safeName(file.doc.title)}.pdf`, bytes, 'application/pdf');
    return { content: [{ type: 'text', text: JSON.stringify({ name: res.name, size: res.size, ...where(res), pages: ids?.length ?? file.doc.pages.filter((p) => !p.hidden).length }) }, link(res)] };
  }));

  server.registerTool('export_gif', {
    title: 'Export as GIF',
    description: 'An animated GIF: each page plays its animations and holds (video designs use page durations; clips show their poster). Saved to Exports; small GIFs are also returned inline.',
    inputSchema: { design_id: z.string(), pages: z.array(pageRef).optional(), size: z.number().int().min(64).max(1600).optional().describe('Longest side (default 800).'), fps: z.number().int().min(4).max(30).optional() },
  }, safe(async ({ design_id, pages, size, fps }) => {
    const file = await ctx.open(design_id);
    const ids = pages?.map((p) => pageOf(file.doc, p).page.id);
    const bytes = await exportGif(file, { pages: ids, maxSide: size, fps });
    const res = await ctx.ws.saveExport(`${safeName(file.doc.title)}.gif`, bytes, 'image/gif');
    return { content: [{ type: 'text', text: JSON.stringify({ name: res.name, size: res.size, ...where(res) }) }, link(res), ...(bytes.length < 1_500_000 ? [{ type: 'image' as const, data: b64(bytes), mimeType: 'image/gif' }] : [])] };
  }));

  server.registerTool('export_video', {
    title: 'Export as MP4',
    description: 'Render the design as an MP4 (H.264 + AAC; 30 fps; animations, transitions, clips, music, captions) and save it to Exports. Waits up to `wait_seconds` (default 50); a longer render keeps going — then poll get_export with the job id.',
    inputSchema: {
      design_id: z.string(), fps: z.number().int().min(10).max(60).optional(),
      max_side: z.number().int().min(240).max(3840).optional().describe('Longest side in px (default 1920 = 1080p).'),
      wait_seconds: z.number().min(0).max(300).optional(),
      name: z.string().optional(),
    },
  }, safe(async ({ design_id, fps, max_side, wait_seconds, name }, extra) => {
    const file: ProjectFile = await ctx.open(design_id);
    const total = totalDuration(file.doc);
    if (!ctx.remote && !ffmpeg()) throw new ToolError('video export needs ffmpeg on this machine', 'install ffmpeg (macOS: brew install ffmpeg; Debian/Ubuntu: apt install ffmpeg) or run `npm i -g ffmpeg-static`, or set DC_FFMPEG=/path/to/ffmpeg — or export_gif instead');
    if (total > 600) throw new ToolError(`the video is ${round(total)}s; exports are limited to 10 minutes`);
    const report = progress(extra);
    const spec: JobSpec = { kind: 'video', designId: design_id, ...(fps ? { fps } : {}), ...(max_side ? { maxSide: max_side } : {}), ...(name ? { name } : {}) };
    const id = await jobs.start(spec, (p) => runJob(ctx.ws, spec, (x) => { p(x); report(x); }));
    const st = await waitFor(jobs, id, (wait_seconds ?? (ctx.remote ? 40 : 50)) * 1000);
    if (!st) throw new Error('the export job was lost');
    if (st.state === 'failed') throw new Error(`video export failed: ${st.error}`);
    if (st.state === 'done' && st.result) return { content: [{ type: 'text', text: JSON.stringify({ ...jobView(st), duration: round(total) }) }, link(st.result)] };
    return json({ ...jobView(st), duration: round(total), next: `still rendering: call get_export { job_id: "${id}" } in a little while` });
  }));

  server.registerTool('get_export', {
    title: 'Export status',
    description: 'Status of a video export started by export_video; returns the link when done. Waits up to `wait_seconds` (default 30).',
    inputSchema: { job_id: z.string(), wait_seconds: z.number().min(0).max(120).optional() },
    annotations: { readOnlyHint: true },
  }, safe(async ({ job_id, wait_seconds }) => {
    const st = await waitFor(jobs, job_id, (wait_seconds ?? 30) * 1000);
    if (!st) throw new ToolError(`no export job "${job_id}"`, 'jobs are kept for a while after they finish; start a new export_video');
    if (st.state === 'done' && st.result) return { content: [{ type: 'text', text: JSON.stringify(jobView(st)) }, link(st.result)] };
    return json(jobView(st));
  }));
}
