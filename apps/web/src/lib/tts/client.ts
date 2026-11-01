/** The main thread's side of the speech worker: one worker, jobs by id, cancellable. */
import type { Progress } from '../models.ts';
import type { SpeakResult, TtsReply, TtsRequest } from './worker.ts';

type Pending = { resolve: (r: SpeakResult) => void; reject: (e: Error) => void; progress?: Progress };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<TtsReply>) => {
    const r = e.data, p = pending.get(r.id);
    if (!p) return;
    if ('progress' in r) return p.progress?.(r.progress.msg, r.progress.fraction);
    pending.delete(r.id);
    if ('error' in r) p.reject(new Error(r.error));
    else p.resolve(r.result);
  };
  w.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'the speech model stopped'));
    pending.clear();
    worker = null;
  };
  worker = w;
  return w;
}

export interface SpeakOptions { voice: string; speed: number; file?: string; ep?: string; progress?: Progress; signal?: AbortSignal }

/** Speech for `text`. Rejects with Error('cancelled') as soon as `signal` aborts. */
export function speak(text: string, o: SpeakOptions): Promise<SpeakResult> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    if (o.signal?.aborted) return reject(new Error('cancelled'));
    pending.set(id, { resolve, reject, progress: o.progress });
    o.signal?.addEventListener('abort', () => {
      if (!pending.delete(id)) return;
      getWorker().postMessage({ id, op: 'cancel' } as TtsRequest);
      reject(new Error('cancelled'));
    }, { once: true });
    getWorker().postMessage({ id, op: 'speak', text, voice: o.voice, speed: o.speed, file: o.file, ep: o.ep } as TtsRequest);
  });
}
