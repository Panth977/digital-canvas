/**
 * Canva's text shortcuts, shared by the canvas (a text box selected) and the
 * in-place editor (the selected characters): ⌘⇧K uppercase, ⌘⇧L/C/R/J align,
 * ⌘⇧> / ⌘⇧< font size. Returns true when the key was one of them.
 */
import type { EditorState } from './editor.svelte.ts';

export function textShortcut(ed: EditorState, e: KeyboardEvent): boolean {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod || !e.shiftKey || e.altKey) return false;
  const st = ed.textStyle;
  if (!st) return false;
  const k = e.key.toLowerCase();
  const align = { l: 'left', c: 'center', r: 'right', j: 'justify' }[k] as 'left' | 'center' | 'right' | 'justify' | undefined;
  if (k === 'k') ed.updateTextStyle({ uppercase: !st.uppercase });
  else if (align) ed.updateTextStyle({ align });
  else if (k === '>' || k === '.' || k === '<' || k === ',') {
    const up = k === '>' || k === '.';
    const fs = st.fontSize ?? 16;
    ed.updateTextStyle({ fontSize: Math.max(1, Math.round(fs) + (up ? 1 : -1)) });
  } else return false;
  e.preventDefault();
  ed.seal();
  return true;
}
