import type { TextEffect, TextEffectType, TextElement, TextRun, TextStyle } from './types.ts';

/**
 * Rich text helpers. Offsets are UTF-16 indices into `TextElement.text`
 * (what DOM selections and Skia's paragraph API use).
 */

/** The runs of a text box; a box without runs is one run with no overrides. */
export function runsOf(el: Pick<TextElement, 'text' | 'runs'>): TextRun[] {
  return el.runs?.length ? el.runs : [{ text: el.text }];
}

function sameStyle(a: Partial<TextStyle> | undefined, b: Partial<TextStyle> | undefined): boolean {
  const ka = Object.keys(a ?? {}), kb = Object.keys(b ?? {});
  if (ka.length !== kb.length) return false;
  return ka.every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)?.[k]);
}

/**
 * Tidy runs: drop overrides equal to the base style, drop empty runs, merge
 * neighbours that look the same. Returns undefined when one style covers it all.
 */
export function normalizeRuns(runs: TextRun[], base: TextStyle): TextRun[] | undefined {
  const out: TextRun[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const style = Object.fromEntries(Object.entries(r.style ?? {}).filter(([k, v]) => v !== undefined && (base as unknown as Record<string, unknown>)[k] !== v)) as Partial<TextStyle>;
    const run: TextRun = Object.keys(style).length ? { text: r.text, style } : { text: r.text };
    const last = out[out.length - 1];
    if (last && sameStyle(last.style, run.style)) out[out.length - 1] = { ...last, text: last.text + run.text };
    else out.push(run);
  }
  if (out.length === 0 || (out.length === 1 && !out[0]!.style)) return undefined;
  return out;
}

/** Split runs so that `at` falls on a run boundary. */
function splitAt(runs: TextRun[], at: number): TextRun[] {
  const out: TextRun[] = [];
  let pos = 0;
  for (const r of runs) {
    const end = pos + r.text.length;
    if (at > pos && at < end) {
      out.push({ ...r, text: r.text.slice(0, at - pos) }, { ...r, text: r.text.slice(at - pos) });
    } else out.push(r);
    pos = end;
  }
  return out;
}

/**
 * Apply `patch` to characters [start, end). A range covering the whole text
 * changes the box's own style instead (and clears that setting on the runs).
 */
export function styleRange(el: TextElement, start: number, end: number, patch: Partial<TextStyle>): Pick<TextElement, 'style' | 'runs'> {
  start = Math.max(0, Math.min(start, el.text.length));
  end = Math.max(start, Math.min(end, el.text.length));
  if (start === 0 && end === el.text.length) {
    const style = { ...el.style, ...patch };
    const runs = el.runs?.map((r) => ({ ...r, style: r.style && (Object.fromEntries(Object.entries(r.style).filter(([k]) => !(k in patch))) as Partial<TextStyle>) }));
    return { style, runs: runs && normalizeRuns(runs, style) };
  }
  if (start === end) return { style: el.style, runs: el.runs };
  const runs = splitAt(splitAt(runsOf(el), start), end);
  let pos = 0;
  const next = runs.map((r) => {
    const s = pos;
    pos += r.text.length;
    return s >= start && s < end ? { ...r, style: { ...r.style, ...patch } } : r;
  });
  return { style: el.style, runs: normalizeRuns(next, el.style) };
}

/** The effective style of the character at `index` (the one before the caret when it sits at the end). */
export function styleAt(el: TextElement, index: number): TextStyle {
  let pos = 0;
  const runs = runsOf(el);
  const i = Math.max(0, Math.min(index, el.text.length - 1));
  for (const r of runs) {
    if (i < pos + r.text.length) return { ...el.style, ...r.style };
    pos += r.text.length;
  }
  return { ...el.style, ...runs[runs.length - 1]?.style };
}

/** Settings that are the same over [start, end); the rest are left out. */
export function commonStyle(el: TextElement, start: number, end: number): Partial<TextStyle> {
  if (end <= start) return styleAt(el, start);
  let common: Partial<TextStyle> | null = null;
  let pos = 0;
  for (const r of runsOf(el)) {
    const s = pos, e = pos + r.text.length;
    pos = e;
    if (e <= start || s >= end) continue;
    const st = { ...el.style, ...r.style } as Record<string, unknown>;
    if (!common) common = { ...st } as Partial<TextStyle>;
    else for (const k of Object.keys(common)) if ((common as Record<string, unknown>)[k] !== st[k]) delete (common as Record<string, unknown>)[k];
  }
  return common ?? styleAt(el, start);
}

/** Every font family the box uses. */
export function familiesOf(el: TextElement): Set<string> {
  const out = new Set([el.style.fontFamily]);
  for (const r of el.runs ?? []) if (r.style?.fontFamily) out.add(r.style.fontFamily);
  return out;
}

/** Canva's default settings for each effect. */
export function defaultEffect(type: TextEffectType): TextEffect {
  switch (type) {
    case 'shadow': return { type, offset: 50, direction: -45, blur: 0, transparency: 60, color: '#000000' };
    case 'lift': return { type, intensity: 50 };
    case 'hollow': return { type, thickness: 50 };
    case 'splice': return { type, thickness: 50, offset: 50, direction: -45, color: '#808080' };
    case 'outline': return { type, thickness: 50, color: '#000000' };
    case 'echo': return { type, offset: 50, direction: -45, color: '#808080' };
    case 'glitch': return { type, offset: 30, direction: 90, colors: 'blue-red' };
    case 'neon': return { type, intensity: 50 };
    case 'background': return { type, roundness: 50, spread: 50, transparency: 0, color: '#ffeb3b' };
  }
}

export const TEXT_EFFECTS: { type: TextEffectType; label: string }[] = [
  { type: 'shadow', label: 'Shadow' },
  { type: 'lift', label: 'Lift' },
  { type: 'hollow', label: 'Hollow' },
  { type: 'splice', label: 'Splice' },
  { type: 'outline', label: 'Outline' },
  { type: 'echo', label: 'Echo' },
  { type: 'glitch', label: 'Glitch' },
  { type: 'neon', label: 'Neon' },
  { type: 'background', label: 'Background' },
];

/** List marker for line `i` (0-based) of a list. */
export function listMarker(list: 'bullet' | 'number', i: number): string {
  return list === 'bullet' ? '•' : `${i + 1}.`;
}
