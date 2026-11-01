/** Small sfnt helpers: read the tables of a font program and give it a Unicode cmap. */

interface Table { tag: string; data: Uint8Array }

function readTables(font: Uint8Array): { flavor: number; tables: Table[] } {
  const dv = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const flavor = dv.getUint32(0), n = dv.getUint16(4);
  const tables: Table[] = [];
  for (let i = 0; i < n; i++) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(font[at]!, font[at + 1]!, font[at + 2]!, font[at + 3]!);
    const off = dv.getUint32(at + 8), len = dv.getUint32(at + 12);
    tables.push({ tag, data: font.subarray(off, off + len) });
  }
  return { flavor, tables };
}

function writeFont(flavor: number, tables: Table[]): Uint8Array {
  tables = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const n = tables.length;
  let size = 12 + 16 * n;
  for (const t of tables) size += (t.data.length + 3) & ~3;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, flavor);
  dv.setUint16(4, n);
  const es = Math.floor(Math.log2(n));
  dv.setUint16(6, 16 << es);
  dv.setUint16(8, es);
  dv.setUint16(10, n * 16 - (16 << es));
  let off = 12 + 16 * n;
  tables.forEach((t, i) => {
    const at = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[at + k] = t.tag.charCodeAt(k);
    out.set(t.data, off);
    let sum = 0;
    for (let k = 0; k < t.data.length; k += 4) sum = (sum + (((t.data[k] ?? 0) << 24) | ((t.data[k + 1] ?? 0) << 16) | ((t.data[k + 2] ?? 0) << 8) | (t.data[k + 3] ?? 0))) >>> 0;
    dv.setUint32(at + 4, sum);
    dv.setUint32(at + 8, off);
    dv.setUint32(at + 12, t.data.length);
    off += (t.data.length + 3) & ~3;
  });
  return out;
}

/** Format 12 cmap table (Windows full Unicode) mapping code points to glyph ids. */
export function buildCmap(map: ReadonlyMap<number, number>): Uint8Array {
  const entries = [...map].filter(([, g]) => g > 0).sort((a, b) => a[0] - b[0]);
  const groups: [number, number, number][] = [];
  for (const [cp, gid] of entries) {
    const last = groups[groups.length - 1];
    if (last && cp === last[1] + 1 && gid === last[2] + (cp - last[0])) last[1] = cp;
    else groups.push([cp, cp, gid]);
  }
  const out = new Uint8Array(12 + 16 + groups.length * 12);
  const dv = new DataView(out.buffer);
  dv.setUint16(2, 1); // one subtable
  dv.setUint16(4, 3);
  dv.setUint16(6, 10);
  dv.setUint32(8, 12);
  dv.setUint16(12, 12);
  dv.setUint32(16, 16 + groups.length * 12);
  dv.setUint32(24, groups.length);
  groups.forEach(([a, b, g], i) => {
    const at = 28 + i * 12;
    dv.setUint32(at, a);
    dv.setUint32(at + 4, b);
    dv.setUint32(at + 8, g);
  });
  return out;
}

/** The same font with only this Unicode cmap. Glyph ids stay as they are. */
export function withUnicodeCmap(font: Uint8Array, map: ReadonlyMap<number, number>): Uint8Array {
  const { flavor, tables } = readTables(font);
  const rest = tables.filter((t) => t.tag !== 'cmap');
  rest.push({ tag: 'cmap', data: buildCmap(map) });
  return writeFont(flavor, rest);
}

/** Units per em, from `head`. */
export function unitsPerEm(font: Uint8Array): number {
  const head = readTables(font).tables.find((t) => t.tag === 'head');
  return head ? (head.data[18]! << 8) | head.data[19]! : 1000;
}

/** Every code point → glyph id of the font's best cmap subtable (formats 0, 4, 6, 12). */
export function readCmap(font: Uint8Array): Map<number, number> {
  const out = new Map<number, number>();
  const t = readTables(font).tables.find((x) => x.tag === 'cmap')?.data;
  if (!t) return out;
  const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const n = dv.getUint16(2);
  for (let i = 0; i < n; i++) {
    const off = dv.getUint32(4 + i * 8 + 4);
    const fmt = dv.getUint16(off);
    if (fmt === 0) {
      for (let c = 0; c < 256; c++) { const g = t[off + 6 + c]!; if (g) out.set(c, g); }
    } else if (fmt === 4) {
      const seg = dv.getUint16(off + 6) / 2;
      const end = off + 14, start = end + seg * 2 + 2, delta = start + seg * 2, range = delta + seg * 2;
      for (let s = 0; s < seg; s++) {
        const e = dv.getUint16(end + s * 2), b = dv.getUint16(start + s * 2), d = dv.getUint16(delta + s * 2), r = dv.getUint16(range + s * 2);
        for (let c = b; c <= e && c !== 0xffff; c++) {
          let g = 0;
          if (r === 0) g = (c + d) & 0xffff;
          else {
            const at = range + s * 2 + r + (c - b) * 2;
            if (at + 2 <= t.length) { g = dv.getUint16(at); if (g) g = (g + d) & 0xffff; }
          }
          if (g) out.set(c, g);
        }
      }
    } else if (fmt === 6) {
      const first = dv.getUint16(off + 6), count = dv.getUint16(off + 8);
      for (let c = 0; c < count; c++) { const g = dv.getUint16(off + 10 + c * 2); if (g) out.set(first + c, g); }
    } else if (fmt === 12) {
      const groups = dv.getUint32(off + 12);
      for (let g = 0; g < groups; g++) {
        const at = off + 16 + g * 12, a = dv.getUint32(at), b = dv.getUint32(at + 4), id = dv.getUint32(at + 8);
        for (let c = a; c <= b; c++) out.set(c, id + c - a);
      }
    }
  }
  return out;
}
