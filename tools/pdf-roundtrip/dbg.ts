import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { importPdfNode } from '@digital-canvas/pdf/node';
import { exportVectorPdf, FontLibrary, Renderer } from '@digital-canvas/render';
import { decodePDFRawStream, PDFDocument, PDFName, PDFRawStream, PDFArray } from 'pdf-lib';
const f = process.argv[2]!, pn = +(process.argv[3] ?? 1);
const src = new Uint8Array(readFileSync(f));
const r = await importPdfNode(src, { pages: [pn] });
const els = r.doc.pages[0]!.elements;
console.log('page', r.doc.width, r.doc.height, 'els', els.length, r.report.notes);
console.log(JSON.stringify(r.report.flattened), els.filter((e:any)=>e.pdfVector).map((e:any)=>JSON.stringify(e.pdfVector).slice(0,200)));
for (const e of els.slice(0, 0)) console.log(e.type, e.name?.slice(0,30), e.x, e.y, e.w, e.h, e.rotation, (e as any).flipY, JSON.stringify((e as any).pdfImage), JSON.stringify((e as any).exact?.runs?.[0]?.m), e.pdfClip ? JSON.stringify(e.pdfClip.paths).slice(0,120) : '');
const ck = await createRequire(import.meta.url)('canvaskit-wasm/bin/full/canvaskit.js')();
const fonts = new FontLibrary(ck);
const renderer = new Renderer(ck, fonts);
for (const fnt of r.doc.fonts ?? []) { const b = r.assets.get(fnt.asset); if (b) fonts.add(fnt.family, b, fnt.subset); }
for (const [id, b] of r.assets) if (r.doc.assets[id]?.mime.startsWith('image/')) renderer.setImage(id, b);
const out = await exportVectorPdf(renderer, r.doc, { assets: r.assets });
writeFileSync('/tmp/dbg-out.pdf', out);
const content = async (bytes: Uint8Array, i: number) => {
  const d = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  const c = d.getPages()[i]!.node.Contents();
  const parts = c instanceof PDFArray ? c.asArray().map((x) => d.context.lookup(x)) : [c];
  return parts.map((s) => new TextDecoder('latin1').decode(decodePDFRawStream(s as PDFRawStream).decode())).join('\n');
};
const a = await content(src, pn - 1), b = await content(out, 0);
console.log('--- SOURCE\n', a.slice(0, +(process.argv[4] ?? 700)));
console.log('--- OURS\n', b.slice(0, +(process.argv[4] ?? 700)));
