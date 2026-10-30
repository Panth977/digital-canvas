/**
 * The image tools that need more than a slider: on-device models (background,
 * subject, inpainting), the mask brush, and the ones that use the user's own AI
 * key. Every result is a new asset plus an element patch through `ed.commit`,
 * so undo, autosave and exports just work; the first picture stays in `original`.
 */
import { autoAdjust, coverCrop, pictureStats, subjectCrop, updateElements, type ImageElement, type ImageLook } from '@digital-canvas/scene';
import type { EditorState } from '../editor.svelte.ts';
import { download } from '../files.ts';
import { expandLayout, subjectBox } from './matte.ts';
import { aiSettings, type Choice } from '../ai/settings.svelte.ts';
import type { Media, Provider } from '../ai/types.ts';

export type BrushTool = 'bg' | 'blur' | 'erase' | 'edit';

/** Which keys can edit pictures: a provider with `editImage`. */
export function editProvider(): { provider: Provider; model: string; label: string } | null {
  const chosen: Choice | null = aiSettings.choice('image');
  const ok = (c: Choice | null) => (c && aiSettings.provider(c.provider).editImage ? c : null);
  let c = ok(chosen);
  if (!c) {
    for (const p of aiSettings.providers) {
      const m = aiSettings.modelsFor(p.id, 'image')[0];
      if (m && aiSettings.provider(p.id).editImage) { c = { provider: p.id, model: m.id }; break; }
    }
  }
  return c ? { provider: aiSettings.provider(c.provider), model: c.model, label: aiSettings.get(c.provider)?.label ?? c.provider } : null;
}

/** Injected by tests instead of a provider. */
export const editHook: { fn: ((image: Media, mask: Media, prompt: string) => Promise<Media>) | null } = { fn: null };

/** The selected image. */
export function selectedImage(ed: EditorState): ImageElement | null {
  const el = ed.selected.find((e) => e.type === 'image');
  return el && el.type === 'image' ? el : null;
}

/** Show progress and errors in the panel while a tool runs. */
export async function busy<T>(ed: EditorState, start: string, job: () => Promise<T>): Promise<T | undefined> {
  if (ed.bgStatus) return undefined;
  ed.bgError = '';
  ed.bgStatus = { msg: start };
  try {
    return await job();
  } catch (err) {
    ed.bgError = err instanceof Error ? err.message : String(err);
    return undefined;
  } finally {
    ed.bgStatus = null;
  }
}

const progress = (ed: EditorState) => (msg: string, fraction?: number) => { ed.bgStatus = { msg, fraction }; };

function bytesOf(ed: EditorState, asset: string): { bytes: Uint8Array; mime: string; name: string } {
  const bytes = ed.assets.get(asset), meta = ed.doc.assets[asset];
  if (!bytes || !meta) throw new Error('this picture is not loaded yet');
  return { bytes, mime: meta.mime, name: meta.name ?? 'image' };
}

async function decode(bytes: Uint8Array, mime: string): Promise<ImageBitmap> {
  return createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
}

const toPng = async (c: OffscreenCanvas): Promise<Uint8Array> => new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());

/** A mask image: white with this alpha, at most `max` px on its long side. */
async function maskFrom(cut: Uint8Array, max = 1024): Promise<Uint8Array> {
  const bmp = await decode(cut, 'image/png');
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = new OffscreenCanvas(w, h), g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  return toPng(c);
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, '');

/** The subject's mask for this picture: made once, kept as an asset of the design. */
export async function ensureMatte(ed: EditorState, el: ImageElement): Promise<string> {
  if (el.matte && ed.assets.has(el.matte)) return el.matte;
  const src = bytesOf(ed, el.original ?? el.asset);
  const cut = el.original ? bytesOf(ed, el.asset).bytes : await ed.bgRemover(src.bytes, src.mime, progress(ed));
  const id = await ed.addAsset(await maskFrom(cut), 'image/png', `${baseName(src.name)} (subject).png`);
  if (!id) throw new Error('the subject mask could not be read');
  ed.commit(updateElements(ed.doc, [el.id], { matte: id }));
  ed.seal();
  return id;
}

/** Set a selective setting, finding the subject first if this picture has no mask yet. */
export async function withMatte(ed: EditorState, patch: (e: ImageElement) => ImageLook): Promise<void> {
  const el = selectedImage(ed);
  if (!el) return;
  await busy(ed, 'Finding the subject…', async () => {
    await ensureMatte(ed, el);
    ed.updateLook((e) => patch(e as ImageElement));
    ed.seal();
  });
}

/** Auto-adjust: read the picture and fill in the corrections at full intensity. */
export async function runAutoAdjust(ed: EditorState): Promise<void> {
  const el = selectedImage(ed);
  if (!el) return;
  const { bytes, mime } = bytesOf(ed, el.asset);
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }), { resizeWidth: 96, resizeHeight: 96 });
  const c = new OffscreenCanvas(96, 96), g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  bmp.close();
  ed.updateLook({ auto: { adjust: autoAdjust(pictureStats(g.getImageData(0, 0, 96, 96).data)), intensity: 100 } });
  ed.seal();
}

/** Magic Crop: frame the subject, keeping the element's shape. */
export async function magicCrop(ed: EditorState): Promise<void> {
  const el = selectedImage(ed);
  if (!el) return;
  await busy(ed, 'Finding the subject…', async () => {
    const id = await ensureMatte(ed, el);
    const m = bytesOf(ed, id), info = ed.doc.assets[el.asset];
    const bmp = await decode(m.bytes, 'image/png');
    const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(bmp, 0, 0);
    const px = g.getImageData(0, 0, bmp.width, bmp.height).data, a = new Uint8Array(bmp.width * bmp.height);
    for (let i = 0; i < a.length; i++) a[i] = px[i * 4 + 3]!;
    const box = subjectBox(a, bmp.width, bmp.height);
    bmp.close();
    if (!box) throw new Error('no clear subject found');
    ed.commit(updateElements(ed.doc, [el.id], { crop: subjectCrop(box, info?.width ?? 1, info?.height ?? 1, el.w / el.h) }));
    ed.seal();
  });
}

/** Swap a picture for a new one of the same size, keeping the very first in `original`. */
async function replaceWith(ed: EditorState, el: ImageElement, png: Uint8Array, label: string): Promise<void> {
  const name = ed.doc.assets[el.asset]?.name ?? 'image';
  const id = await ed.addAsset(png, 'image/png', `${baseName(name)} (${label}).png`);
  if (!id) throw new Error('the result could not be read');
  ed.commit(updateElements(ed.doc, [el.id], (e) => (e.type === 'image' ? { asset: id, original: e.original ?? e.asset } : {})));
  ed.seal();
}

/** Magic Eraser with a painted mask. */
export async function eraseMasked(ed: EditorState, el: ImageElement, mask: Uint8Array): Promise<void> {
  await busy(ed, 'Erasing…', async () => {
    const { bytes, mime } = bytesOf(ed, el.asset);
    await replaceWith(ed, el, await ed.inpainter(bytes, mime, mask, progress(ed)), 'erased');
  });
}

/** Magic Grab: the subject becomes its own element, and the picture is filled in behind it. */
export async function magicGrab(ed: EditorState): Promise<void> {
  const el = selectedImage(ed);
  if (!el) return;
  await busy(ed, 'Grabbing the subject…', async () => {
    const { bytes, mime, name } = bytesOf(ed, el.asset);
    const cut = await ed.bgRemover(bytes, mime, progress(ed));
    const filled = await ed.inpainter(bytes, mime, await maskFrom(cut, 4096), progress(ed));
    const cutId = await ed.addAsset(cut, 'image/png', `${baseName(name)} (subject).png`);
    if (!cutId) throw new Error('the cut-out could not be read');
    await replaceWith(ed, el, filled, 'without subject');
    const copy = ed.overlayCopy(el.id, { asset: cutId, original: undefined, matte: undefined, name: 'Subject' });
    if (copy) ed.select([copy]);
    ed.seal();
  });
}

/** Grab Text: words read from the picture (Tesseract, Apache-2.0, on the device) become editable text. */
export interface OcrLine { text: string; x: number; y: number; w: number; h: number; color: string }
export type Ocr = (bytes: Uint8Array, mime: string, onProgress: (msg: string, f?: number) => void) => Promise<OcrLine[]>;

const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/+esm';

export const tesseractOcr: Ocr = async (bytes, mime, onProgress) => {
  const T = (await import(/* @vite-ignore */ TESS_URL)) as unknown as { createWorker: (lang: string, oem: number, opts: Record<string, unknown>) => Promise<{ recognize(i: Blob, o?: object, out?: object): Promise<{ data: { blocks?: { paragraphs: { lines: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[] }[] }[] } }>; terminate(): Promise<void> }> };
  const w = await T.createWorker('eng', 1, { logger: (m: { status: string; progress: number }) => onProgress(`Reading the text: ${m.status}`, m.progress) });
  try {
    const blob = new Blob([bytes as BlobPart], { type: mime });
    const { data } = await w.recognize(blob, {}, { blocks: true });
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(bmp, 0, 0);
    const out: OcrLine[] = [];
    for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) {
      const text = l.text.trim();
      if (!text || l.confidence < 55) continue;
      const { x0, y0, x1, y1 } = l.bbox;
      const px = g.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data;
      out.push({ text, x: x0 / bmp.width, y: y0 / bmp.height, w: (x1 - x0) / bmp.width, h: (y1 - y0) / bmp.height, color: inkColor(px) });
    }
    bmp.close();
    return out;
  } finally {
    await w.terminate();
  }
};

/** The text's colour: the mean of the pixels furthest from the box's mean tone. */
export function inkColor(px: ArrayLike<number>): string {
  let n = 0, sum = 0;
  const tone = (i: number) => 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!;
  for (let i = 0; i < px.length; i += 4) { sum += tone(i); n++; }
  const mean = sum / Math.max(1, n);
  let far = 0;
  for (let i = 0; i < px.length; i += 4) far = Math.max(far, Math.abs(tone(i) - mean));
  let r = 0, g = 0, b = 0, k = 0;
  for (let i = 0; i < px.length; i += 4) if (Math.abs(tone(i) - mean) > far * 0.7) { r += px[i]!; g += px[i + 1]!; b += px[i + 2]!; k++; }
  const hex = (v: number) => Math.round(v / Math.max(1, k)).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export async function grabText(ed: EditorState): Promise<void> {
  const el = selectedImage(ed);
  if (!el) return;
  await busy(ed, 'Reading the text…', async () => {
    const { bytes, mime } = bytesOf(ed, el.asset);
    const lines = await ed.ocr(bytes, mime, progress(ed));
    if (!lines.length) throw new Error('no text found in this picture');
    // fill in behind the words, then lay them over the picture as text
    const info = ed.doc.assets[el.asset], iw = info?.width ?? el.w, ih = info?.height ?? el.h;
    const mc = new OffscreenCanvas(iw, ih), mg = mc.getContext('2d')!;
    mg.fillStyle = '#fff';
    for (const l of lines) mg.fillRect(l.x * iw - 2, l.y * ih - 2, l.w * iw + 4, l.h * ih + 4);
    await replaceWith(ed, el, await ed.inpainter(bytes, mime, await toPng(mc), progress(ed)), 'without text');
    const crop = el.crop ?? coverCrop(iw, ih, el.w, el.h);
    const sx = el.w / crop.w, sy = el.h / crop.h;
    const ids: string[] = [];
    for (const l of lines) {
      const x = el.x + (l.x - crop.x) * sx, y = el.y + (l.y - crop.y) * sy;
      ids.push(ed.addTextAt(l.text, x, y, l.w * sx, l.h * sy * 0.82, l.color));
    }
    ed.select(ids);
    ed.seal();
  });
}

/** Run the user's image model on a picture and a mask; the mask's clear parts are what changes. */
async function askEdit(ed: EditorState, image: Media, mask: Media, prompt: string): Promise<Media> {
  if (editHook.fn) return editHook.fn(image, mask, prompt);
  const p = editProvider();
  if (!p) throw new Error('this needs an image key from OpenAI or Google. Add one in File › Settings › AI and devices.');
  return p.provider.editImage!({ model: p.model, prompt, image, mask, onProgress: (x) => (ed.bgStatus = { msg: x.message, fraction: x.fraction ?? undefined }) });
}

/** Magic Edit: replace the painted part from a prompt. Only that part of the picture changes. */
export async function magicEdit(ed: EditorState, el: ImageElement, maskAlpha: Uint8Array, prompt: string): Promise<void> {
  await busy(ed, 'Editing…', async () => {
    const { bytes, mime } = bytesOf(ed, el.asset);
    const bmp = await decode(bytes, mime), mbmp = await decode(maskAlpha, 'image/png');
    const iw = bmp.width, ih = bmp.height;
    const png = new OffscreenCanvas(iw, ih);
    png.getContext('2d')!.drawImage(bmp, 0, 0);
    // providers want a mask that is clear where they may paint
    const hole = new OffscreenCanvas(iw, ih), hg = hole.getContext('2d')!;
    hg.fillStyle = '#000';
    hg.fillRect(0, 0, iw, ih);
    hg.globalCompositeOperation = 'destination-out';
    hg.drawImage(mbmp, 0, 0, iw, ih);
    const res = await askEdit(ed, { bytes: await toPng(png), mime: 'image/png' }, { bytes: await toPng(hole), mime: 'image/png' }, prompt);
    const out = await decode(res.bytes, res.mime);
    const patch = new OffscreenCanvas(iw, ih), pg = patch.getContext('2d')!;
    pg.drawImage(out, 0, 0, iw, ih);
    pg.globalCompositeOperation = 'destination-in';
    pg.drawImage(mbmp, 0, 0, iw, ih);
    const g = png.getContext('2d')!;
    g.drawImage(patch, 0, 0);
    bmp.close(); mbmp.close(); out.close();
    await replaceWith(ed, el, await toPng(png), 'edited');
  });
}

/** Magic Expand: the picture grows to a new shape and the model paints what is new. */
export async function magicExpand(ed: EditorState, aspect: number, prompt = ''): Promise<void> {
  const el = selectedImage(ed);
  if (!el) return;
  await busy(ed, 'Expanding…', async () => {
    const { bytes, mime, name } = bytesOf(ed, el.asset);
    const bmp = await decode(bytes, mime);
    const L = expandLayout(bmp.width, bmp.height, aspect);
    if (L.w === bmp.width && L.h === bmp.height) { bmp.close(); throw new Error('the picture already has this shape'); }
    const canvas = new OffscreenCanvas(L.w, L.h), g = canvas.getContext('2d')!;
    g.drawImage(bmp, L.x, L.y);
    const res = await askEdit(ed, { bytes: await toPng(canvas), mime: 'image/png' }, { bytes: await toPng(canvas), mime: 'image/png' }, `Extend this photograph outwards into the empty areas. Continue the scene naturally with matching light, colour and perspective. ${prompt}`.trim());
    const out = await decode(res.bytes, res.mime);
    const full = new OffscreenCanvas(L.w, L.h), fg = full.getContext('2d')!;
    fg.drawImage(out, 0, 0, L.w, L.h);
    fg.drawImage(bmp, L.x, L.y); // the old picture stays exact
    bmp.close(); out.close();
    const id = await ed.addAsset(await toPng(full), 'image/png', `${baseName(name)} (expanded).png`);
    if (!id) throw new Error('the result could not be read');
    const size = sizeOf(ed, el.asset), nw = el.w * (L.w / size.w), nh = el.h * (L.h / size.h);
    ed.commit(updateElements(ed.doc, [el.id], { asset: id, x: el.x - (nw - el.w) / 2, y: el.y - (nh - el.h) / 2, w: nw, h: nh, crop: undefined, matte: undefined, blurBrush: undefined, original: el.original ?? el.asset }));
    ed.seal();
  });
}

function sizeOf(ed: EditorState, asset: string): { w: number; h: number } {
  const m = ed.doc.assets[asset];
  return { w: m?.width ?? 1, h: m?.height ?? 1 };
}

/** Replace the picture, keeping its frame, look and place. */
export async function replaceImage(ed: EditorState, el: ImageElement, file: File): Promise<void> {
  const id = await ed.addAsset(new Uint8Array(await file.arrayBuffer()), file.type, file.name);
  if (!id) return;
  const m = ed.doc.assets[id];
  ed.commit(updateElements(ed.doc, [el.id], { asset: id, crop: coverCrop(m?.width ?? el.w, m?.height ?? el.h, el.w, el.h), original: undefined, matte: undefined, blurBrush: undefined, selective: undefined, autoFocus: undefined }));
  ed.seal();
}

/** "Download selection": the selected elements alone, on a transparent page, as a PNG. */
export async function downloadSelection(ed: EditorState): Promise<void> {
  const el = ed.selected;
  if (!el.length) return;
  const r = el.length === 1 ? ed.renderer.rasterElement(el[0]!, 2) : null;
  const bytes = r?.png ?? ed.exportSelection();
  await download(bytes, `${ed.doc.title || 'selection'}.png`, 'image/png');
}

