/**
 * PDF → design. Walks pdf.js's operator list and turns each page into editable
 * elements: text boxes holding their exact glyphs, vector paths, images. Anything
 * the scene can't say becomes a precise picture of just that region (see `Flat`).
 *
 * pdf.js supplies fonts, images and its interpretation of the content; `source.ts`
 * reads the original objects so CMYK, spot colours, fonts and images go back as they came.
 */
import {
  applyMatrix, DEFAULT_TEXT_STYLE, FORMAT, mulMatrix, newId, partSig, textSig, VERSION,
  type AssetMeta, type Doc, type Element, type ExactRun, type ImageElement, type Matrix, type Page, type PageLink, type PathElement, type PathExact, type PathPart, type PathShade, type PdfClipPath, type PdfFont, type PdfImageSource, type PdfPatternFill, type PdfVectorSource, type BlendMode, type SourceColor, type TextElement, type TextRun,
} from '@digital-canvas/scene';
import { readCmap, withUnicodeCmap } from './fontfile.ts';
import { encodePng } from './png.ts';
import { openSource, type PageScan, type Source } from './source.ts';

/** The pdf.js module (Node: legacy build; browser: main build with a worker). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Pdfjs = any;

export interface ImportOptions {
  /** Where pdf.js finds its data. */
  standardFontDataUrl?: string;
  cMapUrl?: string;
  wasmUrl?: string;
  password?: string;
  /** Asked when the file needs a password; null cancels. */
  askPassword?: (wrongOne: boolean) => Promise<string | null>;
  onProgress?: (done: number, total: number, note: string) => void;
  signal?: AbortSignal;
  title?: string;
  /** Pictures of flattened regions, dots per inch. */
  flattenDpi?: number;
  /** Only these 1-based pages. */
  pages?: number[];
}

export interface Flattened {
  page: number;
  why: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImportReport {
  pages: number;
  texts: number;
  paths: number;
  images: number;
  flattened: Flattened[];
  /** Short sentences for the user. */
  notes: string[];
  /** Fonts: what happened to each. */
  fonts: { name: string; embedded: boolean; editable: boolean }[];
  /** Page sizes differed and pages were fitted on one size. */
  mixedSizes: boolean;
  scanned: number;
  links: number;
}

export interface ImportResult {
  doc: Doc;
  assets: Map<string, Uint8Array>;
  report: ImportReport;
}

export class PdfImportError extends Error {
  constructor(message: string, readonly code: 'password' | 'invalid' | 'cancelled' | 'empty') {
    super(message);
  }
}

const PX = 96 / 72;
/** Most parts in one path element: past this a figure is split, so one element stays cheap to redraw. */
const MAX_PARTS = 1500;
/** pdf.js path opcodes (not exported by the library). */
const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 };
const n4 = (v: number) => Math.round(v * 1e6) / 1e6;

const BLENDS: Record<string, BlendMode> = {
  multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten', 'color-dodge': 'color-dodge', 'color-burn': 'color-burn',
  'hard-light': 'hard-light', 'soft-light': 'soft-light', difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity',
};

interface Paint {
  rgb: string;
  alpha: number;
  src?: SourceColor;
  /** ['TilingPattern', …] or ['Shading', objId, matrix] */
  pattern?: unknown[];
  /** The pattern object in the source file. */
  patternObj?: number;
}

interface State {
  ctm: Matrix;
  fill: Paint;
  stroke: Paint;
  lw: number;
  cap: 0 | 1 | 2;
  join: 0 | 1 | 2;
  miter: number;
  dash: { array: number[]; phase: number } | null;
  blend: string;
  smask: boolean;
  clips: readonly PdfClipPath[];
  clipBox: [number, number, number, number];
  /** Alpha of an enclosing group that has nothing to composite (one drawing inside). */
  ga: number;
  font: string | null;
  fontSrc?: number;
  size: number;
  tc: number;
  tw: number;
  th: number;
  leading: number;
  rise: number;
  mode: number;
  tm: Matrix;
  tlm: Matrix;
}

/** One show of glyphs in the making: a TJ in text space. */
interface Chunk {
  run: ExactRun;
  m: Matrix;
  end: number;
  text: string;
  state: { blend: string; clipKey: string; clips: readonly PdfClipPath[]; alpha: number; clipBox: State['clipBox'] };
}

/** A region drawn as a picture: these operators, on nothing. */
interface Flat {
  kind: 'flat';
  ops: Set<number>;
  why: string;
  bbox: [number, number, number, number];
  blend?: BlendMode;
  /** Type 3 text: the picture is only for screens, cut per text box. */
  invisibleText?: Element[];
  /** The form this group draws, kept vector in PDF exports. */
  form?: { obj: number; m: Matrix; alpha: number; clips: PdfClipPath[] };
  fills?: PdfPatternFill[];
  /** Something in here has no vector form. */
  noVector?: boolean;
  /** Filled by the render. */
  made?: { id: string; x: number; y: number; w: number; h: number };
}

type Out = Element | Flat;

const isFlat = (o: Out): o is Flat => (o as Flat).kind === 'flat';

const emptyBox = (): [number, number, number, number] => [Infinity, Infinity, -Infinity, -Infinity];

function grow(b: [number, number, number, number], x: number, y: number): void {
  if (x < b[0]) b[0] = x;
  if (y < b[1]) b[1] = y;
  if (x > b[2]) b[2] = x;
  if (y > b[3]) b[3] = y;
}

function hexOf(rgb: string, alpha: number): string {
  const c = rgb.length === 4 ? `#${rgb[1]}${rgb[1]}${rgb[2]}${rgb[2]}${rgb[3]}${rgb[3]}` : rgb.slice(0, 7);
  if (alpha >= 0.999) return c;
  return c + Math.round(Math.max(0, alpha) * 255).toString(16).padStart(2, '0');
}

const objGet = <T>(objs: { get: (id: string, cb?: (v: T) => void) => T }, id: string): Promise<T> => new Promise((res) => objs.get(id, res));

class Builder {
  out: Out[] = [];
  fonts: Record<string, PdfFont> = {};
  fontBytes = new Map<string, { data: Uint8Array; chars: Map<number, string> }>();
  assets = new Map<string, Uint8Array>();
  meta: Record<string, AssetMeta> = {};
  imageAssets = new Map<string, { id: string; w: number; h: number }>();
  report: ImportReport = { pages: 0, texts: 0, paths: 0, images: 0, flattened: [], notes: [], fonts: [], mixedSizes: false, scanned: 0, links: 0 };
  usedFamilies = new Set<string>();

  addAsset(id: string, bytes: Uint8Array, meta: AssetMeta): void {
    this.assets.set(id, bytes);
    this.meta[id] = meta;
  }
}

/** Operators that paint, by name: all others set state and always run in a flattened render. */
function paintFns(OPS: Record<string, number>): Set<number> {
  return new Set([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText, OPS.shadingFill, OPS.paintImageMaskXObject, OPS.paintImageMaskXObjectGroup,
    OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintInlineImageXObjectGroup, OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObjectRepeat, OPS.paintSolidColorImageMask].map(Number));
}

class PageWalker {
  st: State;
  stack: State[] = [];
  /** Glyphs since BT, kept until ET: if one must be flattened, the whole block is. */
  bt: Chunk[] = [];
  btOps: number[] = [];
  btFlat: string | null = null;
  /** Depth of a mask group (its content draws the mask, not the page). */
  maskDepth = 0;
  /** The operators of mask groups: state for every flattened render. */
  always = new Set<number>();
  /** While > 0 everything goes into `flatNow`. */
  flatDepth = 0;
  flatNow: Flat | null = null;
  hidden = 0;
  mc: boolean[] = [];
  groups: { flat: boolean; mask: boolean }[] = [];
  pendingClip: null | 'nonzero' | 'evenodd' = null;
  pathOut: { el: PathElement; box: [number, number, number, number]; key: string } | null = null;
  textOut: Chunk[] = [];
  out: Out[] = [];
  counts = { text: 0, image: 0 };

  constructor(readonly pdfjs: Pdfjs, readonly b: Builder, readonly page: any, readonly list: { fnArray: number[]; argsArray: any[] }, base: Matrix, readonly pageW: number, readonly pageH: number, readonly scan: PageScan | null, readonly source: Source | null, readonly ocConfig: any, readonly num: number) {
    const black: Paint = { rgb: '#000000', alpha: 1 };
    this.st = {
      ctm: base, fill: black, stroke: black, lw: 1, cap: 0, join: 0, miter: 10, dash: null, blend: 'source-over', smask: false, clips: [], clipBox: [0, 0, pageW, pageH], ga: 1,
      font: null, size: 0, tc: 0, tw: 0, th: 1, leading: 0, rise: 0, mode: 0, tm: [1, 0, 0, 1, 0, 0], tlm: [1, 0, 0, 1, 0, 0],
    };
  }

  private flat(op: number, why: string, box: [number, number, number, number] | null): void {
    const clip = this.st.clipBox;
    const bb: [number, number, number, number] = box ? [Math.max(box[0], clip[0]), Math.max(box[1], clip[1]), Math.min(box[2], clip[2]), Math.min(box[3], clip[3])] : [...clip];
    if (this.flatNow) {
      this.flatNow.ops.add(op);
      grow(this.flatNow.bbox, bb[0], bb[1]);
      grow(this.flatNow.bbox, bb[2], bb[3]);
      return;
    }
    this.flushText();
    this.flushPath();
    const last = this.lastFlat();
    const blend = this.blendMode();
    if (last && last.why === why && last.blend === blend && !last.form) {
      last.ops.add(op);
      grow(last.bbox, bb[0], bb[1]);
      grow(last.bbox, bb[2], bb[3]);
      return;
    }
    this.out.push({ kind: 'flat', ops: new Set([op]), why, bbox: bb, blend });
  }

  private lastFlat(): Flat | undefined {
    const o = this.out[this.out.length - 1];
    return o && isFlat(o) ? o : undefined;
  }

  private blendMode(): BlendMode | undefined {
    return BLENDS[this.st.blend];
  }

  private flushPath(): void {
    const p = this.pathOut;
    if (!p) return;
    this.pathOut = null;
    const [x0, y0, x1, y1] = p.box;
    const pad = 0.5; // a straight line has no height
    const vb = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
    p.el.x = vb.x; p.el.y = vb.y; p.el.w = vb.w; p.el.h = vb.h; p.el.viewBox = vb;
    setClip(p.el, this.pathClips, p.box);
    this.out.push(p.el);
  }
  private pathClips: readonly PdfClipPath[] = [];

  // ---- text ----

  private font(): PdfFont | null {
    return this.st.font ? this.b.fonts[this.st.font] ?? null : null;
  }

  private async setFont(name: string, size: number): Promise<void> {
    this.st.font = name;
    this.st.size = size;
    this.st.fontSrc = this.scan?.nextFont(size);
    if (!this.b.fonts[name]) {
      const f: any = await objGet(name.startsWith('g_') ? this.page.commonObjs : this.page.objs, name);
      const rawName = String(f.name ?? 'Font').replace(/^[A-Z]{6}\+/, '');
      const pf: PdfFont = {
        name: rawName, bytes: f.composite ? 2 : 1, widths: {}, gids: {}, unicode: {},
        serif: !!f.serif, mono: !!f.isMonospace, bold: !!f.bold || !!f.black, italic: !!f.italic,
      };
      if (f.isType3Font) pf.type3 = true;
      const fm = f.fontMatrix as number[] | undefined;
      if (fm && Math.abs(fm[0]! - 0.001) > 1e-9) pf.scale = fm[0]! * 1000;
      if (this.st.fontSrc !== undefined) pf.obj = this.st.fontSrc;
      this.b.fonts[name] = pf;
      if (f.data?.length) this.b.fontBytes.set(name, { data: f.data, chars: new Map() });
      this.ascents.set(name, [Math.abs(f.ascent ?? 0.8) || 0.8, Math.abs(f.descent ?? 0.2) || 0.2]);
    }
  }
  ascents = new Map<string, [number, number]>();

  private show(i: number, glyphs: any[]): void {
    const st = this.st, font = this.font();
    if (!font || !st.font) return;
    const scale = font.scale ?? 1;
    const size = st.size;
    let x = 0;
    const tj: (string | number)[] = [];
    let cur = '';
    let text = '';
    const pad = font.bytes * 2;
    const store = this.b.fontBytes.get(st.font);
    for (const g of glyphs) {
      if (g === null || g === undefined) continue;
      if (typeof g === 'number') {
        x -= (g / 1000) * size;
        if (cur) { tj.push(cur); cur = ''; }
        const last = tj[tj.length - 1];
        if (typeof last === 'number') tj[tj.length - 1] = last + g;
        else if (tj.length || text) tj.push(g);
        else { tj.push(g); }
        if (g < -180 && text && !text.endsWith(' ')) text += ' ';
        continue;
      }
      const code: number = g.originalCharCode ?? 0;
      font.widths[code] = g.width ?? 0;
      if (g.unicode) font.unicode[code] = g.unicode;
      if (g.fontChar && store) store.chars.set(code, g.fontChar);
      cur += code.toString(16).padStart(pad, '0');
      text += g.unicode ?? '';
      x += ((g.width ?? 0) * scale * size) / 1000 + st.tc + (g.isSpace ? st.tw : 0);
    }
    if (cur) tj.push(cur);
    if (tj.length) this.addChunk(i, tj, text, x);
    st.tm = mulMatrix(st.tm, [1, 0, 0, 1, x * st.th, 0]);
  }

  private addChunk(i: number, tj: (string | number)[], text: string, end: number): void {
    const st = this.st;
    this.btOps.push(i);
    if (this.flatDepth > 0 || st.smask) { this.flat(i, 'soft mask or transparency group', this.textBox(end)); return; }
    if (st.mode >= 4) this.btFlat = 'text used as a clip';
    if (st.fill.pattern && st.mode !== 3) this.btFlat = st.fill.pattern[0] === 'TilingPattern' ? 'text filled with a pattern' : 'text filled with a gradient';
    if (st.stroke.pattern && (st.mode === 1 || st.mode === 2)) this.btFlat = 'text stroked with a pattern';
    if (this.b.fonts[st.font!]?.type3) this.btFlat ??= 'Type 3 font';
    const m = mulMatrix(st.ctm, st.tm);
    const prev = this.bt[this.bt.length - 1];
    const fillC = hexOf(st.fill.rgb, st.fill.alpha * st.ga), strokeC = st.mode === 1 || st.mode === 2 ? hexOf(st.stroke.rgb, st.stroke.alpha * st.ga) : undefined;
    const clipKey = st.clips.map((c) => c.d).join('|');
    if (prev) {
      const r = prev.run;
      if (r.font === st.font && r.size === st.size && (r.tc ?? 0) === st.tc && (r.tw ?? 0) === st.tw && (r.th ?? 1) === st.th && (r.rise ?? 0) === st.rise && (r.mode ?? 0) === st.mode
        && r.color === fillC && r.stroke === strokeC && prev.state.clipKey === clipKey && prev.state.blend === st.blend) {
        const inv = invert(prev.m);
        if (inv) {
          const d = mulMatrix(inv, m);
          if (Math.abs(d[0] - 1) < 1e-5 && Math.abs(d[3] - 1) < 1e-5 && Math.abs(d[1]) < 1e-5 && Math.abs(d[2]) < 1e-5 && Math.abs(d[5]) < 1e-3) {
            const gapX = d[4] / st.th - prev.end;
            if (Math.abs(gapX) > 1e-4) {
              r.tj.push(n4((-gapX * 1000) / st.size));
              if (gapX > Math.abs(st.size) * 0.18 && !prev.text.endsWith(' ') && !text.startsWith(' ')) prev.text += ' ';
            }
            r.tj.push(...tj);
            prev.text += text;
            prev.end = d[4] / st.th + end;
            return;
          }
        }
      }
    }
    const run: ExactRun = { font: st.font!, size: st.size, m, tj, color: fillC };
    if (st.tc) run.tc = st.tc;
    if (st.tw) run.tw = st.tw;
    if (st.th !== 1) run.th = st.th;
    if (st.rise) run.rise = st.rise;
    if (st.mode) run.mode = st.mode;
    if (st.fill.src) run.colorSrc = st.fill.src;
    if (strokeC) {
      run.stroke = strokeC;
      run.lw = st.lw;
      if (st.stroke.src) run.strokeSrc = st.stroke.src;
    }
    this.bt.push({ run, m, end, text, state: { blend: st.blend, clipKey, clips: st.clips, alpha: st.fill.alpha, clipBox: st.clipBox } });
  }

  private textBox(end: number): [number, number, number, number] {
    const st = this.st, m = mulMatrix(st.ctm, st.tm);
    const s = Math.abs(st.size);
    const b = emptyBox();
    for (const [x, y] of [[-s, -s], [end + s, -s], [end + s, s * 1.5], [-s, s * 1.5]] as const) {
      const p = applyMatrix(m, x * st.th, y);
      grow(b, p[0], p[1]);
    }
    return b;
  }

  /** ET: decide how this block of text is kept. */
  private endText(): void {
    const chunks = this.bt, why = this.btFlat, ops = this.btOps;
    this.bt = [];
    this.btFlat = null;
    this.btOps = [];
    if (!chunks.length) return;
    if (!why) {
      this.flushPath();
      this.textOut.push(...chunks);
      return;
    }
    // the whole block as a picture (text positions run through it), the text still there and selectable
    this.flushText();
    this.flushPath();
    const bbox = emptyBox();
    for (const c of chunks) {
      const b = chunkBox(c, this.b.fonts);
      grow(bbox, b[0], b[1]);
      grow(bbox, b[2], b[3]);
    }
    const flat: Flat = { kind: 'flat', ops: new Set(ops), why, bbox, invisibleText: [] };
    this.out.push(flat);
    const mark = this.out.length;
    this.textOut.push(...chunks);
    this.flushText();
    const made = this.out.splice(mark);
    flat.invisibleText = made as Element[];
  }

  private flushText(): void {
    if (this.bt.length) this.endText();
    const chunks = this.textOut;
    this.textOut = [];
    if (!chunks.length) return;
    let line: Chunk[] = [];
    const emit = () => {
      if (line.length) this.out.push(textElement(line, this.b, this.ascents));
      line = [];
    };
    for (const c of chunks) {
      if (line.length && !sameLine(line[line.length - 1]!, c)) emit();
      line.push(c);
    }
    emit();
  }

  // ---- paths ----

  private async paintPath(i: number, op: number, data: Float32Array | number[], OPS: Record<string, number>): Promise<void> {
    const st = this.st;
    const clipOnly = op === OPS.endPath;
    const closes = op === OPS.closeStroke || op === OPS.closeFillStroke || op === OPS.closeEOFillStroke;
    const fills = op === OPS.fill || op === OPS.eoFill || op === OPS.fillStroke || op === OPS.eoFillStroke || op === OPS.closeFillStroke || op === OPS.closeEOFillStroke;
    const strokes = op === OPS.stroke || op === OPS.closeStroke || op === OPS.fillStroke || op === OPS.eoFillStroke || op === OPS.closeFillStroke || op === OPS.closeEOFillStroke;
    const evenOdd = op === OPS.eoFill || op === OPS.eoFillStroke || op === OPS.closeEOFillStroke;
    const conformal = isConformal(st.ctm);
    const keepCtm = strokes && !conformal;
    const { d, box } = pathToSvg(data, keepCtm ? null : st.ctm, closes, DRAW);
    const pageBox = keepCtm ? transformBox(box, st.ctm) : box;

    if (this.pendingClip && !this.flatDepth && !this.maskDepth) { /* clip below */ }
    if (this.pendingClip) {
      const c = keepCtm ? pathToSvg(data, st.ctm, closes, DRAW) : { d, box };
      st.clips = [...st.clips, { d: c.d, ...(this.pendingClip === 'evenodd' ? { evenOdd: true } : {}) }];
      st.clipBox = [Math.max(st.clipBox[0], c.box[0]), Math.max(st.clipBox[1], c.box[1]), Math.min(st.clipBox[2], c.box[2]), Math.min(st.clipBox[3], c.box[3])];
      this.pendingClip = null;
    }
    if (clipOnly || !d) return;
    if (this.hidden || this.maskDepth) return;
    const lw = st.lw * (keepCtm ? 1 : Math.sqrt(Math.abs(st.ctm[0] * st.ctm[3] - st.ctm[1] * st.ctm[2])));
    const pad = strokes ? lw + 1 : 0;
    const shown: [number, number, number, number] = [pageBox[0] - pad, pageBox[1] - pad, pageBox[2] + pad, pageBox[3] + pad];
    if (this.flatDepth > 0 || st.smask) { this.flat(i, 'soft mask or transparency group', shown); return; }
    let shade: PathShade | undefined;
    if (fills && st.fill.pattern) {
      shade = (await this.axialOf(st.fill.pattern)) ?? undefined;
      if (!shade) {
        this.flat(i, st.fill.pattern[0] === 'TilingPattern' ? 'tiling pattern' : 'mesh shading', shown);
        const f = this.lastFlat();
        if (f && st.fill.pattern[0] === 'TilingPattern' && st.fill.patternObj !== undefined && !strokes && !keepCtm && !this.flatNow) {
          (f.fills ??= []).push({ d, ...(evenOdd ? { evenOdd } : {}), obj: st.fill.patternObj, base: this.baseOf(), alpha: st.fill.alpha * st.ga, clips: [...st.clips] });
        } else if (f) f.fills = undefined, f.noVector = true;
        return;
      }
    }
    if (strokes && st.stroke.pattern) { this.flat(i, 'pattern on a stroke', shown); return; }

    const blend = this.blendMode();
    const part: PathPart = { d, fill: null, stroke: null };
    const ex: Omit<PathExact, 'sig'> = {};
    if (fills) {
      part.fill = { type: 'solid', color: shade ? hexOf(shade.stops[0]!.color, st.fill.alpha * st.ga) : hexOf(st.fill.rgb, st.fill.alpha * st.ga) };
      if (st.fill.src && !shade) ex.fillSrc = st.fill.src;
    }
    if (evenOdd) part.evenOdd = true;
    if (strokes) {
      part.stroke = { color: hexOf(st.stroke.rgb, st.stroke.alpha * st.ga), width: Math.max(lw, 0.25) };
      ex.width = lw;
      if (st.cap) ex.cap = st.cap;
      if (st.join) ex.join = st.join;
      if (st.miter !== 10) ex.miter = st.miter;
      const k = keepCtm ? 1 : Math.sqrt(Math.abs(st.ctm[0] * st.ctm[3] - st.ctm[1] * st.ctm[2]));
      if (st.dash && st.dash.array.length) ex.dash = { array: st.dash.array.map((v) => v * k), phase: st.dash.phase * k };
      if (st.stroke.src) ex.strokeSrc = st.stroke.src;
      if (keepCtm) ex.ctm = st.ctm;
    }
    if (shade) ex.shade = shade;
    part.exact = { ...ex, sig: partSig(part) };

    const key = `${st.clips.map((c) => c.d).join('|')}/${st.blend}`;
    const cur = this.pathOut;
    const far = cur && (pageBox[0] > cur.box[2] + 48 || pageBox[2] < cur.box[0] - 48 || pageBox[1] > cur.box[3] + 48 || pageBox[3] < cur.box[1] - 48);
    const big = (pageBox[2] - pageBox[0]) * (pageBox[3] - pageBox[1]) > 0.4 * this.pageW * this.pageH;
    if (cur && cur.key === key && !far && !big && cur.el.paths.length < MAX_PARTS) {
      cur.el.paths.push(part);
      grow(cur.box, pageBox[0], pageBox[1]);
      grow(cur.box, pageBox[2], pageBox[3]);
      return;
    }
    this.flushText();
    this.flushPath();
    const el: PathElement = { id: newId(), type: 'path', name: 'PDF vector', x: 0, y: 0, w: 1, h: 1, rotation: 0, opacity: 1, viewBox: { x: 0, y: 0, w: 1, h: 1 }, paths: [part] };
    if (blend) el.blend = blend;
    this.pathClips = st.clips;
    this.pathOut = { el, box: [...pageBox] as [number, number, number, number], key };
  }

  private objsOf(id: string): any { return id.startsWith('g_') ? this.page.commonObjs : this.page.objs; }

  private async axialOf(pattern: unknown[]): Promise<PathShade | null> {
    if (pattern[0] !== 'Shading') return null;
    const ir: any = await objGet(this.objsOf(pattern[1] as string), pattern[1] as string);
    const pm = pattern[2] ? toMatrix(pattern[2]) : null;
    return ir ? shadeOf(ir, pm ? mulMatrix(this.baseOf(), pm) : this.baseOf()) : null;
  }
  private baseOf(): Matrix { return this.baseCtm[this.baseCtm.length - 1]!; }
  baseCtm: Matrix[] = [];

  private async shadingFill(i: number, id: string): Promise<void> {
    const st = this.st;
    const ir: any = await objGet(this.objsOf(id), id);
    const box = st.clipBox;
    const blend = this.blendMode();
    const shade = ir ? shadeOf(ir, st.ctm) : null;
    if (this.flatDepth > 0 || st.smask || !shade) { this.flat(i, shade ? 'soft mask or transparency group' : 'mesh shading', box); return; }
    this.flushText();
    this.flushPath();
    const [x0, y0, x1, y1] = box;
    if (x1 <= x0 || y1 <= y0) return;
    const part: PathPart = { d: `M${n4(x0)} ${n4(y0)}L${n4(x1)} ${n4(y0)}L${n4(x1)} ${n4(y1)}L${n4(x0)} ${n4(y1)}Z`, fill: { type: 'solid', color: hexOf(shade.stops[0]!.color, st.fill.alpha * st.ga) }, stroke: null };
    part.exact = { shade, sig: partSig(part) };
    const el: PathElement = { id: newId(), type: 'path', name: 'PDF gradient', x: x0, y: y0, w: x1 - x0, h: y1 - y0, rotation: 0, opacity: 1, viewBox: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, paths: [part] };
    if (blend) el.blend = blend;
    setClip(el, st.clips, box);
    this.out.push(el);
  }

  // ---- images ----

  private async image(i: number, img: any, stencil: boolean, inline: boolean): Promise<void> {
    const st = this.st;
    const m = st.ctm;
    const corners = emptyBox();
    for (const [x, y] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) { const p = applyMatrix(m, x, y); grow(corners, p[0], p[1]); }
    const src = !inline ? this.scan?.nextImage(img.width, img.height) : undefined;
    if (this.flatDepth > 0 || st.smask) { this.flat(i, 'soft mask or transparency group', corners); return; }
    if (stencil && st.fill.pattern) { this.flat(i, 'image mask filled with a pattern', corners); return; }
    const ux = Math.hypot(m[0], m[1]), uy = Math.hypot(m[2], m[3]);
    if (ux < 1e-6 || uy < 1e-6) return;
    const skew = Math.abs(m[0] * m[2] + m[1] * m[3]) / (ux * uy);
    if (skew > 1e-3) { this.flat(i, 'skewed image', corners); return; }

    const key = stencil ? `${img.dataId ?? img.data?.length}:${st.fill.rgb}:${i}` : `${img.dataId ?? ''}:${inline ? i : ''}:${src?.obj ?? ''}`;
    const asset = await this.storeImage(key, img, stencil, src?.obj);
    if (!asset) { this.flat(i, 'image in a form pdf.js does not expose', corners); return; }

    this.flushText();
    this.flushPath();
    const det = m[0] * m[3] - m[1] * m[2];
    const rotation = ((Math.atan2(m[1], m[0]) * 180) / Math.PI);
    const c = applyMatrix(m, 0.5, 0.5);
    const el: ImageElement = {
      id: newId(), type: 'image', name: stencil ? 'PDF mask' : 'PDF image', x: c[0] - ux / 2, y: c[1] - uy / 2, w: ux, h: uy, rotation: Math.abs(rotation) < 1e-6 ? 0 : rotation, opacity: st.fill.alpha * st.ga, asset: asset.id, radius: 0, crop: { x: 0, y: 0, w: 1, h: 1 },
    };
    if (det > 0) el.flipY = true; // y runs down here, so an upright image has a negative determinant
    const blend = this.blendMode();
    if (blend) el.blend = blend;
    if (src) {
      const ps: PdfImageSource = { obj: src.obj, asset: asset.id };
      if (stencil) ps.stencil = st.fill.src ?? { cs: 'rg', v: rgbOf(st.fill.rgb), rgb: st.fill.rgb };
      el.pdfImage = ps;
    }
    setClip(el, st.clips, corners);
    this.out.push(el);
    this.counts.image++;
  }

  private async storeImage(key: string, img: any, stencil: boolean, obj: number | undefined): Promise<{ id: string; w: number; h: number } | null> {
    const seen = this.b.imageAssets.get(key);
    if (seen) return seen;
    const w: number = img.width, h: number = img.height;
    const id = `img-${newId()}`;
    const jpeg = !stencil && obj !== undefined ? this.source?.jpegBytes(obj) : null;
    let bytes: Uint8Array | null = null, mime = 'image/png';
    if (jpeg) { bytes = jpeg; mime = 'image/jpeg'; }
    else if (stencil) {
      const px = new Uint8Array(w * h * 4);
      const [r, g, b] = rgbOf(this.st.fill.rgb).map((v) => Math.round(v * 255));
      const data: Uint8Array | undefined = img.data;
      if (!data) return null;
      const row = (w + 7) >> 3;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const on = !((data[y * row + (x >> 3)]! >> (7 - (x & 7))) & 1);
        const at = (y * w + x) * 4;
        px[at] = r!; px[at + 1] = g!; px[at + 2] = b!; px[at + 3] = on ? 255 : 0;
      }
      bytes = encodePng(px, w, h, 4);
    } else {
      const data: Uint8Array | undefined = img.data;
      if (!data) return null;
      const K = this.pdfjs.ImageKind;
      if (img.kind === K.RGB_24BPP) bytes = encodePng(data, w, h, 3);
      else if (img.kind === K.RGBA_32BPP) bytes = encodePng(data, w, h, 4);
      else if (img.kind === K.GRAYSCALE_1BPP) {
        const px = new Uint8Array(w * h);
        const row = (w + 7) >> 3;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = (data[y * row + (x >> 3)]! >> (7 - (x & 7))) & 1 ? 255 : 0;
        bytes = encodePng(px, w, h, 1);
      } else return null;
    }
    this.b.addAsset(id, bytes, { mime, width: w, height: h, name: 'PDF image' });
    const out = { id, w, h };
    this.b.imageAssets.set(key, out);
    return out;
  }

  // ---- the walk ----

  async walk(check: () => void): Promise<Out[]> {
    const { OPS } = this.pdfjs;
    const { fnArray, argsArray } = this.list;
    this.baseCtm = [this.st.ctm];
    for (let i = 0; i < fnArray.length; i++) {
      if ((i & 4095) === 0) check();
      const fn = fnArray[i]!, a = argsArray[i];
      if (this.maskDepth) {
        this.always.add(i);
        if (fn === OPS.beginGroup) { this.groups.push({ flat: false, mask: true }); this.maskDepth++; }
        else if (fn === OPS.endGroup) { this.groups.pop(); this.maskDepth--; }
        continue;
      }
      const st = this.st;
      switch (fn) {
        case OPS.save: this.stack.push({ ...st }); break;
        case OPS.restore: if (this.stack.length) this.st = this.stack.pop()!; break;
        case OPS.transform: st.ctm = mulMatrix(st.ctm, toMatrix(a)); break;
        case OPS.paintFormXObjectBegin: {
          if (fnArray[i - 1] !== OPS.beginGroup) this.scan?.nextForm();
          this.stack.push({ ...st });
          if (a[0]) st.ctm = mulMatrix(st.ctm, toMatrix(a[0]));
          this.baseCtm.push(st.ctm);
          if (a[1]) this.clipRect(a[1]);
          break;
        }
        case OPS.paintFormXObjectEnd: this.baseCtm.pop(); if (this.stack.length) this.st = this.stack.pop()!; break;
        case OPS.beginGroup: this.beginGroup(i, a[0]); break;
        case OPS.endGroup: this.endGroup(i); break;
        case OPS.beginMarkedContent: this.mc.push(false); break;
        case OPS.beginMarkedContentProps: {
          const off = a[0] === 'OC' && a[1] && this.ocConfig && !this.ocConfig.isVisible(a[1]);
          this.mc.push(!!off);
          if (off) this.hidden++;
          break;
        }
        case OPS.endMarkedContent: if (this.mc.pop()) this.hidden--; break;
        case OPS.beginAnnotation: {
          // [id, rect, transform, matrix, hasOwnCanvas]
          this.stack.push({ ...st });
          const [, rect, tr, mx] = a;
          if (Array.isArray(rect) || rect?.length) {
            this.clipRect([...rect] as number[]);
            if (tr) st.ctm = mulMatrix(st.ctm, toMatrix(tr));
            if (mx) st.ctm = mulMatrix(st.ctm, toMatrix(mx));
          }
          this.scan?.annotation();
          break;
        }
        case OPS.endAnnotation: if (this.stack.length) this.st = this.stack.pop()!; break;
        case OPS.setLineWidth: st.lw = a[0]; break;
        case OPS.setLineCap: st.cap = a[0]; break;
        case OPS.setLineJoin: st.join = a[0]; break;
        case OPS.setMiterLimit: st.miter = a[0]; break;
        case OPS.setDash: st.dash = { array: [...a[0]], phase: a[1] }; break;
        case OPS.setGState: await this.gstate(a[0]); break;
        case OPS.setFillRGBColor: { const src = this.scan?.nextColor('fill', a[0]); st.fill = { rgb: src?.rgb ?? a[0], alpha: st.fill.alpha, src }; break; }
        case OPS.setStrokeRGBColor: { const src = this.scan?.nextColor('stroke', a[0]); st.stroke = { rgb: src?.rgb ?? a[0], alpha: st.stroke.alpha, src }; break; }
        case OPS.setFillTransparent: st.fill = { ...st.fill, alpha: 0 }; break;
        case OPS.setStrokeTransparent: st.stroke = { ...st.stroke, alpha: 0 }; break;
        case OPS.setFillColorN: st.fill = { rgb: st.fill.rgb, alpha: st.fill.alpha, pattern: a, patternObj: this.scan?.nextPattern('fill') }; break;
        case OPS.setStrokeColorN: st.stroke = { rgb: st.stroke.rgb, alpha: st.stroke.alpha, pattern: a, patternObj: this.scan?.nextPattern('stroke') }; break;
        case OPS.constructPath: {
          const [op, [data]] = a;
          await this.paintPath(i, op, data ?? [], OPS);
          break;
        }
        case OPS.clip: this.pendingClip = 'nonzero'; break;
        case OPS.eoClip: this.pendingClip = 'evenodd'; break;
        case OPS.beginText: st.tm = [1, 0, 0, 1, 0, 0]; st.tlm = [1, 0, 0, 1, 0, 0]; break;
        case OPS.endText: this.endTextOp(); break;
        case OPS.setCharSpacing: st.tc = a[0]; break;
        case OPS.setWordSpacing: st.tw = a[0]; break;
        case OPS.setHScale: st.th = a[0] / 100; break;
        case OPS.setLeading: st.leading = -a[0]; break;
        case OPS.setFont: await this.setFont(a[0], a[1]); break;
        case OPS.setTextRenderingMode: st.mode = a[0]; break;
        case OPS.setTextRise: st.rise = a[0]; break;
        case OPS.moveText: this.td(a[0], a[1]); break;
        case OPS.setLeadingMoveText: st.leading = -a[1]; this.td(a[0], a[1]); break;
        case OPS.nextLine: this.td(0, -st.leading); break;
        case OPS.setTextMatrix: st.tm = toMatrix(a); st.tlm = st.tm; break;
        case OPS.showText: if (!this.hidden) this.show(i, a[0]); else this.advance(a[0]); break;
        case OPS.showSpacedText: if (!this.hidden) this.show(i, a[0]); else this.advance(a[0]); break;
        case OPS.nextLineShowText: this.td(0, -st.leading); if (!this.hidden) this.show(i, a[0]); break;
        case OPS.nextLineSetSpacingShowText: st.tw = a[0]; st.tc = a[1]; this.td(0, -st.leading); if (!this.hidden) this.show(i, a[2]); break;
        case OPS.shadingFill: if (!this.hidden) await this.shadingFill(i, a[0]); break;
        case OPS.paintImageXObject: {
          if (this.hidden) { this.scan?.nextImage(a[1], a[2]); break; }
          const img: any = await objGet(String(a[0]).startsWith('g_') ? this.page.commonObjs : this.page.objs, a[0]);
          if (img) { img.dataId ??= a[0]; await this.image(i, img, false, false); }
          break;
        }
        case OPS.paintInlineImageXObject: if (!this.hidden) await this.image(i, a[0], false, true); break;
        case OPS.paintImageMaskXObject: {
          let img = a[0];
          if (this.hidden) { this.scan?.nextImage(img.width, img.height); break; }
          if (typeof img.data === 'string') {
            const got: any = await objGet(String(img.data).startsWith('g_') ? this.page.commonObjs : this.page.objs, img.data);
            img = { ...got, dataId: a[0].data };
          }
          await this.image(i, img, true, false);
          break;
        }
        case OPS.paintSolidColorImageMask: {
          if (this.hidden) break;
          const part = [0, 0, 1, 0, 1, 1, 0, 1];
          await this.paintPath(i, OPS.fill, rectOps(part, DRAW), OPS);
          break;
        }
        default:
          break;
      }
    }
    this.flushText();
    this.flushPath();
    return this.out;
  }

  private endTextOp(): void {
    if (this.bt.length) {
      if (this.btFlat) this.endText();
      else {
        this.flushPathIfText();
        this.textOut.push(...this.bt);
        this.bt = [];
        this.btOps = [];
      }
    } else { this.btOps = []; this.btFlat = null; }
  }

  private flushPathIfText(): void { this.flushPath(); }

  private td(x: number, y: number): void {
    const st = this.st;
    st.tlm = mulMatrix(st.tlm, [1, 0, 0, 1, x, y]);
    st.tm = st.tlm;
  }

  private advance(glyphs: any[]): void {
    const st = this.st, f = this.font();
    let x = 0;
    for (const g of glyphs) {
      if (typeof g === 'number') x -= (g / 1000) * st.size;
      else if (g) x += ((g.width ?? 0) * (f?.scale ?? 1) * st.size) / 1000 + st.tc + (g.isSpace ? st.tw : 0);
    }
    st.tm = mulMatrix(st.tm, [1, 0, 0, 1, x * st.th, 0]);
  }

  private clipRect(r: number[]): void {
    const st = this.st;
    const [x0, y0, x1, y1] = r as [number, number, number, number];
    const data = rectOps([x0, y0, x1, y0, x1, y1, x0, y1], DRAW);
    const { d, box } = pathToSvg(data, st.ctm, false, DRAW);
    st.clips = [...st.clips, { d }];
    st.clipBox = [Math.max(st.clipBox[0], box[0]), Math.max(st.clipBox[1], box[1]), Math.min(st.clipBox[2], box[2]), Math.min(st.clipBox[3], box[3])];
  }

  private async gstate(entries: [string, any][]): Promise<void> {
    const st = this.st;
    for (const [k, v] of entries) {
      switch (k) {
        case 'LW': st.lw = v; break;
        case 'LC': st.cap = v; break;
        case 'LJ': st.join = v; break;
        case 'ML': st.miter = v; break;
        case 'D': st.dash = { array: [...v[0]], phase: v[1] }; break;
        case 'CA': st.stroke = { ...st.stroke, alpha: v }; break;
        case 'ca': st.fill = { ...st.fill, alpha: v }; break;
        case 'BM': st.blend = v; break;
        case 'SMask': st.smask = !!v; break;
        case 'Font': await this.setFont(v[0], v[1]); break;
        default: break;
      }
    }
  }

  private beginGroup(i: number, g: any): void {
    const st = this.st;
    this.stack.push({ ...st });
    const formObj = !g.smask ? this.scan?.nextForm() : undefined;
    if (g.smask) { // draws a mask, not page content
      this.always.add(i);
      this.maskDepth = 1;
      this.groups.push({ flat: false, mask: true });
      return;
    }
    // alpha on a group of one drawing, or of text alone, is just that drawing's alpha
    if (st.fill.alpha < 0.999 && st.blend === 'source-over' && !st.smask && !g.knockout && !g.hasSoftMask && !this.flatDepth && this.simpleGroup(i)) {
      st.ga *= st.fill.alpha;
      st.fill = { ...st.fill, alpha: 1 };
      st.stroke = { ...st.stroke, alpha: 1 };
      this.groups.push({ flat: false, mask: false });
      return;
    }
    const needs = st.fill.alpha < 0.999 || st.blend !== 'source-over' || st.smask || g.knockout || g.hasSoftMask || (g.needsIsolation && (g.isolated || g.hasSoftMask));
    const flat = needs || this.flatDepth > 0;
    this.groups.push({ flat, mask: false });
    if (flat) {
      this.flushText();
      this.flushPath();
      if (this.flatDepth === 0) {
        const bbox = this.st.clipBox;
        const why = g.knockout ? 'knockout group' : st.smask || g.hasSoftMask ? 'soft mask' : st.blend !== 'source-over' ? `transparency group, ${st.blend} blend` : needsIso(g) ? 'isolated group with blends inside' : 'transparency group';
        this.flatNow = { kind: 'flat', ops: new Set(), why, bbox: [...bbox], blend: this.blendMode() };
        if (formObj !== undefined && !st.smask) this.flatNow.form = { obj: formObj, m: st.ctm, alpha: st.fill.alpha * st.ga, clips: [...st.clips] };
        this.out.push(this.flatNow);
      }
      this.flatDepth++;
      // inside the group its own blend starts over
      this.st = { ...this.st, smask: false };
    }
  }

  /** True when nothing inside this group overlaps anything else in it. */
  private simpleGroup(i: number): boolean {
    const { OPS } = this.pdfjs;
    const paints = paintFns(OPS);
    const texts = new Set([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText]);
    let depth = 0, drawings = 0, text = 0;
    for (let k = i; k < this.list.fnArray.length; k++) {
      const fn = this.list.fnArray[k]!;
      if (fn === OPS.beginGroup) { if (this.list.argsArray[k]?.[0]?.smask) return false; depth++; }
      else if (fn === OPS.endGroup) { if (--depth === 0) break; }
      else if (texts.has(fn)) text++;
      else if (paints.has(fn) || (fn === OPS.constructPath && this.list.argsArray[k]?.[0] !== OPS.endPath)) drawings++;
    }
    return drawings + (text ? 1 : 0) <= 1;
  }

  private endGroup(_i: number): void {
    const g = this.groups.pop();
    if (this.stack.length) this.st = this.stack.pop()!;
    if (g?.flat) {
      this.flatDepth--;
      if (this.flatDepth === 0) this.flatNow = null;
    }
  }
}

const needsIso = (g: { needsIsolation?: boolean }) => !!g.needsIsolation;

function rgbOf(hex: string): number[] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
}

export function invert(m: Matrix): Matrix | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-14) return null;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

/** A uniform scale with rotation or mirroring: stroke widths stay round. */
function isConformal(m: Matrix): boolean {
  const a = Math.hypot(m[0], m[1]), b = Math.hypot(m[2], m[3]);
  return Math.abs(a - b) < 1e-4 * Math.max(a, b) && Math.abs(m[0] * m[2] + m[1] * m[3]) < 1e-4 * a * b;
}

function rectOps(p: number[], Draw: Record<string, number>): number[] {
  return [Draw.moveTo!, p[0]!, p[1]!, Draw.lineTo!, p[2]!, p[3]!, Draw.lineTo!, p[4]!, p[5]!, Draw.lineTo!, p[6]!, p[7]!, Draw.closePath!];
}

function transformBox(b: [number, number, number, number], m: Matrix): [number, number, number, number] {
  const o = emptyBox();
  for (const [x, y] of [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]] as const) { const p = applyMatrix(m, x, y); grow(o, p[0], p[1]); }
  return o;
}

export function pathToSvg(data: ArrayLike<number>, m: Matrix | null, close: boolean, Draw: Record<string, number>): { d: string; box: [number, number, number, number] } {
  const box = emptyBox();
  const out: string[] = [];
  const pt = (x: number, y: number) => {
    const p = m ? applyMatrix(m, x, y) : [x, y] as const;
    grow(box, p[0], p[1]);
    return `${n4(p[0])} ${n4(p[1])}`;
  };
  for (let i = 0; i < data.length;) {
    const op = data[i++]!;
    if (op === Draw.moveTo) { out.push(`M${pt(data[i]!, data[i + 1]!)}`); i += 2; }
    else if (op === Draw.lineTo) { out.push(`L${pt(data[i]!, data[i + 1]!)}`); i += 2; }
    else if (op === Draw.curveTo) { out.push(`C${pt(data[i]!, data[i + 1]!)} ${pt(data[i + 2]!, data[i + 3]!)} ${pt(data[i + 4]!, data[i + 5]!)}`); i += 6; }
    else if (op === Draw.quadraticCurveTo) { out.push(`Q${pt(data[i]!, data[i + 1]!)} ${pt(data[i + 2]!, data[i + 3]!)}`); i += 4; }
    else if (op === Draw.closePath) out.push('Z');
    else break;
  }
  if (close) out.push('Z');
  if (!out.length) return { d: '', box: [0, 0, 0, 0] };
  return { d: out.join(''), box };
}

function shadeOf(ir: any, m: Matrix): PathShade | null {
  if (ir[0] !== 'RadialAxial') return null;
  const [, type, , stops, p0, p1, r0, r1] = ir;
  const list = (stops as [number, string][]).map(([offset, color]) => ({ offset, color }));
  if (list.length < 2) return null;
  // pdf.js pads an unextended end with a transparent stop at the edge
  const clear = (c: string) => c === 'transparent' || c === '#00000000' || /^rgba\(.*,\s*0\)$/.test(c);
  const extend: [boolean, boolean] = [true, true];
  const kept = list.slice();
  if (clear(kept[0]!.color)) { extend[0] = false; kept.shift(); }
  if (clear(kept[kept.length - 1]!.color)) { extend[1] = false; kept.pop(); }
  const shade: PathShade = {
    kind: type === 'axial' ? 'axial' : 'radial',
    coords: type === 'axial' ? [p0[0], p0[1], p1[0], p1[1]] : [p0[0], p0[1], r0, p1[0], p1[1], r1],
    stops: kept, extend, matrix: m,
  };
  return shade;
}

function chunkBox(c: Chunk, fonts: Record<string, PdfFont>): [number, number, number, number] {
  void fonts;
  const s = Math.abs(c.run.size), th = c.run.th ?? 1;
  const b = emptyBox();
  for (const [x, y] of [[-0.3 * s, -0.5 * s], [c.end + 0.3 * s, -0.5 * s], [c.end + 0.3 * s, 1.2 * s], [-0.3 * s, 1.2 * s]] as const) {
    const p = applyMatrix(c.m, x * th, y);
    grow(b, p[0], p[1]);
  }
  return b;
}

/** Same baseline and close enough to read as one line. */
function sameLine(a: Chunk, b: Chunk): boolean {
  if (a.state.clipKey !== b.state.clipKey || a.state.blend !== b.state.blend) return false;
  const inv = invert(a.m);
  if (!inv) return false;
  const d = mulMatrix(inv, b.m);
  // the same direction (sizes may differ), on the same baseline in the first run's text space
  if (Math.abs(d[1]) > 1e-4 || Math.abs(d[2]) > 1e-4 || d[0] <= 0 || d[3] <= 0) return false;
  if (Math.abs(d[3] - d[0]) > 1e-3) return false;
  const s = Math.abs(a.run.size);
  if (Math.abs(d[5]) > s * 0.02) return false;
  const gap = d[4] / (a.run.th ?? 1) - a.end;
  return gap > -s * 0.3 && gap < s * 1.6;
}

function setClip(el: Element, clips: readonly PdfClipPath[], shown: [number, number, number, number]): void {
  const kept = clips.filter((c) => !rectContains(c, shown));
  if (kept.length) el.pdfClip = { paths: dedupe(kept), box: { x: el.x, y: el.y, w: el.w, h: el.h } };
}

function dedupe(c: PdfClipPath[]): PdfClipPath[] {
  const seen = new Set<string>();
  return c.filter((p) => (seen.has(p.d) ? false : (seen.add(p.d), true)));
}

/** True when this clip is a rectangle holding everything shown: it clips nothing, so the element needn't carry it. */
function rectContains(c: PdfClipPath, b: [number, number, number, number]): boolean {
  const m = c.d.match(/^M(-?[\d.e-]+) (-?[\d.e-]+)L(-?[\d.e-]+) (-?[\d.e-]+)L(-?[\d.e-]+) (-?[\d.e-]+)L(-?[\d.e-]+) (-?[\d.e-]+)(?:L-?[\d.e-]+ -?[\d.e-]+)?Z?$/);
  if (!m) return false;
  const v = m.slice(1).map(Number);
  const xs = [v[0]!, v[2]!, v[4]!, v[6]!], ys = [v[1]!, v[3]!, v[5]!, v[7]!];
  const axis = (v[0] === v[2] || v[1] === v[3]) && (v[2] === v[4] || v[3] === v[5]);
  return axis && Math.min(...xs) <= b[0] && Math.max(...xs) >= b[2] && Math.min(...ys) <= b[1] && Math.max(...ys) >= b[3];
}

function textElement(line: Chunk[], b: Builder, ascents: Map<string, [number, number]>): Element {
  const first = line[0]!, m0 = first.m;
  if (!invert(m0)) return { id: newId(), type: 'text', x: NaN, y: 0, w: 0, h: 0, rotation: 0, opacity: 1, text: '', style: DEFAULT_TEXT_STYLE };
  const th0 = first.run.th ?? 1;
  const inv0 = invert(m0)!;
  // the line's reach along its own baseline, in the first run's text units
  let start = Infinity, end = -Infinity;
  for (const c of line) {
    const d = mulMatrix(inv0, c.m);
    const th = c.run.th ?? 1;
    const a = d[4], z = d[4] + c.end * th * d[0];
    start = Math.min(start, a, z);
    end = Math.max(end, a, z);
  }
  const ux = Math.hypot(m0[0], m0[1]), uy = Math.hypot(m0[2], m0[3]);
  const [asc, desc] = ascents.get(first.run.font) ?? [0.8, 0.2];
  const pxSize = Math.abs(first.run.size) * uy;
  const a = asc * pxSize, d = desc * pxSize;
  const angle = Math.atan2(m0[1], m0[0]);
  const flipBase = m0[0] * m0[3] - m0[1] * m0[2] > 0; // mirrored text space: "up" flips
  const dir = [Math.cos(angle), Math.sin(angle)] as const, up = flipBase ? [dir[1], -dir[0]] as const : [-dir[1], dir[0]] as const;
  void th0;
  const L = Math.max((end - start) * ux, 1);
  const o = applyMatrix(m0, start, 0);
  // box centre: along the baseline by L/2, across it by (d - a)/2 towards the descent
  const nx = -Math.sin(angle), ny = Math.cos(angle);
  void up;
  const h = a + d;
  const cx = o[0] + dir[0] * (L / 2) + nx * (d - a) / 2, cy = o[1] + dir[1] * (L / 2) + ny * (d - a) / 2;
  const x = cx - L / 2, y = cy - h / 2;
  const rotation = Math.abs(angle) < 1e-5 ? 0 : (angle * 180) / Math.PI;
  // page → box: undo the rotation around the centre, then move the box to 0,0
  const cos = Math.cos(-angle), sin = Math.sin(-angle);
  const toBox: Matrix = [cos, sin, -sin, cos, cx - cx * cos + cy * sin - x, cy - cx * sin - cy * cos - y];
  const runs = line.map((c) => ({ ...c.run, m: roundM(mulMatrix(toBox, c.m)) }));

  let text = '';
  const parts: TextRun[] = [];
  const famOf = (f: string) => b.fonts[f]?.family ?? f;
  line.forEach((c, i) => {
    let t = c.text;
    const prev = line[i - 1];
    if (prev) {
      const dd = mulMatrix(invert(prev.m)!, c.m);
      const gap = dd[4] / (prev.run.th ?? 1) - prev.end;
      if (gap > Math.abs(prev.run.size) * 0.18 && !text.endsWith(' ') && !t.startsWith(' ')) t = ` ${t}`;
    }
    text += t;
    parts.push({ text: t, style: { fontFamily: famOf(c.run.font), fontSize: Math.abs(c.run.size) * Math.hypot(c.m[2], c.m[3]), color: c.run.color } });
  });
  const style = { ...DEFAULT_TEXT_STYLE, align: 'left' as const, fontFamily: famOf(first.run.font), fontSize: pxSize, color: first.run.color, lineHeight: h / Math.max(pxSize, 0.01), letterSpacing: (first.run.tc ?? 0) * ux };
  const el: TextElement = { id: newId(), type: 'text', name: text.slice(0, 40) || 'PDF text', x, y, w: L, h, rotation, opacity: 1, text, style };
  const merged = parts.filter((p, i) => i === 0 || p.style?.fontFamily !== parts[i - 1]!.style?.fontFamily || p.style?.color !== parts[i - 1]!.style?.color || p.style?.fontSize !== parts[i - 1]!.style?.fontSize);
  if (merged.length > 1) el.runs = parts;
  const blend = BLENDS[first.state.blend];
  if (blend) el.blend = blend;
  el.exact = { runs, w: L, h, sig: '', color: first.run.color, baseline: a };
  const box = emptyBox();
  for (const c of line) { const bb = chunkBox(c, b.fonts); grow(box, bb[0], bb[1]); grow(box, bb[2], bb[3]); }
  setClip(el, first.state.clips, box);
  return el;
}

/** pdf.js hands matrices over bare, or wrapped in the argument list, as arrays or Float32Arrays. */
function toMatrix(a: any): Matrix {
  const m = a.length === 1 ? a[0] : a;
  return [m[0], m[1], m[2], m[3], m[4], m[5]];
}

const roundM = (m: Matrix): Matrix => m.map((v) => Math.round(v * 1e6) / 1e6) as Matrix;

/** Turn pdf.js fonts into assets and design families, once every glyph used is known. */
function finishFonts(b: Builder, docFonts: NonNullable<Doc['fonts']>): void {
  for (const [key, f] of Object.entries(b.fonts)) {
    const got = b.fontBytes.get(key);
    let editable = false;
    if (got && !f.type3) {
      const cmap = readCmap(got.data);
      const uni = new Map<number, number>();
      for (const [code, ch] of got.chars) {
        const gid = cmap.get(ch.codePointAt(0)!);
        if (gid === undefined) continue;
        f.gids[code] = gid;
        const u = f.unicode[code];
        if (u && [...u].length === 1) uni.set(u.codePointAt(0)!, gid);
      }
      try {
        const bytes = withUnicodeCmap(got.data, uni);
        const id = `pdffont-${newId()}`;
        const mime = bytes[0] === 0x4f ? 'font/otf' : 'font/ttf';
        b.addAsset(id, bytes, { mime, name: f.name });
        let family = `${f.name} (PDF)`;
        for (let i = 2; b.usedFamilies.has(family); i++) family = `${f.name} (PDF ${i})`;
        b.usedFamilies.add(family);
        f.family = family;
        f.asset = id;
        docFonts.push({ family, asset: id, weight: 400, italic: false, source: 'pdf' });
        editable = true;
      } catch { /* a font program we can't touch stays exact-only */ }
    }
    b.report.fonts.push({ name: f.name, embedded: !!got, editable });
  }
}

function renameFamilies(page: Page, fonts: Record<string, PdfFont>): void {
  const fix = (el: Element) => {
    if (el.type === 'group') { el.children.forEach(fix); return; }
    if (el.type !== 'text' || !el.exact) return;
    const runFont = el.exact.runs[0]!.font;
    el.style.fontFamily = fonts[runFont]?.family ?? closestFamily(fonts[runFont]);
    if (el.runs) {
      el.runs = el.runs.map((r, i) => {
        const k = el.exact!.runs[Math.min(i, el.exact!.runs.length - 1)]!.font;
        return { ...r, style: { ...r.style, fontFamily: fonts[k]?.family ?? closestFamily(fonts[k]) } };
      });
    }
    el.exact.sig = textSig(el);
  };
  page.elements.forEach(fix);
}

const SAFE: [RegExp, string][] = [
  [/arial|helvetica|liberation ?sans|nimbus ?sans/i, 'Arimo'], [/times|liberation ?serif|nimbus ?rom/i, 'Tinos'], [/courier|liberation ?mono|nimbus ?mon/i, 'Cousine'],
  [/calibri/i, 'Carlito'], [/cambria/i, 'Caladea'], [/georgia/i, 'Gelasio'], [/verdana|dejavu ?sans/i, 'DejaVu Sans'], [/garamond/i, 'EB Garamond'], [/palatino|book ?antiqua/i, 'Crimson Text'],
  [/devanagari|mangal|kokila|hind/i, 'Noto Sans Devanagari'],
];

/** The nearest full font for text a PDF's subset can't show. */
export function closestFamily(f: Pick<PdfFont, 'name' | 'serif' | 'mono'> | undefined): string {
  if (!f) return 'Inter';
  const clean = f.name.replace(/[-,_ ]?(bold|italic|oblique|regular|roman|medium|light|semibold|black|mt|ps)\b/gi, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  for (const [re, fam] of SAFE) if (re.test(f.name) || re.test(clean)) return fam;
  if (f.mono) return 'Roboto Mono';
  return f.serif ? 'Noto Serif' : 'Inter';
}

async function renderFlats(pdfjs: Pdfjs, doc: any, page: any, list: { fnArray: number[] }, viewport: any, flats: Flat[], always: Set<number>, dpi: number, b: Builder, num: number, W: number, H: number): Promise<void> {
  const paints = paintFns(pdfjs.OPS);
  const scale = dpi / 96;
  const isPaint = (fn: number, args: any) => paints.has(fn) || (fn === pdfjs.OPS.constructPath && args?.[0] !== pdfjs.OPS.endPath);
  for (const f of flats) {
    const x0 = Math.max(0, Math.floor(f.bbox[0])), y0 = Math.max(0, Math.floor(f.bbox[1]));
    const x1 = Math.min(W, Math.ceil(f.bbox[2])), y1 = Math.min(H, Math.ceil(f.bbox[3]));
    if (x1 <= x0 || y1 <= y0) { f.ops.clear(); continue; }
    const w = Math.ceil((x1 - x0) * scale), h = Math.ceil((y1 - y0) * scale);
    const factory = doc.canvasFactory;
    const entry = factory.create(w, h);
    let map: Int32Array | null = null;
    const filter = (i: number, ol: { fnArray: number[]; argsArray: any[] }) => {
      map ??= alignLists(ol.fnArray, list.fnArray);
      const raw = map[i]!;
      if (raw >= 0 && always.has(raw)) return true;
      if (!isPaint(ol.fnArray[i]!, ol.argsArray[i])) return true;
      return raw >= 0 ? f.ops.has(raw) : false;
    };
    const vp = viewport.clone({ scale: viewport.scale * scale, dontFlip: false });
    await page.render({ canvasContext: entry.context, canvas: entry.canvas, viewport: vp, transform: [1, 0, 0, 1, -x0 * scale, -y0 * scale], background: 'rgba(0,0,0,0)', annotationMode: pdfjs.AnnotationMode.ENABLE, operationsFilter: filter }).promise;
    const data = entry.context.getImageData(0, 0, w, h).data as Uint8ClampedArray;
    factory.destroy(entry);
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3]) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (maxX < 0) { f.ops.clear(); continue; }
    const cw = maxX - minX + 1, ch = maxY - minY + 1;
    const px = new Uint8Array(cw * ch * 4);
    for (let y = 0; y < ch; y++) px.set(data.subarray(((y + minY) * w + minX) * 4, ((y + minY) * w + maxX + 1) * 4), y * cw * 4);
    const id = `flat-${newId()}`;
    b.addAsset(id, encodePng(px, cw, ch, 4), { mime: 'image/png', width: cw, height: ch, name: 'PDF region' });
    const box = { x: x0 + minX / scale, y: y0 + minY / scale, w: cw / scale, h: ch / scale };
    f.made = { id, ...box };
    b.report.flattened.push({ page: num, why: f.why, x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) });
  }
}

/** Index in `raw` of each operator in `opt` (pdf.js's render list folds runs of image operators into one; -1 there). */
function alignLists(opt: number[], raw: number[]): Int32Array {
  const map = new Int32Array(opt.length);
  let r = 0;
  for (let i = 0; i < opt.length; i++) {
    if (opt[i] === raw[r]) { map[i] = r++; continue; }
    map[i] = -1;
    // skip what the fold swallowed: resume where the next operator after it next appears
    const next = opt[i + 1];
    while (r < raw.length && raw[r] !== next) r++;
  }
  return map;
}

function finishPage(out: Out[], b: Builder): Element[] {
  const els: Element[] = [];
  for (const o of out) {
    if (!isFlat(o)) {
      // text at size 0 and other degenerate matrices draw nothing
      if (Number.isFinite(o.x + o.y + o.w + o.h + o.rotation)) els.push(o);
      continue;
    }
    const made = o.made;
    if (made) {
      const el: ImageElement = { id: newId(), type: 'image', name: `PDF region (${o.why})`, x: made.x, y: made.y, w: made.w, h: made.h, rotation: 0, opacity: 1, asset: made.id, radius: 0, crop: { x: 0, y: 0, w: 1, h: 1 } };
      if (o.blend) el.blend = o.blend;
      if ((o.form || o.fills?.length) && !o.noVector) {
        const v: PdfVectorSource = { asset: made.id, box: { x: el.x, y: el.y, w: el.w, h: el.h } };
        if (o.form) v.form = o.form;
        if (o.fills) v.fills = o.fills;
        el.pdfVector = v;
      }
      if (o.invisibleText?.length) {
        // the picture shows the glyphs: the text stays on top, selectable and editable, and draws nothing
        for (const t of o.invisibleText) if (t.type === 'text' && t.exact) t.exact.runs = t.exact.runs.map((r) => ({ ...r, mode: 3 }));
      }
      els.push(el);
    }
    if (o.invisibleText?.length) els.push(...o.invisibleText);
  }
  void b;
  return els;
}

/**
 * Read a PDF into a design. Throws PdfImportError for what the user must hear about:
 * a wrong password, a broken file, a cancel.
 */
export async function importPdf(pdfjs: Pdfjs, bytes: Uint8Array, opts: ImportOptions = {}): Promise<ImportResult> {
  const check = () => { if (opts.signal?.aborted) throw new PdfImportError('Import cancelled', 'cancelled'); };
  check();
  const data = new Uint8Array(bytes); // pdf.js takes the buffer over to its worker
  const task = pdfjs.getDocument({
    data, fontExtraProperties: true, disableFontFace: true, isOffscreenCanvasSupported: false, isImageDecoderSupported: false, useSystemFonts: false, verbosity: 0,
    stopAtErrors: false, password: opts.password, standardFontDataUrl: opts.standardFontDataUrl, cMapUrl: opts.cMapUrl, cMapPacked: true, wasmUrl: opts.wasmUrl,
  });
  let asked = false;
  let cancelled = false;
  if (opts.askPassword) {
    task.onPassword = (update: (p: string) => void, reason: number) => {
      const wrong = reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD || asked;
      asked = true;
      void opts.askPassword!(wrong).then((p) => {
        if (p === null) { cancelled = true; void task.destroy(); } else update(p);
      });
    };
  }
  const abort = () => void task.destroy();
  opts.signal?.addEventListener('abort', abort);
  let pdf: any;
  try {
    pdf = await task.promise;
  } catch (e) {
    const name = (e as Error)?.name;
    if (cancelled || opts.signal?.aborted) throw new PdfImportError('Import cancelled', 'cancelled');
    if (name === 'PasswordException') throw new PdfImportError('This PDF needs a password', 'password');
    throw new PdfImportError(`This file can't be read as a PDF: ${(e as Error)?.message ?? e}`, 'invalid');
  }
  try {
    const numbers = opts.pages ?? Array.from({ length: pdf.numPages }, (_, i) => i + 1);
    if (!numbers.length) throw new PdfImportError('This PDF has no pages', 'empty');
    const b = new Builder();
    b.report.pages = numbers.length;
    const source = await openSource(bytes);
    const oc = await pdf.getOptionalContentConfig().catch(() => null);

    // pages share one size: the design takes the largest, and smaller pages sit centred on it
    const sizes: { num: number; w: number; h: number; page: any; viewport: any }[] = [];
    for (const num of numbers) {
      check();
      const page = await pdf.getPage(num);
      const viewport = page.getViewport({ scale: PX, rotation: page.rotate });
      sizes.push({ num, w: viewport.width, h: viewport.height, page, viewport });
    }
    const docW = Math.max(...sizes.map((s) => s.w)), docH = Math.max(...sizes.map((s) => s.h));
    const mixed = sizes.some((s) => Math.abs(s.w - docW) > 0.5 || Math.abs(s.h - docH) > 0.5);
    b.report.mixedSizes = mixed;

    const pages: Page[] = [];
    const docFonts: NonNullable<Doc['fonts']> = [];
    let idx = 0;
    for (const s of sizes) {
      check();
      opts.onProgress?.(idx, sizes.length, `Reading page ${s.num} of ${pdf.numPages}`);
      const { page, viewport, num } = s;
      const list = await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.ENABLE });
      const base = toMatrix(viewport.transform);
      const scan = source?.scanPage(num - 1) ?? null;
      const w = new PageWalker(pdfjs, b, page, list, base, s.w, s.h, scan, source, oc, num);
      const out = await w.walk(check);
      const flats = out.filter(isFlat);
      if (flats.length) await renderFlats(pdfjs, pdf, page, list, viewport, flats, w.always, opts.flattenDpi ?? 300, b, num, s.w, s.h);
      const els = finishPage(out, b);
      const p: Page = { id: newId(), background: { type: 'solid', color: '#ffffff' }, elements: els };
      if (mixed) {
        const k = Math.min(docW / s.w, docH / s.h);
        const dx = (docW - s.w * k) / 2, dy = (docH - s.h * k) / 2;
        if (Math.abs(k - 1) > 1e-6 || dx > 0.01 || dy > 0.01) {
          for (const e of els) fitOnPage(e, k, dx, dy);
          p.pdfPage = { w: s.w / PX, h: s.h / PX, scale: k * PX, x: dx, y: dy };
        }
      }
      const links = await readLinks(page, base, pdf);
      if (links.length) { p.links = links; b.report.links += links.length; }
      for (const e of els) {
        if (e.type === 'text') b.report.texts++;
        else if (e.type === 'path') b.report.paths++;
        else if (e.type === 'image') b.report.images++;
      }
      const only = els.filter((e) => !(e.type === 'text' && e.exact?.runs.every((r) => r.mode === 3)));
      if (only.length === 1 && only[0]!.type === 'image' && only[0]!.w > s.w * 0.8 && only[0]!.h > s.h * 0.8) b.report.scanned++;
      pages.push(p);
      page.cleanup();
      idx++;
    }
    finishFonts(b, docFonts);
    for (const p of pages) renameFamilies(p, b.fonts);

    const sourceId = source ? `pdfsource-${newId()}` : undefined;
    if (sourceId) b.addAsset(sourceId, bytes, { mime: 'application/pdf', name: opts.title ?? 'source.pdf' });
    const meta = await pdf.getMetadata().catch(() => null);
    const title = opts.title ?? meta?.info?.Title ?? 'Imported PDF';
    const now = new Date().toISOString();
    const doc: Doc = {
      format: FORMAT, version: VERSION, id: newId(), title, unit: 'px', width: docW, height: docH, bleed: 0, pages, assets: b.meta,
      pdf: { fonts: b.fonts, ...(sourceId ? { source: sourceId } : {}) }, createdAt: now, updatedAt: now,
    };
    if (docFonts.length) doc.fonts = docFonts;
    notes(b.report);
    opts.onProgress?.(sizes.length, sizes.length, 'Done');
    return { doc, assets: b.assets, report: b.report };
  } finally {
    opts.signal?.removeEventListener('abort', abort);
    await pdf.destroy?.();
  }
}

function fitOnPage(e: Element, k: number, dx: number, dy: number): void {
  e.x = e.x * k + dx; e.y = e.y * k + dy; e.w *= k; e.h *= k;
  if (e.pdfClip) e.pdfClip.box = { x: e.x, y: e.y, w: e.w, h: e.h }; // box scales with the element; the clip stays in import px
  if (e.pdfClip) e.pdfClip = { ...e.pdfClip, paths: e.pdfClip.paths, box: e.pdfClip.box };
}

async function readLinks(page: any, base: Matrix, pdf: any): Promise<PageLink[]> {
  const out: PageLink[] = [];
  const annots = await page.getAnnotations({ intent: 'display' }).catch(() => []);
  for (const a of annots) {
    if (a.subtype !== 'Link' || !a.rect) continue;
    const p0 = applyMatrix(base, a.rect[0], a.rect[1]), p1 = applyMatrix(base, a.rect[2], a.rect[3]);
    const link: PageLink = { x: Math.min(p0[0], p1[0]), y: Math.min(p0[1], p1[1]), w: Math.abs(p1[0] - p0[0]), h: Math.abs(p1[1] - p0[1]) };
    if (a.url) link.url = a.url;
    else if (a.dest) {
      try {
        const dest = typeof a.dest === 'string' ? await pdf.getDestination(a.dest) : a.dest;
        if (dest?.[0]) link.page = await pdf.getPageIndex(dest[0]);
      } catch { continue; }
    } else continue;
    out.push(link);
  }
  return out;
}

function notes(r: ImportReport): void {
  if (r.mixedSizes) r.notes.push('Pages come in different sizes. They sit centred on the largest size here, and PDF export gives each page its own size back.');
  const groups = new Map<string, number>();
  for (const f of r.flattened) groups.set(f.why, (groups.get(f.why) ?? 0) + 1);
  for (const [why, c] of groups) r.notes.push(`${c} region${c > 1 ? 's' : ''} kept as a picture: ${why}.`);
  const lost = r.fonts.filter((f) => !f.editable).map((f) => f.name);
  if (lost.length) r.notes.push(`Fonts shown exactly but not usable for new text: ${[...new Set(lost)].join(', ')}.`);
  if (r.scanned) r.notes.push(`${r.scanned} page${r.scanned > 1 ? 's are' : ' is'} a scan: one image, no text to edit.`);
}

