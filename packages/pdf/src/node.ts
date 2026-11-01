import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { importPdf, type ImportOptions, type ImportResult } from './import.ts';

const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const url = (p: string) => `${pathToFileURL(join(root, p)).pathname}/`;

/** Import in Node, with pdf.js's legacy build and the data files from its package. */
export async function importPdfNode(bytes: Uint8Array, opts: ImportOptions = {}): Promise<ImportResult> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return importPdf(pdfjs, bytes, { standardFontDataUrl: url('standard_fonts'), cMapUrl: url('cmaps'), wasmUrl: url('wasm'), ...opts });
}
