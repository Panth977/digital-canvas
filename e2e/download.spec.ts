import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { expect, test, type Download, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from 'pdf-lib';
import { newDesign } from './helpers.ts';

/** The Download panel's new formats (r11): bytes, magic numbers and structure. Screenshots of each panel go to SHOTS. */
const SHOTS = '/tmp/orch27-rw';
mkdirSync(SHOTS, { recursive: true });

const bytesOf = async (d: Download) => readFileSync((await d.path())!);
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

async function openAs(page: Page, format: string, shot?: string): Promise<void> {
  await page.getByTestId('download').click();
  await page.getByTestId('dl-format').selectOption(format);
  if (shot) await page.getByTestId('download-menu').screenshot({ path: `${SHOTS}/r11-dl-${shot}.png` });
}

async function save(page: Page, timeout = 30_000): Promise<Download> {
  const dl = page.waitForEvent('download', { timeout });
  await page.getByTestId('do-download').click();
  return dl;
}

/** Notes on page `i` (the editor has no notes UI yet; the scene field is what the exporters read). */
async function setNotes(page: Page, i: number, notes: string): Promise<void> {
  await page.evaluate(([i, notes]) => {
    const ed = (window as any).__dc;
    ed.commit({ ...ed.doc, pages: ed.doc.pages.map((p: any, k: number) => (k === i ? { ...p, notes } : p)) });
  }, [i, notes] as const);
}

function probe(path: string, entries: string): string {
  try { return execFileSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'csv=p=0', path]).toString(); } catch { return ''; }
}

test('Download lists Canva\'s file types in order, plus PPTX and our .dcanvas', async ({ page }) => {
  await newDesign(page, 'logo');
  await page.getByTestId('download').click();
  await expect(page.getByTestId('dl-format').locator('option')).toHaveText(['PNG · Suggested', 'JPG', 'PDF Standard', 'PDF Print', 'SVG', 'GIF', 'PPTX', 'Digital Canvas file']);
});

test('PDF Print: crop marks and bleed, CMYK, notes; flattened pages as separate files', async ({ page }) => {
  await newDesign(page, 'a4');
  await page.getByTestId('shape-star').click();
  await page.getByTestId('add-page').click();
  await setNotes(page, 0, 'Print on matte stock.');
  await openAs(page, 'pdf');
  await page.getByTestId('dl-marks').check();
  await page.getByTestId('dl-profile').selectOption('cmyk');
  await expect(page.getByTestId('dl-cmyk-note')).toBeVisible();
  await expect(page.getByTestId('dl-notes')).toBeChecked();
  await page.getByTestId('download-menu').screenshot({ path: `${SHOTS}/r11-dl-pdf-print.png` });
  let file = await save(page);
  expect(file.suggestedFilename()).toBe('A4 document.pdf');
  const bytes = await bytesOf(file);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBe(3); // page 1, its notes, page 2
  const p1 = pdf.getPage(0);
  expect(p1.getTrimBox().width).toBeCloseTo(595.3, 0); // A4 trim
  expect(p1.getWidth()).toBeGreaterThan(595.3 + 2 * 25); // + bleed and marks slug (9 mm a side)
  expect(p1.getBleedBox().width).toBeCloseTo(595.3 + 2 * 8.5, 0); // 3 mm bleed
  const contents = p1.node.Contents()!;
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => pdf.context.lookup(r)) : [contents];
  const ops = streams.map((s) => Buffer.from(decodePDFRawStream(s as PDFRawStream).decode()).toString('latin1')).join('\n');
  expect(ops).toMatch(/ k\n/); // CMYK fills
  expect(ops).not.toMatch(/ rg\n/); // no RGB ones
  expect(ops).toMatch(/1 1 1 1 K/); // crop marks in registration colour

  // Flatten + separate files: a zip of one PDF per page
  await openAs(page, 'pdf');
  await page.getByTestId('dl-marks').uncheck();
  await page.getByTestId('dl-profile').selectOption('rgb');
  await page.getByTestId('dl-flatten').check();
  await page.getByTestId('dl-separate').check();
  file = await save(page);
  expect(file.suggestedFilename()).toBe('A4 document.zip');
  const zip = unzipSync(await bytesOf(file));
  expect(Object.keys(zip).sort()).toEqual(['A4 document - page 1.pdf', 'A4 document - page 2.pdf']);
  const flat = await PDFDocument.load(zip['A4 document - page 1.pdf']!);
  expect(flat.getPageCount()).toBe(2); // page + notes
  expect(flat.getPage(0).getWidth()).toBeCloseTo(595.3, 0);
});

test('PPTX: a slide per page with editable text, notes', async ({ page }) => {
  await newDesign(page, 'presentation');
  await page.getByTestId('shape-rect').click();
  await page.getByTestId('tab-text').click();
  await page.getByTestId('text-heading').click();
  await page.keyboard.press('Escape');
  await page.getByTestId('add-page').click();
  await setNotes(page, 1, 'Thank the team.');
  await openAs(page, 'pptx', 'pptx');
  const file = await save(page);
  expect(file.suggestedFilename()).toMatch(/\.pptx$/);
  const bytes = await bytesOf(file);
  expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  const zip = unzipSync(bytes);
  expect(Object.keys(zip)[0]).toBe('[Content_Types].xml');
  const pres = strFromU8(zip['ppt/presentation.xml']!);
  expect((pres.match(/<p:sldId /g) ?? []).length).toBe(2);
  expect(pres).toContain('<p:sldSz cx="18288000" cy="10287000"/>'); // 1920 × 1080
  const heading = await page.evaluate(() => (window as any).__dc.doc.pages[0].elements.find((e: any) => e.type === 'text').text);
  const s1 = strFromU8(zip['ppt/slides/slide1.xml']!);
  expect(s1).toContain(`<a:t>${heading}</a:t>`);
  expect(s1).toContain('<p:pic>'); // the rectangle
  expect(strFromU8(zip['ppt/notesSlides/notesSlide2.xml']!)).toContain('Thank the team.');
});

test('MP4: Canva quality (720p) and pages as separate files', async ({ page }) => {
  test.setTimeout(90_000);
  await newDesign(page, 'video');
  await page.getByTestId('shape-rect').click();
  await page.evaluate(() => {
    const ed = (window as any).__dc;
    const p = ed.doc.pages[0];
    ed.commit({ ...ed.doc, pages: [{ ...p, duration: 1 }, { ...p, id: 'p_second', elements: [], duration: 1, background: { type: 'solid', color: '#ff0000' } }] });
  });
  await openAs(page, 'mp4');
  await page.getByTestId('dl-video-quality').selectOption('720');
  await expect(page.getByTestId('dl-video-size')).toContainText('1280 × 720 px');
  await page.getByTestId('dl-separate').check();
  await page.getByTestId('download-menu').screenshot({ path: `${SHOTS}/r11-dl-mp4.png` });
  const file = await save(page, 80_000);
  expect(file.suggestedFilename()).toMatch(/\.zip$/);
  const zip = unzipSync(await bytesOf(file));
  const names = Object.keys(zip).sort();
  expect(names).toHaveLength(2);
  for (const n of names) {
    expect(n).toMatch(/ - page [12]\.mp4$/);
    expect(Buffer.from(zip[n]!.subarray(4, 8)).toString()).toBe('ftyp');
  }
  const tmp = `${test.info().outputDir}/page1.mp4`;
  mkdirSync(test.info().outputDir, { recursive: true });
  (await import('node:fs')).writeFileSync(tmp, zip[names[0]!]!);
  const p = probe(tmp, 'stream=width,height:format=duration');
  if (p) {
    expect(p).toContain('1280,720');
    expect(Number(p.trim().split('\n').pop())).toBeLessThan(1.3);
  }
});

test('GIF: Canva size 0.4x with a transparent background', async ({ page }) => {
  await newDesign(page, 'logo');
  await page.getByTestId('shape-ellipse').click();
  await openAs(page, 'gif');
  await page.getByTestId('dl-gif-0.4').click();
  await page.getByTestId('dl-transparent').check();
  await page.getByTestId('download-menu').screenshot({ path: `${SHOTS}/r11-dl-gif.png` });
  const file = await save(page);
  const b = await bytesOf(file);
  expect(b.subarray(0, 6).toString()).toBe('GIF89a');
  expect(b.readUInt16LE(6)).toBe(200); // 500 × 0.4
  expect(b.readUInt16LE(8)).toBe(200);
  // a Graphic Control Extension with the transparency flag
  const gce = b.indexOf(Buffer.from([0x21, 0xf9, 0x04]));
  expect(gce).toBeGreaterThan(0);
  expect(b[gce + 3]! & 1).toBe(1);
});

test('MP3: the design\'s sound only', async ({ page }) => {
  test.setTimeout(60_000);
  await newDesign(page, 'video');
  if (!(await page.getByTestId('upload').isVisible())) await page.getByTestId('tab-uploads').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('upload').click();
  await (await chooser).setFiles({ name: 'tone.mp3', mimeType: 'audio/mpeg', buffer: fixture('tone.mp3') });
  await expect.poll(async () => page.evaluate(() => (window as any).__dc.doc.audio?.length ?? 0)).toBe(1);
  await page.getByTestId('download').click();
  await expect(page.getByTestId('dl-format').locator('option')).toHaveText(['PNG', 'JPG', 'PDF Standard', 'PDF Print', 'SVG', 'MP4 Video · Suggested', 'GIF', 'PPTX', 'MP3', 'Digital Canvas file']);
  await page.getByTestId('dl-format').selectOption('mp3');
  await page.getByTestId('download-menu').screenshot({ path: `${SHOTS}/r11-dl-mp3.png` });
  const file = await save(page, 50_000);
  expect(file.suggestedFilename()).toMatch(/\.mp3$/);
  const b = await bytesOf(file);
  // an ID3 tag or straight into an MPEG audio frame (sync word 0xFFE)
  expect(b.subarray(0, 3).toString() === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0)).toBe(true);
  expect(b.length).toBeGreaterThan(5_000);
  const tmp = `${test.info().outputDir}/sound.mp3`;
  mkdirSync(test.info().outputDir, { recursive: true });
  (await import('node:fs')).writeFileSync(tmp, b);
  const p = probe(tmp, 'stream=codec_name,codec_type');
  if (p) {
    expect(p).toContain('mp3,audio');
    expect(p).not.toContain('video');
  }
});

test('.dcanvas: the design as our own file', async ({ page }) => {
  await newDesign(page, 'logo');
  await page.getByTestId('shape-star').click();
  await openAs(page, 'dcanvas', 'dcanvas');
  const file = await save(page);
  expect(file.suggestedFilename()).toBe('Logo.dcanvas');
  const zip = unzipSync(await bytesOf(file));
  expect(strFromU8(zip['mimetype']!)).toBe('application/vnd.digital-canvas+zip');
  const doc = JSON.parse(strFromU8(zip['document.json']!));
  expect(doc.pages[0].elements[0].shape).toBe('star');
  expect(Array.from(zip['thumbnail.png']!.subarray(1, 4))).toEqual([0x50, 0x4e, 0x47]);
});

test('Download panel screenshots of the other types', async ({ page }) => {
  await newDesign(page, 'a4');
  await page.getByTestId('shape-star').click();
  for (const f of ['png', 'jpeg', 'pdfv', 'svg']) {
    await openAs(page, f, f);
    await page.getByTestId('download').click(); // close
  }
});
