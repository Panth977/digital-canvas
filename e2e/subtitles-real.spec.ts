/**
 * The real model, end to end: off by default, it downloads 92 MB and takes
 * minutes. DC_REAL_MODELS=1 runs it; DC_TTS_SAMPLE=<path> keeps the MP4.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { doc, newDesign } from './helpers.ts';

const LINES: [string, string][] = [
  ['Your words, spoken right on your own device.', '#1f3a5f'],
  ['Nothing you type is ever sent to a server.', '#4a2c5a'],
  ['नमस्ते दोस्तों, यह आवाज़ आपके अपने कंप्यूटर पर बनी है।', '#7a3b1e'],
  ['अब आप अपने वीडियो में हिंदी में भी बोल सकते हैं।', '#1f5f4a'],
];

test.skip(!process.env.DC_REAL_MODELS, 'set DC_REAL_MODELS=1 to run the real speech model');

test('real speech in English and Hindi, in the panel and in the MP4', async ({ page }) => {
  test.setTimeout(560_000);
  await page.addInitScript(() => localStorage.setItem('dc.tts.engine', 'small'));
  await newDesign(page, 'video');
  await page.evaluate(([bg]) => {
    const d = (window as any).__dc;
    d.updatePage({ duration: 3, background: { type: 'solid', color: bg[0] } });
    for (const c of bg.slice(1)) { d.addPage(); d.updatePage({ duration: 3, background: { type: 'solid', color: c } }); }
    d.seal();
  }, [LINES.map((l) => l[1])]);
  await page.getByTestId('tab-subtitles').click();
  await page.getByTestId('sub-script').fill(LINES.map((l) => l[0]).join('\n'));
  await page.getByTestId('sub-add-script').click();
  await expect(page.getByTestId('sub-line')).toHaveCount(4);
  await page.getByTestId('sub-generate').click();
  await expect(page.getByTestId('sub-progress')).toBeVisible();
  await page.screenshot({ path: '/tmp/orch27-rw/r17-real-progress.png' }).catch(() => {});
  await expect(page.getByTestId('sub-generate')).toHaveText('Speech is up to date', { timeout: 400_000 });
  await expect(page.getByTestId('sub-error')).toHaveCount(0);

  const d = await doc(page);
  expect(d.audio).toHaveLength(4);
  const levels = await page.evaluate(async () => {
    const ed = (window as any).__dc;
    const out = [];
    for (const a of ed.doc.audio) {
      const buf = await new OfflineAudioContext(1, 1, 24000).decodeAudioData(ed.assets.get(a.asset).slice().buffer);
      const c = buf.getChannelData(0);
      let peak = 0, sum = 0;
      for (const v of c) { peak = Math.max(peak, Math.abs(v)); sum += v * v; }
      out.push({ voice: ed.doc.assets[a.asset].speech.voice, dur: buf.duration, peak, rms: Math.sqrt(sum / c.length) });
    }
    return out;
  });
  console.log(JSON.stringify(levels, null, 1));
  expect(levels.map((l: any) => l.voice)).toEqual(['af_heart', 'af_heart', 'hf_alpha', 'hf_alpha']);
  for (const l of levels) {
    expect(l.dur).toBeGreaterThan(1.5);
    expect(l.dur).toBeLessThan(9);
    expect(l.rms).toBeGreaterThan(0.05);
    expect(l.peak).toBeLessThan(1);
  }
  await page.getByTestId('sub-text').first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/tmp/orch27-rw/r17-real-panel.png' });

  const bytes = await page.evaluate(async () => {
    const { exportMp4 } = await import('/src/lib/mp4.ts');
    return Array.from(await exportMp4((window as any).__dc, { quality: 720 }));
  });
  const mp4 = join(mkdtempSync(join(tmpdir(), 'dc-tts-')), 'sample.mp4');
  writeFileSync(mp4, Buffer.from(bytes));
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', mp4]).toString());
  const a = probe.streams.find((s: any) => s.codec_type === 'audio');
  expect(a).toBeTruthy();
  const want = (await doc(page)).pages.reduce((t: number, p: any) => t + p.duration, 0);
  expect(Number(probe.format.duration)).toBeCloseTo(want, 0);
  if (process.env.DC_TTS_SAMPLE) copyFileSync(mp4, process.env.DC_TTS_SAMPLE);
});
