/**
 * The device side of the bridge.
 *
 *  - ToolHost: the MCP tools over a workspace, called in-process (an MCP
 *    client on an in-memory transport, so arguments are validated exactly
 *    as on a server). Lives where the work happens (a Web Worker in the app).
 *  - DeviceAgent: registers the device, keeps a heartbeat, listens for jobs
 *    addressed to it, runs them one at a time through `execute`, and writes
 *    the results back (chunked when large). Lives next to the mailbox (the
 *    app's main thread, signed in to Firestore).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ServerOptions } from '../context.ts';
import { createServer } from '../server.ts';
import type { Workspace } from '../workspace.ts';
import { encodeResult } from './codec.ts';
import type { DeviceLink } from './store.ts';
import { HEARTBEAT_MS, type DeviceRow, type JobRow } from './types.ts';

export class ToolHost {
  private ready: Promise<Client>;
  constructor(ws: Workspace, opts: ServerOptions = {}) {
    const server = createServer(ws, { mode: 'local', ...opts });
    const client = new Client({ name: 'digital-canvas-device', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    this.ready = Promise.all([server.connect(a), client.connect(b)]).then(() => client);
  }

  async call(tool: string, args: Record<string, unknown>, timeoutMs = 300_000): Promise<CallToolResult> {
    const client = await this.ready;
    return (await client.callTool({ name: tool, arguments: args }, undefined, { timeout: timeoutMs })) as CallToolResult;
  }
}

export interface DeviceAgentOptions {
  id: string;
  name: string;
  platform: string;
  appVersion?: string;
  /** Runs one tool call (e.g. posts it to the worker). */
  execute: (tool: string, args: Record<string, unknown>) => Promise<CallToolResult>;
  /** Number of jobs waiting or running changed (for the "AI is working" indicator). */
  onBusy?: (n: number, tool: string | null) => void;
  onError?: (e: Error) => void;
  now?: () => number;
  heartbeatMs?: number;
  /** Result size per document (tests use a small one to exercise chunking). */
  partBytes?: number;
}

export class DeviceAgent {
  private seen = new Set<string>();
  private latest = new Map<string, JobRow>();
  private queue: JobRow[] = [];
  private running = false;
  private unsub: (() => void) | null = null;
  private beat: ReturnType<typeof setInterval> | null = null;
  private stopped = true;
  private now: () => number;

  constructor(private link: DeviceLink, private o: DeviceAgentOptions) {
    this.now = o.now ?? Date.now;
  }

  get active(): boolean { return !this.stopped; }

  private row(enabled: boolean): DeviceRow {
    return { id: this.o.id, name: this.o.name, platform: this.o.platform, enabled, lastSeen: this.now(), ...(this.o.appVersion ? { appVersion: this.o.appVersion } : {}) };
  }

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    await this.link.putDevice(this.row(true));
    this.beat = setInterval(() => this.heartbeat(), this.o.heartbeatMs ?? HEARTBEAT_MS);
    this.unsub = this.link.listenJobs(this.o.id, (jobs) => this.onJobs(jobs), (e) => this.o.onError?.(e));
  }

  /** Say "still here" now (also call it when the page becomes visible again). */
  heartbeat(): void {
    if (this.stopped) return;
    this.link.putDevice(this.row(true)).catch((e: unknown) => this.o.onError?.(e as Error));
  }

  /** Stop taking jobs; the device stays listed with "Let AI use this device" off. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.unsub?.();
    this.unsub = null;
    if (this.beat) clearInterval(this.beat);
    this.beat = null;
    for (const j of this.queue.splice(0)) await this.link.updateJob(j.id, { state: 'cancelled', finishedAt: this.now() }).catch(() => {});
    this.busy(null);
    await this.link.putDevice(this.row(false)).catch(() => {});
  }

  private busy(tool: string | null): void {
    this.o.onBusy?.(this.queue.length + (this.running ? 1 : 0), tool);
  }

  private onJobs(jobs: JobRow[]): void {
    this.latest = new Map(jobs.map((j) => [j.id, j]));
    for (const id of [...this.seen]) if (!this.latest.has(id)) this.seen.delete(id);
    for (const j of jobs) {
      if (j.state !== 'pending' || this.seen.has(j.id) || j.device !== this.o.id) continue;
      if (j.expiresAt && j.expiresAt < this.now()) continue;
      this.seen.add(j.id);
      this.queue.push(j);
      // Taken at once (the relay's pick-up timer stops); the work itself is queued.
      this.link.updateJob(j.id, { state: 'running', startedAt: this.now() }).catch((e: unknown) => this.o.onError?.(e as Error));
    }
    this.busy(null);
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let job = this.queue.shift(); job; job = this.queue.shift()) {
        if (this.stopped) break;
        // The relay gave up (deleted it) while it waited in the queue.
        if (!this.latest.has(job.id)) continue;
        this.busy(job.tool);
        await this.runOne(job);
      }
    } finally {
      this.running = false;
      this.busy(null);
    }
  }

  private async runOne(job: JobRow): Promise<void> {
    let result: CallToolResult;
    try {
      const args = JSON.parse(job.args || '{}') as Record<string, unknown>;
      result = await this.o.execute(job.tool, args);
    } catch (e) {
      await this.link.updateJob(job.id, { state: 'failed', error: e instanceof Error ? e.message : String(e), finishedAt: this.now() }).catch(() => {});
      return;
    }
    try {
      const enc = encodeResult(result, this.o.partBytes ? { partBytes: this.o.partBytes } : {});
      if (enc.parts) {
        await this.link.putParts(job.id, enc.parts);
        await this.link.updateJob(job.id, { state: 'done', parts: enc.parts.length, finishedAt: this.now() });
      } else {
        await this.link.updateJob(job.id, { state: 'done', result: enc.inline!, finishedAt: this.now() });
      }
    } catch (e) {
      this.o.onError?.(e as Error);
      await this.link.updateJob(job.id, { state: 'failed', error: `could not send the result back: ${e instanceof Error ? e.message : String(e)}`, finishedAt: this.now() }).catch(() => {});
    }
  }
}
