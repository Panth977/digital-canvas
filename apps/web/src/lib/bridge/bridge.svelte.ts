/**
 * "Let AI use this device": this browser / app runs the AI connector's tool
 * calls (packages/mcp/src/bridge). The page keeps the mailbox (Firestore:
 * device registry + heartbeat, jobs addressed to this device) and hands each
 * call to the device worker (worker.ts), so the editor never blocks.
 *
 * Loaded lazily (Firestore + the tool core are big): bridgeUi.svelte.ts holds
 * the small always-loaded state.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DeviceAgent, type DeviceLink } from '@digital-canvas/mcp/bridge';
import { account } from '../account.svelte.ts';
import { auth } from '../icebase.ts';
import { isNative, nativePlatform } from '../native/platform.ts';
import { bridgeUi, deviceId, deviceName, devicePlatform } from './bridgeUi.svelte.ts';
import { firestoreLink } from './link.ts';

let worker: Worker | null = null;
const calls = new Map<string, { resolve: (r: CallToolResult) => void; reject: (e: Error) => void }>();
let n = 0;

function startWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'digital-canvas-ai' });
  w.onmessage = async (e: MessageEvent) => {
    const m = e.data as { type: string; id?: string; result?: CallToolResult; error?: string; req?: number; force?: boolean };
    if (m.type === 'token?') {
      try { w.postMessage({ type: 'token', req: m.req, token: await account.driveToken(m.force) }); }
      catch (err) { w.postMessage({ type: 'token', req: m.req, error: err instanceof Error ? err.message : String(err) }); }
    } else if (m.type === 'result' || m.type === 'failed') {
      const c = calls.get(m.id!);
      calls.delete(m.id!);
      if (m.type === 'result') c?.resolve(m.result!); else c?.reject(new Error(m.error));
    }
  };
  w.onerror = (e) => { bridgeUi.error = `The AI worker stopped: ${e.message || 'unknown error'}`; };
  return (worker = w);
}

/** One tool call in the worker. */
export function runInWorker(tool: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const w = startWorker();
  const id = `c${++n}`;
  return new Promise((resolve, reject) => {
    calls.set(id, { resolve, reject });
    w.postMessage({ type: 'call', id, tool, args });
  });
}

let agent: DeviceAgent | null = null;

/** Android: a foreground service keeps the app (and this page) running while AI may use the phone. */
async function keepAlive(on: boolean): Promise<void> {
  if (!isNative() || nativePlatform() !== 'android') return;
  try {
    const { registerPlugin } = await import('@capacitor/core');
    const plugin = registerPlugin<{ start(o: { title: string; text: string }): Promise<void>; stop(): Promise<void> }>('BridgeKeepAlive');
    if (on) await plugin.start({ title: 'Digital Canvas', text: 'AI can use this phone. Turn off in the app: File › Settings › AI and devices.' });
    else await plugin.stop();
  } catch (e) {
    console.warn('BridgeKeepAlive', e);
  }
}

function onVisible(): void {
  if (document.visibilityState === 'visible') agent?.heartbeat();
}

/** Start taking AI tool calls on this device. `link` replaces Firestore (tests). */
export async function startBridge(link?: DeviceLink): Promise<void> {
  if (agent?.active) return;
  const uid = auth.currentUser?.uid ?? account.user?.uid;
  if (!uid) throw new Error('Sign in first');
  bridgeUi.error = '';
  bridgeUi.status = 'starting';
  agent = new DeviceAgent(link ?? firestoreLink(uid), {
    id: deviceId(), name: deviceName(account.user?.name), platform: devicePlatform(), appVersion: '0.1.0',
    execute: runInWorker,
    onBusy: (count, tool) => { bridgeUi.busy = count; if (tool) bridgeUi.tool = tool; if (!count) bridgeUi.tool = null; },
    onError: (e) => { console.warn('[bridge]', e); bridgeUi.error = e.message; },
  });
  try {
    await agent.start();
    startWorker();
    bridgeUi.status = 'on';
    document.addEventListener('visibilitychange', onVisible);
    void keepAlive(true);
  } catch (e) {
    bridgeUi.status = 'error';
    bridgeUi.error = e instanceof Error ? e.message : String(e);
    agent = null;
    throw e;
  }
}

export async function stopBridge(): Promise<void> {
  document.removeEventListener('visibilitychange', onVisible);
  const a = agent;
  agent = null;
  await a?.stop();
  bridgeUi.status = 'off';
  bridgeUi.busy = 0;
  bridgeUi.tool = null;
  void keepAlive(false);
}
