import { inflateSync } from 'node:zlib';

/** Minimal PNG reader for tests: RGBA/RGB 8-bit, filter-aware, first pixel only. */
export const PNG = {
  firstPixel(buf: Buffer): number[] {
    let off = 8, w = 0, colorType = 6;
    const idat: Buffer[] = [];
    while (off < buf.length) {
      const len = buf.readUInt32BE(off);
      const type = buf.subarray(off + 4, off + 8).toString();
      const data = buf.subarray(off + 8, off + 8 + len);
      if (type === 'IHDR') { w = data.readUInt32BE(0); colorType = data[9]!; }
      if (type === 'IDAT') idat.push(data);
      off += 12 + len;
    }
    void w;
    const raw = inflateSync(Buffer.concat(idat));
    const bpp = colorType === 6 ? 4 : 3;
    // first scanline, first pixel: filters 0 (none) and 1 (sub) both leave pixel 0 as-is; 2 (up) too for row 0
    return Array.from(raw.subarray(1, 1 + bpp));
  },
};
