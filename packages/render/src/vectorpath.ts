import type { CanvasKit, Path } from 'canvaskit-wasm';
import type { Color } from '@digital-canvas/scene';
import type { FontFace } from './fonts.ts';

/** Path commands with absolute points: move, line, cubic, close. Conics and quads become cubics. */
export type Cmd = { op: 'M' | 'L'; x: number; y: number } | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number } | { op: 'Z' };

export function pathCmds(ck: CanvasKit, path: Path): Cmd[] {
  const v = path.toCmds();
  const out: Cmd[] = [];
  let cx = 0, cy = 0;
  // a conic (weight w) as one cubic: control points at k = 4w / 3(1 + w) along the tangents (w = 1 is a quad)
  const curve = (x1: number, y1: number, x: number, y: number, w: number) => {
    const k = (4 * w) / (3 * (1 + w));
    out.push({ op: 'C', x1: cx + (x1 - cx) * k, y1: cy + (y1 - cy) * k, x2: x + (x1 - x) * k, y2: y + (y1 - y) * k, x, y });
  };
  for (let i = 0; i < v.length;) {
    const verb = v[i++]!;
    if (verb === ck.MOVE_VERB || verb === ck.LINE_VERB) {
      cx = v[i++]!; cy = v[i++]!;
      out.push({ op: verb === ck.MOVE_VERB ? 'M' : 'L', x: cx, y: cy });
    } else if (verb === ck.QUAD_VERB) {
      curve(v[i]!, v[i + 1]!, v[i + 2]!, v[i + 3]!, 1);
      cx = v[i + 2]!; cy = v[i + 3]!;
      i += 4;
    } else if (verb === ck.CONIC_VERB) {
      curve(v[i]!, v[i + 1]!, v[i + 2]!, v[i + 3]!, v[i + 4]!);
      cx = v[i + 2]!; cy = v[i + 3]!;
      i += 5;
    } else if (verb === ck.CUBIC_VERB) {
      out.push({ op: 'C', x1: v[i]!, y1: v[i + 1]!, x2: v[i + 2]!, y2: v[i + 3]!, x: v[i + 4]!, y: v[i + 5]! });
      cx = v[i + 4]!; cy = v[i + 5]!;
      i += 6;
    } else if (verb === ck.CLOSE_VERB) out.push({ op: 'Z' });
    else break;
  }
  return out;
}

const n = (v: number) => String(Math.round(v * 100) / 100);

export function cmdsToSvg(cmds: Cmd[]): string {
  return cmds.map((c) => (c.op === 'Z' ? 'Z' : c.op === 'C' ? `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}` : `${c.op}${n(c.x)} ${n(c.y)}`)).join('');
}

/** `#rrggbb[aa]` → rgb 0..1 and alpha. */
export function rgba(hex: Color): { r: number; g: number; b: number; a: number } {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const ch = (i: number) => (parseInt(h.slice(i, i + 2), 16) || 0) / 255;
  return { r: ch(0), g: ch(2), b: ch(4), a: h.length >= 8 ? ch(6) : 1 };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 without Buffer or btoa (works in Node and browsers alike). */
export function base64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!, b = bytes[i + 1], c = bytes[i + 2];
    out += B64[a >> 2]! + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]! + (b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]!) + (c === undefined ? '=' : B64[c & 63]!);
  }
  return out;
}

/** Faces of `family` to use for a weight/style: the closest match (and its script subsets). */
export function pickFaces(faces: readonly FontFace[], family: string, bold: boolean, italic: boolean): FontFace[] {
  const of = faces.filter((f) => f.family === family);
  if (!of.length) return [];
  const want = bold ? 700 : 400;
  const score = (f: FontFace) => Math.abs(f.weight - want) + (f.italic !== italic ? 1000 : 0);
  const best = Math.min(...of.map(score));
  const picked = of.filter((f) => score(f) === best);
  // main face (no subset, or latin) first
  const rank = (f: FontFace) => (!f.subset ? 0 : f.subset === 'latin' ? 1 : 2);
  return picked.sort((a, b) => rank(a) - rank(b));
}

export function fontMime(bytes: Uint8Array): string {
  const tag = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
  return tag === 'wOF2' ? 'font/woff2' : tag === 'wOFF' ? 'font/woff' : tag === 'OTTO' ? 'font/otf' : 'font/ttf';
}
