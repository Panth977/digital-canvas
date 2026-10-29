/**
 * Putting panel content into the design: graphics as vector paths (or a
 * picture when our SVG reader can't draw them exactly), photos as image
 * assets, videos as video elements and sounds as audio clips. Downloads show
 * progress on their tile and respect a size limit. Every asset keeps its
 * credit (title, author, licence, source page) as its name.
 */
import { LINES, type EditorState } from '../editor.svelte.ts';
import { COMBOS } from './combos.ts';
import { insertCombo } from './text.ts';
import { download, mb, TooLargeError } from './http.ts';
import { iconSvg, isSimpleSvg } from './iconify.ts';
import { resolveNasa } from './nasa.ts';
import { remember } from './recent.ts';
import type { Item } from './types.ts';
import { creditLine, mimeFor } from './util.ts';

export { creditLine };

export const LIMITS = { photo: 30 * 1048576, video: 120 * 1048576, audio: 50 * 1048576 };

/** Downloads in flight: item key → progress 0..1 (−1 while the size is unknown). */
export const progress: Record<string, number> = $state({});
/** Last problem, shown under the panel's search box. */
export const notice = $state({ text: '' });

/** The SVG text of an Iconify item. */
export const svgOf = (item: Item): Promise<string> => iconSvg(item.icon!);

/** Draw an SVG to a PNG `size` px on its long side (for graphics with gradients and such). */
export async function rasterize(svg: string, size = 1024): Promise<Uint8Array> {
  const vb = /viewBox=["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(svg);
  const vw = vb ? Number(vb[3]) : 24, vh = vb ? Number(vb[4]) : 24;
  const s = size / Math.max(vw, vh);
  const w = Math.round(vw * s), h = Math.round(vh * s);
  const sized = svg.replace(/<svg\b([^>]*)>/i, (_m, a: string) => `<svg${a.replace(/\s(width|height)=["'][^"']*["']/gi, '')} width="${w}" height="${h}">`);
  const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = new OffscreenCanvas(w, h);
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function fetchMedia(item: Item, kind: 'image' | 'video' | 'audio', limit: number): Promise<{ bytes: Uint8Array; mime: string }> {
  const urls = [item.url, item.fallback].filter((u): u is string => !!u);
  let last: unknown = new Error('nothing to download');
  for (const url of urls) {
    try {
      const got = await download(url, { maxBytes: limit, onProgress: (p) => (progress[item.key] = p) });
      const mime = mimeFor(url, got.mime, kind);
      if (!mime.startsWith(`${kind}/`)) throw new Error(`not ${kind === 'image' ? 'an' : 'a'} ${kind} (${got.mime || 'unknown type'})`);
      return { bytes: got.bytes, mime };
    } catch (e) {
      last = e;
      // a too-large photo can still use the smaller fallback; a video can't
      if (e instanceof TooLargeError && kind !== 'image') break;
    }
  }
  throw last;
}

/**
 * Add `item` to the design (at a page point when dropped). An image dropped
 * on a frame fills the frame. Returns false and sets `notice` on failure.
 */
export async function insertItem(ed: EditorState, item: Item, at?: { x: number; y: number }, frameId?: string | null): Promise<boolean> {
  if (item.key in progress) return false;
  notice.text = '';
  progress[item.key] = -1;
  try {
    if (item.icon) {
      const svg = await svgOf(item);
      const name = item.credit.license.startsWith('CC') ? `${item.icon} · ${creditLine(item.credit)}` : item.icon;
      if (isSimpleSvg(svg)) {
        if (!ed.addSvg(svg, name, '#1f2328', at)) throw new Error('nothing to draw in this graphic');
      } else {
        const id = await ed.addAsset(await rasterize(svg), 'image/png', name);
        if (!id) throw new Error("couldn't draw this graphic");
        frameId ? ed.fillFrame(frameId, id) : ed.addImageAsset(id, at);
      }
    } else {
      const full = item.source === 'nasa' ? await resolveNasa(item) : item;
      if (full.kind === 'video') {
        const { bytes, mime } = await fetchMedia(full, 'video', LIMITS.video);
        if (!(await ed.addVideoBytes(bytes, mime, creditLine(full.credit), at))) throw new Error("this browser can't play the video");
      } else if (full.kind === 'audio') {
        const { bytes, mime } = await fetchMedia(full, 'audio', LIMITS.audio);
        if (!(await ed.addAudioBytes(bytes, mime, creditLine(full.credit), full.title))) throw new Error("this browser can't play the sound");
      } else {
        const { bytes, mime } = await fetchMedia(full, 'image', LIMITS.photo);
        const id = await ed.addAsset(bytes, mime, creditLine(full.credit));
        if (!id) throw new Error("couldn't read the picture");
        frameId ? ed.fillFrame(frameId, id) : ed.addImageAsset(id, at);
      }
    }
    remember('content', item.key, item);
    return true;
  } catch (e) {
    const why = e instanceof TooLargeError ? e.message : e instanceof Error ? e.message : String(e);
    notice.text = `Couldn't add "${item.title}": ${why}`;
    return false;
  } finally {
    delete progress[item.key];
  }
}

export const DRAG_TYPE = 'application/x-digital-canvas';

/** Start dragging a result toward the page. */
export function dragItem(e: DragEvent, item: Item): void {
  e.dataTransfer?.setData(DRAG_TYPE, JSON.stringify({ kind: 'content', item }));
  if (item.thumb && e.dataTransfer) e.dataTransfer.setData('text/uri-list', item.thumb);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
}

/**
 * The canvas hands drops it doesn't know to this. Returns true when it was
 * panel content (and has been added).
 */
export async function handlePanelDrop(ed: EditorState, data: string, at: { x: number; y: number }, frameId: string | null): Promise<boolean> {
  let d: { kind?: string; item?: Item; id?: string };
  try {
    d = JSON.parse(data);
  } catch {
    return false;
  }
  if (d.kind === 'content' && d.item) {
    await insertItem(ed, d.item, at, frameId);
    return true;
  }
  if (d.kind === 'combo' && d.id) {
    const combo = COMBOS.find((c) => c.id === d.id);
    if (combo) await insertCombo(ed, combo, at);
    return true;
  }
  if (d.kind === 'line' && d.id) {
    const l = LINES.find((x) => x.id === d.id);
    if (l) ed.addLine(l, at);
    return true;
  }
  if (d.kind === 'ai' && d.id) {
    // a generated image / video tile from the AI panel
    const { studio } = await import('../ai/media.svelte.ts');
    return studio.insert(ed, d.id, at);
  }
  if (d.kind === 'frame' && d.id) {
    ed.addFrame(d.id, at);
    return true;
  }
  return false;
}

export { mb };
