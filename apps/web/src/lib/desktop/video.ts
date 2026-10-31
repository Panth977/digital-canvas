/** Video work for the app's MCP server, on this window's WebCodecs, in a worker. */
let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function run(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./videoworker.ts', import.meta.url), { type: 'module', name: 'videoworker' });
  worker.onmessage = (e: MessageEvent<{ id: number; value?: unknown; error?: string }>) => {
    const w = waiting.get(e.data.id);
    waiting.delete(e.data.id);
    if (e.data.error) w?.reject(new Error(e.data.error));
    else w?.resolve(e.data.value);
  };
  return worker;
}

export function videoTask(op: string, args: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    run().postMessage({ id, op, args });
  });
}
