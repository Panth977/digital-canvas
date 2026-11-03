/**
 * Live previews for the plugin creators: a small doc drawn by the real
 * renderer (with `animateAt` for animations), and an SkSL effect run on it
 * with CanvasKit's RuntimeEffect (the same contract the renderer uses for
 * `ElementBase.shader`: `uniform shader image`, `resolution`, `time`, one
 * float per param).
 */
import type { Canvas, CanvasKit, Image as SkImage } from 'canvaskit-wasm';
import { animateAt, type Doc, type Page } from '@digital-canvas/scene';
import type { EditorState } from '../editor.svelte.ts';
import { cleanError } from './render-bridge.ts';

/** Draw `draw` at `W×H` (page units scaled from doc size) into a 2D canvas. */
function toCanvas(ck: CanvasKit, c: HTMLCanvasElement, W: number, H: number, draw: (canvas: Canvas) => void): void {
  const surface = ck.MakeSurface(W, H);
  if (!surface) return;
  try {
    draw(surface.getCanvas());
    surface.flush();
    const img = surface.makeImageSnapshot();
    const px = img.readPixels(0, 0, { width: W, height: H, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array;
    img.delete();
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    c.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer, px.byteOffset, px.length), W, H), 0, 0);
  } finally {
    surface.delete();
  }
}

/** A page of `doc` at `t` seconds (animations playing) on a canvas. */
export function paintPage(ed: EditorState, c: HTMLCanvasElement, doc: Doc, page: Page, t: number, bg = true): void {
  const ck = ed.engine.ck;
  toCanvas(ck, c, c.width, c.height, (canvas) => {
    canvas.clear(bg ? ck.WHITE : ck.TRANSPARENT);
    canvas.save();
    canvas.scale(c.width / doc.width, c.height / doc.height);
    ed.renderer.drawPage(canvas, doc, animateAt(doc, page, t));
    canvas.restore();
  });
}

/** Snapshot of a page as an SkImage (caller deletes it). */
function pageImage(ed: EditorState, doc: Doc, page: Page, W: number, H: number): SkImage | null {
  const ck = ed.engine.ck;
  const surface = ck.MakeSurface(W, H);
  if (!surface) return null;
  try {
    const canvas = surface.getCanvas();
    canvas.clear(ck.TRANSPARENT);
    canvas.scale(W / doc.width, H / doc.height);
    ed.renderer.drawPage(canvas, doc, page);
    surface.flush();
    return surface.makeImageSnapshot();
  } finally {
    surface.delete();
  }
}

/**
 * The page through the shader. Returns null, or the compile error (the plain
 * page is drawn then).
 */
export function paintShaded(ed: EditorState, c: HTMLCanvasElement, doc: Doc, page: Page, sksl: string | null, params: Record<string, number>, time: number): string | null {
  const ck = ed.engine.ck;
  const W = c.width, H = c.height;
  const img = pageImage(ed, doc, page, W, H);
  if (!img) return null;
  let error: string | null = null;
  try {
    toCanvas(ck, c, W, H, (canvas) => {
      canvas.clear(ck.TRANSPARENT);
      if (!sksl) { canvas.drawImage(img, 0, 0); return; }
      let msg = '';
      const fx = ck.RuntimeEffect.Make(sksl, (e: string) => { msg = e; });
      if (!fx) { error = cleanError(msg) || 'The shader does not compile.'; canvas.drawImage(img, 0, 0); return; }
      const child = img.makeShaderOptions(ck.TileMode.Clamp, ck.TileMode.Clamp, ck.FilterMode.Linear, ck.MipmapMode.None);
      const uniforms: number[] = [];
      for (let i = 0; i < fx.getUniformCount(); i++) {
        const u = fx.getUniform(i), name = fx.getUniformName(i), n = u.columns * u.rows;
        const v = name === 'resolution' ? [W, H] : name === 'time' ? [time] : name in params ? [params[name]!] : [];
        for (let k = 0; k < n; k++) uniforms.push(v[k] ?? 0);
      }
      const shader = fx.makeShaderWithChildren(uniforms, [child]);
      const paint = new ck.Paint();
      paint.setShader(shader);
      canvas.drawRect(ck.XYWHRect(0, 0, W, H), paint);
      paint.delete(); shader.delete(); child.delete(); fx.delete();
    });
  } finally {
    img.delete();
  }
  return error;
}
