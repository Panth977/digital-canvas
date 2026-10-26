<script lang="ts">
  import { moveElementTo, type ShapeKind } from '@digital-canvas/scene';
  import { SHAPES, TEXT_PRESETS, type EditorState } from '../lib/editor.svelte.ts';
  import Icon, { type IconName } from '../lib/Icon.svelte';
  import { IMAGE_TYPES, objectUrl, pickFiles } from '../lib/files.ts';

  let { ed }: { ed: EditorState } = $props();

  type Tab = 'elements' | 'text' | 'uploads' | 'layers';
  let tab = $state<Tab | null>('elements');
  let uploadError = $state('');
  let dragLayer = $state<string | null>(null);

  const TABS: { id: Tab; label: string; icon: IconName }[] = [
    { id: 'elements', label: 'Elements', icon: 'shapes' },
    { id: 'text', label: 'Text', icon: 'text' },
    { id: 'uploads', label: 'Uploads', icon: 'upload' },
    { id: 'layers', label: 'Layers', icon: 'layers' },
  ];

  const SHAPE_SVG: Record<ShapeKind, string> = {
    rect: '<rect x="4" y="4" width="40" height="40" rx="3"/>',
    ellipse: '<circle cx="24" cy="24" r="20"/>',
    triangle: '<path d="M24 4L44 44H4z"/>',
    diamond: '<path d="M24 3L45 24 24 45 3 24z"/>',
    pentagon: '<path d="M24 4l19 14-7 23H12L5 18z"/>',
    hexagon: '<path d="M14 6h20l10 18-10 18H14L4 24z"/>',
    star: '<path d="M24 4l5.9 12.9 14.1 1.6-10.5 9.6 2.9 13.9L24 35l-12.4 7 2.9-13.9L4 18.5l14.1-1.6z"/>',
    arrow: '<path d="M4 17h24V8l16 16-16 16v-9H4z"/>',
  };

  const assets = $derived(Object.entries(ed.doc.assets).filter(([, m]) => m.mime.startsWith('image/')));
  const layers = $derived([...ed.page.elements].reverse());

  function dragData(e: DragEvent, data: object): void {
    e.dataTransfer?.setData('application/x-digital-canvas', JSON.stringify(data));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  }

  async function upload(): Promise<void> {
    uploadError = '';
    const files = await pickFiles(IMAGE_TYPES.join(','));
    for (const f of files) if (!(await ed.addImageFile(f))) uploadError = `Couldn't read ${f.name}.`;
  }

  function layerName(e: (typeof layers)[number]): string {
    if (e.name) return e.name;
    if (e.type === 'text') return e.text.split('\n')[0]!.slice(0, 40) || 'Text';
    if (e.type === 'image') return ed.doc.assets[e.asset]?.name ?? 'Image';
    return SHAPES.find((s) => s.kind === e.shape)?.label ?? 'Shape';
  }

  function dropLayer(targetId: string): void {
    if (!dragLayer || dragLayer === targetId) return;
    const els = ed.page.elements;
    const to = els.findIndex((e) => e.id === targetId);
    ed.commit(moveElementTo(ed.doc, dragLayer, to));
    ed.seal();
    dragLayer = null;
  }
</script>

<aside class="side">
  <nav class="rail">
    {#each TABS as t}
      <button class:on={tab === t.id} onclick={() => (tab = tab === t.id ? null : t.id)} data-testid="tab-{t.id}">
        <Icon name={t.icon} size={22} />
        <span>{t.label}</span>
      </button>
    {/each}
  </nav>

  {#if tab}
    <div class="drawer scroll-y">
      {#if tab === 'elements'}
        <h3>Shapes</h3>
        <div class="shapes">
          {#each SHAPES as s}
            <button class="shape" title={s.label} aria-label="Add {s.label}" data-testid="shape-{s.kind}" draggable="true"
              ondragstart={(e) => dragData(e, { kind: 'shape', shape: s.kind })} onclick={() => ed.addShape(s.kind)}>
              <svg viewBox="0 0 48 48" width="44" height="44">{@html SHAPE_SVG[s.kind]}</svg>
            </button>
          {/each}
        </div>
        <p class="hint">Lines, frames, grids, charts, icons and stock photos arrive in milestone 6.</p>
      {:else if tab === 'text'}
        <h3>Text</h3>
        <div class="texts">
          {#each Object.entries(TEXT_PRESETS) as [key, p]}
            <button class="textbtn {key}" draggable="true" data-testid="text-{key}"
              ondragstart={(e) => dragData(e, { kind: 'text', preset: key })} onclick={() => ed.addText(key as keyof typeof TEXT_PRESETS)}>{p.label}</button>
          {/each}
        </div>
        <p class="hint">Double-click text to edit it. Select some words to style just those. Fonts, effects, curve and lists are in the panel on the right.</p>
      {:else if tab === 'uploads'}
        <button class="btn primary wide" onclick={upload} data-testid="upload"><Icon name="upload" size={16} /> Upload images</button>
        <p class="hint">Or drop image files onto the page. PNG, JPG, WebP, GIF.</p>
        {#if uploadError}<p class="err">{uploadError}</p>{/if}
        <div class="assets">
          {#each assets as [id, m] (id)}
            {@const bytes = ed.assets.get(id)}
            <button class="asset" title={m.name ?? id} draggable="true" ondragstart={(e) => dragData(e, { kind: 'asset', id })} onclick={() => ed.addImageAsset(id)}>
              {#if bytes}<img src={objectUrl(bytes, m.mime)} alt={m.name ?? ''} />{/if}
            </button>
          {/each}
        </div>
      {:else}
        <h3>Layers · Page {ed.pageIndex + 1}</h3>
        {#if !layers.length}
          <p class="hint">Nothing on this page yet.</p>
        {/if}
        <ul class="layers" data-testid="layers">
          {#each layers as e (e.id)}
            <li
              class:sel={ed.selection.includes(e.id)}
              class:hidden={e.hidden}
              draggable="true"
              ondragstart={() => (dragLayer = e.id)}
              ondragover={(ev) => ev.preventDefault()}
              ondrop={() => dropLayer(e.id)}
            >
              <button class="lname" onclick={(ev) => ed.select(ev.shiftKey ? [...ed.selection, e.id] : [e.id])}>
                <Icon name={e.type === 'text' ? 'text' : e.type === 'image' ? 'image' : 'shapes'} size={15} />
                <span>{layerName(e)}</span>
              </button>
              <button class="lbtn" aria-label={e.locked ? 'Unlock' : 'Lock'} onclick={() => { ed.update({ locked: !e.locked }, null, [e.id]); ed.seal(); }}><Icon name={e.locked ? 'lock' : 'unlock'} size={15} /></button>
              <button class="lbtn" aria-label={e.hidden ? 'Show' : 'Hide'} onclick={() => { ed.update({ hidden: !e.hidden }, null, [e.id]); ed.seal(); }}><Icon name={e.hidden ? 'eyeoff' : 'eye'} size={15} /></button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</aside>

<style>
  .side { display: flex; height: 100%; flex-shrink: 0; }
  .rail { width: 72px; background: var(--rail); display: flex; flex-direction: column; align-items: stretch; padding: 8px 0; gap: 2px; }
  .rail button { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 0; border: 0; background: none; color: var(--rail-ink); font-size: 11px; font-weight: 600; }
  .rail button:hover { color: #fff; }
  .rail button.on { color: #fff; background: rgba(255,255,255,.08); box-shadow: inset 3px 0 0 var(--accent); }
  .drawer { width: 300px; background: var(--panel); border-right: 1px solid var(--line); padding: 16px; }
  h3 { margin: 0 0 12px; font-size: 14px; }
  .shapes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .shape { aspect-ratio: 1; display: grid; place-items: center; border: 1px solid transparent; background: #f4f5f8; border-radius: 10px; }
  .shape:hover { border-color: var(--accent); background: var(--accent-soft); }
  .shape svg { fill: #7c5cff; }
  .texts { display: flex; flex-direction: column; gap: 8px; }
  .textbtn { text-align: left; padding: 14px; border: 1px solid var(--line); border-radius: 10px; background: #fff; }
  .textbtn:hover { border-color: var(--accent); }
  .textbtn.heading { font-size: 24px; font-weight: 800; }
  .textbtn.subheading { font-size: 17px; font-weight: 700; }
  .textbtn.body { font-size: 13px; }
  .hint { color: var(--muted); font-size: 12px; line-height: 1.5; margin: 14px 0 0; }
  .err { color: var(--danger); font-size: 13px; }
  .wide { width: 100%; height: 40px; }
  .assets { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 14px; }
  .asset { aspect-ratio: 1; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; padding: 0; background: #f4f5f8; }
  .asset img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .layers { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .layers li { display: flex; align-items: center; gap: 2px; border-radius: 8px; border: 1px solid var(--line); background: #fff; padding-right: 4px; }
  .layers li.sel { border-color: var(--accent); background: var(--accent-soft); }
  .layers li.hidden .lname { opacity: .45; }
  .lname { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; border: 0; background: none; padding: 9px 10px; text-align: left; }
  .lname span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .lbtn { width: 28px; height: 28px; display: grid; place-items: center; border: 0; background: none; border-radius: 6px; color: var(--muted); }
  .lbtn:hover { background: rgba(0,0,0,.06); color: var(--ink); }
</style>
