/**
 * Small self-made PDFs for tests: `npx tsx tools/pdf-roundtrip/fixtures.ts` writes e2e/fixtures/roundtrip.pdf and password.pdf.
 * roundtrip.pdf covers text in an embedded and a standard font, CMYK, strokes, dashes, a clip, a gradient,
 * alpha, an image, a link and a second page of another size. password.pdf opens with "secret".
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFName, PDFOperator, PDFString, StandardFonts, rgb } from 'pdf-lib';

const zlibPng = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAJElEQVR4nGP8z8DAwMDAxMDAwMDAwAAmGP8zMDAwMDAxMDAwAAAqFAIHnZ0mWQAAAABJRU5ErkJggg==';

export async function roundtripPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle('Round trip fixture');
  const inter = await pdf.embedFont(readFileSync(new URL('../../apps/web/public/fonts/Inter-Regular.ttf', import.meta.url)), { subset: true });
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([400, 300]);
  page.drawText('Hello from the fixture', { x: 30, y: 250, size: 20, font: inter, color: rgb(0.1, 0.2, 0.6) });
  page.drawText('Standard font line', { x: 30, y: 220, size: 14, font: helv });
  const png = await pdf.embedPng(Buffer.from(zlibPng, 'base64'));
  page.drawImage(png, { x: 280, y: 200, width: 80, height: 80 });
  const raw = `q 0 0.8 0.9 0.1 k 30 120 100 60 re f Q
q 0.2 0.6 0.2 RG 4 w [8 4] 0 d 1 J 150 120 m 250 180 l S Q
q 270 120 80 60 re W n 1 0 0 rg 300 150 m 400 150 l 350 250 l h f Q`;
  page.pushOperators(...raw.split('\n').map((l) => PDFOperator.of(l as never)));
  const sh = pdf.context.obj({ ShadingType: 2, ColorSpace: 'DeviceRGB', Coords: [30, 0, 130, 0], Extend: [true, true], Function: { FunctionType: 2, Domain: [0, 1], N: 1, C0: [1, 0, 0], C1: [0, 0, 1] } });
  const res = page.node.normalizedEntries().Resources;
  res.set(PDFName.of('Shading'), pdf.context.obj({ Sh0: pdf.context.register(sh) }));
  page.pushOperators(PDFOperator.of('q 30 40 100 50 re W n /Sh0 sh Q' as never));
  page.drawRectangle({ x: 160, y: 40, width: 100, height: 50, color: rgb(1, 0, 0), opacity: 0.5 });
  const link = pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [30, 245, 200, 275], Border: [0, 0, 0], A: { S: 'URI', URI: PDFString.of('https://example.com/') } }));
  page.node.set(PDFName.of('Annots'), pdf.context.obj([link]));
  const two = pdf.addPage([200, 200]);
  two.drawText('Small page', { x: 20, y: 100, size: 16, font: helv });
  return pdf.save({ useObjectStreams: false });
}

const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');
const md5 = (...b: Uint8Array[]) => { const h = createHash('md5'); for (const x of b) h.update(x); return h.digest(); };

function rc4(key: Uint8Array, data: Uint8Array): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i]! + key[i % key.length]!) & 255; [s[i], s[j]] = [s[j]!, s[i]!]; }
  const out = Buffer.alloc(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255; j = (j + s[i]!) & 255; [s[i], s[j]] = [s[j]!, s[i]!];
    out[k] = data[k]! ^ s[(s[i]! + s[j]!) & 255]!;
  }
  return out;
}

/** A one-page PDF under the 40-bit standard handler (revision 2). */
export function passwordPdf(password = 'secret'): Uint8Array {
  const padded = (p: string) => Buffer.concat([Buffer.from(p), PAD]).subarray(0, 32);
  const O = rc4(md5(padded(password)).subarray(0, 5), padded(password));
  const id = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const P = Buffer.alloc(4); P.writeInt32LE(-4);
  const key = md5(padded(password), O, P, id).subarray(0, 5);
  const U = rc4(key, PAD);
  const objKey = (n: number) => md5(key, Buffer.from([n & 255, n >> 8, 0, 0, 0])).subarray(0, 10);
  const content = rc4(objKey(4), Buffer.from('BT /F1 24 Tf 40 100 Td (Locked text) Tj ET'));
  const parts: Buffer[] = [Buffer.from('%PDF-1.3\n')];
  const offs: number[] = [];
  const add = (n: number, body: Buffer | string) => { offs[n] = Buffer.concat(parts).length; parts.push(Buffer.from(`${n} 0 obj\n`), Buffer.from(body as never), Buffer.from('\nendobj\n')); };
  add(1, '<</Type/Catalog/Pages 2 0 R>>');
  add(2, '<</Type/Pages/Kids[3 0 R]/Count 1>>');
  add(3, '<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>>>');
  add(4, Buffer.concat([Buffer.from(`<</Length ${content.length}>>stream\n`), content, Buffer.from('\nendstream')]));
  add(5, `<</Filter/Standard/V 1/R 2/O<${O.toString('hex')}>/U<${U.toString('hex')}>/P -4>>`);
  const at = Buffer.concat(parts).length;
  const xref = `xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => `${String(offs[n]).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<</Size 6/Root 1 0 R/Encrypt 5 0 R/ID[<${id.toString('hex')}><${id.toString('hex')}>]>>\nstartxref\n${at}\n%%EOF\n`;
  return new Uint8Array(Buffer.concat([...parts, Buffer.from(xref)]));
}

if (process.argv[1]?.endsWith('fixtures.ts')) {
  const dir = new URL('../../e2e/fixtures/', import.meta.url);
  writeFileSync(new URL('roundtrip.pdf', dir), await roundtripPdf());
  writeFileSync(new URL('password.pdf', dir), passwordPdf());
}
