/** Test helpers: an MCP client wired to a server on a temp folder, and sample media. */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.ts';
import { engine } from '../src/engine.ts';
import { FolderWorkspace } from '../src/workspace.ts';
import type { ServerOptions } from '../src/context.ts';

process.env.DC_OFFLINE = '1';

export const FIXTURES = new URL('../../../e2e/fixtures/', import.meta.url);
export const clipWebm = () => new Uint8Array(readFileSync(new URL('clip.webm', FIXTURES)));
export const toneMp3 = () => new Uint8Array(readFileSync(new URL('tone.mp3', FIXTURES)));

export interface Harness {
  client: Client;
  ws: FolderWorkspace;
  dir: string;
  call: (name: string, args?: Record<string, unknown>) => Promise<{ json: any; text: string; images: { data: string; mimeType: string }[]; isError: boolean; raw: any }>;
  close: () => Promise<void>;
}

export async function harness(opts: ServerOptions = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'dc-mcp-test-'));
  const ws = new FolderWorkspace(dir);
  const server = createServer(ws, opts);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call: Harness['call'] = async (name, args = {}) => {
    const raw = (await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 })) as any;
    const text = raw.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
    let json: any = null;
    try { json = JSON.parse(raw.content.find((c: any) => c.type === 'text')?.text ?? 'null'); } catch { /* error text */ }
    return { json, text, images: raw.content.filter((c: any) => c.type === 'image'), isError: !!raw.isError, raw };
  };
  return { client, ws, dir, call, close: async () => { await client.close(); await server.close(); } };
}

/** A photo-like PNG: a two-colour gradient with a light circle (for contrast tests). */
export async function samplePng(w = 1200, h = 800, from = '#1e3a8a', to = '#0f172a'): Promise<Uint8Array> {
  const { ck } = await engine();
  const s = ck.MakeSurface(w, h)!;
  const c = s.getCanvas();
  const p = new ck.Paint();
  p.setShader(ck.Shader.MakeLinearGradient([0, 0], [w, h], [ck.parseColorString(from), ck.parseColorString(to)], null, ck.TileMode.Clamp));
  c.drawRect(ck.XYWHRect(0, 0, w, h), p);
  p.setShader(null);
  p.setColor(ck.parseColorString('#fbbf24'));
  c.drawCircle(w * 0.7, h * 0.35, Math.min(w, h) * 0.18, p);
  s.flush();
  const img = s.makeImageSnapshot();
  const out = img.encodeToBytes()!;
  img.delete(); p.delete(); s.delete();
  return out;
}

export const isPng = (b64: string) => Buffer.from(b64, 'base64').subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
