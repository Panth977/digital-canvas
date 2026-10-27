<script lang="ts">
  import { view } from '../lib/view.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import type { EditorState } from '../lib/editor.svelte.ts';
  import Icon from '../lib/Icon.svelte';

  /** Canva's File menu: save, download, view settings (rulers, bleed, margins, snapping). */
  let { ed, bleed, onclose, ondownload }: { ed: EditorState; bleed: number; onclose: () => void; ondownload: () => void } = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="menu" data-testid="file-dropdown" onclick={(e) => e.stopPropagation()}>
  <div class="doc">
    <b>{ed.doc.title}</b>
    <span>{Math.round(ed.doc.width)} × {Math.round(ed.doc.height)} px · {ed.doc.pages.length} page{ed.doc.pages.length === 1 ? '' : 's'}</span>
  </div>
  <hr />
  <button onclick={() => { void ed.save(); onclose(); }}><Icon name="cloud" size={18} /> Save <kbd>⌘S</kbd></button>
  <button onclick={ondownload}><Icon name="download" size={18} /> Download</button>
  <hr />
  <h5><Icon name="ruler" size={16} /> View settings</h5>
  <label><input type="checkbox" checked={view.rulers} onchange={() => view.toggle('rulers')} data-testid="view-rulers" /> Show rulers and guides <kbd>⇧R</kbd></label>
  <label class:off={!bleed} title={bleed ? '' : 'This design has no print bleed'}><input type="checkbox" checked={view.bleed} disabled={!bleed} onchange={() => view.toggle('bleed')} data-testid="view-bleed" /> Show print bleed</label>
  <label><input type="checkbox" checked={view.margins} onchange={() => view.toggle('margins')} data-testid="view-margins" /> Show margins</label>
  <label><input type="checkbox" checked={view.snap} onchange={() => view.toggle('snap')} data-testid="view-snap" /> Snap to guides and elements</label>
  <p>Hold ⌘/Ctrl while dragging to place freely; Alt-drag moves a copy. Drag from a ruler to add a guide; drag it off the page to remove it.</p>
  <hr />
  <button onclick={() => router.go({ name: 'home' })}><Icon name="home" size={18} /> All designs</button>
</div>

<style>
  .menu { position: absolute; top: 48px; left: 0; width: 320px; background: var(--pop); color: var(--ink); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow); padding: 8px; display: flex; flex-direction: column; gap: 2px; z-index: 50; }
  .doc { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; }
  .doc span { font-size: 12px; color: var(--muted); }
  hr { border: 0; border-top: 1px solid var(--line); margin: 4px 0; width: 100%; }
  h5 { display: flex; align-items: center; gap: 8px; margin: 6px 10px 2px; font-size: 13px; }
  button, label { display: flex; align-items: center; gap: 10px; min-height: 36px; padding: 6px 10px; border: 0; background: none; border-radius: 8px; text-align: left; cursor: pointer; color: inherit; font-size: 14px; }
  button:hover, label:hover { background: var(--hover); }
  label.off { opacity: .5; }
  kbd { margin-left: auto; font: inherit; font-size: 12px; color: var(--muted); }
  p { margin: 2px 10px 4px; font-size: 12px; color: var(--muted); line-height: 1.4; }
</style>
