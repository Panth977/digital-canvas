import type { Doc, Element, Fill, ImageElement, Page, PathElement, ShapeElement, TextElement, VideoElement } from '@digital-canvas/scene';
import { dashArray, hasLook, type Decomposed } from '@digital-canvas/scene';
import type { Renderer } from './renderer.ts';
import { shapePath } from './renderer.ts';
import type { FontFace } from './fonts.ts';
import { base64, cmdsToSvg, fontMime, pathCmds, pickFaces, rgba } from './vectorpath.ts';

export interface VectorExportOptions {
  /** Asset bytes by id (images, video posters). */
  assets: ReadonlyMap<string, Uint8Array>;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => String(Math.round(v * 100) / 100);

/** True when vector export can't show a text box faithfully (it is drawn as an image instead). */
export const textNeedsRaster = (el: TextElement): boolean => !!el.effect || !!el.curve;

/** True when an image or video has adjustments, a filter or an effect (vector export draws it as an image). */
export const pictureNeedsRaster = (el: ImageElement | VideoElement): boolean => hasLook(el);

/** Decode an image's (or a video poster's) bytes into the renderer so it can be drawn; its pixel size, or null. */
export function loadPicture(renderer: Renderer, el: ImageElement | VideoElement, assets: ReadonlyMap<string, Uint8Array>): { width: number; height: number } | null {
  const assetId = el.type === 'video' ? `${el.asset}.poster` : el.asset;
  const bytes = assetId ? assets.get(assetId) : undefined;
  return bytes ? renderer.setImage(assetId, bytes) : null;
}

/**
 * One page as a standalone SVG: shapes, paths, lines, tables and charts as
 * vectors, text as `<text>` (with the fonts it uses embedded as @font-face),
 * images as data URIs. Text effects, curved text and images with
 * adjustments, filters or effects become images.
 */
export function exportSvg(renderer: Renderer, doc: Doc, page: Page, opts: VectorExportOptions): string {
  const ck = renderer.ck;
  const defs: string[] = [];
  let ids = 0;
  const id = (p: string) => `${p}${++ids}`;
  const usedFaces = new Set<FontFace>();

  /** fill="…" (+ fill-opacity) for a fill, adding a gradient to defs when needed. Gradient geometry is in user space. */
  const fillAttr = (fill: Fill | null, x: number, y: number, w: number, h: number, kind: 'fill' | 'stroke' = 'fill'): string => {
    if (!fill) return `${kind}="none"`;
    if (fill.type === 'solid') {
      const c = rgba(fill.color);
      return `${kind}="${fill.color.slice(0, 7)}"${c.a < 1 ? ` ${kind}-opacity="${n(c.a)}"` : ''}`;
    }
    const rad = ((fill.angle - 90) * Math.PI) / 180;
    const cx = x + w / 2, cy = y + h / 2;
    const half = (Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad))) / 2;
    const dx = Math.cos(rad) * half, dy = Math.sin(rad) * half;
    const gid = id('g');
    const stops = fill.stops.map((s) => {
      const c = rgba(s.color);
      return `<stop offset="${n(s.offset)}" stop-color="${s.color.slice(0, 7)}"${c.a < 1 ? ` stop-opacity="${n(c.a)}"` : ''}/>`;
    }).join('');
    defs.push(`<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${n(cx - dx)}" y1="${n(cy - dy)}" x2="${n(cx + dx)}" y2="${n(cy + dy)}">${stops}</linearGradient>`);
    return `${kind}="url(#${gid})"`;
  };

  const strokeAttrs = (s: { color: string; width: number; dash?: 'solid' | 'dashed' | 'dotted' }, cap: 'butt' | 'round' | 'square', width = s.width, dash = dashArray(s, cap)) => {
    const c = rgba(s.color);
    return `stroke="${s.color.slice(0, 7)}"${c.a < 1 ? ` stroke-opacity="${n(c.a)}"` : ''} stroke-width="${n(width)}" stroke-linecap="${cap}" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash.map(n).join(' ')}"` : ''}`;
  };

  const image = (bytes: Uint8Array, mime: string) => `data:${mime};base64,${base64(bytes)}`;

  const rasterImage = (el: Element) => {
    const r = renderer.rasterElement(el);
    return r ? `<image x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" preserveAspectRatio="none" href="${image(r.png, 'image/png')}"/>` : '';
  };

  const text = (el: TextElement): string => {
    const pieces = renderer.textPieces(el);
    if (!pieces.length) return '';
    let fill: string | null = null;
    if (el.gradient) fill = fillAttr(el.gradient, 0, 0, el.w, el.h);
    const out = pieces.map((p) => {
      const st = p.style;
      for (const f of pickFaces(renderer.fonts.faces, st.fontFamily, st.bold, st.italic)) usedFaces.add(f);
      const deco = [st.underline ? 'underline' : '', st.strike ? 'line-through' : ''].filter(Boolean).join(' ');
      const c = rgba(st.color);
      return `<text x="${n(p.x)}" y="${n(p.y)}" font-family="${esc(`'${st.fontFamily}', Inter, sans-serif`)}" font-size="${n(st.fontSize)}"`
        + `${st.bold ? ' font-weight="700"' : ''}${st.italic ? ' font-style="italic"' : ''}${st.letterSpacing ? ` letter-spacing="${n(st.letterSpacing)}"` : ''}`
        + `${deco ? ` text-decoration="${deco}"` : ''} ${fill ?? `fill="${st.color.slice(0, 7)}"${c.a < 1 ? ` fill-opacity="${n(c.a)}"` : ''}`}`
        + `${p.width > 0 && p.text.length > 1 ? ` textLength="${n(p.width)}" lengthAdjust="spacing"` : ''}>${esc(p.text)}</text>`;
    }).join('');
    return `<g transform="translate(${n(el.x)} ${n(el.y)})">${out}</g>`;
  };

  const shape = (el: ShapeElement): string => {
    const path = shapePath(ck, el.shape, el.x, el.y, el.w, el.h, el.radius);
    const d = cmdsToSvg(pathCmds(ck, path));
    path.delete();
    const stroke = el.stroke && el.stroke.width > 0 ? ` ${strokeAttrs(el.stroke, 'butt', el.stroke.width, el.stroke.dash === 'dashed' ? [el.stroke.width * 3, el.stroke.width * 2] : el.stroke.dash === 'dotted' ? [el.stroke.width, el.stroke.width] : null)}` : '';
    return `<path d="${d}" ${fillAttr(el.fill, el.x, el.y, el.w, el.h)}${stroke}/>`;
  };

  const vectorPath = (el: PathElement): string => {
    const vb = el.viewBox;
    if (vb.w <= 0 || vb.h <= 0) return '';
    const sx = el.w / vb.w, sy = el.h / vb.h;
    const parts = el.paths.map((p) => {
      const stroke = p.stroke && p.stroke.width > 0 ? ` ${strokeAttrs(p.stroke, 'round', p.stroke.width / Math.sqrt(Math.abs(sx * sy)), null)}` : '';
      return `<path d="${esc(p.d)}" ${fillAttr(p.fill, vb.x, vb.y, vb.w, vb.h)}${p.evenOdd ? ' fill-rule="evenodd"' : ''}${stroke}/>`;
    }).join('');
    // full precision for the scale: viewBoxes can be tiny (a 24-unit icon) or huge
    return `<g transform="translate(${n(el.x)} ${n(el.y)}) scale(${sx} ${sy}) translate(${n(-vb.x)} ${n(-vb.y)})">${parts}</g>`;
  };

  const pieces = (d: Decomposed): string =>
    d.paths.map((p) => {
      const stroke = p.stroke && p.stroke.width > 0 ? ` ${strokeAttrs(p.stroke, p.cap ?? 'butt')}` : '';
      const b = p.fill?.type === 'linear' ? (() => { const path = ck.Path.MakeFromSVGString(p.d); const r = path?.computeTightBounds(); path?.delete(); return r; })() : null;
      return `<path d="${esc(p.d)}" ${fillAttr(p.fill, b?.[0] ?? 0, b?.[1] ?? 0, (b?.[2] ?? 0) - (b?.[0] ?? 0), (b?.[3] ?? 0) - (b?.[1] ?? 0))}${stroke}/>`;
    }).join('') + d.texts.map((t) => text(t.el)).join('');

  const picture = (el: ImageElement | VideoElement): string => {
    const assetId = el.type === 'video' ? `${el.asset}.poster` : el.asset;
    const bytes = assetId ? opts.assets.get(assetId) : undefined;
    const size = bytes ? renderer.setImage(assetId, bytes) : null;
    // clip: the frame's shape, rounded corners or the box
    const mask = el.type === 'image' ? renderer.maskPath(el) : null;
    let clipD: string;
    if (mask) {
      clipD = cmdsToSvg(pathCmds(ck, mask));
      mask.delete();
    } else {
      const p = shapePath(ck, 'rect', el.x, el.y, el.w, el.h, el.radius);
      clipD = cmdsToSvg(pathCmds(ck, p));
      p.delete();
    }
    if (!bytes || !size) return `<path d="${clipD}" fill="${el.type === 'video' ? '#1f2128' : '#d4d8e0'}"/>`;
    const cid = id('c');
    defs.push(`<clipPath id="${cid}"><path d="${clipD}"/></clipPath>`);
    const iw = size.width, ih = size.height;
    let crop = el.crop;
    if (!crop) {
      const s = Math.max(el.w / iw, el.h / ih);
      const cw = el.w / s / iw, ch = el.h / s / ih;
      crop = { x: (1 - cw) / 2, y: (1 - ch) / 2, w: cw, h: ch };
    }
    // place the whole image so that the crop window lands on the box
    const W = el.w / crop.w, H = el.h / crop.h;
    const mime = (el.type === 'video' ? 'image/png' : doc.assets[assetId]?.mime) ?? 'image/png';
    return `<g clip-path="url(#${cid})"><image x="${n(el.x - crop.x * W)}" y="${n(el.y - crop.y * H)}" width="${n(W)}" height="${n(H)}" preserveAspectRatio="none" href="${image(bytes, mime)}"/></g>`;
  };

  const body: string[] = [];
  body.push(`<rect width="${n(doc.width)}" height="${n(doc.height)}" ${fillAttr(page.background, 0, 0, doc.width, doc.height)}/>`);
  for (const el of flattenGroups(page.elements)) {
    if (el.hidden) continue;
    let inner: string;
    if (el.type === 'text') inner = textNeedsRaster(el) ? rasterImage(el) : text(el);
    else if (el.type === 'shape') inner = shape(el);
    else if (el.type === 'path') inner = vectorPath(el);
    else if (el.type === 'line' || el.type === 'table' || el.type === 'chart') inner = pieces(renderer.vectorize(el));
    else if (pictureNeedsRaster(el)) inner = loadPicture(renderer, el, opts.assets) ? rasterImage(el) : picture(el);
    else inner = picture(el);
    if (!inner) continue;
    const raster = (el.type === 'text' && textNeedsRaster(el)) || ((el.type === 'image' || el.type === 'video') && pictureNeedsRaster(el) && inner.startsWith('<image '));
    const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
    const tf: string[] = [];
    if (!raster) {
      if (el.rotation) tf.push(`rotate(${n(el.rotation)} ${n(cx)} ${n(cy)})`);
      if (el.flipX || el.flipY) tf.push(`translate(${n(cx)} ${n(cy)}) scale(${el.flipX ? -1 : 1} ${el.flipY ? -1 : 1}) translate(${n(-cx)} ${n(-cy)})`);
    }
    const attrs = `${tf.length ? ` transform="${tf.join(' ')}"` : ''}${el.opacity < 1 && !raster ? ` opacity="${n(Math.max(0, el.opacity))}"` : ''}`;
    body.push(`<g data-id="${esc(el.id)}"${attrs}>${inner}</g>`);
  }

  const fonts = [...usedFaces].map((f) => `@font-face{font-family:'${f.family.replace(/'/g, '')}';src:url(data:${fontMime(f.bytes)};base64,${base64(f.bytes)});font-weight:${f.weight};font-style:${f.italic ? 'italic' : 'normal'}}`);
  const style = fonts.length ? `<style>${fonts.join('')}</style>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${n(doc.width)}" height="${n(doc.height)}" viewBox="0 0 ${n(doc.width)} ${n(doc.height)}">`
    + `<title>${esc(doc.title)}</title>`
    + (style || defs.length ? `<defs>${style}${defs.join('')}</defs>` : '')
    + `${body.join('')}</svg>\n`;
}

/** Groups keep their children in page coordinates: export the children (the group's opacity carried down). */
function flattenGroups(els: readonly Element[]): Exclude<Element, { type: 'group' }>[] {
  return els.flatMap((e) => (e.type === 'group'
    ? flattenGroups(e.children.map((c) => ({ ...c, opacity: c.opacity * e.opacity, hidden: c.hidden || e.hidden })))
    : [e as Exclude<Element, { type: 'group' }>]));
}
