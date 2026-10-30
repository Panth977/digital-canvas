/** The main thread's side of the image-model worker: one worker, jobs by id. */
import type { VisionReply, VisionRequest } from './worker.ts';

export type Progress = (msg: string, fraction?: number) => void;

type Pending = { resolve: (r: Uint8Array) => void; reject: (e: Error) => void; progress?: Progress };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<VisionReply>) => {
    const r = e.data, p = pending.get(r.id);
    if (!p) return;
    if ('progress' in r) return p.progress?.(r.progress.msg, r.progress.fraction);
    pending.delete(r.id);
    if ('error' in r) p.reject(new Error(r.error));
    else p.resolve(r.result);
  };
  w.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'the image model stopped'));
    pending.clear();
    worker = null;
  };
  worker = w;
  return w;
}

type Job = { op: 'cutout'; bytes: Uint8Array; mime: string } | { op: 'inpaint'; bytes: Uint8Array; mime: string; mask: Uint8Array };

function call(job: Job, progress?: Progress): Promise<Uint8Array> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, progress });
    getWorker().postMessage({ id, ...job } as VisionRequest);
  });
}

/** The picture with its background transparent, same size (PNG). */
export const cutoutImage = (bytes: Uint8Array, mime: string, progress?: Progress): Promise<Uint8Array> => call({ op: 'cutout', bytes, mime }, progress);

/** The picture with the masked part filled in (`mask` = PNG whose alpha marks what to fill). */
export const inpaintImage = (bytes: Uint8Array, mime: string, mask: Uint8Array, progress?: Progress): Promise<Uint8Array> => call({ op: 'inpaint', bytes, mime, mask }, progress);
