/**
 * Make a `.dcanvas` video design from a video file (e.g. Canva's MP4 export of a video design whose
 * parts the Canva API can't list): one page as long as the clip, the clip filling it, its sound kept.
 *
 *   npx tsx tools/video-to-dcanvas.ts <video.mp4> <poster.png> <out.dcanvas> [title]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createDoc, video } from '@digital-canvas/scene';
import { assetId, pack } from '@digital-canvas/storage';

const [file, posterFile, out, title = 'Video'] = process.argv.slice(2);
if (!file || !posterFile || !out) throw new Error('usage: tsx tools/video-to-dcanvas.ts <video> <poster.png> <out.dcanvas> [title]');
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]).toString());
const vs = probe.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
const width = Number(vs.width), height = Number(vs.height), duration = Number(probe.format.duration);
const bytes = new Uint8Array(readFileSync(file));
const poster = new Uint8Array(readFileSync(posterFile));
const id = await assetId(bytes, 'video/mp4');
let doc = createDoc({ width, height, title });
doc = {
  ...doc,
  assets: {
    [id]: { mime: 'video/mp4', width, height, duration, name: `${title}.mp4` },
    [`${id}.poster`]: { mime: 'image/png', width, height, name: `${title} (poster)` },
  },
  pages: [{ ...doc.pages[0]!, duration: Math.round(duration * 1000) / 1000, elements: [{ ...video(id, { x: 0, y: 0, w: width, h: height }), name: 'Video' }] }],
};
writeFileSync(out, pack({ doc, assets: new Map([[id, bytes], [`${id}.poster`, poster]]) }));
console.log(`wrote ${out}: ${width}×${height}, ${duration.toFixed(1)} s`);
