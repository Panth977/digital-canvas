/**
 * check_design: the critique a careful designer would give, as data the agent
 * can act on. Text is measured with the real renderer and contrast is read
 * from the rendered page behind each text (WCAG 2.x ratios), so the findings
 * match what the export will look like.
 */
import { aabb, isVideo, pageDuration, totalDuration, walk, type Doc, type Element, type Page, type TextElement } from '@digital-canvas/scene';
import type { ProjectFile } from '@digital-canvas/storage';
import { withRenderer } from './engine.ts';

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  severity: Severity;
  code: string;
  page: number;
  element?: string;
  message: string;
  /** What to change (tool + fields). */
  fix: string;
}

type RGB = [number, number, number];

function hexRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) || 0;
  return [n(0), n(2), n(4)];
}
const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export const luminance = ([r, g, b]: RGB) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export function contrast(a: RGB, b: RGB): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const hex = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const r1 = (v: number) => Math.round(v * 10) / 10;

const PLACEHOLDER = /lorem ipsum|dolor sit amet|your (text|title|heading|name|company|logo)|add (a )?(heading|subheading|title|text)|sample text|placeholder|shopname\.com|yourwebsite|example\.com|@username|xxx+|\[[^\]]*\]|tbd/i;

function textColor(t: TextElement): RGB {
  if (t.gradient) {
    const cs = t.gradient.stops.map((s) => hexRgb(s.color));
    return [0, 1, 2].map((i) => cs.reduce((a, c) => a + c[i]!, 0) / cs.length) as RGB;
  }
  return hexRgb(t.style.color);
}

function minFont(t: TextElement): number {
  return Math.min(t.style.fontSize, ...(t.runs ?? []).map((r) => r.style?.fontSize ?? t.style.fontSize));
}

const area = (r: { w: number; h: number }) => Math.max(0, r.w) * Math.max(0, r.h);
function inter(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, w: Math.min(a.x + a.w, b.x + b.w) - x, h: Math.min(a.y + a.h, b.y + b.h) - y };
}
const windowsOverlap = (a: Element, b: Element) => {
  const s1 = a.timing?.start ?? 0, e1 = a.timing?.end ?? Infinity, s2 = b.timing?.start ?? 0, e2 = b.timing?.end ?? Infinity;
  return s1 < e2 && s2 < e1;
};

function opaqueCover(e: Element): boolean {
  if (e.hidden || e.opacity < 1 || e.rotation % 90 !== 0) return false;
  if (e.type === 'shape') return e.shape === 'rect' && e.fill?.type === 'solid' && e.fill.color.length <= 7 && e.radius === 0;
  if (e.type === 'image') return !!e.asset && !e.mask && !e.radius;
  return e.type === 'video' && !e.radius;
}

export interface CheckResult {
  issues: Issue[];
  summary: string;
}

export async function checkDesign(file: ProjectFile, opts: { pages?: number[] } = {}): Promise<CheckResult> {
  const doc: Doc = file.doc;
  const issues: Issue[] = [];
  const W = doc.width, H = doc.height, short = Math.min(W, H);
  const print = doc.unit !== 'px' || doc.bleed > 0;
  const minSize = print ? 10.7 : Math.max(12, short * 0.022);
  const video = isVideo(doc);
  const reel = video && H / W > 1.7;
  const pages = doc.pages.map((p, i) => ({ p, n: i + 1 })).filter(({ n }) => !opts.pages || opts.pages.includes(n));
  const pageRect = { x: 0, y: 0, w: W, h: H };

  await withRenderer(file, (r, eng) => {
    const ck = eng.ck;
    const sample = Math.min(1, 512 / Math.max(W, H));
    const SW = Math.max(1, Math.round(W * sample)), SH = Math.max(1, Math.round(H * sample));
    const surface = ck.MakeSurface(SW, SH)!;
    try {
      for (const { p, n } of pages) {
        const add = (severity: Severity, code: string, message: string, fix: string, element?: string) => issues.push({ severity, code, page: n, ...(element ? { element } : {}), message, fix });
        const all = [...walk(p.elements)];
        const texts = all.filter((e): e is TextElement => e.type === 'text' && !e.hidden);
        // the page without its text, to read what each text sits on
        const canvas = surface.getCanvas();
        canvas.clear(ck.WHITE);
        canvas.save();
        canvas.scale(sample, sample);
        r.drawPage(canvas, doc, p, { skip: new Set(texts.map((t) => t.id)) });
        canvas.restore();
        surface.flush();
        const img = surface.makeImageSnapshot();
        const px = img.readPixels(0, 0, { width: SW, height: SH, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array;
        img.delete();

        const measured = new Map<string, { x: number; y: number; w: number; h: number }>();
        for (const t of texts) {
          const need = t.curve ? r.fitText(t).h : r.textHeight(t);
          const box = { x: t.x, y: t.anchor === 'bottom' ? t.y + t.h - need : t.anchor === 'middle' ? t.y + (t.h - need) / 2 : t.y, w: t.w, h: Math.max(need, 1) };
          measured.set(t.id, box);
          if (!t.text.trim()) { add('info', 'empty_text', 'Empty text box.', 'delete_elements, or give it text with update_elements', t.id); continue; }
          if (need > t.h + Math.max(3, t.h * 0.08)) add('warning', 'text_overflow', `Text needs ${Math.ceil(need)}px of height but its box is ${Math.round(t.h)}px, so it spills below the box (into whatever is under it).`, `update_elements { id, h: ${Math.ceil(need)} } (and move things below it), or a smaller fontSize, or autoFit "shrink"`, t.id);
          if (!t.curve) {
            // a word wider than the box breaks mid-word ("MARKE / T")
            const words = [...new Set(t.text.split(/\s+/).filter((w) => w.length > 1))].sort((a, b) => b.length - a.length).slice(0, 6);
            const indent = t.list ? 40 : 0;
            for (const w of words) {
              const one = r.textWidth({ ...t, text: w, runs: undefined, list: undefined }) + indent;
              if (one > t.w + 1) {
                add('warning', 'word_broken', `The word "${w.slice(0, 30)}" is wider (${Math.ceil(one)}px) than its box (${Math.round(t.w)}px), so it breaks across lines.`, `update_elements { id, w: ${Math.ceil(one + 12)} } (if it fits the page) or a smaller fontSize`, t.id);
                break;
              }
            }
          }
          if (PLACEHOLDER.test(t.text)) add('warning', 'placeholder_text', `Looks like placeholder text: "${t.text.slice(0, 60)}".`, 'replace it with real content (update_elements { id, text }) or delete it', t.id);
          const fs = minFont(t);
          if (fs < minSize) add('warning', 'tiny_text', `Font size ${r1(fs)}px is small for a ${Math.round(W)}×${Math.round(H)} ${print ? 'print design (under 8 pt)' : 'design (hard to read on a phone)'}.`, `fontSize ≥ ${Math.ceil(minSize)}`, t.id);
          // contrast with what is behind
          const b = aabb({ ...box, rotation: t.rotation });
          const c = inter(b, pageRect);
          if (area(c) > 0) {
            let fx = t.effect;
            if (fx?.type === 'background' && fx.transparency < 50) {
              const ratio = contrast(textColor(t), hexRgb(fx.color));
              if (ratio < 4.5) add('warning', 'low_contrast', `Text colour on its highlight box has contrast ${r1(ratio)}:1 (WCAG wants 4.5:1).`, 'change color or effect.color', t.id);
              fx = undefined;
            } else if (fx?.type === 'outline' || fx?.type === 'hollow' || fx?.type === 'neon') continue;
            const x0 = Math.floor(c.x * sample), y0 = Math.floor(c.y * sample), x1 = Math.ceil((c.x + c.w) * sample), y1 = Math.ceil((c.y + c.h) * sample);
            const lums: number[] = [];
            let sr = 0, sg = 0, sb = 0, cnt = 0;
            const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 400)));
            for (let y = y0; y < Math.min(SH, y1); y += step) for (let x = x0; x < Math.min(SW, x1); x += step) {
              const o = (y * SW + x) * 4;
              const rgb: RGB = [px[o]!, px[o + 1]!, px[o + 2]!];
              sr += rgb[0]; sg += rgb[1]; sb += rgb[2]; cnt++;
              lums.push(luminance(rgb));
            }
            if (!cnt) continue;
            const mean: RGB = [sr / cnt, sg / cnt, sb / cnt];
            const tc = textColor(t);
            const ratio = contrast(tc, mean);
            const large = minFont(t) >= 24 || (t.style.bold && minFont(t) >= 18.7);
            const need = large ? 3 : 4.5;
            const shadowHelp = fx?.type === 'shadow' || fx?.type === 'lift';
            if (ratio < need && !(shadowHelp && ratio >= need * 0.7)) {
              const better = contrast([255, 255, 255], mean) > contrast([0, 0, 0], mean) ? '#ffffff' : '#111111';
              add(ratio < 2 ? 'error' : 'warning', 'low_contrast', `Text ${hex(tc)} on background ≈${hex(mean)} has contrast ${r1(ratio)}:1 (needs ${need}:1 for ${large ? 'large' : 'body'} text).`, `color "${better}", or put a solid/darkened shape behind it, or effect { type: "background" } / { type: "shadow" }`, t.id);
            } else {
              // a busy picture: part of the text sits on a tone close to its own
              lums.sort((a, b2) => a - b2);
              const lt = luminance(tc);
              const worst = lt > 0.5 ? lums[Math.floor(lums.length * 0.9)]! : lums[Math.floor(lums.length * 0.1)]!;
              const wr = (Math.max(lt, worst) + 0.05) / (Math.min(lt, worst) + 0.05);
              if (wr < 1.6 && lums.length > 20 && !shadowHelp) add('info', 'busy_background', `Part of this text sits on a ${lt > 0.5 ? 'light' : 'dark'} area of the picture behind it (contrast ${r1(wr)}:1 there).`, 'add a dark/light overlay shape under the text, a text shadow, or effect { type: "background" }', t.id);
            }
          }
          const m = Math.round(short * 0.03);
          const inside = b.x >= -1 && b.y >= -1 && b.x + b.w <= W + 1 && b.y + b.h <= H + 1;
          if (inside && (b.x < m || b.y < m || b.x + b.w > W - m || b.y + b.h > H - m)) add('info', 'tight_margin', `Text is within ${m}px of the page edge.`, `keep text ≥ ${Math.round(short * 0.05)}px from the edges`, t.id);
          if (reel) {
            const top = H * 0.11, bottom = H * 0.8;
            if (b.y < top || b.y + b.h > bottom) add('info', 'reel_safe_zone', 'On Reels/Shorts/TikTok the top ~11% and bottom ~20% are covered by the app\'s buttons and caption.', `keep important text between y=${Math.round(top)} and y=${Math.round(bottom)}`, t.id);
          }
        }
        // overlapping text
        for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
          const a = texts[i]!, b = texts[j]!;
          if (!windowsOverlap(a, b)) continue;
          const A = measured.get(a.id)!, B = measured.get(b.id)!;
          const o = area(inter(A, B));
          if (o > 0.12 * Math.min(area(A), area(B))) add('warning', 'text_overlap', `Text boxes ${a.id} and ${b.id} overlap.`, 'move one (update_elements y) or use align_elements / distribute', a.id);
        }
        // off the page, empty, missing, hidden behind
        p.elements.forEach((e, i) => {
          if (e.hidden) return;
          const b = aabb(e);
          const vis = area(inter(b, pageRect)) / Math.max(1, area(b));
          if (vis <= 0) add('warning', 'outside_page', `${e.type} is completely outside the page.`, 'move it onto the page or delete it', e.id);
          else if (vis < 0.98 && (e.type === 'text' || e.type === 'table' || e.type === 'chart' || (e.type === 'path' && e.qr !== undefined))) add('warning', 'off_page', `${Math.round((1 - vis) * 100)}% of this ${e.type} is cut off by the page edge.`, 'move or resize it inside the page', e.id);
          else if (vis < 0.6 && (e.type === 'image' || e.type === 'video')) add('info', 'off_page', `${Math.round((1 - vis) * 100)}% of this ${e.type} is off the page.`, 'intended? else move/resize it', e.id);
          if (e.opacity <= 0.02) add('info', 'invisible', `${e.type} has opacity ${e.opacity}.`, 'raise opacity or delete it', e.id);
          for (const k of p.elements.slice(i + 1)) {
            if (!opaqueCover(k) || !windowsOverlap(e, k)) continue;
            const kb = aabb(k);
            if (b.x >= kb.x - 0.5 && b.y >= kb.y - 0.5 && b.x + b.w <= kb.x + kb.w + 0.5 && b.y + b.h <= kb.y + kb.h + 0.5) {
              add('warning', 'hidden_behind', `${e.type} is completely covered by ${k.type} ${k.id} above it.`, `arrange_elements { ids: ["${e.id}"], how: "front" } or move it`, e.id);
              break;
            }
          }
        });
        for (const e of all) {
          if ((e.type === 'image' || e.type === 'video') && !e.asset) add('warning', 'empty_frame', 'Empty photo frame (placeholder).', 'update_elements { id, asset } with a picture, or delete it', e.id);
          else if ((e.type === 'image' || e.type === 'video') && !file.assets.has(e.asset)) add('error', 'missing_asset', `The ${e.type} file ${e.asset} is missing.`, 'replace it (update_elements { id, asset | url })', e.id);
          if (e.type === 'video') {
            const m = doc.assets[e.asset];
            const len = (Math.min(e.trimEnd ?? m?.duration ?? Infinity, m?.duration ?? Infinity) - (e.trimStart ?? 0));
            if (m?.duration !== undefined && (e.trimStart ?? 0) >= m.duration) add('error', 'bad_trim', `trimStart ${e.trimStart}s is past the end of the clip (${r1(m.duration)}s).`, 'lower trimStart', e.id);
            else if (Number.isFinite(len) && len + 0.05 < pageDuration(p) && !e.loop) add('info', 'clip_ends_early', `The clip lasts ${r1(len)}s but the page lasts ${r1(pageDuration(p))}s; its last frame (poster) shows after it ends.`, `set_page { duration: ${r1(len)} } or update_elements { id, loop: true }`, e.id);
          }
        }
        if (video && pageDuration(p) < 0.5) add('warning', 'short_page', `Page lasts only ${pageDuration(p)}s.`, 'set_page duration ≥ 1', undefined);
        if (!p.elements.length) add('info', 'empty_page', 'The page is empty.', 'add elements or delete_page');
      }
    } finally {
      surface.delete();
    }
  }, pages.map((x) => x.p));
  if (video) {
    const total = totalDuration(doc);
    for (const a of doc.audio ?? []) {
      if (a.start >= total) issues.push({ severity: 'warning', code: 'audio_after_end', page: 0, element: a.id, message: `Sound "${a.name ?? a.asset}" starts at ${a.start}s, after the video ends (${r1(total)}s).`, fix: 'set_audio start earlier' });
      else if (a.start + a.duration > total + 0.05 && !a.fadeOut) issues.push({ severity: 'info', code: 'audio_cut', page: 0, element: a.id, message: `Sound "${a.name ?? a.asset}" is cut off at the end of the video without a fade.`, fix: 'set_audio fadeOut: 1.5 (or a shorter duration)' });
    }
  }
  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity] || a.page - b.page);
  const count = (s: Severity) => issues.filter((x) => x.severity === s).length;
  const summary = issues.length ? `${count('error')} error(s), ${count('warning')} warning(s), ${count('info')} note(s).` : 'No problems found: text fits, is readable and stays on the page.';
  return { issues, summary };
}

export type { Page };
