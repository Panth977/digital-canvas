/**
 * The relay side of the device bridge (runs in the remote MCP server, one per
 * request): decides where each tool call runs, and in device mode hands the
 * call to the user's device through the mailbox and waits for the answer.
 * Also the three bridge tools: get_processing_mode, list_devices, use_device.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { decodeResult } from './codec.ts';
import { effectiveMode, pickDevice, type ModeInfo } from './routing.ts';
import type { BridgeStore } from './store.ts';
import { CALL_MS, JOB_TTL_MS, PICKUP_MS, isOnline, type BridgeSettings, type DeviceRow, type JobRow } from './types.ts';

/** How server.ts hands tool calls to a relay (see ServerOptions.relay). */
export interface ToolRelay {
  call(tool: string, args: Record<string, unknown>, extra: { signal?: AbortSignal }, local: () => Promise<CallToolResult>): Promise<CallToolResult>;
  /** Register the relay's own tools (they always run in the relay). */
  registerTools?(server: McpServer): void;
}

/** Catalogue tools that touch neither Drive nor the renderer: cheap, they run in the relay even in device mode. */
const RELAY_LOCAL: Record<string, (args: Record<string, unknown>) => boolean> = {
  list_size_presets: () => true,
  search_fonts: () => true,
  search_stock: () => true,
  list_templates: (a) => !a.design_id,
};

export interface RelayOptions {
  store: BridgeStore;
  uid: string;
  /** Emails allowed to process in our cloud. */
  allowlist: readonly string[];
  now?: () => number;
  pickupMs?: number;
  callMs?: number;
  /** While a device works, check it is still online this often. */
  livenessMs?: number;
  newId?: () => string;
}

const text = (t: string, isError = false): CallToolResult => ({ ...(isError ? { isError: true } : {}), content: [{ type: 'text', text: t }] });
const json = (v: unknown): CallToolResult => text(JSON.stringify(v));

function randomId(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return `bj_${Date.now().toString(36)}_${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

type Wait = JobRow | 'pickup' | 'timeout' | 'gone' | 'offline' | 'aborted';

export class Relay implements ToolRelay {
  private settingsP: Promise<BridgeSettings> | null = null;
  private now: () => number;

  constructor(private o: RelayOptions) {
    this.now = o.now ?? Date.now;
  }

  settings(): Promise<BridgeSettings> {
    this.settingsP ??= this.o.store.settings(this.o.uid);
    return this.settingsP;
  }

  async mode(): Promise<ModeInfo> {
    return effectiveMode(await this.settings(), this.o.allowlist);
  }

  async call(tool: string, args: Record<string, unknown>, extra: { signal?: AbortSignal }, local: () => Promise<CallToolResult>): Promise<CallToolResult> {
    const m = await this.mode();
    if (m.mode === 'cloud' || RELAY_LOCAL[tool]?.(args ?? {})) return local();
    const route = pickDevice(await this.settings(), await this.o.store.devices(this.o.uid), this.now());
    if (route.kind !== 'device') return text(route.message, true);
    return this.runOn(route.device, tool, args ?? {}, extra.signal);
  }

  /** Hand one call to a device and wait for its answer. */
  async runOn(device: DeviceRow, tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<CallToolResult> {
    const { store, uid } = this.o;
    const id = (this.o.newId ?? randomId)();
    const t0 = this.now();
    await store.createJob(uid, { id, device: device.id, tool, args: JSON.stringify(args), state: 'pending', createdAt: t0, expiresAt: t0 + JOB_TTL_MS });
    try {
      const end = await this.wait(device, id, signal);
      const name = device.name;
      if (end === 'pickup') return text(`${name} did not pick up the request. Digital Canvas may be closed there, the device asleep, or the tab in the background (browsers pause background tabs). Ask the user to bring Digital Canvas to the front on ${name} (or choose another device with use_device), then try again.`, true);
      if (end === 'offline') return text(`${name} went offline while it was working on ${tool}. Ask the user to reopen Digital Canvas there (or choose another device with use_device), then try again.`, true);
      if (end === 'timeout') return text(`${name} took longer than ${Math.round((this.o.callMs ?? CALL_MS) / 1000)} s for ${tool}. It may still finish: check with list_designs / open_design before repeating changes.`, true);
      if (end === 'aborted') return text('Cancelled.', true);
      if (end === 'gone') return text(`The request to ${name} was removed before it finished. Try again.`, true);
      if (end.state === 'failed') return text(`Error: ${end.error ?? 'the device could not run the tool'}`, true);
      if (end.state === 'cancelled') return text(`${name} cancelled the request (the user turned off "Let AI use this device"?).`, true);
      if (end.parts) return decodeResult((await store.readParts(uid, id, end.parts)).join(''));
      return decodeResult(end.result ?? '');
    } finally {
      await store.deleteJob(uid, id).catch(() => {});
    }
  }

  private wait(device: DeviceRow, id: string, signal?: AbortSignal): Promise<Wait> {
    const { store, uid } = this.o;
    return new Promise<Wait>((resolve) => {
      let state = 'pending';
      let settled = false;
      let unsub: (() => void) | null = null;
      const timers: ReturnType<typeof setTimeout>[] = [];
      let live: ReturnType<typeof setInterval> | null = null;
      const onAbort = () => done('aborted');
      const done = (v: Wait) => {
        if (settled) return;
        settled = true;
        unsub?.();
        timers.forEach(clearTimeout);
        if (live) clearInterval(live);
        signal?.removeEventListener('abort', onAbort);
        resolve(v);
      };
      if (signal?.aborted) return done('aborted');
      signal?.addEventListener('abort', onAbort);
      timers.push(setTimeout(() => { if (state === 'pending') done('pickup'); }, this.o.pickupMs ?? PICKUP_MS));
      timers.push(setTimeout(() => done('timeout'), this.o.callMs ?? CALL_MS));
      live = setInterval(() => {
        if (state !== 'running') return;
        void store.devices(uid).then((ds) => {
          const me = ds.find((d) => d.id === device.id);
          if (!me || !isOnline(me, this.now())) done('offline');
        }).catch(() => {});
      }, this.o.livenessMs ?? 30_000);
      const u = store.watchJob(uid, id, (job) => {
        if (!job) return done('gone');
        state = job.state;
        if (job.state === 'done' || job.state === 'failed' || job.state === 'cancelled') done(job);
      });
      if (settled) u(); else unsub = u;
    });
  }

  // ---- the bridge tools

  registerTools(server: McpServer): void {
    const { store, uid } = this.o;
    const devicesView = async () => {
      const s = await this.settings();
      const now = this.now();
      const list = await store.devices(uid);
      const route = pickDevice(s, list, now);
      const using = route.kind === 'device' ? route.device.id : null;
      return {
        list: list.sort((a, b) => b.lastSeen - a.lastSeen).map((d) => ({
          id: d.id, name: d.name, platform: d.platform, online: isOnline(d, now), ...(d.enabled ? {} : { ai_turned_off: true }),
          last_seen_seconds_ago: Math.max(0, Math.round((now - d.lastSeen) / 1000)), chosen: s.activeDevice === d.id, in_use: using === d.id,
        })),
        route,
      };
    };

    server.registerTool('get_processing_mode', {
      title: 'Where tools run',
      description: 'Whether Digital Canvas tools run on the user\'s own device (their browser or phone with Digital Canvas open) or in Digital Canvas\'s cloud, and which device is in use. Call it when a tool says no device is available.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    }, async () => {
      const m = await this.mode();
      const s = await this.settings();
      const { list, route } = await devicesView();
      return json({
        mode: m.mode, cloud_allowed: m.cloudAllowed, requested: m.requested, chosen_device: s.activeDevice ?? null,
        devices_online: list.filter((d) => d.online).length,
        ...(m.mode === 'device' ? { device_in_use: route.kind === 'device' ? { id: route.device.id, name: route.device.name } : null } : {}),
        explanation: m.mode === 'cloud'
          ? 'Tools run in the Digital Canvas cloud. The user can switch to their own device in Digital Canvas (File › Settings › AI and devices).'
          : `Tools run on the user's device: Digital Canvas must be open there with "Let AI use this device" on.${route.kind === 'device' ? '' : ` ${route.message}`}`,
      });
    });

    server.registerTool('list_devices', {
      title: 'List the user\'s devices',
      description: 'The user\'s devices that can run Digital Canvas tools (browsers and phones with Digital Canvas open and "Let AI use this device" on): id, name, online, and which one is in use. Pick one with use_device.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    }, async () => {
      const m = await this.mode();
      const { list, route } = await devicesView();
      return json({
        mode: m.mode, devices: list,
        next: m.mode === 'cloud' ? 'tools run in the cloud; devices are only used if the user switches to device processing'
          : route.kind === 'device' ? `tools run on ${route.device.name}` : route.message,
      });
    });

    server.registerTool('use_device', {
      title: 'Choose the device',
      description: 'Run Digital Canvas tools on this device from now on (it stays chosen until changed). Pass the id (or name) from list_devices, or "auto" to use whichever single device is online.',
      inputSchema: { device_id: z.string().describe('An id from list_devices, a device name, or "auto".') },
    }, async ({ device_id }) => {
      const want = device_id.trim();
      if (!want || want.toLowerCase() === 'auto') {
        await store.setActiveDevice(uid, null);
        return json({ ok: true, chosen: null, note: 'Tools use the device that is online; if several are, you will be asked to choose.' });
      }
      const list = await store.devices(uid);
      const hit = list.find((d) => d.id === want) ?? list.find((d) => d.name.toLowerCase() === want.toLowerCase())
        ?? (list.filter((d) => d.name.toLowerCase().includes(want.toLowerCase())).length === 1 ? list.find((d) => d.name.toLowerCase().includes(want.toLowerCase())) : undefined);
      if (!hit) return text(`Error: no device "${want}". Devices: ${list.map((d) => `${d.name} (id ${d.id})`).join('; ') || 'none (ask the user to open Digital Canvas and turn on "Let AI use this device")'}`, true);
      await store.setActiveDevice(uid, hit.id);
      this.settingsP = this.settings().then((s) => ({ ...s, activeDevice: hit.id }));
      const online = isOnline(hit, this.now());
      const m = await this.mode();
      return json({
        ok: true, chosen: { id: hit.id, name: hit.name, online },
        ...(online ? {} : { warning: `${hit.name} is offline now: ask the user to open Digital Canvas there and turn on "Let AI use this device".` }),
        ...(m.mode === 'cloud' ? { note: 'Processing is set to cloud for this account, so tools run in the cloud until the user switches to device processing in Digital Canvas.' } : {}),
      });
    });
  }
}
