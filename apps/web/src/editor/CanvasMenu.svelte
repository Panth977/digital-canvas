<script lang="ts">
  import { childrenOf, type ImageElement } from '@digital-canvas/scene';
  import type { EditorState } from '../lib/editor.svelte.ts';
  import Icon from '../lib/Icon.svelte';
  import { IMAGE_TYPES, pickFiles } from '../lib/files.ts';
  import { downloadSelection, replaceImage } from '../lib/vision/tools.svelte.ts';

  /**
   * Canva's right-click menu on the canvas. On an element: Copy, Paste,
   * Duplicate, Delete, Layer ▸, Align to page ▸, Group / Ungroup, Lock and
   * Set image as background. On a page: Paste and the page actions.
   */
  let { ed, x, y, kind, pageId, vw, vh, onclose }: {
    ed: EditorState;
    x: number;
    y: number;
    kind: 'element' | 'page';
    pageId: string;
    vw: number;
    vh: number;
    onclose: () => void;
  } = $props();

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const M = isMac ? '⌘' : 'Ctrl+';
  const A = isMac ? '⌥' : 'Alt+';

  let sub = $state<'layer' | 'align' | null>(null);
  let box = $state<HTMLDivElement>();
  let at = $state({ x: 0, y: 0, flip: false });

  const els = $derived(ed.selected);
  const locked = $derived(els.some((e) => e.locked));
  const one = $derived(els.length === 1 ? els[0]! : null);
  const page = $derived(ed.doc.pages.find((p) => p.id === pageId));
  const pageIndex = $derived(ed.doc.pages.findIndex((p) => p.id === pageId));

  // keep the menu inside the workspace; submenus open on the side with room
  $effect(() => {
    if (!box) return;
    const w = box.offsetWidth, h = box.offsetHeight;
    at = { x: Math.max(4, Math.min(x, vw - w - 4)), y: Math.max(4, Math.min(y, vh - h - 4)), flip: x + w + 200 > vw };
  });

  function run(fn: () => void): void {
    fn();
    onclose();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onclose();
    }
  }
  async function pickReplace(): Promise<void> {
    const el = ed.selected.find((e): e is ImageElement => e.type === 'image');
    const [f] = await pickFiles(IMAGE_TYPES.join(','), false);
    if (f && el) await replaceImage(ed, el, f);
  }
</script>

<svelte:window onkeydowncapture={onKey} onpointerdown={(e) => { if (!box?.contains(e.target as Node)) onclose(); }} onblur={onclose} />

<div class="cm" class:flip={at.flip} bind:this={box} role="menu" tabindex="-1" data-testid="canvas-menu" style="left:{at.x}px;top:{at.y}px"
  onpointerdown={(e) => e.stopPropagation()} oncontextmenu={(e) => e.preventDefault()}>
  {#if kind === 'element' && els.length}
    <button role="menuitem" onclick={() => run(() => ed.copy())}><Icon name="copy" size={18} /> Copy<kbd>{M}C</kbd></button>
    <button role="menuitem" onclick={() => run(() => ed.paste())}><Icon name="copy" size={18} /> Paste<kbd>{M}V</kbd></button>
    <button role="menuitem" onclick={() => run(() => ed.duplicateSelection())}><Icon name="plus" size={18} /> Duplicate<kbd>{M}D</kbd></button>
    <button role="menuitem" onclick={() => run(() => ed.deleteSelection())}><Icon name="trash" size={18} /> Delete<kbd>DELETE</kbd></button>
    <hr />
    <div class="has" role="none" onpointerenter={() => (sub = 'layer')} onpointerleave={() => (sub = null)}>
      <button role="menuitem" aria-haspopup="menu" aria-expanded={sub === 'layer'} onclick={() => (sub = sub === 'layer' ? null : 'layer')}><Icon name="layers" size={18} /> Layer<span class="arr"><Icon name="right" size={16} /></span></button>
      {#if sub === 'layer'}
        <div class="cm subm" role="menu" data-testid="canvas-menu-layer">
          <button role="menuitem" onclick={() => run(() => ed.arrange('forward'))}><Icon name="front" size={18} /> Bring forward<kbd>{M}]</kbd></button>
          <button role="menuitem" onclick={() => run(() => ed.arrange('front'))}><Icon name="front" size={18} /> Bring to front<kbd>{A}{M}]</kbd></button>
          <button role="menuitem" onclick={() => run(() => ed.arrange('backward'))}><Icon name="back" size={18} /> Send backward<kbd>{M}[</kbd></button>
          <button role="menuitem" onclick={() => run(() => ed.arrange('back'))}><Icon name="back" size={18} /> Send to back<kbd>{A}{M}[</kbd></button>
        </div>
      {/if}
    </div>
    {#if one}
      <div class="has" role="none" onpointerenter={() => (sub = 'align')} onpointerleave={() => (sub = null)}>
        <button role="menuitem" aria-haspopup="menu" aria-expanded={sub === 'align'} disabled={locked} onclick={() => (sub = sub === 'align' ? null : 'align')}><Icon name="alignc" size={18} /> Align to page<span class="arr"><Icon name="right" size={16} /></span></button>
        {#if sub === 'align'}
          <div class="cm subm" role="menu" data-testid="canvas-menu-align">
            <button role="menuitem" onclick={() => run(() => { ed.align('left'); ed.seal(); })}><Icon name="alignl" size={18} /> Left</button>
            <button role="menuitem" onclick={() => run(() => { ed.align('center'); ed.seal(); })}><Icon name="alignc" size={18} /> Centre</button>
            <button role="menuitem" onclick={() => run(() => { ed.align('right'); ed.seal(); })}><Icon name="alignr" size={18} /> Right</button>
            <button role="menuitem" onclick={() => run(() => { ed.align('top'); ed.seal(); })}><Icon name="alignt" size={18} /> Top</button>
            <button role="menuitem" onclick={() => run(() => { ed.align('middle'); ed.seal(); })}><Icon name="alignm" size={18} /> Middle</button>
            <button role="menuitem" onclick={() => run(() => { ed.align('bottom'); ed.seal(); })}><Icon name="alignb" size={18} /> Bottom</button>
          </div>
        {/if}
      </div>
    {/if}
    {#if els.length > 1}
      <button role="menuitem" onclick={() => run(() => ed.group())}><Icon name="group" size={18} /> Group<kbd>{M}G</kbd></button>
    {:else if one && childrenOf(one)}
      <button role="menuitem" onclick={() => run(() => ed.ungroup())}><Icon name="ungroup" size={18} /> Ungroup<kbd>⇧{M}G</kbd></button>
    {/if}
    <hr />
    <button role="menuitem" onclick={() => run(() => { ed.update({ locked: !locked }); ed.seal(); })}><Icon name={locked ? 'unlock' : 'lock'} size={18} /> {locked ? 'Unlock' : 'Lock'}</button>
    {#if one && one.type === 'image'}
      <button role="menuitem" onclick={() => run(() => ed.setAsBackground())}><Icon name="image" size={18} /> Set image as background</button>
      {#if one.locked && one.x <= 0 && one.y <= 0 && one.w >= ed.doc.width && one.h >= ed.doc.height}
        <button role="menuitem" onclick={() => run(() => ed.detachBackground())}><Icon name="image" size={18} /> Detach image from background</button>
      {/if}
      <button role="menuitem" data-testid="menu-replace" onclick={() => run(() => void pickReplace())}><Icon name="replace" size={18} /> Replace image</button>
    {/if}
    <button role="menuitem" data-testid="menu-download-selection" onclick={() => run(() => void downloadSelection(ed))}><Icon name="download" size={18} /> Download selection</button>
  {:else if page}
    <button role="menuitem" onclick={() => run(() => ed.paste())}><Icon name="copy" size={18} /> Paste<kbd>{M}V</kbd></button>
    <hr />
    <button role="menuitem" onclick={() => run(() => ed.duplicatePage(pageId))}><Icon name="copy" size={18} /> Duplicate page</button>
    <button role="menuitem" disabled={ed.doc.pages.length === 1} onclick={() => run(() => ed.removePage(pageId))}><Icon name="trash" size={18} /> Delete page</button>
    <button role="menuitem" onclick={() => run(() => { ed.select([], pageId); ed.addPage(); })}><Icon name="addpage" size={18} /> Add page</button>
    <button role="menuitem" onclick={() => run(() => { ed.updatePage({ hidden: page.hidden ? undefined : true }, null, pageId); ed.seal(); })}><Icon name={page.hidden ? 'eye' : 'eyeoff'} size={18} /> {page.hidden ? 'Show page' : 'Hide page'}</button>
    <hr />
    <button role="menuitem" disabled={pageIndex <= 0} onclick={() => run(() => ed.movePage(pageId, -1))}><Icon name="up" size={18} /> Move page up</button>
    <button role="menuitem" disabled={pageIndex >= ed.doc.pages.length - 1} onclick={() => run(() => ed.movePage(pageId, 1))}><Icon name="down" size={18} /> Move page down</button>
  {/if}
</div>

<style>
  .cm { position: absolute; z-index: 45; min-width: 232px; padding: 6px; display: flex; flex-direction: column; background: var(--pop); color: var(--ink); border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--shadow); font-size: 14px; pointer-events: auto; }
  button { display: flex; align-items: center; gap: 10px; width: 100%; height: 36px; padding: 0 10px; border: 0; border-radius: 6px; background: none; color: inherit; font: inherit; text-align: left; white-space: nowrap; }
  button:hover:not(:disabled), button[aria-expanded='true'] { background: var(--hover); }
  button:disabled { opacity: .4; cursor: default; }
  kbd { margin-left: auto; padding-left: 16px; font: 12px Inter, system-ui, sans-serif; color: var(--muted); }
  .arr { margin-left: auto; display: flex; color: var(--muted); }
  hr { width: 100%; margin: 4px 0; border: 0; border-top: 1px solid var(--line); }
  .has { position: relative; }
  .subm { top: -6px; left: calc(100% + 4px); }
  .flip .subm { left: auto; right: calc(100% + 4px); }
</style>
