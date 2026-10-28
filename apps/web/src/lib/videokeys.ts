import { isVideo, totalDuration } from '@digital-canvas/scene';
import type { EditorState } from './editor.svelte.ts';
import { stepFrame } from './timeline.ts';
import { toast } from './toast.svelte.ts';

/**
 * Canva's video editor keys: Space plays / pauses, S splits the scene at the
 * playhead, ← / → step one frame while paused with nothing selected (with a
 * selection the arrows still nudge it). True when the key was used.
 */
export function videoKey(ed: EditorState, e: KeyboardEvent): boolean {
  if (!isVideo(ed.doc) || e.metaKey || e.ctrlKey || e.altKey) return false;
  if (ed.editingTextId || ed.croppingId || ed.editingCell) return false;
  const p = ed.player;
  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) p.toggle();
    return true;
  }
  if ((e.key === 's' || e.key === 'S') && !e.shiftKey) {
    e.preventDefault();
    if (p.playing) p.pause();
    if (!ed.splitAtPlayhead()) toast.show('Move the playhead inside a scene to split it');
    return true;
  }
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !ed.selection.length && !p.playing) {
    e.preventDefault();
    void p.seek(stepFrame(p.time, e.key === 'ArrowLeft' ? -1 : 1, totalDuration(ed.doc)));
    return true;
  }
  return false;
}
