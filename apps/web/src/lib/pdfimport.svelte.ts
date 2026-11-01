/**
 * Open a PDF as a design. pdf.js parses in its own worker; the file becomes a new
 * design in the current store (Drive or folder alike). State lives here so Home, the
 * editor and the Uploads panel share one progress card (lib/PdfImport.svelte).
 */
import { importPdf, PdfImportError, type ImportReport } from '@digital-canvas/pdf';
import { library } from './library.svelte.ts';
import { router } from './router.svelte.ts';
import { toast } from './toast.svelte.ts';

/** Bigger files take minutes and hundreds of MB of memory here: say so instead of freezing the tab. */
export const MAX_PDF_BYTES = 300 * 1024 * 1024;

export const isPdfBytes = (b: Uint8Array): boolean => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
export const isPdfFile = (f: { name: string; type: string }): boolean => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

class PdfImportState {
  job = $state<{ name: string; done: number; total: number; note: string } | null>(null);
  ask = $state<{ wrong: boolean; answer: (p: string | null) => void } | null>(null);
  /** What was kept as pictures and the like, after an import with something to say. */
  report = $state<{ title: string; report: ImportReport } | null>(null);
  private abort: AbortController | null = null;

  cancel(): void { this.abort?.abort(); this.ask?.answer(null); }

  async open(bytes: Uint8Array, name: string): Promise<string | null> {
    if (bytes.length > MAX_PDF_BYTES) {
      toast.show(`“${name}” is ${Math.round(bytes.length / 1048576)} MB. PDFs up to ${MAX_PDF_BYTES / 1048576} MB can be imported.`, { timeout: 10_000 });
      return null;
    }
    const title = name.replace(/\.pdf$/i, '');
    this.abort = new AbortController();
    this.job = { name, done: 0, total: 0, note: 'Opening…' };
    try {
      const pdfjs = await loadPdfjs();
      const base = `${import.meta.env.BASE_URL}pdfjs/`;
      const url = (p: string) => new URL(`${base}${p}/`, location.href).href;
      const r = await importPdf(pdfjs, bytes, {
        title, signal: this.abort.signal, standardFontDataUrl: url('standard_fonts'), cMapUrl: url('cmaps'), wasmUrl: url('wasm'),
        askPassword: (wrong) => new Promise((answer) => { this.ask = { wrong, answer: (p) => { this.ask = null; answer(p); } }; }),
        onProgress: (done, total, note) => { if (this.job) this.job = { ...this.job, done, total, note }; },
      });
      if (this.job) this.job = { ...this.job, note: 'Saving…' };
      await library.store.save({ doc: r.doc, assets: r.assets });
      router.go({ name: 'editor', id: r.doc.id });
      if (r.report.notes.length) this.report = { title, report: r.report };
      else toast.show(`Opened “${title}”: ${r.report.pages} page${r.report.pages === 1 ? '' : 's'}`);
      return r.doc.id;
    } catch (e) {
      if (e instanceof PdfImportError && e.code === 'cancelled') return null;
      toast.show(`Couldn't open “${name}”: ${e instanceof Error ? e.message : e}`, { timeout: 10_000 });
      return null;
    } finally {
      this.job = null;
      this.ask = null;
      this.abort = null;
    }
  }

  async openFile(file: File): Promise<string | null> {
    if (file.size > MAX_PDF_BYTES) return this.open(new Uint8Array(file.size), file.name);
    return this.open(new Uint8Array(await file.arrayBuffer()), file.name);
  }
}

export const pdfImport = new PdfImportState();

let loaded: Promise<unknown> | null = null;

function loadPdfjs(): Promise<unknown> {
  loaded ??= (async () => {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url), { type: 'module' });
    return pdfjs;
  })();
  return loaded;
}
