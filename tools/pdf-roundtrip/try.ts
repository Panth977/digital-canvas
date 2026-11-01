import { readFileSync } from 'node:fs';
import { importPdfNode } from '@digital-canvas/pdf/node';
for (const f of process.argv.slice(2)) {
  const t=Date.now();
  try {
    const r = await importPdfNode(new Uint8Array(readFileSync(f)), { pages: [1] });
    const { flattened, fonts, ...rest } = r.report;
    console.log(f.split('/').pop(), Date.now()-t+'ms', JSON.stringify(rest), 'flat', JSON.stringify(flattened.slice(0,3)), 'fonts', fonts.length, 'objs', Object.values(r.doc.pdf!.fonts).map(x=>x.obj).join(','));
  } catch (e) { console.log(f.split('/').pop(), 'ERR', (e as Error).stack?.slice(0,400)); }
}
