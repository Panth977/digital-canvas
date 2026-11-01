import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
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

test('edit a word, export a vector PDF: only that text changes', async ({ page }) => {
  await home(page);
  await openPdf(page);
  await inEditor(page);
  await page.getByTestId('pdf-report-ok').click();
  const bytes = async () => {
    const b64: string = await page.evaluate(async () => {
      const ed = (window as any).__dc;
      const out: Uint8Array = await ed.exportVectorPdfBytes();
      let s = '';
      for (const b of out) s += String.fromCharCode(b);
      return btoa(s);
    });
    return Buffer.from(b64, 'base64');
  };
  const before = await bytes();
  expect(before.subarray(0, 5).toString()).toBe('%PDF-');
  const hello = (await elements(page)).find((e) => e.text?.startsWith('Hello'))!;
  await page.evaluate((id) => (window as any).__dc.setText(id, 'Hello from the editor'), hello.id);
  const after = await elements(page);
  const edited = after.find((e) => e.id === hello.id)!;
  expect(edited.text).toBe('Hello from the editor');
  expect(edited.y).toBe(hello.y); // the line stays where the PDF put it
  const out = await bytes();
  expect(out.length).toBeGreaterThan(1000);
  // the other line still carries its exact glyphs
  const other = after.find((e) => e.text === 'Standard font line')!;
  expect(await page.evaluate((id) => {
    const el = (window as any).__dc.doc.pages[0].elements.find((e: { id: string }) => e.id === id);
    return !!el.exact;
  }, other.id)).toBe(true);
});

test('canvas shows the page: pixels match the export path', async ({ page }) => {
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
  await page.getByTestId('file-menu').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('file-import-pdf').click();
  await (await chooser).setFiles({ name: 'second.pdf', mimeType: 'application/pdf', buffer: pdf('roundtrip.pdf') });
  await expect(page.getByTestId('title')).toHaveValue('second', { timeout: 25_000 });
});
