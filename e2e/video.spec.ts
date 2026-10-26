import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { doc, elements, newDesign } from './helpers.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

async function upload(page: import('@playwright/test').Page, name: string, mimeType: string) {
  if (!(await page.getByTestId('upload').isVisible())) await page.getByTestId('tab-uploads').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('upload').click();
  await (await chooser).setFiles({ name, mimeType, buffer: fixture(name) });
}

test('video: clip + sound, play, export MP4', async ({ page }) => {
  test.setTimeout(90_000);
  await newDesign(page, 'video');
  await expect(page.getByTestId('timeline')).toBeVisible();
  await expect(page.getByTestId('time')).toContainText('0:05.0');

  await upload(page, 'clip.webm', 'video/webm');
  await expect.poll(async () => (await elements(page)).map((e) => e.type)).toEqual(['video']);
  let d = await doc(page);
  const v = (await elements(page))[0]! as any;
  expect(d.assets[v.asset].duration).toBeCloseTo(2, 0);
  expect(d.assets[`${v.asset}.poster`].mime).toBe('image/png');

  await upload(page, 'tone.mp3', 'audio/mpeg');
  await expect.poll(async () => (await doc(page)).audio?.length ?? 0).toBe(1);
  d = await doc(page);
  expect(d.audio[0].duration).toBeCloseTo(3, 0);

  // page duration from the panel
  await page.getByTestId('stage').click({ position: { x: 5, y: 5 } });
  await page.getByTestId('page-duration').fill('3');
  expect((await doc(page)).pages[0].duration).toBe(3);

  // play advances the clock
  await page.getByTestId('play').click();
  await expect.poll(async () => page.evaluate(() => (window as any).__dc.player.time), { timeout: 5000 }).toBeGreaterThan(0.5);
  await page.getByTestId('play').click();

  // export
  await page.getByTestId('download').click();
  await page.getByTestId('dl-format').selectOption('mp4');
  const dl = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByTestId('do-download').click();
  const file = await (await dl).path();
  const bytes = readFileSync(file!);
  expect(bytes.subarray(4, 8).toString()).toBe('ftyp');
  expect(bytes.length).toBeGreaterThan(10_000);
  let probe = '';
  try { probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'csv=p=0', file!]).toString(); } catch { /* no ffprobe */ }
  if (probe) {
    expect(probe).toContain('video');
    expect(probe).toContain('audio');
    const dur = Number(probe.trim().split('\n').pop());
    expect(dur).toBeGreaterThan(2.8);
    expect(dur).toBeLessThan(3.3);
  }
});
