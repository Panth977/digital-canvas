/**
 * What the on-device model workers share (vision/, tts/). onnxruntime-web (MIT)
 * comes from jsDelivr (the service worker keeps it), models from pinned
 * revisions, kept in the Cache API `dc-models`, so later runs work offline.
 */
const ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/';

export interface OrtTensor { data: Float32Array; dims: readonly number[] }
export interface OrtSession { inputNames: readonly string[]; outputNames: readonly string[]; run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>; release(): Promise<void> }
export interface Ort {
  env: { wasm: { wasmPaths: string; numThreads: number }; logLevel: string };
  Tensor: new (type: string, data: Float32Array | BigInt64Array, dims: number[]) => OrtTensor;
  InferenceSession: { create(model: Uint8Array, opts: Record<string, unknown>): Promise<OrtSession> };
}

export type Progress = (msg: string, fraction?: number) => void;

let ortP: Promise<Ort> | null = null;

export function loadOrt(): Promise<Ort> {
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

/** A file at a pinned URL: from the cache, or downloaded once with progress. */
export async function fetchCached(url: string, name: string, mb: number, progress: Progress): Promise<Uint8Array> {
  const cache = 'caches' in self ? await caches.open('dc-models').catch(() => null) : null;
  const hit = await cache?.match(url);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`model download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || mb * 1e6;
  const chunks: Uint8Array[] = [];
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (mb >= 1) progress(`Downloading ${name}: ${Math.round(got / 1e6)} of ${Math.round(total / 1e6)} MB, first time only`, Math.min(1, got / total));
  }
  const all = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  await cache?.put(url, new Response(all)).catch(() => {});
  return all;
}

export const hasGpu = async (): Promise<boolean> => {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  return !!gpu && !!(await gpu.requestAdapter().catch(() => null));
};
