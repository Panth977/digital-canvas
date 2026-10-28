/**
 * The device bridge: routing decisions (cloud allowlist, no / one / several
 * devices, the chosen device), the job lifecycle through an in-memory
 * mailbox (pick-up, result, chunked result, failure, pick-up timeout,
 * cleanup), and whole tool calls relayed to a DeviceAgent + ToolHost.
 */
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.ts';
import { FolderWorkspace } from '../src/node/index.ts';
import {
  DeviceAgent, MemoryBridge, NO_DEVICE_MESSAGE, Relay, ToolHost, decodeResult, effectiveMode, encodeResult, parseAllowlist, pickDevice, splitUtf8, utf8Bytes,
  type DeviceRow,
} from '../src/bridge/index.ts';
import { isPng } from './helpers.ts';

process.env.DC_OFFLINE = '1';

const NOW = 1_800_000_000_000;
const dev = (id: string, over: Partial<DeviceRow> = {}): DeviceRow => ({ id, name: `Device ${id}`, platform: 'web', enabled: true, lastSeen: NOW - 5_000, ...over });

describe('processing mode', () => {
  const allow = ['ppanth977@gmail.com'];
  it('cloud is the default for allowlisted users, who may still pick device', () => {
    expect(effectiveMode({ email: 'ppanth977@gmail.com' }, allow)).toEqual({ mode: 'cloud', cloudAllowed: true, requested: 'cloud' });
    expect(effectiveMode({ email: 'PPanth977@Gmail.com', processing: 'device' }, allow)).toEqual({ mode: 'device', cloudAllowed: true, requested: 'device' });
  });
  it('everyone else is forced to device, whatever is stored', () => {
    expect(effectiveMode({ email: 'ada@example.com' }, allow)).toEqual({ mode: 'device', cloudAllowed: false, requested: 'device' });
    expect(effectiveMode({ email: 'ada@example.com', processing: 'cloud' }, allow).mode).toBe('device');
    expect(effectiveMode({}, allow).mode).toBe('device');
  });
  it('the allowlist comes from config', () => {
    expect(parseAllowlist(undefined)).toEqual(['ppanth977@gmail.com']);
    expect(parseAllowlist(' A@x.com, b@y.com ;c@z.com')).toEqual(['a@x.com', 'b@y.com', 'c@z.com']);
    expect(parseAllowlist('')).toEqual([]);
  });
});

describe('device routing', () => {
  it('no device online → tells the agent to ask the user to open the app', () => {
    const r = pickDevice({}, [dev('a', { lastSeen: NOW - 120_000 }), dev('b', { enabled: false })], NOW);
    expect(r.kind).toBe('none');
    expect(r.kind === 'none' && r.message).toContain('Let AI use this device');
  });
  it('one device online → it is used without asking', () => {
    const r = pickDevice({}, [dev('a'), dev('b', { lastSeen: NOW - 90_000 })], NOW);
    expect(r).toMatchObject({ kind: 'device', device: { id: 'a' }, auto: true });
  });
  it('several online and none chosen → the list, and ask the user', () => {
    const r = pickDevice({}, [dev('a'), dev('b', { lastSeen: NOW - 1000 })], NOW);
    expect(r.kind).toBe('choose');
    if (r.kind !== 'choose') return;
    expect(r.devices.map((d) => d.id)).toEqual(['b', 'a']);
    expect(r.message).toMatch(/use_device/);
    expect(r.message).toContain('id a');
  });
  it('the chosen device wins while it is online', () => {
    expect(pickDevice({ activeDevice: 'b' }, [dev('a'), dev('b')], NOW)).toMatchObject({ kind: 'device', device: { id: 'b' }, auto: false });
  });
  it('the chosen device offline → never silently switches', () => {
    const r = pickDevice({ activeDevice: 'b' }, [dev('a'), dev('b', { lastSeen: NOW - 70_000 })], NOW);
    expect(r.kind).toBe('choose');
    expect(r.kind === 'choose' && r.message).toContain('Device b, is offline');
    const none = pickDevice({ activeDevice: 'b' }, [dev('b', { enabled: false })], NOW);
    expect(none.kind === 'none' && none.message).toContain('Device b, is offline');
  });
});

describe('result codec', () => {
  it('splits on UTF-8 byte size, never inside a character', () => {
    const s = 'aé€😀'.repeat(1000);
    const parts = splitUtf8(s, 100);
    expect(parts.join('')).toBe(s);
    for (const p of parts) expect(utf8Bytes(p)).toBeLessThanOrEqual(100);
  });
  it('inline when small, parts when large, pictures dropped past the cap', () => {
    const small = { content: [{ type: 'text' as const, text: 'hi' }] };
    expect(encodeResult(small)).toEqual({ inline: JSON.stringify(small) });
    const big = { content: [{ type: 'text' as const, text: '{}' }, { type: 'image' as const, data: 'A'.repeat(5000), mimeType: 'image/png' }] };
    const enc = encodeResult(big, { partBytes: 1000 });
    expect(enc.parts!.length).toBe(6);
    expect(decodeResult(enc.parts!.join(''))).toEqual(big);
    const capped = decodeResult(encodeResult(big, { maxBytes: 2000 }).inline!);
    expect(capped.content[1]).toMatchObject({ type: 'text' });
    expect(decodeResult('nonsense').isError).toBe(true);
  });
});

// ---------------------------------------------------------------- relayed tool calls

interface Rig {
  bridge: MemoryBridge;
  call: (name: string, args?: Record<string, unknown>) => Promise<any>;
  cloudDir: string;
  agents: DeviceAgent[];
  addDevice: (id: string, opts?: { partBytes?: number; fail?: boolean; listen?: boolean }) => Promise<{ dir: string; host: ToolHost }>;
  close: () => Promise<void>;
}

const rigs: Rig[] = [];
afterEach(async () => { for (const r of rigs.splice(0)) await r.close(); });

async function rig(email: string, processing?: 'device' | 'cloud', relayOpts: { pickupMs?: number } = {}): Promise<Rig> {
  const uid = 'google:1';
  const bridge = new MemoryBridge();
  bridge.setSettings(uid, { email, ...(processing ? { processing } : {}) });
  const cloudDir = mkdtempSync(join(tmpdir(), 'dc-bridge-cloud-'));
  const relay = new Relay({ store: bridge, uid, allowlist: ['ppanth977@gmail.com'], pickupMs: relayOpts.pickupMs ?? 5000, livenessMs: 200 });
  const server = createServer(new FolderWorkspace(cloudDir), { mode: 'remote', relay });
  const client = new Client({ name: 't', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const agents: DeviceAgent[] = [];
  const r: Rig = {
    bridge, cloudDir, agents,
    call: async (name, args = {}) => {
      const raw = (await client.callTool({ name, arguments: args }, undefined, { timeout: 60_000 })) as any;
      const text = raw.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
      let json: any = null;
      try { json = JSON.parse(raw.content.find((c: any) => c.type === 'text')?.text ?? 'null'); } catch { /* error text */ }
      return { raw, text, json, isError: !!raw.isError, images: raw.content.filter((c: any) => c.type === 'image') };
    },
    addDevice: async (id, o = {}) => {
      const dir = mkdtempSync(join(tmpdir(), `dc-bridge-${id}-`));
      const host = new ToolHost(new FolderWorkspace(dir));
      if (o.listen === false) {
        await bridge.link(uid).putDevice({ id, name: `Device ${id}`, platform: 'web', enabled: true, lastSeen: Date.now() });
        return { dir, host };
      }
      const agent = new DeviceAgent(bridge.link(uid), {
        id, name: `Device ${id}`, platform: 'web', heartbeatMs: 1000, ...(o.partBytes ? { partBytes: o.partBytes } : {}),
        execute: (tool, args) => (o.fail ? Promise.reject(new Error('the GPU caught fire')) : host.call(tool, args)),
      });
      await agent.start();
      agents.push(agent);
      return { dir, host };
    },
    close: async () => { for (const ag of agents) await ag.stop(); await client.close(); await server.close(); },
  };
  rigs.push(r);
  return r;
}

const designs = (dir: string) => readdirSync(dir).filter((f) => f.endsWith('.dcanvas'));

describe('relay', () => {
  it('cloud mode (allowlisted): tools run in the function, no jobs', async () => {
    const r = await rig('ppanth977@gmail.com');
    const res = await r.call('create_design', { preset: 'instagram-post', title: 'Cloud' });
    expect(res.isError).toBe(false);
    expect(designs(r.cloudDir)).toHaveLength(1);
    expect(r.bridge.log).toEqual([]);
    const mode = await r.call('get_processing_mode');
    expect(mode.json).toMatchObject({ mode: 'cloud', cloud_allowed: true });
  });

  it('cloud requested by a user who is not allowlisted: forced to device (no device → clear message)', async () => {
    const r = await rig('ada@example.com', 'cloud');
    const res = await r.call('create_design', { preset: 'instagram-post', title: 'Post' });
    expect(res.isError).toBe(true);
    expect(res.text).toBe(NO_DEVICE_MESSAGE);
    expect(designs(r.cloudDir)).toHaveLength(0);
    expect((await r.call('get_processing_mode')).json).toMatchObject({ mode: 'device', cloud_allowed: false, devices_online: 0 });
  });

  it('catalogue tools still answer in device mode without a device', async () => {
    const r = await rig('ada@example.com');
    const res = await r.call('list_size_presets', {});
    expect(res.isError).toBe(false);
    expect(r.bridge.log).toEqual([]);
  });

  it('device mode: create + render_page run on the device and the PNG comes back; jobs are cleaned up', async () => {
    const r = await rig('ada@example.com');
    const { dir } = await r.addDevice('mac');
    const made = await r.call('create_design', { preset: 'instagram-post', title: 'On device' });
    expect(made.isError).toBe(false);
    expect(designs(dir)).toHaveLength(1);
    expect(designs(r.cloudDir)).toHaveLength(0);
    const shot = await r.call('render_page', { design_id: made.json.id, size: 256 });
    expect(shot.isError).toBe(false);
    expect(shot.images).toHaveLength(1);
    expect(isPng(shot.images[0].data)).toBe(true);
    expect(r.bridge.jobs.get('google:1')?.size ?? 0).toBe(0);
    expect(r.bridge.log.filter(([op]) => op === 'create')).toHaveLength(2);
    expect(r.bridge.log.filter(([op]) => op === 'delete')).toHaveLength(2);
  });

  it('allowlisted user who picked device processing uses the device', async () => {
    const r = await rig('ppanth977@gmail.com', 'device');
    const { dir } = await r.addDevice('mac');
    expect((await r.call('create_design', { preset: 'logo', title: 'Logo' })).isError).toBe(false);
    expect(designs(dir)).toHaveLength(1);
    expect(designs(r.cloudDir)).toHaveLength(0);
  });

  it('large results travel in parts', async () => {
    const r = await rig('ada@example.com');
    await r.addDevice('mac', { partBytes: 1500 });
    const made = await r.call('create_design', { preset: 'instagram-post', title: 'Post' });
    const shot = await r.call('render_page', { design_id: made.json.id, size: 512 });
    expect(shot.isError).toBe(false);
    expect(isPng(shot.images[0].data)).toBe(true);
    expect(r.bridge.log.some(([op]) => op === 'parts')).toBe(true);
    expect(r.bridge.parts.size).toBe(0);
  });

  it('several devices: asks to choose; use_device sticks; list_devices shows it', async () => {
    const r = await rig('ada@example.com');
    const a = await r.addDevice('a');
    const b = await r.addDevice('b');
    const ask = await r.call('create_design', { preset: 'logo', title: 'Logo' });
    expect(ask.isError).toBe(true);
    expect(ask.text).toMatch(/Ask the user which device/);
    const list = await r.call('list_devices');
    expect(list.json.devices.map((d: any) => d.id).sort()).toEqual(['a', 'b']);
    expect(list.json.devices.every((d: any) => d.online && !d.in_use)).toBe(true);
    const use = await r.call('use_device', { device_id: 'Device b' });
    expect(use.json).toMatchObject({ ok: true, chosen: { id: 'b', online: true } });
    expect(r.bridge.users.get('google:1')?.activeDevice).toBe('b');
    expect((await r.call('create_design', { preset: 'logo', title: 'Logo' })).isError).toBe(false);
    expect(designs(b.dir)).toHaveLength(1);
    expect(designs(a.dir)).toHaveLength(0);
    expect((await r.call('list_devices')).json.devices.find((d: any) => d.id === 'b')).toMatchObject({ chosen: true, in_use: true });
    expect((await r.call('use_device', { device_id: 'nope' })).isError).toBe(true);
    expect((await r.call('use_device', { device_id: 'auto' })).json.chosen).toBeNull();
  });

  it('a device that does not pick up in time → a clear error, and the job is removed', async () => {
    const r = await rig('ada@example.com', undefined, { pickupMs: 150 });
    await r.addDevice('sleepy', { listen: false });
    const res = await r.call('create_design', { preset: 'logo', title: 'Logo' });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/did not pick up/);
    expect(r.bridge.jobs.get('google:1')?.size ?? 0).toBe(0);
  });

  it('a tool that fails on the device comes back as an error result', async () => {
    const r = await rig('ada@example.com');
    await r.addDevice('mac', { fail: true });
    const res = await r.call('create_design', { preset: 'logo', title: 'Logo' });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('the GPU caught fire');
  });

  it('a device that stops ("Let AI use this device" off) goes offline', async () => {
    const r = await rig('ada@example.com');
    await r.addDevice('mac');
    await r.agents[0]!.stop();
    const res = await r.call('create_design', { preset: 'logo', title: 'Logo' });
    expect(res.isError).toBe(true);
    expect(res.text).toBe(NO_DEVICE_MESSAGE);
    expect((await r.call('list_devices')).json.devices[0]).toMatchObject({ id: 'mac', online: false, ai_turned_off: true });
  });
});
