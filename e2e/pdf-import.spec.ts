import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { FakeDrive, FOLDER, fakeSignIn } from './fake-drive.ts';
import { CONTENT_HOSTS, doc, elements, waitSaved } from './helpers.ts';

const pdf = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url));
const SHOTS = process.env.SHOTS_DIR;

async function home(page: Page): Promise<void> {
  await page.context().route(CONTENT_HOSTS, (r) => r.fulfill({ status: 503, body: 'offline in tests' }));
  await page.goto('/');
  await expect(page.getByTestId('open-file')).toBeVisible();
}

async function openPdf(page: Page, name = 'roundtrip.pdf'): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('open-file').click();
  await (await chooser).setFiles({ name, mimeType: 'application/pdf', buffer: pdf(name) });
}

/** Rows that differ between two PDFs' first pages, rendered at 96 dpi by poppler. */
function changedRows(a: Buffer, b: Buffer): number[] {
  const dir = mkdtempSync(join(tmpdir(), 'pdfe2e-'));
  const page = (bytes: Buffer, n: string) => {
    writeFileSync(join(dir, `${n}.pdf`), bytes);
    execFileSync('pdftoppm', ['-r', '96', '-f', '1', '-l', '1', '-singlefile', join(dir, `${n}.pdf`), join(dir, n)]);
    const f = readFileSync(join(dir, `${n}.ppm`));
    const head = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(f.subarray(0, 40).toString('latin1'))!;
    return { w: +head[1]!, h: +head[2]!, px: f.subarray(head[0].length) };
  };
  const A = page(a, 'a'), B = page(b, 'b');
  const rows = new Set<number>();
  for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w * 3; x++) if (Math.abs(A.px[y * A.w * 3 + x]! - B.px[y * A.w * 3 + x]!) > 16) { rows.add(y); break; }
  return [...rows];
}

const inEditor = (page: Page) => page.waitForFunction(() => !!(window as any).__dc?.doc?.pdf, null, { timeout: 25_000 });

test('Home › Import opens a PDF as a design with real text', async ({ page }) => {
  await home(page);
  await openPdf(page);
  await inEditor(page);
  await expect(page.getByTestId('title')).toHaveValue('roundtrip');
  const d = await doc(page);
  expect(d.pages).toHaveLength(2);
  const texts = (await elements(page)).filter((e) => e.type === 'text');
  expect(texts.map((t) => t.text)).toContain('Hello from the fixture');
  // pages of two sizes: the user hears about it
  await expect(page.getByTestId('pdf-report')).toContainText('different sizes');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/r18-editor.png` });
  await page.getByTestId('pdf-report-ok').click();
  await expect(page.getByTestId('pdf-report')).toHaveCount(0);
  await waitSaved(page);
});

test('change a word, export a vector PDF: only that line changes', async ({ page }) => {
  await home(page);
  await openPdf(page);
  await inEditor(page);
  await page.getByTestId('pdf-report-ok').click();
  const bytes = async () => {
    const b64: string = await page.evaluate(async () => {
      const ed = (window as any).__dc;
      const out: Uint8Array = await ed.exportVectorPdf(ed.doc.pages.map((p: { id: string }) => p.id));
      let s = '';
      for (const b of out) s += String.fromCharCode(b);
      return btoa(s);
    });
    return Buffer.from(b64, 'base64');
  };
  const before = await bytes();
  expect(before.subarray(0, 5).toString()).toBe('%PDF-');
  const hello = (await elements(page)).find((e) => e.text?.startsWith('Hello'))!;
  await page.evaluate((id) => (window as any).__dc.select?.([id]), hello.id);
  await page.evaluate((id) => (window as any).__dc.setText(id, 'Hello from the editor'), hello.id);
  await page.waitForTimeout(150);
  const after = await elements(page);
  const edited = after.find((e) => e.id === hello.id)!;
  expect(edited.text).toBe('Hello from the editor');
  expect(edited.y).toBe(hello.y); // the line stays where the PDF put it
  const out = await bytes();
  const rows = changedRows(before, out);
  expect(rows.length).toBeGreaterThan(5);
  // every changed pixel row sits in that text box
  for (const y of rows) { expect(y).toBeGreaterThanOrEqual(hello.y - 2); expect(y).toBeLessThanOrEqual(hello.y + hello.h + 2); }
  // the other line still carries its exact glyphs
  const other = after.find((e) => e.text === 'Standard font line')!;
  expect(await page.evaluate((id) => {
    const el = (window as any).__dc.doc.pages[0].elements.find((e: { id: string }) => e.id === id);
    return !!el.exact;
  }, other.id)).toBe(true);
});

test('the editor renderer draws the imported page', async ({ page }) => {
  await home(page);
  await openPdf(page);
  await inEditor(page);
  await page.getByTestId('pdf-report-ok').click();
  await page.waitForTimeout(400);
  const dark = await page.evaluate(() => {
    const ed = (window as any).__dc;
    const png = ed.renderer.renderPageRgba(ed.doc, ed.doc.pages[0], 400, 300);
    let n = 0;
    for (let i = 0; i < png.data.length; i += 4) if (png.data[i] < 128) n++;
    return n;
  });
  expect(dark).toBeGreaterThan(500);
  if (SHOTS) await page.getByTestId('canvas').screenshot({ path: `${SHOTS}/r18-canvas.png` });
});

test('a password PDF asks, says when it is wrong, and opens', async ({ page }) => {
  await home(page);
  await openPdf(page, 'password.pdf');
  await expect(page.getByTestId('pdf-password')).toBeVisible();
  await expect(page.getByTestId('pdf-progress')).toContainText('needs a password');
  if (SHOTS) await page.getByTestId('pdf-progress').screenshot({ path: `${SHOTS}/r18-password.png` });
  await page.getByTestId('pdf-password').fill('wrong');
  await page.getByTestId('pdf-password-ok').click();
  await expect(page.getByTestId('pdf-progress')).toContainText('wrong');
  await page.getByTestId('pdf-password').fill('secret');
  await page.getByTestId('pdf-password-ok').click();
  await inEditor(page);
  expect((await elements(page)).some((e) => e.text === 'Locked text')).toBe(true);
});

test('cancel stops at the password prompt and stays on Home', async ({ page }) => {
  await home(page);
  await openPdf(page, 'password.pdf');
  await expect(page.getByTestId('pdf-password')).toBeVisible();
  await page.getByTestId('pdf-cancel').click();
  await expect(page.getByTestId('pdf-progress')).toHaveCount(0);
  await expect(page.getByTestId('open-file')).toBeVisible();
});

test('Uploads panel takes a PDF and opens it as a design', async ({ page }) => {
  await home(page);
  await page.getByTestId('preset-instagram-post').click();
  await page.waitForFunction(() => !!(window as any).__dc);
  await page.getByRole('button', { name: /^Uploads/ }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('upload').first().click();
  await (await chooser).setFiles({ name: 'from-uploads.pdf', mimeType: 'application/pdf', buffer: pdf('roundtrip.pdf') });
  await expect(page.getByTestId('title')).toHaveValue('from-uploads', { timeout: 25_000 });
});

test('a word the subset has no glyph for moves that box to a full font and says so', async ({ page }) => {
  await home(page);
  await openPdf(page);
  await inEditor(page);
  await page.getByTestId('pdf-report-ok').click();
  // no network for fonts here: the catalogue answers with what the app has, Inter
  const hello = (await elements(page)).find((e) => e.text?.startsWith('Hello'))!;
  await page.evaluate(([id]) => {
    const ed = (window as any).__dc;
    ed.engine.fonts.families.add('Arimo');
    ed.setText(id, 'Hello QZ');
  }, [hello.id]);
  await expect(page.getByText(/closest full font/)).toBeVisible();
  const el = (await elements(page)).find((e) => e.id === hello.id)!;
  expect(el.style.fontFamily).toBe('Arimo');
});

test('a broken file says so', async ({ page }) => {
  await home(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('open-file').click();
  await (await chooser).setFiles({ name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 nothing here') });
  await expect(page.getByText(/Couldn't open “bad.pdf”/)).toBeVisible({ timeout: 15_000 });
});

test('too big a file gets a clear message', async ({ page }) => {
  await home(page);
  await page.evaluate(async () => {
    const m = await import('/src/lib/pdfimport.svelte.ts');
    await m.pdfImport.open(new Uint8Array(m.MAX_PDF_BYTES + 1), 'huge.pdf');
  });
  await expect(page.getByText(/PDFs up to 300 MB can be imported/)).toBeVisible();
});

test('drop on Home, and File › Import a PDF in the editor', async ({ page }) => {
  await home(page);
  const bytes = [...pdf('roundtrip.pdf')];
  await page.evaluate((b) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(b)], 'dropped.pdf', { type: 'application/pdf' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, bytes);
  await inEditor(page);
  await expect(page.getByTestId('title')).toHaveValue('dropped');
  await page.getByTestId('pdf-report-ok').click();
  await page.getByRole('button', { name: /^File/ }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('file-import-pdf').click();
  await (await chooser).setFiles({ name: 'second.pdf', mimeType: 'application/pdf', buffer: pdf('roundtrip.pdf') });
  await expect(page.getByTestId('title')).toHaveValue('second', { timeout: 25_000 });
});

test('saved to Drive and opened again: fonts and the source come back, text is still exact', async ({ page }) => {
  const d = new FakeDrive();
  const app = d.add({ id: 'appfolder', name: 'Digital Canvas', mimeType: FOLDER, appProperties: { digitalCanvasRoot: '1' } });
  d.add({ id: 'assetsfolder', name: 'assets', mimeType: FOLDER, parents: [app.id], appProperties: { dcAssets: '1', digitalCanvasRoot: 'assets' } });
  await d.install(page);
  await page.context().route(CONTENT_HOSTS, (r) => r.fulfill({ status: 503, body: 'offline in tests' }));
  await page.goto('/');
  await fakeSignIn(page);
  await openPdf(page);
  await inEditor(page);
  await page.getByTestId('pdf-report-ok').click();
  await waitSaved(page);
  const id = (await doc(page)).id;
  expect([...d.files.values()].some((f) => f.name.endsWith('.dcanvas'))).toBe(true);
  await page.goto('/');
  await fakeSignIn(page);
  await page.evaluate((i) => { location.hash = `#/d/${i}`; }, id);
  await inEditor(page);
  await page.waitForFunction(() => (window as any).__dc.assets.size > 0);
  const exact = await page.evaluate(() => {
    const ed = (window as any).__dc;
    const t = ed.doc.pages[0].elements.find((e: { text?: string }) => e.text?.startsWith('Hello'));
    return { exact: !!t.exact, source: !!ed.assets.get(ed.doc.pdf.source), font: ed.doc.fonts.every((f: { asset: string }) => ed.assets.has(f.asset)) };
  });
  expect(exact).toEqual({ exact: true, source: true, font: true });
});
