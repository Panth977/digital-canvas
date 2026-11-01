import { zlibSync } from 'fflate';

const table = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Colour type 2 (RGB), 0 (grey) or 6 (RGBA), 8 bits per channel. No DOM, so it works in Node and workers. */
export function encodePng(data: Uint8Array, width: number, height: number, channels: 1 | 3 | 4): Uint8Array {
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const at = y * (stride + 1);
    raw[at] = 1; // Sub filter: flat areas and gradients shrink well, and it costs almost nothing
    const row = y * stride;
    for (let i = 0; i < stride; i++) raw[at + 1 + i] = data[row + i]! - (i >= channels ? data[row + i - channels]! : 0);
  }
  const idat = zlibSync(raw, { level: 6 });
  const head = new Uint8Array(13);
  const dv = new DataView(head.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  head[8] = 8;
  head[9] = channels === 1 ? 0 : channels === 3 ? 2 : 6;
  const out = new Uint8Array(8 + 25 + 12 + idat.length + 12);
  out.set([137, 80, 78, 71, 13, 10, 26, 10]);
  let p = 8;
  const chunk = (name: string, body: Uint8Array) => {
    const v = new DataView(out.buffer);
    v.setUint32(p, body.length);
    const typed = new Uint8Array(4 + body.length);
    for (let i = 0; i < 4; i++) typed[i] = name.charCodeAt(i);
    typed.set(body, 4);
    out.set(typed, p + 4);
    v.setUint32(p + 4 + typed.length, crc(typed));
    p += 12 + body.length;
  };
  chunk('IHDR', head);
  chunk('IDAT', idat);
  chunk('IEND', new Uint8Array(0));
  return out;
}
