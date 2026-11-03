<script lang="ts">
  /**
   * Make or edit a mockup plugin from your own photo: drag the four corners
   * onto the print area (a loupe shows the spot under the finger; arrow keys
   * nudge the picked corner, Shift = 10 px), set how much of the photo's
   * light and shade shows on the design, optionally add a mask for curved or
   * partly hidden areas. The preview is the current page composited by the
   * mockup worker, exactly as the Mockups tab will show it.
   */
  import '../panels.css';
  import { onDestroy, onMount, untrack } from 'svelte';
  import { parsePlugin, type MockupPlugin } from '@digital-canvas/scene';
  import type { EditorState } from '../../../lib/editor.svelte.ts';
  import Icon from '../../../lib/Icon.svelte';
  import { IMAGE_TYPES, pickFiles } from '../../../lib/files.ts';
  import { toast } from '../../../lib/toast.svelte.ts';
  import { ui } from '../../../lib/ui.svelte.ts';
  import { MOCKUP_CATEGORIES, designPx, mockupClient, paint, sendPage } from '../../../lib/mockups/mockups.svelte.ts';
  import { mimeOfImage, mockupEntry, plugins } from '../../../lib/plugins/plugins.svelte.ts';
  import type { Corners } from '../../../lib/plugins/quad-bridge.ts';

  let { ed, plugin, onclose }: { ed: EditorState; plugin?: MockupPlugin; onclose: () => void } = $props();

  // svelte-ignore state_referenced_locally
  const start = plugin;
  const DRAFT = 'plugin-draft-mockup', DESIGN = 'plugin-draft';
  let name = $state(start?.name ?? 'My mockup');
  let category = $state(start?.category ?? 'My mockups');
  let shade = $state(start?.shade ?? 0.8);
  let photo = $state<{ asset: string; url: string; width: number; height: number } | null>(null);
  let mask = $state<{ asset: string; url: string } | null>(null);
  let corners = $state<Corners>(start ? structuredClone(start.corners) : [[0, 0], [1, 0], [1, 1], [0, 1]]);
  let active = $state<number | null>(null);
  let picked = $state(0);
  let error = $state('');
  let dialog = $state<HTMLElement>();

  const urlOf = (b: Uint8Array) => URL.createObjectURL(new Blob([b as BlobPart], { type: mimeOfImage(b) }));
  const urls: string[] = [];

  onMount(() => {
    dialog?.focus();
    if (start) {
      void (async () => {
        const [p, m] = await Promise.all([plugins.asset(start.photo), start.mask ? plugins.asset(start.mask) : Promise.resolve(null)]);
        if (!p) { error = 'This mockup’s photo is missing.'; return; }
        photo = { asset: start.photo, url: urlOf(p), width: start.width, height: start.height };
        urls.push(photo.url);
        if (m && start.mask) { mask = { asset: start.mask, url: urlOf(m) }; urls.push(mask.url); }
      })();
    }
    sendPage(ed, ed.pageId, DESIGN, designPx(ed, 'small'));
  });
  onDestroy(() => { for (const u of urls) URL.revokeObjectURL(u); if (timer) clearTimeout(timer); });

  async function readImage(f: File): Promise<{ bytes: Uint8Array; mime: string; width: number; height: number } | null> {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const mime = mimeOfImage(bytes);
    if (!IMAGE_TYPES.includes(mime)) { error = `${f.name} is not a PNG, JPEG, WebP or GIF picture.`; return null; }
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
    const out = { bytes, mime, width: bmp.width, height: bmp.height };
    bmp.close();
    return out;
  }

  async function setPhoto(f: File): Promise<void> {
    error = '';
    const img = await readImage(f);
    if (!img) return;
    const asset = await plugins.addFile(img.bytes, img.mime);
    photo = { asset, url: urlOf(img.bytes), width: img.width, height: img.height };
    urls.push(photo.url);
    const { width: w, height: h } = img;
    corners = [[w * 0.25, h * 0.25], [w * 0.75, h * 0.25], [w * 0.75, h * 0.75], [w * 0.25, h * 0.75]];
    if (name === 'My mockup') name = f.name.replace(/\.[^.]+$/, '').slice(0, 80) || name;
  }
  async function uploadPhoto(): Promise<void> {
    const [f] = await pickFiles(IMAGE_TYPES.join(','), false);
    if (f) await setPhoto(f);
  }
  async function uploadMask(): Promise<void> {
    const [f] = await pickFiles(IMAGE_TYPES.join(','), false);
    if (!f) return;
    const img = await readImage(f);
    if (!img) return;
    mask = { asset: await plugins.addFile(img.bytes, img.mime), url: urlOf(img.bytes) };
    urls.push(mask.url);
  }
  function onDrop(e: DragEvent): void {
    const f = [...(e.dataTransfer?.files ?? [])].find((x) => x.type.startsWith('image/'));
    if (!f) return;
    e.preventDefault();
    void setPhoto(f);
  }

  // ---- the stage: photo fitted into the box, corners in photo pixels ----
  const BOX = { w: 620, h: 460 };
  const scale = $derived(photo ? Math.min(BOX.w / photo.width, BOX.h / photo.height) : 1);
  let svg = $state<SVGSVGElement>();
  let pointer = $state<{ x: number; y: number } | null>(null);

  function toPhoto(e: PointerEvent): [number, number] {
    const r = svg!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * photo!.width, y = ((e.clientY - r.top) / r.height) * photo!.height;
    return [Math.max(0, Math.min(photo!.width, x)), Math.max(0, Math.min(photo!.height, y))];
  }
  function down(e: PointerEvent, i: number): void {
    e.preventDefault();
    e.stopPropagation();
    active = i;
    picked = i;
    svg?.setPointerCapture(e.pointerId);
    svg?.focus();
  }
  function move(e: PointerEvent): void {
    if (active === null || !photo) return;
    const p = toPhoto(e);
    corners = corners.map((c, j) => (j === active ? p : c)) as Corners;
    pointer = { x: p[0], y: p[1] };
  }
  function up(): void {
    active = null;
    pointer = null;
  }
  function nudge(e: KeyboardEvent): void {
    const d = e.shiftKey ? 10 : 1;
    const v = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
    if (e.key === 'Tab' && !e.shiftKey && document.activeElement === svg) { /* let focus move on */ }
    if (/^[1-4]$/.test(e.key)) { picked = Number(e.key) - 1; e.preventDefault(); return; }
    if (!v || !photo) return;
    e.preventDefault();
    e.stopPropagation();
    const [x, y] = corners[picked]!;
    corners = corners.map((c, j) => (j === picked ? [Math.max(0, Math.min(photo!.width, x + v[0]!)), Math.max(0, Math.min(photo!.height, y + v[1]!))] : c)) as Corners;
  }
  const LABELS = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];
  const loupeAt = $derived(pointer ?? (photo ? { x: corners[picked]![0], y: corners[picked]![1] } : null));
  const LOUPE = 128, ZOOM = 4;

  // ---- live preview through the compositor ----
  let pv = $state<HTMLCanvasElement>();
  let rendering = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const draft = $derived<MockupPlugin | null>(photo ? {
    format: 'digital-canvas-plugin', version: 1, id: DRAFT, kind: 'mockup', name, category, photo: photo.asset, width: photo.width, height: photo.height,
    corners: corners.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]) as Corners, shade, ...(mask ? { mask: mask.asset } : {}),
    createdAt: '', updatedAt: '',
  } : null);
  $effect(() => {
    const d = draft, c = pv;
    if (!d || !c) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => untrack(async () => {
      rendering = true;
      try {
        if (!(await plugins.ensureMockup(d, DRAFT))) return;
        const r = await mockupClient.render({ entry: { ...mockupEntry(d), id: DRAFT }, size: 'small', design: DESIGN });
        if (pv) { paint(pv, r); pv.dataset.rendered = String(Number(pv.dataset.rendered ?? 0) + 1); }
      } catch (e) {
        error = `Couldn’t render the preview: ${e instanceof Error ? e.message : e}`;
      } finally {
        rendering = false;
      }
    }), active === null ? 60 : 160);
  });

  let saving = $state(false);
  async function save(show = false): Promise<void> {
    if (!draft) return;
    saving = true;
    try {
      const p = parsePlugin({ ...(start ?? {}), ...draft, id: start?.id, name: name.trim() || 'My mockup', category: category.trim() || 'My mockups', createdAt: start?.createdAt, updatedAt: undefined }) as MockupPlugin;
      const saved = await plugins.save(p);
      toast.show(`“${saved.name}” is in your mockups`);
      onclose();
      if (show) ui.rail('mockups');
    } catch (e) {
      toast.show(`Couldn't save: ${e instanceof Error ? e.message : e}`);
    } finally {
      saving = false;
    }
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.stopPropagation(); onclose(); }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="dp-modal-bg" onclick={onclose} onpointerdown={(e) => e.stopPropagation()}>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="mc" role="dialog" aria-modal="true" aria-label="Mockup from a photo" tabindex="-1" bind:this={dialog} data-testid="mockup-creator"
    onclick={(e) => e.stopPropagation()} onkeydown={onKey} ondragover={(e) => e.preventDefault()} ondrop={onDrop}>
    <header class="mc-head">
      <h2>{start ? 'Edit mockup' : 'New mockup'}</h2>
      <button class="btn ghost icon" aria-label="Close" onclick={onclose}><Icon name="close" size={16} /></button>
    </header>
    <div class="mc-body">
      <div class="mc-stage" style="width:{BOX.w}px;height:{BOX.h}px">
        {#if !photo}
          <button class="mc-drop" data-testid="mockup-photo-upload" onclick={uploadPhoto}>
            <Icon name="image" size={32} />
            <b>Upload a photo</b>
            <span>A product, a wall, a screen… then drag the corners onto where the design goes. You can drop a picture here.</span>
          </button>
        {:else}
          <div class="mc-pic" style="width:{photo.width * scale}px;height:{photo.height * scale}px">
            <img src={photo.url} alt="The mockup" draggable="false" />
            {#if mask}<img class="mc-mask" src={mask.url} alt="" draggable="false" />{/if}
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <svg bind:this={svg} viewBox="0 0 {photo.width} {photo.height}" tabindex="0" role="application" aria-label="Print area corners: drag them, or pick one with 1-4 and nudge with the arrow keys"
              data-testid="mockup-stage" onpointermove={move} onpointerup={up} onpointercancel={up} onkeydown={nudge}>
              <polygon points={corners.map((c) => c.join(',')).join(' ')} class="mc-quad" style="stroke-width:{2 / scale}px" />
              {#each corners as c, i (i)}
                <circle cx={c[0]} cy={c[1]} r={9 / scale} class="mc-h" class:on={picked === i} style="stroke-width:{2 / scale}px"
                  data-testid="mockup-corner-{i}" aria-label={LABELS[i]} onpointerdown={(e) => down(e, i)} />
              {/each}
            </svg>
          </div>
          {#if loupeAt}
            <div class="mc-loupe" aria-hidden="true" style="width:{LOUPE}px;height:{LOUPE}px;background-image:url({photo.url});background-size:{photo.width * scale * ZOOM}px {photo.height * scale * ZOOM}px;background-position:{LOUPE / 2 - loupeAt.x * scale * ZOOM}px {LOUPE / 2 - loupeAt.y * scale * ZOOM}px">
              <i></i><small>{LABELS[picked]} · {Math.round(loupeAt.x)}, {Math.round(loupeAt.y)}</small>
            </div>
          {/if}
        {/if}
      </div>
      <aside class="mc-side dp-stack">
        <label class="cr-f"><span>Name</span><input class="cr-in" bind:value={name} maxlength="80" data-testid="mockup-plugin-name" /></label>
        <label class="cr-f"><span>Category</span>
          <input class="cr-in" bind:value={category} list="dc-mockup-cats" maxlength="40" data-testid="mockup-plugin-category" />
          <datalist id="dc-mockup-cats"><option value="My mockups"></option>{#each MOCKUP_CATEGORIES as c (c)}<option value={c}></option>{/each}</datalist>
        </label>
        <div class="cr-f">
          <span>Light and shade · {Math.round(shade * 100)}%</span>
          <input type="range" min="0" max="1" step="0.05" bind:value={shade} data-testid="mockup-plugin-shade" />
        </div>
        <div class="cr-f">
          <span>Mask <small>(white = where the design shows)</small></span>
          <div class="dp-row">
            <button class="btn" disabled={!photo} data-testid="mockup-mask-upload" onclick={uploadMask}><Icon name="upload" size={14} /> {mask ? 'Replace' : 'Upload'}</button>
            {#if mask}<button class="btn ghost" onclick={() => (mask = null)}>Remove</button>{/if}
          </div>
        </div>
        {#if photo}
          <div class="mc-pv">
            <canvas bind:this={pv} width="400" height="300" data-testid="mockup-plugin-preview"></canvas>
            {#if rendering}<span class="dp-spin"></span>{/if}
          </div>
          <div class="dp-row">
            <button class="btn ghost" onclick={uploadPhoto}><Icon name="replace" size={14} /> Other photo</button>
          </div>
        {/if}
        {#if error}<p class="dp-err">{error}</p>{/if}
        <p class="dp-hint">Corners go clockwise from the top left of the design. Pick a corner and use the arrow keys for fine moves.</p>
      </aside>
    </div>
    <footer class="mc-foot">
      <button class="btn" onclick={onclose}>Cancel</button>
      <button class="btn" disabled={!photo || saving} onclick={() => save(true)} data-testid="mockup-plugin-save-show">Save and show</button>
      <button class="btn primary" disabled={!photo || saving} onclick={() => save(false)} data-testid="mockup-plugin-save">Save</button>
    </footer>
  </div>
</div>

<style>
  .mc { width: 940px; max-width: calc(100vw - 24px); max-height: calc(100vh - 24px); overflow: auto; background: var(--pop); color: var(--ink); border-radius: 14px; box-shadow: var(--shadow); display: flex; flex-direction: column; outline: none; }
  .mc-head, .mc-foot { display: flex; align-items: center; gap: 8px; padding: 14px 18px; }
  .mc-head h2 { margin: 0; font-size: 17px; flex: 1; }
  .mc-foot { justify-content: flex-end; border-top: 1px solid var(--line); }
  .mc-body { display: flex; gap: 16px; padding: 0 18px 14px; flex-wrap: wrap; }
  .mc-stage { position: relative; max-width: 100%; display: grid; place-items: center; background: var(--chip); border-radius: 10px; overflow: hidden; flex-shrink: 0; }
  .mc-drop { display: flex; flex-direction: column; align-items: center; gap: 8px; border: 2px dashed var(--line); border-radius: 12px; background: none; color: var(--ink); padding: 40px; max-width: 360px; text-align: center; }
  .mc-drop span { color: var(--muted); font-size: 13px; line-height: 1.5; }
  .mc-drop:hover { border-color: var(--accent); }
  .mc-pic { position: relative; }
  .mc-pic img { position: absolute; inset: 0; width: 100%; height: 100%; user-select: none; }
  .mc-mask { opacity: .35; mix-blend-mode: multiply; pointer-events: none; }
  .mc-pic svg { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; outline: none; overflow: visible; }
  .mc-quad { fill: color-mix(in srgb, var(--accent) 22%, transparent); stroke: var(--accent); }
  .mc-h { fill: #fff; stroke: var(--accent); cursor: grab; }
  .mc-h.on { fill: var(--accent); }
  .mc-loupe { position: absolute; left: 10px; top: 10px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 2px 10px rgba(0,0,0,.4); background-repeat: no-repeat; pointer-events: none; }
  .mc-loupe i { position: absolute; left: 50%; top: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px; border: 1.5px solid var(--accent); border-radius: 50%; }
  .mc-loupe small { position: absolute; top: calc(100% + 6px); left: 50%; transform: translateX(-50%); white-space: nowrap; background: rgba(0,0,0,.7); color: #fff; font-size: 11px; padding: 2px 6px; border-radius: 4px; }
  .mc-side { flex: 1; min-width: 240px; }
  .cr-f { display: flex; flex-direction: column; gap: 4px; font-size: 13px; font-weight: 600; }
  .cr-f small { color: var(--muted); font-weight: 400; }
  .cr-in { height: 36px; border: 1px solid var(--line); border-radius: 8px; background: var(--field); color: var(--ink); padding: 0 10px; font: inherit; font-weight: 400; }
  .mc-pv { position: relative; background: var(--chip); border-radius: 8px; overflow: hidden; }
  .mc-pv canvas { width: 100%; height: auto; display: block; }
  .mc-pv .dp-spin { position: absolute; right: 8px; top: 8px; }
  @media (max-width: 767px) { .mc-stage { width: 100% !important; height: 60vw !important; } .mc { width: 100vw; max-width: 100vw; max-height: 100vh; border-radius: 0; } }
</style>
