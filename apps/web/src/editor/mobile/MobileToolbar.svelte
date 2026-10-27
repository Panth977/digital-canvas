<script lang="ts">
  import { flushSync } from 'svelte';
  import { animationLabel, type Element, type ImageElement, type LineElement, type ShapeElement, type TextElement, type VideoElement } from '@digital-canvas/scene';
  import type { EditorState } from '../../lib/editor.svelte.ts';
  import Icon, { type IconName } from '../../lib/Icon.svelte';
  import { ui, type ColorTarget, type RailTab } from '../../lib/ui.svelte.ts';
  import { mobile, type MobileSheet } from '../../lib/mobile.svelte.ts';

  /**
   * Canva mobile's bottom toolbar: one scrolling row of big buttons that
   * follows the selection. With nothing selected it opens the content
   * sections (Design, Elements, Text, Uploads…) in a bottom sheet.
   */
  let { ed }: { ed: EditorState } = $props();

  const sel = $derived(ed.selected);
  const one = $derived(sel.length === 1 ? sel[0]! : null);
  const texts = $derived(sel.filter((e): e is TextElement => e.type === 'text'));
  const s0 = $derived(sel.find((e): e is ShapeElement => e.type === 'shape'));
  const l0 = $derived(sel.find((e): e is LineElement => e.type === 'line'));
  const pic = $derived(sel.find((e): e is ImageElement | VideoElement => e.type === 'image' || e.type === 'video'));
  const fr = $derived(one?.type === 'image' && one.mask ? one : null);
  const locked = $derived(sel.some((e) => e.locked));

  type Kind = 'page' | 'text' | 'image' | 'video' | 'frame' | 'shape' | 'line' | 'table' | 'chart' | 'graphic' | 'qr' | 'group' | 'multi';
  const kind = $derived.by((): Kind => {
    if (!sel.length) return 'page';
    if (texts.length === sel.length) return 'text';
    if (!one) return 'multi';
    if (one.type === 'image') return one.mask ? 'frame' : 'image';
    if (one.type === 'path') return one.qr !== undefined ? 'qr' : 'graphic';
    return one.type as Kind;
  });

  const key = (k: string) => `prop:${k}:${ed.selection.join(',')}`;
  const end = () => ed.seal();
  const owner = $derived(ed.selection.join(','));

  function color(t: Omit<ColorTarget, 'owner' | 'onend'>): void {
    if (ui.panel === 'color' && ui.color?.title === t.title && ui.color.owner === owner) return ui.close();
    ui.openColor({ onend: end, ...t, owner });
  }
  function rail(t: RailTab): void {
    ui.rail(t);
  }
  function sheet(s: MobileSheet): void {
    if (ui.panel) ui.panel = null;
    mobile.sheet = mobile.sheet === s ? null : s;
  }
  function edit(): void {
    const t = texts[0];
    if (!t) return;
    // mount and focus the editor inside the tap, or iOS keeps the keyboard shut
    flushSync(() => ed.startEditing(t.id));
    document.querySelector<HTMLElement>('[data-testid=text-editor]')?.focus();
  }

  const fillHex = (s: ShapeElement) => (s.fill?.type === 'solid' ? s.fill.color : s.fill?.type === 'linear' ? s.fill.stops[0]?.color ?? '#000000' : '#ffffff');
  const textColor = () => ed.textStyle?.color ?? '#000000';
  const pageBg = () => (ed.page.background.type === 'solid' ? ed.page.background.color : '#ffffff');
  function graphicColor(): void {
    if (one?.type !== 'path') return;
    const part = one.paths.find((p) => p.fill?.type === 'solid' || p.stroke);
    let cur = (part?.fill?.type === 'solid' ? part.fill.color : part?.stroke?.color ?? '#000000').slice(0, 7).toLowerCase();
    color({ title: 'Colour', testid: 'graphic-color-0', value: () => cur, onchange: (hex) => { ed.recolor(cur, hex, key('rc0')); cur = hex; } });
  }

  interface Item { id: string; label: string; icon?: IconName; swatch?: string; on?: boolean; danger?: boolean; disabled?: boolean; act: () => void }

  const items = $derived.by((): Item[] => {
    const out: Item[] = [];
    const add = (i: Item) => out.push(i);
    const isOpen = (p: string) => ui.panel === p;
    if (kind === 'page') {
      add({ id: 'templates', label: 'Design', icon: 'templates', on: isOpen('templates'), act: () => rail('templates') });
      add({ id: 'elements', label: 'Elements', icon: 'elements', on: isOpen('elements'), act: () => rail('elements') });
      add({ id: 'text', label: 'Text', icon: 'text', on: isOpen('text'), act: () => rail('text') });
      add({ id: 'uploads', label: 'Uploads', icon: 'cloud', on: isOpen('uploads'), act: () => rail('uploads') });
      add({ id: 'photos', label: 'Photos', icon: 'image', on: isOpen('photos'), act: () => rail('photos') });
      add({ id: 'draw', label: 'Draw', icon: 'pen', on: isOpen('draw'), act: () => rail('draw') });
      add({ id: 'brand', label: 'Brand', icon: 'brand', on: isOpen('brand'), act: () => rail('brand') });
      add({ id: 'apps', label: 'Apps', icon: 'apps', on: isOpen('apps'), act: () => rail('apps') });
      add({ id: 'ai', label: 'AI', icon: 'ai', on: isOpen('ai'), act: () => rail('ai') });
      add({ id: 'projects', label: 'Projects', icon: 'projects', on: isOpen('projects'), act: () => rail('projects') });
      add({ id: 'videos', label: 'Videos', icon: 'video', on: isOpen('videos'), act: () => rail('videos') });
      add({ id: 'sounds', label: 'Audio', icon: 'music', on: isOpen('sounds'), act: () => rail('sounds') });
      add({ id: 'page-bg', label: 'Background', swatch: pageBg(), on: isOpen('color'), act: () => color({ title: 'Background colour', testid: 'page-bg', kind: 'page', value: pageBg, onchange: (hex) => ed.updatePage({ background: { type: 'solid', color: hex } }, 'page-bg') }) });
      add({ id: 'pages', label: 'Pages', icon: 'pages', on: mobile.sheet === 'pages', act: () => sheet('pages') });
      add({ id: 'animate', label: ed.page.animation ? animationLabel(ed.page.animation) : 'Animate', icon: 'animate', on: isOpen('animate'), act: () => ui.open('animate') });
      add({ id: 'layers', label: 'Layers', icon: 'layers', on: isOpen('position'), act: () => { ui.positionTab = 'layers'; ui.open('position'); } });
      return out;
    }
    if (kind === 'text') {
      add({ id: 'edit', label: 'Edit', icon: 'pen', on: !!ed.editingTextId, act: edit });
      add({ id: 'font', label: 'Font', icon: 'text', on: isOpen('font'), act: () => ui.open('font') });
      add({ id: 'size', label: 'Size', icon: 'resize', on: mobile.sheet === 'size', act: () => sheet('size') });
      add({ id: 'text-color', label: 'Colour', swatch: textColor(), on: isOpen('color'), act: () => color({ title: 'Text colour', testid: 'text-color', kind: 'text', value: textColor, onchange: (hex) => ed.updateTextStyle({ color: hex }, key('tc')) }) });
      add({ id: 'format', label: 'Format', icon: 'bold', on: mobile.sheet === 'format', act: () => sheet('format') });
      add({ id: 'effects', label: 'Effects', icon: 'sparkle', on: isOpen('effects'), act: () => ui.open('effects') });
      add({ id: 'spacing', label: 'Spacing', icon: 'spacing', on: mobile.sheet === 'spacing', act: () => sheet('spacing') });
    }
    if ((kind === 'image' || kind === 'video' || (kind === 'frame' && fr?.asset)) && pic) {
      add({ id: 'edit-image', label: 'Edit', icon: 'sliders', on: isOpen('image'), act: () => ui.open('image') });
      add({ id: 'crop', label: ed.croppingId === pic.id ? 'Done' : 'Crop', icon: 'crop', on: ed.croppingId === pic.id, disabled: pic.locked, act: () => (ed.croppingId === pic.id ? ed.stopCrop() : ed.startCrop(pic.id)) });
      add({ id: 'flip', label: 'Flip', icon: 'flipx', act: () => { ed.update((e) => ({ flipX: !e.flipX })); end(); } });
    }
    if (kind === 'frame' && fr) add({ id: 'edit-frame', label: 'Frame', icon: 'frame', on: isOpen('frame'), act: () => ui.open('frame') });
    if (kind === 'shape' && s0) {
      const s = s0;
      add({ id: 'fill', label: 'Colour', swatch: s.fill ? fillHex(s) : 'transparent', on: isOpen('color'), act: () => color({ title: 'Colour', testid: 'fill', kind: 'fill', value: () => (s0?.fill ? fillHex(s0) : '#ffffff'), onchange: (hex) => ed.update((e) => (e.type === 'shape' ? { fill: { type: 'solid', color: hex } } : {}), key('fill')) }) });
    }
    if (kind === 'line' && l0) {
      const l = l0;
      add({ id: 'line-color', label: 'Colour', swatch: l.stroke.color, on: isOpen('color'), act: () => color({ title: 'Line colour', testid: 'line-color', value: () => l0?.stroke.color ?? '#000000', onchange: (hex) => l0 && ed.updateLine({ stroke: { ...l0.stroke, color: hex } }, key('lc')) }) });
    }
    if (kind === 'graphic') add({ id: 'graphic-color', label: 'Colour', icon: 'palette', act: graphicColor });
    if (kind === 'qr') add({ id: 'edit-qr', label: 'QR code', icon: 'qr', on: isOpen('qr'), act: () => ui.open('qr') });
    if (kind === 'table') add({ id: 'edit-table', label: 'Edit table', icon: 'table', on: isOpen('table'), act: () => ui.open('table') });
    if (kind === 'chart') add({ id: 'edit-chart', label: 'Edit chart', icon: 'chart', on: isOpen('chart'), act: () => ui.open('chart') });
    if (kind === 'group' || (sel.length > 1 && sel.some((e) => e.type === 'group'))) add({ id: 'ungroup', label: 'Ungroup', icon: 'ungroup', act: () => ed.ungroup() });
    if (sel.length > 1) add({ id: 'group', label: 'Group', icon: 'group', act: () => ed.group() });
    const anim = sel.length === 1 && sel[0]!.animation ? animationLabel(sel[0]!.animation) : 'Animate';
    add({ id: 'animate', label: anim, icon: 'animate', on: isOpen('animate'), act: () => ui.open('animate') });
    add({ id: 'position', label: 'Position', icon: 'position', on: isOpen('position'), act: () => { ui.positionTab = 'arrange'; ui.open('position'); } });
    add({ id: 'opacity', label: 'Transparency', icon: 'transparency', on: mobile.sheet === 'opacity', act: () => sheet('opacity') });
    if (pic && !(fr && !fr.asset)) add({ id: 'set-bg', label: 'Background', icon: 'image', act: () => ed.setAsBackground() });
    add({ id: 'duplicate', label: 'Duplicate', icon: 'copy', act: () => ed.duplicateSelection() });
    add({ id: 'lock', label: locked ? 'Unlock' : 'Lock', icon: locked ? 'lock' : 'unlock', on: locked, act: () => { ed.update({ locked: !locked }); end(); } });
    add({ id: 'delete', label: 'Delete', icon: 'trash', danger: true, act: () => ed.deleteSelection() });
    return out;
  });

  // a new kind of selection starts the row from the left
  let row = $state<HTMLElement>();
  $effect(() => {
    void kind;
    row?.scrollTo({ left: 0 });
  });
</script>

<nav class="mbar" bind:this={row} aria-label="{kind === 'page' ? 'Design' : kind} tools" data-testid="mobile-toolbar" data-kind={kind} data-text-tools>
  {#each items as it (it.id)}
    <button class:on={it.on} class:danger={it.danger} disabled={it.disabled} onclick={it.act} data-testid="m-{it.id}" aria-pressed={it.on ?? undefined}>
      <span class="ic">
        {#if it.swatch !== undefined}<i class="sw" style="background:{it.swatch}"></i>{:else if it.icon}<Icon name={it.icon} size={22} />{/if}
      </span>
      <span class="lb">{it.label}</span>
    </button>
  {/each}
</nav>

<style>
  .mbar {
    flex-shrink: 0; display: flex; gap: 2px; overflow-x: auto; overflow-y: hidden; padding: 6px 6px calc(6px + env(safe-area-inset-bottom));
    background: var(--panel); border-top: 1px solid var(--line); scrollbar-width: none; touch-action: pan-x; overscroll-behavior-x: contain;
    -webkit-overflow-scrolling: touch;
  }
  .mbar::-webkit-scrollbar { display: none; }
  button {
    flex: 0 0 auto; min-width: 64px; height: 58px; padding: 0 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
    border: 0; border-radius: 10px; background: transparent; color: var(--ink); font-size: 11px; font-weight: 500; -webkit-tap-highlight-color: transparent;
  }
  button:active { background: var(--hover); }
  button.on .ic { background: var(--accent-soft); color: var(--accent); }
  button.danger { color: var(--danger); }
  button:disabled { opacity: .4; }
  .ic { width: 40px; height: 30px; display: grid; place-items: center; border-radius: 8px; }
  .sw { width: 24px; height: 24px; border-radius: 50%; border: 1px solid rgba(0, 0, 0, .15); display: block; }
  .lb { white-space: nowrap; max-width: 80px; overflow: hidden; text-overflow: ellipsis; }
</style>
