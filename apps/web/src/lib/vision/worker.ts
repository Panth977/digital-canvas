/**
 * The on-device image models, off the main thread. onnxruntime-web (MIT) comes
 * from jsDelivr (the service worker keeps it), models from Hugging Face at a
 * pinned revision (kept in the Cache API `dc-models`, so later runs work
 * offline). WebGPU when it works, else WebAssembly.
 */
import { boxBlur, coverage, dilate, feather, guidedFilter, inpaintWindow, subjectBox, type Box } from './matte.ts';

const ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/';

export interface Model {
  name: string;
  url: string;
  /** Rough download, for the first-run message. */
  mb: number;
  size: (w: number, h: number) => [number, number];
  mean: number[];
  std: number[];
  logits: boolean;
}

const fixed512 = () => [512, 512] as [number, number];

/** BiRefNet-lite (MIT, any subject) re-exported at 512 px; 1024 px runs out of memory in onnxruntime-web. */
const BIREFNET: Model = {
  name: 'BiRefNet-lite',
  url: 'https://huggingface.co/studioludens/birefnet-lite-512/resolve/962e67969ec6acec9c19fab76acee4f5e22e990c/onnx/model_fp16.onnx',
  mb: 99, size: fixed512, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], logits: true,
};

/** MODNet (Apache-2.0): people only, but small; the fallback when BiRefNet can't run on a device. */
const MODNET: Model = {
  name: 'MODNet',
  url: 'https://huggingface.co/Xenova/modnet/resolve/main/onnx/model.onnx',
  mb: 25,
  size: (w, h) => {
    const s = 512 / Math.min(w, h);
    const r32 = (v: number) => Math.max(32, Math.round((v * s) / 32) * 32);
    return [r32(w), r32(h)];
  },
  mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5], logits: false,
};

/** LaMa (Apache-2.0), fixed 512 px input. */
const LAMA: Model = {
  name: 'LaMa',
  url: 'https://huggingface.co/Carve/LaMa-ONNX/resolve/c3c0c9e468934d62e79c329e35d82dd09ff8c444/lama_fp32.onnx',
  mb: 208, size: fixed512, mean: [0, 0, 0], std: [1, 1, 1], logits: false,
};

interface OrtTensor { data: Float32Array; dims: readonly number[] }
interface OrtSession { inputNames: readonly string[]; outputNames: readonly string[]; run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>; release(): Promise<void> }
interface Ort {
  env: { wasm: { wasmPaths: string; numThreads: number }; logLevel: string };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => OrtTensor;
  InferenceSession: { create(model: Uint8Array, opts: Record<string, unknown>): Promise<OrtSession> };
}

type Progress = (msg: string, fraction?: number) => void;

let ortP: Promise<Ort> | null = null;

function loadOrt(): Promise<Ort> {
  ortP ??= (async () => {
    const ort = (await import(/* @vite-ignore */ `${ORT_URL}ort.webgpu.min.mjs`)) as Ort;
    ort.env.wasm.wasmPaths = ORT_URL;
    ort.env.wasm.numThreads = (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    ort.env.logLevel = 'error';
    return ort;
  })();
  ortP.catch(() => (ortP = null));
  return ortP;
}

async function fetchModel(m: Model, progress: Progress): Promise<Uint8Array> {
  const cache = 'caches' in self ? await caches.open('dc-models').catch(() => null) : null;
  const hit = await cache?.match(m.url);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  const res = await fetch(m.url);
  if (!res.ok || !res.body) throw new Error(`model download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || m.mb * 1e6;
  const chunks: Uint8Array[] = [];
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    progress(`Downloading ${m.name}: ${Math.round(got / 1e6)} of ${Math.round(total / 1e6)} MB, first time only`, Math.min(1, got / total));
  }
  const all = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  await cache?.put(m.url, new Response(all)).catch(() => {});
  return all;
}

/** Only one model at a time stays in memory: they are big. */
let live: { model: Model; ep: string; session: OrtSession } | null = null;

async function session(m: Model, ep: string, progress: Progress): Promise<OrtSession> {
  if (live?.model === m && live.ep === ep) return live.session;
  if (live) { await live.session.release().catch(() => {}); live = null; }
  const ort = await loadOrt();
  const bytes = await fetchModel(m, progress);
  progress(`Starting ${m.name}…`);
  const s = await ort.InferenceSession.create(bytes, { executionProviders: [ep] });
  live = { model: m, ep, session: s };
  return s;
}

const hasGpu = async (): Promise<boolean> => {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  return !!gpu && !!(await gpu.requestAdapter().catch(() => null));
};

/** Run a model on the GPU if it can, and on the CPU if that fails or gives nonsense. */
async function run<T>(m: Model, progress: Progress, job: (s: OrtSession, ort: Ort) => Promise<T>, ok: (r: T) => boolean): Promise<T> {
  const eps = (await hasGpu()) ? ['webgpu', 'wasm'] : ['wasm'];
  let last: unknown;
  for (const ep of eps) {
    try {
      const s = await session(m, ep, progress);
      const r = await job(s, await loadOrt());
      if (ok(r)) return r;
      last = new Error('the model gave no usable result');
    } catch (e) {
      last = e;
      if (live) { await live.session.release().catch(() => {}); live = null; }
    }
  }
  throw last;
}

/** An image's pixels, drawn at w×h. */
function pixels(src: CanvasImageSource, w: number, h: number): Uint8ClampedArray {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

function planar(rgba: Uint8ClampedArray, n: number, m: Model): Float32Array {
  const input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) input[k * n + i] = (rgba[i * 4 + k]! / 255 - m.mean[k]!) / m.std[k]!;
  return input;
}

async function runMatte(m: Model, bitmap: ImageBitmap, progress: Progress): Promise<{ alpha: Uint8ClampedArray; w: number; h: number }> {
  const [w, h] = m.size(bitmap.width, bitmap.height);
  const data = pixels(bitmap, w, h);
  const n = w * h;
  const input = planar(data, n, m);
  return run(m, progress, async (s, ort) => {
    progress('Finding the subject…');
    const out = (await s.run({ [s.inputNames[0]!]: new ort.Tensor('float32', input, [1, 3, h, w]) }))[s.outputNames[0]!]!;
    const d = out.data;
    const alpha = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) alpha[i] = Math.round(255 * (m.logits ? 1 / (1 + Math.exp(-d[i]!)) : d[i]!));
    return { alpha, w, h, finite: Number.isFinite(d[0]) };
  }, (r) => r.finite);
}

/** The picture with its background gone, full size, edges following the photo. */
async function cutout(bytes: Uint8Array, mime: string, progress: Progress): Promise<{ png: Uint8Array; model: string }> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
  try {
    let m = BIREFNET, res;
    try {
      res = await runMatte(BIREFNET, bitmap, progress);
    } catch (e) {
      // a device that can't hold BiRefNet still gets a remover, with a people-first model
      console.warn('BiRefNet failed, trying MODNet:', e);
      m = MODNET;
      res = await runMatte(MODNET, bitmap, progress);
    }
    if (coverage(res.alpha) < 0.002) throw new Error('no clear subject found in this picture. Try a tighter crop, or paint it by hand with Magic Grab\'s brush.');
    progress('Refining the edges…');
    const G = Math.min(2048, Math.max(bitmap.width, bitmap.height));
    const k = G / Math.max(bitmap.width, bitmap.height);
    const gw = Math.max(1, Math.round(bitmap.width * k)), gh = Math.max(1, Math.round(bitmap.height * k));
    const up = new OffscreenCanvas(res.w, res.h);
    const id = new ImageData(res.w, res.h);
    for (let i = 0; i < res.alpha.length; i++) { const v = res.alpha[i]!; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
    up.getContext('2d')!.putImageData(id, 0, 0);
    const soft = pixels(up, gw, gh), photo = pixels(bitmap, gw, gh);
    const n = gw * gh, guide = new Float32Array(n), mask = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      guide[i] = (0.2126 * photo[i * 4]! + 0.7152 * photo[i * 4 + 1]! + 0.0722 * photo[i * 4 + 2]!) / 255;
      mask[i] = soft[i * 4]! / 255;
    }
    const fine = guidedFilter(guide, mask, gw, gh, Math.max(2, Math.round(Math.max(gw, gh) / 256)), 1e-4);
    // the model decides inside and outside; the filter only reshapes the uncertain edge
    const band = boxBlur(mask.map((v) => (v > 0.02 && v < 0.98 ? 1 : 0)), gw, gh, 3);
    const am = new OffscreenCanvas(gw, gh);
    const ad = new ImageData(gw, gh);
    for (let i = 0; i < n; i++) ad.data[i * 4 + 3] = Math.round((band[i]! > 0 ? fine[i]! : mask[i]!) * 255);
    am.getContext('2d')!.putImageData(ad, 0, 0);
    const out = new OffscreenCanvas(bitmap.width, bitmap.height);
    const g = out.getContext('2d')!;
    g.drawImage(bitmap, 0, 0);
    g.globalCompositeOperation = 'destination-in';
    g.imageSmoothingQuality = 'high';
    g.drawImage(am, 0, 0, bitmap.width, bitmap.height);
    const png = new Uint8Array(await (await out.convertToBlob({ type: 'image/png' })).arrayBuffer());
    return { png, model: m.name };
  } finally {
    bitmap.close();
  }
}

async function runLama(rgba: Uint8ClampedArray, mask: Uint8Array, progress: Progress): Promise<Float32Array> {
  const S = 512, n = S * S, im = new Float32Array(3 * n), ma = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) im[k * n + i] = rgba[i * 4 + k]! / 255;
    ma[i] = mask[i]! > 127 ? 1 : 0;
  }
  return run(LAMA, progress, async (s, ort) => {
    progress('Filling in the picture…');
    const r = await s.run({ [s.inputNames[0]!]: new ort.Tensor('float32', im, [1, 3, S, S]), [s.inputNames[1]!]: new ort.Tensor('float32', ma, [1, 1, S, S]) });
    return r[s.outputNames[0]!]!.data; // 0..255, CHW
  }, (d) => Number.isFinite(d[0]) && d.some((v) => v > 1));
}

/**
 * Fill the masked part of a picture. Only a window around the mask goes through
 * the model, so a small repair stays sharp on a big photo, and the patch is
 * feathered in: everything else keeps its exact pixels.
 */
async function inpaint(bytes: Uint8Array, mime: string, maskBytes: Uint8Array, progress: Progress): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
  const maskBmp = await createImageBitmap(new Blob([maskBytes as BlobPart], { type: 'image/png' }));
  try {
    const iw = bitmap.width, ih = bitmap.height;
    // mask at full size (alpha = where to fill), with a margin so the object's edge goes too
    const mc = new OffscreenCanvas(iw, ih);
    const mg = mc.getContext('2d', { willReadFrequently: true })!;
    mg.drawImage(maskBmp, 0, 0, iw, ih);
    const raw = mg.getImageData(0, 0, iw, ih).data;
    const a = new Uint8Array(iw * ih);
    for (let i = 0; i < a.length; i++) a[i] = raw[i * 4 + 3]! > 40 ? 255 : 0;
    const margin = Math.max(2, Math.round(Math.max(iw, ih) / 300));
    const grown = dilate(a, iw, ih, margin);
    const box = subjectBox(grown, iw, ih);
    if (!box) throw new Error('nothing was brushed');
    const px: Box = { x: box.x * iw, y: box.y * ih, w: box.w * iw, h: box.h * ih };
    const win = inpaintWindow(px, iw, ih);
    const S = 512;
    const src = new OffscreenCanvas(S, S), sg = src.getContext('2d', { willReadFrequently: true })!;
    sg.imageSmoothingQuality = 'high';
    sg.drawImage(bitmap, win.x, win.y, win.w, win.h, 0, 0, S, S);
    const rgba = sg.getImageData(0, 0, S, S).data;
    const gm = new OffscreenCanvas(iw, ih);
    const gd = new ImageData(iw, ih);
    for (let i = 0; i < grown.length; i++) gd.data[i * 4 + 3] = grown[i]!;
    gm.getContext('2d')!.putImageData(gd, 0, 0);
    const small = new OffscreenCanvas(S, S), sm = small.getContext('2d', { willReadFrequently: true })!;
    sm.drawImage(gm, win.x, win.y, win.w, win.h, 0, 0, S, S);
    const sd = sm.getImageData(0, 0, S, S).data, mask512 = new Uint8Array(S * S);
    for (let i = 0; i < mask512.length; i++) mask512[i] = sd[i * 4 + 3]! > 20 ? 255 : 0;
    const res = await runLama(rgba, mask512, progress);
    progress('Blending it in…');
    const n = S * S, out = new ImageData(S, S);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) out.data[i * 4 + k] = res[k * n + i]!;
      out.data[i * 4 + 3] = 255;
    }
    const patch = new OffscreenCanvas(S, S);
    patch.getContext('2d')!.putImageData(out, 0, 0);
    // the patch at window size, cut by the feathered mask
    const wc = new OffscreenCanvas(win.w, win.h), wg = wc.getContext('2d')!;
    wg.imageSmoothingQuality = 'high';
    wg.drawImage(patch, 0, 0, win.w, win.h);
    const soft = feather(grown, iw, ih, Math.max(1, Math.round(margin / 2)));
    const fd = new ImageData(iw, ih);
    for (let i = 0; i < soft.length; i++) fd.data[i * 4 + 3] = soft[i]!;
    const fc = new OffscreenCanvas(iw, ih);
    fc.getContext('2d')!.putImageData(fd, 0, 0);
    wg.globalCompositeOperation = 'destination-in';
    wg.drawImage(fc, win.x, win.y, win.w, win.h, 0, 0, win.w, win.h);
    const result = new OffscreenCanvas(iw, ih), rg = result.getContext('2d')!;
    rg.drawImage(bitmap, 0, 0);
    rg.drawImage(wc, win.x, win.y);
    return new Uint8Array(await (await result.convertToBlob({ type: 'image/png' })).arrayBuffer());
  } finally {
    bitmap.close();
    maskBmp.close();
  }
}

export type VisionRequest =
  | { id: number; op: 'cutout'; bytes: Uint8Array; mime: string }
  | { id: number; op: 'inpaint'; bytes: Uint8Array; mime: string; mask: Uint8Array };

export type VisionReply =
  | { id: number; progress: { msg: string; fraction?: number } }
  | { id: number; result: Uint8Array; model?: string }
  | { id: number; error: string };

self.onmessage = async (e: MessageEvent<VisionRequest>) => {
  const q = e.data;
  const post = (r: VisionReply, tr: Transferable[] = []) => (self as unknown as Worker).postMessage(r, tr);
  const progress: Progress = (msg, fraction) => post({ id: q.id, progress: { msg, fraction } });
  try {
    if (q.op === 'cutout') {
      const { png, model } = await cutout(q.bytes, q.mime, progress);
      post({ id: q.id, result: png, model }, [png.buffer as ArrayBuffer]);
    } else {
      const png = await inpaint(q.bytes, q.mime, q.mask, progress);
      post({ id: q.id, result: png }, [png.buffer as ArrayBuffer]);
    }
  } catch (err) {
    post({ id: q.id, error: err instanceof Error ? err.message : String(err) });
  }
};
