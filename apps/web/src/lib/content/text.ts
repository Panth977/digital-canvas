/**
 * Text panel actions: font combinations as grouped text, picking a font from
 * the library (applies to the selected text, or adds a text box in it), and
 * light preview faces so each font name and combo shows in its own face.
 */
import { addElements, groupElements, text, type TextElement } from '@digital-canvas/scene';
import type { EditorState } from '../editor.svelte.ts';
import { catalog, fetchFamily, type CatalogFont, type FontFile } from '../fonts.ts';
import { fontId, type Combo } from './combos.ts';
import { recent, remember } from './recent.ts';

const CDN = 'https://cdn.jsdelivr.net/fontsource/fonts';
const loaded = new Set<string>();

/**
 * A preview face (latin subset, woff2) registered under `dcp-<id>` with its
 * weight and style, so the panel can show names and combos in their face.
 * Returns the CSS family name.
 */
export function previewFace(family: string, weight = 400, italic = false, weights?: number[]): string {
  const id = fontId(family);
  const name = `dcp-${id}`;
  const w = weights?.length ? [...weights].sort((a, b) => Math.abs(a - weight) - Math.abs(b - weight))[0]! : weight;
  const key = `${id}-${w}-${italic}`;
  if (!loaded.has(key) && typeof FontFace !== 'undefined') {
    loaded.add(key);
    const face = new FontFace(name, `url(${CDN}/${id}@latest/latin-${w}-${italic ? 'italic' : 'normal'}.woff2)`, { weight: String(w), style: italic ? 'italic' : 'normal' });
    face.load().then((f) => document.fonts.add(f)).catch(() => {
      // no italic (or no such weight): fall back to the upright regular face
      if (italic || w !== 400) previewFace(family, 400, false);
    });
  }
  return name;
}

/** Make sure the design has these families (downloads and embeds the ones it lacks). */
async function ensureFamilies(ed: EditorState, families: string[], sample: string, key: string): Promise<void> {
  const missing = families.filter((f) => !ed.engine.fonts.families.has(f));
  if (!missing.length) return;
  const cat = await catalog();
  const files: FontFile[] = [];
  await Promise.all(missing.map(async (fam) => {
    const f = cat.find((x) => x.family === fam);
    if (f) files.push(...(await fetchFamily(f, sample)));
  }));
  if (files.length) await ed.addFonts(files, key);
}

/** Add a font combination to the page as one group (fonts are embedded first). */
export async function insertCombo(ed: EditorState, combo: Combo, at?: { x: number; y: number }): Promise<void> {
  const key = `combo:${Date.now()}`;
  ed.fontLoading = combo.lines[0]!.family;
  try {
    await ensureFamilies(ed, [...new Set(combo.lines.map((l) => l.family))], combo.lines.map((l) => l.text).join(' '), key);
  } finally {
    ed.fontLoading = null;
  }
  const scale = Math.max(0.4, Math.min(3, Math.min(ed.doc.width, ed.doc.height) / 1080));
  const els: TextElement[] = combo.lines.map((l) => {
    let el = text(l.text, { x: 0, y: 0, w: 100, h: 10 }, {
      fontFamily: l.family, fontSize: Math.round(l.size * scale), bold: !!l.bold, italic: !!l.italic, color: l.color ?? '#1f2328',
      align: 'center', letterSpacing: Math.round((l.spacing ?? 0) * scale * 10) / 10, uppercase: !!l.upper, lineHeight: 1.2,
    });
    el = { ...el, w: Math.min(ed.renderer.textWidth(el) + 4, ed.doc.width * 0.85) };
    return { ...el, h: ed.renderer.textHeight(el) };
  });
  const gap = 8 * scale;
  const total = els.reduce((s, e) => s + e.h, 0) + gap * (els.length - 1);
  const cx = at?.x ?? ed.doc.width / 2;
  let y = (at?.y ?? ed.doc.height / 2) - total / 2;
  const placed = els.map((e) => { const p = { ...e, x: cx - e.w / 2, y }; y += e.h + gap; return p; });
  const doc = addElements(ed.doc, ed.pageId, placed);
  const g = groupElements(doc, placed.map((e) => e.id));
  ed.commit(g ? { ...g.doc } : doc, key);
  ed.seal();
  ed.select(g ? [g.id] : placed.map((e) => e.id), ed.pageId);
  remember('combo', combo.id, combo.id);
}

/** Pick a library font: the selected text takes it, or a new text box is added in it. */
export async function pickFont(ed: EditorState, f: CatalogFont): Promise<void> {
  if (!ed.selected.some((e) => e.type === 'text')) ed.addText('body');
  await ed.useFont(f);
  remember('font', f.family, f.family);
}

/** Use an embedded or uploaded family the same way. */
export function pickFamily(ed: EditorState, family: string): void {
  if (!ed.selected.some((e) => e.type === 'text')) ed.addText('body');
  ed.updateTextStyle({ fontFamily: family });
  ed.seal();
  ed.refitText();
  remember('font', family, family);
}

export const recentFonts = (): string[] => recent(['font']).map((r) => r.data as string);
