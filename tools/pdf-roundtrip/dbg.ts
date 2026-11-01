import { readFileSync } from 'node:fs';
import { importPdfNode } from '@digital-canvas/pdf/node';
const r = await importPdfNode(new Uint8Array(readFileSync(process.argv[2]!)), { pages: [1] });
const t = r.doc.pages[0]!.elements.filter((e) => e.type === 'text').slice(0, 4);
console.log(JSON.stringify(t, null, 0).slice(0, 1800));
console.log(r.report.texts, r.report.paths, r.report.images);
