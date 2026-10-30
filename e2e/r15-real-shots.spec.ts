import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { newDesign } from './helpers.ts';

/** Runs the app's real worker on real photos for the audit; only with SHOTS_DIR set. WebGPU in full Chromium. */
const dir = process.env.SHOTS_DIR;
test.skip(!dir, 'audit shots only');
test.use({ channel: 'chromium', launchOptions: { args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'] } });
test.setTimeout(420_000);

test('real cut-outs and inpainting', async ({ page }) => {
  await newDesign(page);
  fs.mkdirSync(`${dir}/app`, { recursive: true });
  const names = ['m-mug-green', 'm-can-white', 'm-box-kraft', 'sneaker', 'watch', 'car', 'dog', 'cat', 'bird', 'm-tee-woman', 'hair', 'm-hoodie-street'];
  const times: Record<string, number> = {};
  for (const n of names) {
    const b64 = fs.readFileSync(`${dir}/photos/${n}.jpg`).toString('base64');
    const r = await page.evaluate(async (b) => {
      const bytes = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
      const t = performance.now();
      let out: Uint8Array | null = null, err = '';
      try { out = await (window as any).__dc.bgRemover(bytes, 'image/jpeg', () => {}); } catch (e) { err = String(e); }
      const ms = performance.now() - t;
      let s = '';
      if (out) for (let i = 0; i < out.length; i += 8192) s += String.fromCharCode(...out.subarray(i, i + 8192));
      return { ms, err, png: out ? btoa(s) : '' };
    }, b64);
    times[n] = Math.round(r.ms);
    if (r.png) fs.writeFileSync(`${dir}/app/${n}.png`, Buffer.from(r.png, 'base64'));
    else console.log(n, r.err);
  }
  console.log(JSON.stringify(times));
  // erase the whole subject: mask = the cut-out
  for (const n of ['m-mug-green', 'sneaker']) {
    const b64 = fs.readFileSync(`${dir}/photos/${n}.jpg`).toString('base64'), m64 = fs.readFileSync(`${dir}/app/${n}.png`).toString('base64');
    const r = await page.evaluate(async ([b, m]) => {
      const bytes = Uint8Array.from(atob(b!), (c) => c.charCodeAt(0)), mask = Uint8Array.from(atob(m!), (c) => c.charCodeAt(0));
      const t = performance.now();
      const out: Uint8Array = await (window as any).__dc.inpainter(bytes, 'image/jpeg', mask, () => {});
      const ms = performance.now() - t;
      let s = '';
      for (let i = 0; i < out.length; i += 8192) s += String.fromCharCode(...out.subarray(i, i + 8192));
      return { ms, png: btoa(s) };
    }, [b64, m64]);
    console.log('inpaint', n, Math.round(r.ms));
    fs.writeFileSync(`${dir}/app/${n}-erased.png`, Buffer.from(r.png, 'base64'));
  }
  expect(Object.keys(times).length).toBe(names.length);
});
