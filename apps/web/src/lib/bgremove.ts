/**
 * Background remover, run in the browser with onnxruntime-web (MIT, from
 * jsDelivr) and an open model from Hugging Face, both loaded on first use. The
 * model is kept in the Cache API, so later runs work offline.
 *
 * The model is MODNet (Apache-2.0, https://github.com/ZHKKKe/MODNet): 25 MB,
 * a few seconds on the CPU (in a worker). It is trained for people, but does
 * well on clear subjects.
 *
 * TODO: BiRefNet-lite (MIT, any subject, `BIREFNET` below) is the better model,
 * but at its fixed 1024×1024 input onnxruntime-web 1.31 runs out of memory
 * (std::bad_alloc) on the CPU and on WebGPU (tested on Apple Metal). Switch
 * `MODEL` when a runtime manages it (or with a 64-bit WebAssembly build).
 *
 * `EditorState.bgRemover` can swap in another remover (tests use a stub).
 */

export type Progress = (msg: string, fraction?: number) => void;

/** Turns an encoded image into a PNG of the same size with the background transparent. */
export type BackgroundRemover = (bytes: Uint8Array, mime: string, progress?: Progress) => Promise<Uint8Array>;

const ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/';

export interface Model {
  name: string;
  url: string;
  /** Input size for an image (the model's fixed size, or a multiple of 32). */
  size: (w: number, h: number) => [number, number];
  mean: number[];
  std: number[];
  /** Output is logits (else already 0..1). */
  logits: boolean;
}

export const BIREFNET: Model = {
  name: 'BiRefNet-lite',
  url: 'https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model_fp16.onnx',
  size: () => [1024, 1024],
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
  logits: true,
};

export const MODNET: Model = {
  name: 'MODNet',
  url: 'https://huggingface.co/Xenova/modnet/resolve/main/onnx/model.onnx',
  size: (w, h) => {
    const s = 512 / Math.min(w, h);
    const r32 = (v: number) => Math.max(32, Math.round((v * s) / 32) * 32);
    return [r32(w), r32(h)];
  },
  mean: [0.5, 0.5, 0.5],
  std: [0.5, 0.5, 0.5],
  logits: false,
};

/* Just the parts of onnxruntime-web we use (loaded from the CDN, so no package types). */
interface OrtTensor { data: Float32Array | Uint16Array; dims: readonly number[]; type: string }
interface OrtSession { inputNames: readonly string[]; outputNames: readonly string[]; run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>> }
interface Ort {
  env: { wasm: { wasmPaths: string; proxy: boolean } };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => OrtTensor;
  InferenceSession: { create(model: Uint8Array, opts: Record<string, unknown>): Promise<OrtSession> };
}

/** The model the editor uses. */
const MODEL = MODNET;

let ortP: Promise<Ort> | null = null;
const sessions = new Map<Model, Promise<OrtSession>>();

function loadOrt(): Promise<Ort> {
  ortP ??= (async () => {
    const ort = (await import(/* @vite-ignore */ `${ORT_URL}ort.min.mjs`)) as Ort;
    ort.env.wasm.wasmPaths = ORT_URL;
    ort.env.wasm.proxy = true; // run in a worker, so the page stays responsive
    return ort;
  })();
  ortP.catch(() => (ortP = null));
  return ortP;
}

async function fetchModel(m: Model, progress?: Progress): Promise<Uint8Array> {
  const cache = 'caches' in globalThis ? await caches.open('dc-models').catch(() => null) : null;
  const hit = await cache?.match(m.url);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  const res = await fetch(m.url);
  if (!res.ok || !res.body) throw new Error(`model download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const chunks: Uint8Array[] = [];
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    progress?.(`Downloading ${m.name} (${Math.round(got / 1e6)} MB, first time only)`, total ? got / total : undefined);
  }
  const all = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  await cache?.put(m.url, new Response(all)).catch(() => {});
  return all;
}

function session(m: Model, progress?: Progress): Promise<OrtSession> {
  let s = sessions.get(m);
  if (!s) {
    s = (async () => {
      const ort = await loadOrt();
      const bytes = await fetchModel(m, progress);
      progress?.(`Starting ${m.name}…`);
      return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
    })();
    s.catch(() => sessions.delete(m));
    sessions.set(m, s);
  }
  return s;
}

/** Run one model: an alpha mask (0..255) at the model's input size. */
async function mask(m: Model, bitmap: ImageBitmap, progress?: Progress): Promise<{ alpha: Uint8ClampedArray; w: number; h: number }> {
  const s = await session(m, progress);
  const ort = await loadOrt();
  progress?.('Removing the background…');
  const [w, h] = m.size(bitmap.width, bitmap.height);
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bitmap, 0, 0, w, h);
  const rgba = g.getImageData(0, 0, w, h).data;
  const n = w * h;
  const input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) input[k * n + i] = (rgba[i * 4 + k]! / 255 - m.mean[k]!) / m.std[k]!;
  const out = (await s.run({ [s.inputNames[0]!]: new ort.Tensor('float32', input, [1, 3, h, w]) }))[s.outputNames[0]!]!;
  const data = out.data as Float32Array;
  const alpha = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) alpha[i] = Math.round(255 * (m.logits ? 1 / (1 + Math.exp(-data[i]!)) : data[i]!));
  return { alpha, w, h };
}

/** The built-in remover. */
export const removeBackground: BackgroundRemover = async (bytes, mime, progress) => {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
  try {
    progress?.('Loading the background remover…');
    const m = await mask(MODEL, bitmap, progress);
    // the mask, stretched back to the image, keeps only the subject
    const mc = new OffscreenCanvas(m.w, m.h);
    const md = new ImageData(m.w, m.h);
    for (let i = 0; i < m.alpha.length; i++) md.data[i * 4 + 3] = m.alpha[i]!;
    mc.getContext('2d')!.putImageData(md, 0, 0);
    const out = new OffscreenCanvas(bitmap.width, bitmap.height);
    const g = out.getContext('2d')!;
    g.drawImage(bitmap, 0, 0);
    g.globalCompositeOperation = 'destination-in';
    g.imageSmoothingQuality = 'high';
    g.drawImage(mc, 0, 0, bitmap.width, bitmap.height);
    return new Uint8Array(await (await out.convertToBlob({ type: 'image/png' })).arrayBuffer());
  } finally {
    bitmap.close();
  }
};
