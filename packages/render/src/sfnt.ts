/// <reference path="./brotli.d.ts" />
/**
 * Font files for CanvasKit, which reads TrueType/OpenType (SFNT) only:
 * `toSfnt` turns WOFF and WOFF2 back into SFNT (pure TS, sync, Node and
 * browser), `fontInfo` reads family, weight and italic from the name and
 * OS/2 tables (to pre-fill the font plugin form).
 *
 * WOFF: zlib per table (fflate). WOFF2 (W3C WOFF2 §4–5): one Brotli stream
 * (the `brotli` package's pure-JS decoder, MIT / Apache-2.0) plus the glyf/loca
 * and hmtx transforms rebuilt here.
 */
import { unzlibSync } from 'fflate';
// CommonJS, no types: (input bytes, output size?) => bytes
import brotliDecompress from 'brotli/decompress.js';

export class FontFileError extends Error {}

const tagOf = (b: Uint8Array, o: number) => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);

/** What kind of font file the bytes are. */
export function fontFormat(bytes: Uint8Array): 'ttf' | 'otf' | 'woff' | 'woff2' | 'ttc' | null {
  if (bytes.length < 12) return null;
  const t = tagOf(bytes, 0);
  if (t === '\0\x01\0\0' || t === 'true') return 'ttf';
  if (t === 'OTTO') return 'otf';
  if (t === 'wOFF') return 'woff';
  if (t === 'wOF2') return 'woff2';
  if (t === 'ttcf') return 'ttc';
  return null;
}

/** TTF / OTF as is; WOFF and WOFF2 decoded to TTF / OTF. Throws FontFileError for anything else. */
export function toSfnt(bytes: Uint8Array): Uint8Array {
  const f = fontFormat(bytes);
  if (f === 'ttf' || f === 'otf') return bytes;
  try {
    if (f === 'woff') return fromWoff(bytes);
    if (f === 'woff2') return fromWoff2(bytes);
  } catch (e) {
    if (e instanceof FontFileError) throw e;
    throw new FontFileError(`broken ${f!.toUpperCase()} file: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (f === 'ttc') throw new FontFileError('font collections (.ttc) are not supported: use a single .ttf, .otf, .woff or .woff2 face');
  throw new FontFileError('not a font file: expected .ttf, .otf, .woff or .woff2');
}

// ---------------------------------------------------------------- SFNT writing

interface Table { tag: string; data: Uint8Array }

function checksum(b: Uint8Array): number {
  let sum = 0;
  const n = b.length & ~3;
  for (let i = 0; i < n; i += 4) sum = (sum + ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!)) >>> 0;
  if (n < b.length) {
    let last = 0;
    for (let i = n; i < n + 4; i++) last = (last << 8) | (b[i] ?? 0);
    sum = (sum + (last >>> 0)) >>> 0;
  }
  return sum;
}

function writeSfnt(flavor: number, tables: Table[]): Uint8Array {
  tables = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const n = tables.length;
  let size = 12 + 16 * n;
  for (const t of tables) size += (t.data.length + 3) & ~3;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  const es = Math.floor(Math.log2(n || 1));
  dv.setUint32(0, flavor);
  dv.setUint16(4, n);
  dv.setUint16(6, (1 << es) * 16);
  dv.setUint16(8, es);
  dv.setUint16(10, n * 16 - (1 << es) * 16);
  let off = 12 + 16 * n, headAt = -1;
  tables.forEach((t, i) => {
    const d = 12 + 16 * i;
    for (let k = 0; k < 4; k++) out[d + k] = t.tag.charCodeAt(k);
    if (t.tag === 'head' && t.data.length >= 12) { t.data = t.data.slice(); new DataView(t.data.buffer).setUint32(8, 0); headAt = off; }
    dv.setUint32(d + 4, checksum(t.data));
    dv.setUint32(d + 8, off);
    dv.setUint32(d + 12, t.data.length);
    out.set(t.data, off);
    off += (t.data.length + 3) & ~3;
  });
  if (headAt >= 0) dv.setUint32(headAt + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}

// ---------------------------------------------------------------- WOFF 1

function fromWoff(b: Uint8Array): Uint8Array {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const flavor = dv.getUint32(4), n = dv.getUint16(12);
  const tables: Table[] = [];
  for (let i = 0; i < n; i++) {
    const d = 44 + 20 * i;
    const tag = tagOf(b, d), off = dv.getUint32(d + 4), comp = dv.getUint32(d + 8), orig = dv.getUint32(d + 12);
    if (off + comp > b.length) throw new FontFileError(`broken WOFF file: table ${tag} is cut off`);
    const raw = b.subarray(off, off + comp);
    const data = comp < orig ? unzlibSync(raw) : raw.slice();
    if (data.length !== orig) throw new FontFileError(`broken WOFF file: table ${tag} has the wrong size`);
    tables.push({ tag, data });
  }
  return writeSfnt(flavor, tables);
}

// ---------------------------------------------------------------- WOFF 2

const KNOWN_TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

/** A reader over a byte array. */
class Reader {
  dv: DataView;
  constructor(readonly b: Uint8Array, public p = 0, readonly end = b.length) { this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength); }
  need(n: number) { if (this.p + n > this.end) throw new FontFileError('broken WOFF2 file: data runs out'); }
  u8() { this.need(1); return this.b[this.p++]!; }
  u16() { this.need(2); const v = this.dv.getUint16(this.p); this.p += 2; return v; }
  i16() { this.need(2); const v = this.dv.getInt16(this.p); this.p += 2; return v; }
  u32() { this.need(4); const v = this.dv.getUint32(this.p); this.p += 4; return v; }
  bytes(n: number) { this.need(n); const v = this.b.subarray(this.p, this.p + n); this.p += n; return v; }
  base128() {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const c = this.u8();
      if (i === 0 && c === 0x80) throw new FontFileError('broken WOFF2 file: bad number');
      if (v & 0xfe000000) throw new FontFileError('broken WOFF2 file: number too big');
      v = (v << 7) | (c & 0x7f);
      if (!(c & 0x80)) return v >>> 0;
    }
    throw new FontFileError('broken WOFF2 file: number too long');
  }
  u255() {
    const c = this.u8();
    if (c === 253) return this.u16();
    if (c === 255) return this.u8() + 253;
    if (c === 254) return this.u8() + 506;
    return c;
  }
  sub(n: number) { this.need(n); const r = new Reader(this.b, this.p, this.p + n); this.p += n; return r; }
}

function fromWoff2(b: Uint8Array): Uint8Array {
  const r = new Reader(b);
  r.u32(); // signature
  const flavor = r.u32();
  r.u32(); // length
  const n = r.u16();
  r.u16(); r.u32(); // reserved, totalSfntSize
  const compressedSize = r.u32();
  r.p = 48;
  const dir: { tag: string; orig: number; len: number; transformed: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const flags = r.u8();
    const tag = (flags & 0x3f) === 63 ? tagOf(r.bytes(4), 0) : KNOWN_TAGS[flags & 0x3f]!;
    const version = flags >> 6;
    const orig = r.base128();
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    const len = transformed ? r.base128() : orig;
    dir.push({ tag, orig, len, transformed });
  }
  if (flavor === 0x74746366) throw new FontFileError('font collections (.ttc in WOFF2) are not supported');
  const stream = brotliDecompress(r.bytes(compressedSize)) as Uint8Array | null;
  if (!stream) throw new FontFileError('broken WOFF2 file: Brotli data did not decode');
  const raw = new Map<string, Uint8Array>();
  let off = 0;
  for (const t of dir) {
    if (off + t.len > stream.length) throw new FontFileError(`broken WOFF2 file: table ${t.tag} is cut off`);
    raw.set(t.tag, stream.subarray(off, off + t.len));
    off += t.len;
  }
  const out = new Map<string, Uint8Array>();
  for (const t of dir) if (!t.transformed) out.set(t.tag, raw.get(t.tag)!.slice());
  const glyf = dir.find((t) => t.tag === 'glyf');
  let xMins: Int16Array | null = null;
  if (glyf?.transformed) {
    const g = rebuildGlyf(raw.get('glyf')!);
    out.set('glyf', g.glyf);
    out.set('loca', g.loca);
    xMins = g.xMins;
  }
  const hmtx = dir.find((t) => t.tag === 'hmtx');
  if (hmtx?.transformed) {
    const hhea = out.get('hhea'), maxp = out.get('maxp');
    if (!hhea || !maxp) throw new FontFileError('broken WOFF2 file: hmtx needs hhea and maxp');
    const numH = new DataView(hhea.buffer, hhea.byteOffset).getUint16(34), numGlyphs = new DataView(maxp.buffer, maxp.byteOffset).getUint16(4);
    out.set('hmtx', rebuildHmtx(raw.get('hmtx')!, numH, numGlyphs, xMins));
  }
  return writeSfnt(flavor, [...out].map(([tag, data]) => ({ tag, data })));
}

/** A growing byte buffer. */
class Writer {
  b = new Uint8Array(1024);
  n = 0;
  room(k: number) { if (this.n + k > this.b.length) { const nb = new Uint8Array(Math.max(this.b.length * 2, this.n + k)); nb.set(this.b.subarray(0, this.n)); this.b = nb; } }
  u8(v: number) { this.room(1); this.b[this.n++] = v & 255; }
  u16(v: number) { this.room(2); this.b[this.n++] = (v >> 8) & 255; this.b[this.n++] = v & 255; }
  bytes(v: Uint8Array) { this.room(v.length); this.b.set(v, this.n); this.n += v.length; }
  pad4() { while (this.n & 3) this.u8(0); }
  done() { return this.b.slice(0, this.n); }
}

const ARG_WORDS = 0x0001, HAVE_SCALE = 0x0008, MORE = 0x0020, XY_SCALE = 0x0040, TWO_BY_TWO = 0x0080, HAVE_INSTR = 0x0100;

/** The transformed glyf table (WOFF2 §5.1) back to glyf + loca. */
function rebuildGlyf(t: Uint8Array): { glyf: Uint8Array; loca: Uint8Array; xMins: Int16Array } {
  const h = new Reader(t);
  h.u16(); // reserved
  const options = h.u16(), numGlyphs = h.u16(), indexFormat = h.u16();
  const sizes = [h.u32(), h.u32(), h.u32(), h.u32(), h.u32(), h.u32(), h.u32()];
  const [nContourS, nPointsS, flagS, glyphS, compositeS, bboxS, instrS] = sizes.map((s) => h.sub(s)) as [Reader, Reader, Reader, Reader, Reader, Reader, Reader];
  const overlap = options & 1 ? h.bytes((numGlyphs + 7) >> 3) : null;
  const bboxBits = bboxS.bytes(((numGlyphs + 31) >> 5) * 4);
  const out = new Writer();
  const offsets = new Uint32Array(numGlyphs + 1);
  const xMins = new Int16Array(numGlyphs);
  for (let gi = 0; gi < numGlyphs; gi++) {
    offsets[gi] = out.n;
    const nContours = nContourS.i16();
    const hasBox = (bboxBits[gi >> 3]! & (0x80 >> (gi & 7))) !== 0;
    if (nContours === 0) {
      if (hasBox) throw new FontFileError('broken WOFF2 file: empty glyph with a bounding box');
      continue;
    }
    if (nContours < 0) {
      // composite: copied from the composite stream, bbox always given
      const start = compositeS.p;
      let flags = 0, instr = false;
      do {
        flags = compositeS.u16();
        compositeS.u16(); // glyph index
        compositeS.bytes(flags & ARG_WORDS ? 4 : 2);
        if (flags & HAVE_SCALE) compositeS.bytes(2);
        else if (flags & XY_SCALE) compositeS.bytes(4);
        else if (flags & TWO_BY_TWO) compositeS.bytes(8);
        if (flags & HAVE_INSTR) instr = true;
      } while (flags & MORE);
      const comp = compositeS.b.subarray(start, compositeS.p);
      const box = [bboxS.i16(), bboxS.i16(), bboxS.i16(), bboxS.i16()];
      xMins[gi] = box[0]!;
      out.u16(0xffff);
      for (const v of box) out.u16(v);
      out.bytes(comp);
      if (instr) {
        const len = glyphS.u255();
        out.u16(len);
        out.bytes(instrS.bytes(len));
      }
      out.pad4();
      continue;
    }
    // simple glyph
    const ends: number[] = [];
    let total = 0;
    for (let c = 0; c < nContours; c++) { total += nPointsS.u255(); ends.push(total - 1); }
    const xs = new Int32Array(total), ys = new Int32Array(total), on = new Uint8Array(total);
    let x = 0, y = 0;
    for (let i = 0; i < total; i++) {
      let f = flagS.u8();
      on[i] = f & 0x80 ? 0 : 1;
      f &= 0x7f;
      const nb = f < 84 ? 1 : f < 120 ? 2 : f < 124 ? 3 : 4;
      const d = glyphS.bytes(nb);
      const sign = (flag: number, v: number) => (flag & 1 ? v : -v);
      let dx: number, dy: number;
      if (f < 10) { dx = 0; dy = sign(f, ((f & 14) << 7) + d[0]!); }
      else if (f < 20) { dx = sign(f, (((f - 10) & 14) << 7) + d[0]!); dy = 0; }
      else if (f < 84) { const b0 = f - 20, b1 = d[0]!; dx = sign(f, 1 + (b0 & 0x30) + (b1 >> 4)); dy = sign(f >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f)); }
      else if (f < 120) { const b0 = f - 84; dx = sign(f, 1 + (Math.floor(b0 / 12) << 8) + d[0]!); dy = sign(f >> 1, 1 + (((b0 % 12) >> 2) << 8) + d[1]!); }
      else if (f < 124) { const b2 = d[1]!; dx = sign(f, (d[0]! << 4) + (b2 >> 4)); dy = sign(f >> 1, ((b2 & 0x0f) << 8) + d[2]!); }
      else { dx = sign(f, (d[0]! << 8) + d[1]!); dy = sign(f >> 1, (d[2]! << 8) + d[3]!); }
      x += dx; y += dy;
      xs[i] = x; ys[i] = y;
    }
    const instrLen = glyphS.u255();
    let box: number[];
    if (hasBox) box = [bboxS.i16(), bboxS.i16(), bboxS.i16(), bboxS.i16()];
    else {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < total; i++) { x0 = Math.min(x0, xs[i]!); x1 = Math.max(x1, xs[i]!); y0 = Math.min(y0, ys[i]!); y1 = Math.max(y1, ys[i]!); }
      box = total ? [x0, y0, x1, y1] : [0, 0, 0, 0];
    }
    xMins[gi] = box[0]!;
    out.u16(nContours);
    for (const v of box) out.u16(v);
    for (const e of ends) out.u16(e);
    out.u16(instrLen);
    out.bytes(instrS.bytes(instrLen));
    // flags (no repeats), then x and y in short form where they fit
    const ov = overlap && (overlap[gi >> 3]! & (0x80 >> (gi & 7))) ? 0x40 : 0;
    const coords = new Writer();
    const ycoords = new Writer();
    let px = 0, py = 0;
    for (let i = 0; i < total; i++) {
      let f = on[i]! | (i === 0 ? ov : 0);
      const dx = xs[i]! - px, dy = ys[i]! - py;
      px = xs[i]!; py = ys[i]!;
      if (dx === 0) f |= 0x10;
      else if (dx > -256 && dx < 256) { f |= 0x02 | (dx > 0 ? 0x10 : 0); coords.u8(Math.abs(dx)); }
      else coords.u16(dx & 0xffff);
      if (dy === 0) f |= 0x20;
      else if (dy > -256 && dy < 256) { f |= 0x04 | (dy > 0 ? 0x20 : 0); ycoords.u8(Math.abs(dy)); }
      else ycoords.u16(dy & 0xffff);
      out.u8(f);
    }
    out.bytes(coords.done());
    out.bytes(ycoords.done());
    out.pad4();
  }
  offsets[numGlyphs] = out.n;
  const loca = new Uint8Array((numGlyphs + 1) * (indexFormat ? 4 : 2));
  const ldv = new DataView(loca.buffer);
  for (let i = 0; i <= numGlyphs; i++) {
    if (indexFormat) ldv.setUint32(i * 4, offsets[i]!);
    else ldv.setUint16(i * 2, offsets[i]! >> 1);
  }
  return { glyf: out.done(), loca, xMins };
}

/** The transformed hmtx table (WOFF2 §5.4): left side bearings left out are the glyphs' xMin. */
function rebuildHmtx(t: Uint8Array, numH: number, numGlyphs: number, xMins: Int16Array | null): Uint8Array {
  const r = new Reader(t);
  const flags = r.u8();
  const adv: number[] = [];
  for (let i = 0; i < numH; i++) adv.push(r.u16());
  const lsb = new Int16Array(numGlyphs);
  const need = () => { if (!xMins) throw new FontFileError('broken WOFF2 file: hmtx transform without a transformed glyf'); return xMins; };
  for (let i = 0; i < numH; i++) lsb[i] = flags & 1 ? need()[i]! : r.i16();
  for (let i = numH; i < numGlyphs; i++) lsb[i] = flags & 2 ? need()[i]! : r.i16();
  const w = new Writer();
  for (let i = 0; i < numGlyphs; i++) {
    if (i < numH) w.u16(adv[i]!);
    w.u16(lsb[i]! & 0xffff);
  }
  return w.done();
}

// ---------------------------------------------------------------- font info

export interface FontInfo {
  /** Typographic family (name ID 16), else the family (ID 1). */
  family: string;
  /** OS/2 usWeightClass (100..900), 400 when missing. */
  weight: number;
  italic: boolean;
}

/** Family, weight and italic of a font file (TTF, OTF, WOFF or WOFF2). */
export function fontInfo(bytes: Uint8Array): FontInfo {
  const b = toSfnt(bytes);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tables = new Map<string, { off: number; len: number }>();
  for (let i = 0, n = dv.getUint16(4); i < n; i++) {
    const d = 12 + 16 * i;
    tables.set(tagOf(b, d), { off: dv.getUint32(d + 8), len: dv.getUint32(d + 12) });
  }
  const names = new Map<number, string>();
  const name = tables.get('name');
  if (name) {
    const count = dv.getUint16(name.off + 2), strings = name.off + dv.getUint16(name.off + 4);
    const rank = new Map<number, number>();
    for (let i = 0; i < count; i++) {
      const r = name.off + 6 + 12 * i;
      const platform = dv.getUint16(r), encoding = dv.getUint16(r + 2), lang = dv.getUint16(r + 4), id = dv.getUint16(r + 6);
      const len = dv.getUint16(r + 8), at = strings + dv.getUint16(r + 10);
      if (at + len > b.length) continue;
      // Windows English first, then any Windows / Unicode, then Mac Roman
      const utf16 = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10 || encoding === 0));
      const score = platform === 3 && lang === 0x409 ? 3 : utf16 ? 2 : platform === 1 && encoding === 0 ? 1 : 0;
      if (!score || (rank.get(id) ?? 0) >= score) continue;
      let s = '';
      if (utf16) for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(dv.getUint16(at + k));
      else for (let k = 0; k < len; k++) s += String.fromCharCode(b[at + k]!);
      s = s.replace(/\0/g, '').trim();
      if (s) { names.set(id, s); rank.set(id, score); }
    }
  }
  const os2 = tables.get('OS/2'), head = tables.get('head');
  const weight = os2 && os2.len >= 6 ? dv.getUint16(os2.off + 4) : 0;
  let italic = os2 && os2.len >= 64 ? (dv.getUint16(os2.off + 62) & 1) !== 0 : false;
  if (!os2 && head && head.len >= 46) italic = (dv.getUint16(head.off + 44) & 2) !== 0;
  if (!italic && /italic|oblique/i.test(names.get(17) ?? names.get(2) ?? '')) italic = true;
  return {
    family: names.get(16) ?? names.get(1) ?? names.get(4) ?? 'Untitled font',
    weight: weight >= 1 && weight <= 1000 ? weight : 400,
    italic,
  };
}
