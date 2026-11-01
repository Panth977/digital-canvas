import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { doc, newDesign } from './helpers.ts';

const tone = (sec: number, level: number): Float32Array => Float32Array.from({ length: sec * 24000 }, (_, i) => Math.sin(i / 10) * level);
const encodeWav = (pcm: Float32Array): Uint8Array => {
  const b = Buffer.alloc(44 + pcm.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + pcm.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(pcm.length * 2, 40);
  pcm.forEach((v, i) => b.writeInt16LE(Math.round(v * 32767), 44 + i * 2));
  return b;
};

const SHOTS = process.env.SHOTS ? process.env.SHOTS_DIR ?? '/tmp/orch27-rw' : null;
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/r17-${name}.png` }); };

/** A stub synthesiser: a tone, 0.06 s per character, and a log of what it was asked. */
async function stubSynth(page: Page, ms = 0): Promise<void> {
  await page.evaluate((ms) => {
    const w = window as any;
    w.__said = [];
    w.__dc.synth = async (text: string, o: { voice: string; speed: number; signal?: AbortSignal; progress?: (m: string, f?: number) => void }) => {
      w.__said.push({ text, voice: o.voice, speed: o.speed });
      o.progress?.('Speaking…', 0.5);
      if (ms) await new Promise((r, x) => { const t = setTimeout(r, ms); o.signal?.addEventListener('abort', () => { clearTimeout(t); x(new Error('cancelled')); }); });
      const rate = 24000, pcm = new Float32Array(Math.round(rate * (w.__perChar ?? 0.06) * text.length));
      for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i / 6) * 0.3;
      return { pcm, rate };
    };
  }, ms);
}

async function openPanel(page: Page): Promise<void> {
  await newDesign(page, 'video');
  await stubSynth(page);
  await page.getByTestId('tab-subtitles').click();
}

async function script(page: Page, text: string): Promise<void> {
  await page.getByTestId('sub-script').fill(text);
  await page.getByTestId('sub-add-script').click();
}

const said = (page: Page): Promise<{ text: string; voice: string; speed: number }[]> => page.evaluate(() => (window as any).__said);
const captions = async (page: Page, i = 0) => (await doc(page)).pages[i].elements.filter((e: any) => e.caption);

test('the Subtitles tab shows only on video designs', async ({ page }) => {
  await newDesign(page, 'instagram-post');
  await expect(page.getByTestId('tab-subtitles')).toHaveCount(0);
  await newDesign(page, 'video');
  await expect(page.getByTestId('tab-subtitles')).toBeVisible();
});

test('a script becomes lines and caption text; the canvas edit comes back to the line', async ({ page }) => {
  await openPanel(page);
  await script(page, 'Welcome to our shop. Fresh bread every morning.');
  await expect(page.getByTestId('sub-line')).toHaveCount(2);
  const caps = await captions(page);
  expect(caps.map((c: any) => c.text)).toEqual(['Welcome to our shop.', 'Fresh bread every morning.']);
  expect(caps[0].type).toBe('text');
  expect(caps[0].timing.end).toBeLessThanOrEqual(caps[1].timing.start + 0.01);

  // one line per scene
  await page.getByTestId('sub-clear').click();
  await page.evaluate(() => { const d = (window as any).__dc; d.addPage(); d.updatePage({ duration: 5 }); d.seal(); });
  await script(page, 'First scene.\nSecond scene.');
  expect((await doc(page)).subtitles.lines.map((l: any) => [l.start, l.end])).toEqual([[0, 5], [5, 10]]);

  // typing on the canvas: the element is the caption
  await page.evaluate(() => {
    const d = (window as any).__dc, el = d.doc.pages[0].elements.find((e: any) => e.caption);
    d.setText(el.id, 'Edited on the canvas');
  });
  await expect(page.getByTestId('sub-text').first()).toHaveValue('Edited on the canvas');

  // a longer scene carries the next line along
  await page.evaluate(() => { const d = (window as any).__dc; d.updatePage({ duration: 7 }, null, d.doc.pages[0].id); d.seal(); });
  await expect.poll(async () => (await doc(page)).subtitles.lines[1].start).toBe(7);
});

test('style picker, undo, show and hide', async ({ page }) => {
  await openPanel(page);
  await script(page, 'Look at this.');
  await page.getByTestId('sub-style-yellow').click();
  expect((await captions(page))[0].style.color).toBe('#ffd400');
  await shot(page, 'panel');
  await page.getByTestId('sub-show').uncheck();
  await expect.poll(async () => (await captions(page)).length).toBe(0);
  await page.getByTestId('sub-show').check();
  await expect.poll(async () => (await captions(page)).length).toBe(1);
});

test('SRT: import, export round trip', async ({ page }) => {
  await openPanel(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('sub-import').click();
  await (await chooser).setFiles({ name: 's.srt', mimeType: 'application/x-subrip', buffer: Buffer.from('1\n00:00:00,500 --> 00:00:02,000\nFirst\n\n2\n00:00:02,500 --> 00:00:04,000\nSecond\n') });
  await expect(page.getByTestId('sub-line')).toHaveCount(2);
  expect((await doc(page)).subtitles.lines[1]).toMatchObject({ start: 2.5, end: 4, text: 'Second' });
  const dl = page.waitForEvent('download');
  await page.getByTestId('sub-export-vtt').click();
  const file = await (await dl).path();
  const vtt = readFileSync(file, 'utf8');
  expect(vtt).toContain('WEBVTT');
  expect(vtt).toContain('00:00:02.500 --> 00:00:04.000');
});

test('generate: clips on the timeline, only changed lines again, marked with text and voice', async ({ page }) => {
  await openPanel(page);
  await script(page, 'One.\nTwo two.');
  await page.getByTestId('sub-voice').selectOption('af_bella');
  await page.getByTestId('sub-generate').click();
  await expect(page.getByTestId('sub-generate')).toHaveText('Speech is up to date');
  expect(await said(page)).toHaveLength(2);
  await expect(page.getByTestId('tl-audio')).toHaveCount(2);
  let d = await doc(page);
  expect(d.audio.every((a: any) => a.speech)).toBe(true);
  expect(d.audio[0].start).toBe(d.subtitles.lines[0].start);
  expect(d.audio[1].start).toBe(d.subtitles.lines[1].start);
  const meta = d.assets[d.audio[1].asset];
  expect(meta).toMatchObject({ mime: 'audio/wav', speech: { text: 'Two two.', voice: 'af_bella', model: 'Kokoro-82M' } });
  await shot(page, 'timeline');

  // change one line: only it goes to the model
  await page.getByTestId('sub-text').nth(1).fill('Changed line.');
  await expect(page.getByTestId('sub-generate')).toContainText('1 line');
  await page.getByTestId('sub-generate').click();
  await expect(page.getByTestId('sub-generate')).toHaveText('Speech is up to date');
  expect((await said(page)).map((s) => s.text)).toEqual(['One.', 'Two two.', 'Changed line.']);
  d = await doc(page);
  expect(d.audio).toHaveLength(2);

  // one line can have its own voice, and a single line regenerates alone
  await page.getByTestId('sub-more').first().click();
  await page.getByTestId('sub-line-voice').selectOption('bm_george');
  await page.getByTestId('sub-speak').first().click();
  await expect.poll(async () => (await said(page)).at(-1)?.voice).toBe('bm_george');

  // volume reaches the clips
  await page.getByTestId('sub-volume').fill('0.5');
  await expect.poll(async () => (await doc(page)).audio[0].volume).toBe(0.5);
});

test('same words twice are stored once', async ({ page }) => {
  await openPanel(page);
  await script(page, 'Again.\nAgain.');
  await page.getByTestId('sub-generate').click();
  await expect(page.getByTestId('sub-generate')).toHaveText('Speech is up to date');
  const d = await doc(page);
  expect(d.audio).toHaveLength(2);
  expect(new Set(d.audio.map((a: any) => a.asset)).size).toBe(1);
  expect((await said(page))).toHaveLength(1);
});

test('fit: stretch grows the scene, speed keeps it; a Hindi line takes a Hindi voice', async ({ page }) => {
  await openPanel(page);
  const long = 'This line is much too long for one short scene, so something must give way.';
  await page.evaluate(() => { (window as any).__perChar = 0.1; }); // 7.6 s in a 5 s scene
  await script(page, long);
  await page.getByTestId('sub-generate').click();
  await expect(page.getByTestId('sub-generate')).toHaveText('Speech is up to date');
  let d = await doc(page);
  expect(d.pages[0].duration).toBeGreaterThan(6.5);
  expect(d.subtitles.lines[0].end - d.subtitles.lines[0].start).toBeGreaterThan(6.5);
  expect((await captions(page))[0].timing.end).toBeCloseTo(d.subtitles.lines[0].end, 1);

  await page.getByTestId('sub-clear').click();
  await page.evaluate(() => { const d = (window as any).__dc; d.updatePage({ duration: 5 }); d.seal(); });
  await page.getByTestId('sub-script').fill(long);
  await page.getByTestId('sub-add-script').click();
  await page.getByTestId('sub-fit').selectOption('speed');
  await page.getByTestId('sub-generate').click();
  await expect(page.getByTestId('sub-state').first()).toContainText('faster');
  d = await doc(page);
  expect(d.pages[0].duration).toBe(5);
  expect(d.audio[0].duration).toBeLessThanOrEqual(5);
  expect(d.audio[0].speech.fitted).toBeGreaterThan(1.3);
  // the cached speech was re-fitted: no second run of the model
  expect((await said(page))).toHaveLength(1);

  await page.getByTestId('sub-clear').click();
  await script(page, 'नमस्ते दोस्तों।');
  await page.getByTestId('sub-generate').click();
  await expect(page.getByTestId('sub-generate')).toHaveText('Speech is up to date');
  expect((await said(page)).at(-1)!.voice).toBe('hf_alpha');
  expect((await captions(page))[0].style.fontFamily).toBe('Noto Sans Devanagari');
});

test('cancel stops the queue and keeps what is done; a failure says so and keeps the lines', async ({ page }) => {
  await openPanel(page);
  await stubSynth(page, 600);
  await script(page, 'One.\nTwo.\nThree.\nFour.');
  await page.getByTestId('sub-generate').click();
  await expect(page.getByTestId('sub-progress')).toContainText('of 4');
  await expect.poll(async () => (await doc(page)).audio?.length ?? 0, { timeout: 8000 }).toBeGreaterThan(0);
  await page.getByTestId('sub-cancel').click();
  await expect(page.getByTestId('sub-generate')).toBeVisible();
  await expect(page.getByTestId('sub-error')).toHaveCount(0);
  const n = (await doc(page)).audio.length;
  expect(n).toBeLessThan(4);
  await expect(page.getByTestId('sub-generate')).toContainText(`${4 - n} line`);

  await page.evaluate(() => { (window as any).__dc.synth = async () => { throw new Error('out of memory'); }; });
  await page.getByTestId('sub-generate').click();
  await expect(page.getByTestId('sub-error')).toContainText('out of memory');
  await expect(page.getByTestId('sub-line')).toHaveCount(4);
});

test('voice preview, language, and the music ducks in the export', async ({ page }) => {
  test.setTimeout(90_000);
  await openPanel(page);
  await script(page, 'Hello.');
  await page.getByTestId('sub-lang').selectOption('hi');
  await expect(page.getByTestId('sub-voice')).toHaveValue('hf_alpha');
  await page.getByTestId('sub-voice').selectOption('hm_omega');
  await page.getByTestId('sub-preview').click();
  await expect.poll(async () => (await said(page)).at(-1)?.voice).toBe('hm_omega');
  expect((await said(page)).at(-1)!.text).toContain('नमस्ते');
  await page.getByTestId('sub-duck').check();
  expect((await doc(page)).subtitles.speech.duck).toBe(0.25);

  // a tone under a line of speech: the mix is quieter while the speech plays than before it
  await page.getByTestId('sub-generate').click();
  await expect(page.getByTestId('sub-generate')).toHaveText('Speech is up to date');
  const levels = await page.evaluate(async (wav) => {
    const d = (window as any).__dc;
    const { mixAudio } = await import('/src/lib/mp4.ts');
    d.assets.set('music.wav', Uint8Array.from(wav));
    const music = { id: 'a_music', asset: 'music.wav', start: 0, offset: 0, duration: 5 };
    const doc = { ...d.doc, assets: { ...d.doc.assets, 'music.wav': { mime: 'audio/wav', duration: 5 } }, audio: [...d.doc.audio, music] };
    // only the music: the speech clip muted, so the dip shows
    const quiet = { ...doc, audio: doc.audio.map((a: any) => (a.speech ? { ...a, volume: 0 } : a)) };
    const mix = await mixAudio(quiet, d.assets, 5);
    const ch = mix.getChannelData(0), rms = (a: number, b: number) => { let s = 0; for (let i = Math.floor(a * 48000); i < Math.floor(b * 48000); i++) s += ch[i]! ** 2; return Math.sqrt(s / ((b - a) * 48000)); };
    const clip = doc.audio.find((a: any) => a.speech);
    return { during: rms(clip.start + 0.25, clip.start + clip.duration - 0.05), after: rms(clip.start + clip.duration + 0.3, Math.min(5, clip.start + clip.duration + 0.8)) };
  }, [...encodeWav(tone(5, 0.5))]);
  expect(levels.during).toBeLessThan(levels.after * 0.4);
});

test('download: MP4 holds the speech, with burn-in and sidecar options', async ({ page }) => {
  test.setTimeout(120_000);
  await openPanel(page);
  await page.evaluate(() => { const d = (window as any).__dc; d.updatePage({ duration: 3 }); d.seal(); });
  await script(page, 'A short spoken line.');
  await page.getByTestId('sub-generate').click();
  await expect(page.getByTestId('sub-generate')).toHaveText('Speech is up to date');
  const dir = mkdtempSync(join(tmpdir(), 'dc-sub-'));
  const clip = (await doc(page)).audio[0];

  // the same export the Download menu runs
  const bytes = await page.evaluate(async () => {
    const { exportMp4 } = await import('/src/lib/mp4.ts');
    const out = await exportMp4((window as any).__dc, { maxSide: 320, fps: 10 });
    return Array.from(out);
  });
  const mp4 = join(dir, 'out.mp4');
  writeFileSync(mp4, Buffer.from(bytes));
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', mp4]).toString());
  const audio = probe.streams.find((s: any) => s.codec_type === 'audio');
  expect(audio, 'an audio stream').toBeTruthy();
  expect(Number(audio.duration ?? probe.format.duration)).toBeGreaterThan(2.8);
  expect(Number(probe.format.duration)).toBeLessThan(3.4);
  // the sound is really there, where the clip is
  const stats = execFileSync('sh', ['-c', `ffmpeg -hide_banner -i '${mp4}' -t ${clip.duration} -af volumedetect -f null - 2>&1`]).toString();
  expect(Number(/mean_volume: (-?[\d.]+) dB/.exec(stats)![1])).toBeGreaterThan(-40);

  // burn-in off removes the caption from the picture only; the sidecar comes with it
  await page.getByTestId('download').click();
  await page.getByTestId('dl-format').selectOption('mp4');
  await expect(page.getByTestId('dl-burn')).toBeVisible();
  await page.getByTestId('dl-burn').uncheck();
  await page.getByTestId('dl-srt').check();
  const files: string[] = [];
  page.on('download', (d) => files.push(d.suggestedFilename()));
  await page.getByTestId('do-download').click();
  await expect.poll(() => files.length, { timeout: 60_000 }).toBe(2);
  expect(files.some((f) => f.endsWith('.mp4'))).toBe(true);
  expect(files.some((f) => f.endsWith('.srt'))).toBe(true);
});

test('the phone warns before the download and works in its sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await newDesign(page, 'video');
  await stubSynth(page);
  await page.getByTestId('m-subtitles').click();
  await expect(page.getByTestId('subtitles-panel')).toBeVisible();
  await script(page, 'Small screen line.');
  await page.getByTestId('sub-generate').click();
  await expect(page.getByTestId('sub-phone-warn')).toContainText('86 MB');
  await shot(page, 'phone');
  await page.getByTestId('sub-phone-go').click();
  await expect(page.getByTestId('sub-generate')).toHaveText('Speech is up to date');
  expect(await said(page)).toHaveLength(1);
});
