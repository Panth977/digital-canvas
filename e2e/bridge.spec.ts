import { expect, test, type Page } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { FakeDrive, fakeSignIn } from './fake-drive.ts';
import { startRelay, type Relay } from './bridge-relay.ts';
import { PNG } from './png.ts';

/**
 * The device bridge end to end: an MCP client calls the remote server (relay,
 * device mode); the relay hands the calls to this browser page, whose device
 * worker runs the real tools (CanvasKit WASM in a Web Worker) on a fake Drive;
 * the PNG comes back through the relay. The mailbox is in memory (bridge-relay.ts)
 * and the page reaches it over HTTP instead of Firestore.
 */

let relay: Relay;
test.beforeEach(async () => { relay = await startRelay(); });
test.afterEach(async () => { await relay.close(); });

async function device(page: Page): Promise<FakeDrive> {
  await page.goto('/');
  const drive = new FakeDrive();
  await drive.install(page);
  await fakeSignIn(page, ['openid', 'https://www.googleapis.com/auth/drive.file']);
  await page.route('**/aiSettings', (r) => r.fulfill({ json: { result: { mode: 'device', requested: 'device', cloudAllowed: false } } }));
  // the device's mailbox: HTTP to the relay's in-memory bridge (Firestore in the app)
  await page.evaluate((base) => {
    const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', body: JSON.stringify(body) }).then((r) => { if (!r.ok) throw new Error(`${path}: ${r.status}`); });
    (window as any).__bridgeUi.testLink = {
      putDevice: (row: unknown) => post('/dev/putDevice', row),
      removeDevice: async () => {},
      updateJob: (id: string, patch: unknown) => post('/dev/updateJob', { id, patch }),
      putParts: (id: string, parts: string[]) => post('/dev/putParts', { id, parts }),
      listenJobs: (deviceId: string, cb: (jobs: unknown[]) => void) => {
        const ctl = new AbortController();
        void (async () => {
          let v = -1;
          while (!ctl.signal.aborted) {
            try {
              const r = await (await fetch(`${base}/dev/jobs?device=${encodeURIComponent(deviceId)}&v=${v}`, { signal: ctl.signal })).json();
              if (r.v !== v) { v = r.v; cb(r.jobs); }
            } catch { await new Promise((res) => setTimeout(res, 200)); }
          }
        })();
        return () => ctl.abort();
      },
    };
  }, relay.base);
  return drive;
}

async function mcp(): Promise<{ client: Client; call: (name: string, args?: Record<string, unknown>) => Promise<any> }> {
  const client = new Client({ name: 'e2e', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${relay.base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${relay.token}` } } }));
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const raw = (await client.callTool({ name, arguments: args }, undefined, { timeout: 90_000 })) as any;
    const text = raw.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
    let json: any = null;
    try { json = JSON.parse(raw.content.find((c: any) => c.type === 'text')?.text ?? 'null'); } catch { /* error text */ }
    return { raw, text, json, isError: !!raw.isError, images: raw.content.filter((c: any) => c.type === 'image') };
  };
  return { client, call };
}

test('Claude → relay → this browser: render_page runs on the device and the PNG comes back', async ({ page }) => {
  test.setTimeout(120_000);
  const drive = await device(page);
  const { client, call } = await mcp();

  // nothing online yet: the agent is told what to ask the user
  const before = await call('create_design', { preset: 'instagram-post', title: 'Bridge' });
  expect(before.isError).toBe(true);
  expect(before.text).toContain('Let AI use this device');

  // the user turns it on in File › Settings › AI and devices (here: Home › AI)
  await page.getByTestId('home-ai').click();
  await expect(page.getByTestId('ai-dialog')).toBeVisible();
  await expect(page.getByTestId('ai-mode-text')).toContainText('On your devices');
  await page.getByTestId('ai-device-toggle').check();
  await expect(page.getByTestId('ai-this-device')).toContainText('Ready for requests');
  await page.getByRole('button', { name: 'Close' }).click();

  const tools = (await client.listTools()).tools.map((t) => t.name);
  expect(tools).toEqual(expect.arrayContaining(['render_page', 'list_devices', 'use_device', 'get_processing_mode']));
  const devices = await call('list_devices');
  expect(devices.json.mode).toBe('device');
  expect(devices.json.devices).toHaveLength(1);
  expect(devices.json.devices[0]).toMatchObject({ online: true, in_use: true, platform: 'web' });
  expect(devices.json.devices[0].name).toMatch(/^Tester's .+ – Chrome$/);

  const working = page.getByTestId('ai-working').waitFor({ state: 'attached', timeout: 60_000 });
  const made = await call('create_design', { preset: 'instagram-post', title: 'Bridge' });
  expect(made.isError, made.text).toBe(false);
  await working;
  // saved by the device into (fake) Drive, not by the server
  expect([...drive.files.values()].some((f) => f.name.endsWith('.dcanvas'))).toBe(true);

  await call('add_elements', { design_id: made.json.id, elements: [{ type: 'text', text: 'Made on my device', x: 80, y: 80, w: 900, fontSize: 72, color: '#5b3df5' }, { type: 'shape', shape: 'ellipse', x: 700, y: 600, w: 300, h: 300, fill: '#ffb800' }] });
  const shot = await call('render_page', { design_id: made.json.id, size: 512, show_ids: true });
  expect(shot.isError, shot.text).toBe(false);
  expect(shot.images).toHaveLength(1);
  const png = Buffer.from(shot.images[0].data, 'base64');
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  expect(png.readUInt32BE(16)).toBe(512);
  // the mailbox is empty again
  expect(relay.bridge.jobs.get('google:1')?.size ?? 0).toBe(0);
  await expect(page.getByTestId('ai-working')).toHaveCount(0);

  // turned off: the device stays listed, and calls say what to do
  await page.getByTestId('home-ai').click();
  await page.getByTestId('ai-device-toggle').uncheck();
  await expect(page.getByTestId('ai-this-device')).toContainText('Off');
  expect((await call('list_devices')).json.devices[0]).toMatchObject({ online: false, ai_turned_off: true });
  expect((await call('render_page', { design_id: made.json.id })).text).toContain('Let AI use this device');
  await client.close();
});

test('a reel made and exported on the device: clip frames and MP4 by WebCodecs in the worker', async ({ page }) => {
  test.setTimeout(150_000);
  const drive = await device(page);
  await page.evaluate(() => (window as any).__bridgeUi.setEnabled(true));
  await expect.poll(() => page.evaluate(() => (window as any).__bridgeUi.status)).toBe('on');
  const { client, call } = await mcp();

  const reel = await call('assemble_video', {
    title: 'Device reel', preset: 'instagram-reel',
    clips: [{ url: `${relay.base}/fixtures/clip.webm`, trimEnd: 1, text: 'Day one' }, { url: `${relay.base}/fixtures/clip.webm`, trimStart: 0.5, trimEnd: 1.5 }],
    transition: { type: 'dissolve', duration: 0.3 }, music: { url: `${relay.base}/fixtures/tone.mp3`, fadeOut: 0.5 },
  });
  expect(reel.isError, reel.text).toBe(false);
  // a moment inside the first clip: the frame is decoded by WebCodecs in the worker
  const moment = await call('render_page', { design_id: reel.json.id, page: 1, at: 0.5, size: 256 });
  expect(moment.isError, moment.text).toBe(false);
  expect(moment.images).toHaveLength(1);
  const px = PNG.firstPixel(Buffer.from(moment.images[0].data, 'base64'));
  // the test pattern's magenta bar is at the top-left of the 9:16 crop of the 4:3 clip
  expect(px[0]).toBeGreaterThan(200);
  expect(px[1]).toBeLessThan(60);
  expect(px[2]).toBeGreaterThan(200);

  const out = await call('export_video', { design_id: reel.json.id, max_side: 320, fps: 12, wait_seconds: 100 });
  expect(out.isError, out.text).toBe(false);
  expect(out.json.state).toBe('done');
  const mp4 = [...drive.files.values()].find((f) => f.name.endsWith('.mp4'));
  expect(mp4?.body?.subarray(4, 8).toString('latin1')).toBe('ftyp');
  const { ALL_FORMATS, BufferSource, Input } = await import('mediabunny');
  const input = new Input({ source: new BufferSource(new Uint8Array(mp4!.body!)), formats: ALL_FORMATS });
  expect(await input.computeDuration()).toBeGreaterThan(1.4);
  expect(await input.getPrimaryVideoTrack()).toBeTruthy();
  expect(await input.getPrimaryAudioTrack()).toBeTruthy();
  await client.close();
});
