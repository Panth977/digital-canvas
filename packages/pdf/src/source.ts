/**
 * The original objects behind pdf.js's operator list. pdf.js resolves every colour to
 * RGB and hides which object a font or image came from, so we read the content
 * streams ourselves and line our events up with its operators, one queue per kind.
 * Each match is checked; a queue that loses step just stops answering, and the
 * importer falls back on what pdf.js gave. Nothing here can break an import.
 */
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, type PDFObject } from 'pdf-lib';
import type { SourceColor } from '@digital-canvas/scene';

interface FontEvent { obj?: number; size: number }
interface ImageEvent { obj: number; w: number; h: number }
interface ColorEvent { cs: SourceColor['cs'] | null; v: number[] }

const WINDOW = 32;

function matchesRgb(e: ColorEvent, hex: string): boolean {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const got = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  const close = (want: number[]) => want.every((w, i) => Math.abs(w * 255 - got[i]!) <= 2);
  if (e.cs === 'g') return close([e.v[0]!, e.v[0]!, e.v[0]!]);
  if (e.cs === 'rg') return close(e.v);
  return true; // CMYK and friends: pdf.js's conversion is its own
}

/** CMYK on screen: the 16 corners of the ink cube, as Adobe's and poppler's default conversions have them. */
const CORNERS: [number, number, number][] = [[1, 1, 1], [0.1373, 0.1373, 0.1373], [1, 0.949, 0], [0.1098, 0.102, 0], [0.9255, 0, 0.549], [0.1412, 0, 0], [0.9294, 0.1098, 0.1412], [0.1333, 0, 0],
  [0, 0.6784, 0.9373], [0, 0.0588, 0.1412], [0, 0.651, 0.3137], [0, 0.0745, 0], [0.1804, 0.1922, 0.5725], [0, 0, 0.0078], [0.2118, 0.2119, 0.2235], [0, 0, 0]];

export function cmykHex(v: number[]): string {
  const [c, m, y, k] = v.map((x) => Math.min(1, Math.max(0, x))) as [number, number, number, number];
  const rgb = [0, 0, 0];
  CORNERS.forEach((corner, i) => {
    const w = (i & 8 ? c : 1 - c) * (i & 4 ? m : 1 - m) * (i & 2 ? y : 1 - y) * (i & 1 ? k : 1 - k);
    for (let a = 0; a < 3; a++) rgb[a]! += w * corner[a]!;
  });
  return `#${rgb.map((x) => Math.round(Math.min(1, x) * 255).toString(16).padStart(2, '0')).join('')}`;
}

export class PageScan {
  private f = 0; private i = 0; private cf = 0; private cs = 0;
  constructor(private fonts: FontEvent[], private images: ImageEvent[], private fills: ColorEvent[], private strokes: ColorEvent[]) {}

  /** Annotations come after the page's content, from streams we don't read. */
  annotation(): void { this.fonts = []; this.images = []; this.fills = []; this.strokes = []; this.f = this.i = this.cf = this.cs = 0; }

  nextFont(size: number): number | undefined {
    for (let k = this.f; k < Math.min(this.fonts.length, this.f + WINDOW); k++) {
      if (Math.abs(this.fonts[k]!.size - size) < 1e-3) { this.f = k + 1; return this.fonts[k]!.obj; }
    }
    return undefined;
  }

  nextImage(w: number, h: number): { obj: number } | undefined {
    for (let k = this.i; k < Math.min(this.images.length, this.i + WINDOW); k++) {
      const e = this.images[k]!;
      if (e.w === w && e.h === h) { this.i = k + 1; return { obj: e.obj }; }
    }
    return undefined;
  }

  nextColor(kind: 'fill' | 'stroke', hex: string): SourceColor | undefined {
    const q = kind === 'fill' ? this.fills : this.strokes;
    const at = kind === 'fill' ? this.cf : this.cs;
    for (let k = at; k < Math.min(q.length, at + WINDOW); k++) {
      const e = q[k]!;
      if (!matchesRgb(e, hex)) continue;
      if (kind === 'fill') this.cf = k + 1; else this.cs = k + 1;
      // plain RGB and grey read the same from pdf.js: only other inks are worth keeping
      if (e.cs === null || e.cs === 'rg') return undefined;
      return { cs: e.cs, v: e.v, rgb: e.cs === 'k' ? cmykHex(e.v) : hex };
    }
    return undefined;
  }
}

type Tok = { k: 'num'; v: number } | { k: 'name'; v: string } | { k: 'op'; v: string } | { k: 'other' };

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);

/** Walks a content stream; calls `op` with each operator and its operands. Strings and arrays are skipped. */
function tokenize(b: Uint8Array, op: (name: string, args: Tok[]) => void): void {
  let i = 0;
  let args: Tok[] = [];
  const n = b.length;
  while (i < n) {
    const c = b[i]!;
    if (WS.has(c)) { i++; continue; }
    if (c === 37) { while (i < n && b[i] !== 10 && b[i] !== 13) i++; continue; }
    if (c === 40) { // string
      let depth = 1; i++;
      while (i < n && depth) { const d = b[i]!; if (d === 92) i++; else if (d === 40) depth++; else if (d === 41) depth--; i++; }
      args.push({ k: 'other' });
      continue;
    }
    if (c === 60) {
      if (b[i + 1] === 60) { // dict
        let depth = 1; i += 2;
        while (i < n && depth) {
          if (b[i] === 60 && b[i + 1] === 60) { depth++; i += 2; } else if (b[i] === 62 && b[i + 1] === 62) { depth--; i += 2; } else i++;
        }
      } else { while (i < n && b[i] !== 62) i++; i++; }
      args.push({ k: 'other' });
      continue;
    }
    if (c === 91 || c === 93 || c === 123 || c === 125 || c === 41 || c === 62) { i++; if (c === 91) args.push({ k: 'other' }); continue; }
    let j = i + (c === 47 ? 1 : 0);
    while (j < n && !WS.has(b[j]!) && !DELIM.has(b[j]!)) j++;
    let word = '';
    for (let k = c === 47 ? i + 1 : i; k < j; k++) word += String.fromCharCode(b[k]!);
    i = j === i ? i + 1 : j;
    if (c === 47) { args.push({ k: 'name', v: word.replace(/#([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))) }); continue; }
    const num = Number(word);
    if (word !== '' && !Number.isNaN(num)) { args.push({ k: 'num', v: num }); continue; }
    if (word === 'BI') { // inline image: its data can hold anything; skip to a standalone EI
      while (i < n && !(b[i] === 73 && b[i + 1] === 68 && WS.has(b[i + 2] ?? 32))) i++;
      i += 3;
      while (i < n && !(WS.has(b[i - 1]!) && b[i] === 69 && b[i + 1] === 73 && (i + 2 >= n || WS.has(b[i + 2]!)))) i++;
      i += 2;
      args = [];
      continue;
    }
    op(word, args);
    args = [];
  }
}

const nums = (a: Tok[]): number[] => a.flatMap((t) => (t.k === 'num' ? [t.v] : []));

export class Source {
  private pages: { node: { Resources(): PDFDict | undefined; Contents(): PDFObject | undefined } }[];
  constructor(private doc: PDFDocument) {
    this.pages = doc.getPages() as never;
  }

  private look(o: PDFObject | undefined): PDFObject | undefined {
    return o instanceof PDFRef ? this.doc.context.lookup(o) : o;
  }

  private bytesOf(o: PDFObject | undefined): Uint8Array {
    const s = this.look(o);
    if (s instanceof PDFArray) {
      const parts = s.asArray().map((x) => this.bytesOf(x));
      const out = new Uint8Array(parts.reduce((a, p) => a + p.length + 1, 0));
      let at = 0;
      for (const p of parts) { out.set(p, at); out[at + p.length] = 10; at += p.length + 1; }
      return out;
    }
    if (s instanceof PDFRawStream) return decodePDFRawStream(s).decode();
    if (s instanceof PDFStream) return s.getContents();
    return new Uint8Array(0);
  }

  private dictIn(res: PDFDict | undefined, key: string): PDFDict | undefined {
    const d = res ? this.look(res.get(PDFName.of(key))) : undefined;
    return d instanceof PDFDict ? d : undefined;
  }

  private spaceOf(name: string, res: PDFDict | undefined): SourceColor['cs'] | 'pattern' | null {
    if (name === 'DeviceGray' || name === 'G') return 'g';
    if (name === 'DeviceRGB' || name === 'RGB') return 'rg';
    if (name === 'DeviceCMYK' || name === 'CMYK') return 'k';
    if (name === 'Pattern') return 'pattern';
    const v = this.dictIn(res, 'ColorSpace')?.get(PDFName.of(name));
    if (v instanceof PDFRef) {
      const obj = this.look(v);
      if (obj instanceof PDFArray && obj.get(0)?.toString() === '/Pattern') return 'pattern';
      return v.objectNumber;
    }
    if (v instanceof PDFArray && v.get(0)?.toString() === '/Pattern') return 'pattern';
    return null;
  }

  scanPage(index: number): PageScan | null {
    try {
      const page = this.pages[index];
      if (!page) return null;
      const fonts: FontEvent[] = [], images: ImageEvent[] = [], fills: ColorEvent[] = [], strokes: ColorEvent[] = [];
      const run = (bytes: Uint8Array, res: PDFDict | undefined, depth: number) => {
        type Cs = SourceColor['cs'] | 'pattern' | null;
        let fillCs: Cs = 'g' as Cs, strokeCs: Cs = 'g' as Cs;
        const stack: [Cs, Cs][] = [];
        tokenize(bytes, (op, a) => {
          switch (op) {
            case 'q': stack.push([fillCs, strokeCs]); break;
            case 'Q': { const s = stack.pop(); if (s) [fillCs, strokeCs] = s; break; }
            case 'g': fillCs = 'g'; fills.push({ cs: 'g', v: nums(a) }); break;
            case 'G': strokeCs = 'g'; strokes.push({ cs: 'g', v: nums(a) }); break;
            case 'rg': fillCs = 'rg'; fills.push({ cs: 'rg', v: nums(a) }); break;
            case 'RG': strokeCs = 'rg'; strokes.push({ cs: 'rg', v: nums(a) }); break;
            case 'k': fillCs = 'k'; fills.push({ cs: 'k', v: nums(a) }); break;
            case 'K': strokeCs = 'k'; strokes.push({ cs: 'k', v: nums(a) }); break;
            case 'cs': if (a[0]?.k === 'name') fillCs = this.spaceOf(a[0].v, res); break;
            case 'CS': if (a[0]?.k === 'name') strokeCs = this.spaceOf(a[0].v, res); break;
            case 'sc': case 'scn': if (fillCs !== 'pattern') fills.push({ cs: fillCs, v: nums(a) }); break;
            case 'SC': case 'SCN': if (strokeCs !== 'pattern') strokes.push({ cs: strokeCs, v: nums(a) }); break;
            case 'Tf': {
              const name = a[0]?.k === 'name' ? a[0].v : '', size = nums(a)[0] ?? 0;
              const v = this.dictIn(res, 'Font')?.get(PDFName.of(name));
              fonts.push({ obj: v instanceof PDFRef ? v.objectNumber : undefined, size });
              break;
            }
            case 'Do': {
              if (a[0]?.k !== 'name' || depth > 24) break;
              const ref = this.dictIn(res, 'XObject')?.get(PDFName.of(a[0].v));
              const x = this.look(ref);
              if (!(x instanceof PDFStream)) break;
              const sub = x.dict.get(PDFName.of('Subtype'))?.toString();
              if (sub === '/Image' && ref instanceof PDFRef) {
                const num = (k: string) => { const v = this.look(x.dict.get(PDFName.of(k))); return v instanceof PDFNumber ? v.asNumber() : 0; };
                images.push({ obj: ref.objectNumber, w: num('Width'), h: num('Height') });
              } else if (sub === '/Form') {
                const inner = this.look(x.dict.get(PDFName.of('Resources')));
                run(this.bytesOf(x), inner instanceof PDFDict ? inner : res, depth + 1);
              }
              break;
            }
            default: break;
          }
        });
      };
      run(this.bytesOf(page.node.Contents()), page.node.Resources(), 0);
      return new PageScan(fonts, images, fills, strokes);
    } catch {
      return null;
    }
  }

  /** The original JPEG of an image, when a decoder would show it as the PDF does: plain grey or RGB, unmasked. */
  jpegBytes(obj: number): Uint8Array | null {
    const x = this.doc.context.lookup(PDFRef.of(obj));
    if (!(x instanceof PDFRawStream)) return null;
    const get = (k: string) => this.look(x.dict.get(PDFName.of(k)));
    let f = get('Filter');
    if (f instanceof PDFArray && f.size() === 1) f = this.look(f.get(0));
    if (f?.toString() !== '/DCTDecode') return null;
    if (get('SMask') || get('Mask') || get('Decode')) return null;
    const cs = get('ColorSpace')?.toString();
    if (cs === '/DeviceGray' || cs === '/DeviceRGB') return x.getContents();
    const arr = get('ColorSpace');
    if (arr instanceof PDFArray && arr.get(0)?.toString() === '/ICCBased') {
      const icc = this.look(arr.get(1));
      const N = icc instanceof PDFStream ? this.look(icc.dict.get(PDFName.of('N'))) : undefined;
      if (N instanceof PDFNumber && N.asNumber() !== 4) return x.getContents();
    }
    return null;
  }
}

/** Null when pdf-lib can't read the file (encrypted, or too broken): the import then works from pdf.js alone. */
export async function openSource(bytes: Uint8Array): Promise<Source | null> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    if (doc.isEncrypted) return null;
    return new Source(doc);
  } catch {
    return null;
  }
}
