import { PDFDocument } from 'pdf-lib';
import type { Doc } from '@digital-canvas/scene';
import type { Renderer } from './renderer.ts';

export interface PdfOptions {
  /** Raster resolution of each page (print: 300). */
  dpi?: number;
  /** JPEG keeps files small; PNG is lossless. */
  image?: 'jpeg' | 'png';
  /** 0..100 for JPEG. */
  quality?: number;
  /** Page ids to include, in order (default: all visible pages). */
  pages?: string[];
  title?: string;
}

/**
 * Build a PDF with one page per design page, at the design's physical size
 * (96 px = 1 in = 72 pt). Pages are rendered by CanvasKit at `dpi` and
 * embedded as images, so the PDF looks exactly like the editor. (Vector
 * text/paths in PDF come later.)
 */
export async function exportPdf(renderer: Renderer, doc: Doc, opts: PdfOptions = {}): Promise<Uint8Array> {
  const dpi = opts.dpi ?? 300;
  const scale = dpi / 96;
  const kind = opts.image ?? 'jpeg';
  const pdf = await PDFDocument.create();
  pdf.setTitle(opts.title ?? doc.title);
  pdf.setCreator('Digital Canvas');
  pdf.setProducer('Digital Canvas (CanvasKit + pdf-lib)');
  const pages = opts.pages ? opts.pages.map((id) => doc.pages.find((p) => p.id === id)!).filter(Boolean) : doc.pages.filter((p) => !p.hidden);
  const wPt = (doc.width * 72) / 96, hPt = (doc.height * 72) / 96;
  for (const page of pages) {
    const bytes = renderer.exportPage(doc, page, { scale, format: kind, quality: opts.quality ?? 90 });
    const img = kind === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    const p = pdf.addPage([wPt, hPt]);
    p.drawImage(img, { x: 0, y: 0, width: wPt, height: hPt });
  }
  return pdf.save();
}
