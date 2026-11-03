<script lang="ts">
  /**
   * Make or edit a font plugin: upload its faces (TTF, OTF, WOFF, WOFF2; WOFF
   * is made plain), family / weight / italic read from the files, and a
   * licence note. The font then shows under "My fonts" in the font list.
   */
  import '../panels.css';
  import { parsePlugin, type FontFace, type FontPlugin } from '@digital-canvas/scene';
  import type { EditorState } from '../../../lib/editor.svelte.ts';
  import Icon from '../../../lib/Icon.svelte';
  import { FONT_ACCEPT, addCssFace } from '../../../lib/fonts.ts';
  import { pickFiles } from '../../../lib/files.ts';
  import { toast } from '../../../lib/toast.svelte.ts';
  import { plugins } from '../../../lib/plugins/plugins.svelte.ts';
  import { fontInfo, fontMime, toSfnt } from '../../../lib/plugins/render-bridge.ts';

  let { ed, plugin, onclose }: { ed: EditorState; plugin?: FontPlugin; onclose: () => void } = $props();

  // svelte-ignore state_referenced_locally
  const start = plugin;
  let name = $state(start?.name ?? '');
  let family = $state(start?.family ?? '');
  let license = $state(start?.license ?? '');
  let faces = $state<(FontFace & { file?: string })[]>(start ? structuredClone(start.faces) : []);
  let error = $state('');
  let dragging = $state(false);
  /** CSS family for the previews (one per face set, so edits show at once). */
  const cssFamily = `dcpl-font-${Math.random().toString(36).slice(2, 8)}`;

  const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  const WEIGHT_NAMES: Record<number, string> = { 100: 'Thin', 200: 'Extra light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black' };

  // existing faces: load for the preview
  if (start) for (const f of start.faces) void plugins.asset(f.asset).then((b) => { if (b) addCssFace(cssFamily, `${cssFamily}:${f.asset}`, toSfnt(b), f.weight, f.italic); });

  async function addFiles(files: File[]): Promise<void> {
    error = '';
    for (const file of files) {
      const raw = new Uint8Array(await file.arrayBuffer());
      if (!fontMime(raw)) { error = `${file.name} is not a font file (TTF, OTF, WOFF, WOFF2).`; continue; }
      const bytes = toSfnt(raw);
      const mime = fontMime(bytes)!;
      const info = fontInfo(bytes, ed.engine.ck);
      const asset = await plugins.addFile(bytes, mime);
      if (faces.some((f) => f.asset === asset)) continue;
      const weight = Math.min(900, Math.max(100, Math.round((info?.weight ?? 400) / 100) * 100));
      faces = [...faces, { asset, mime, weight, italic: info?.italic ?? /italic/i.test(file.name), file: file.name }];
      if (!family && info?.family) family = info.family;
      if (!family) family = file.name.replace(/[-_ ]?(regular|bold|italic|light|medium|black|thin)*\.[^.]+$/i, '');
      if (!name) name = family;
      addCssFace(cssFamily, `${cssFamily}:${asset}`, bytes, weight, faces[faces.length - 1]!.italic);
    }
  }
  async function upload(): Promise<void> {
    await addFiles(await pickFiles(FONT_ACCEPT, true, 'files'));
  }
  function onDrop(e: DragEvent): void {
    dragging = false;
    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => /\.(ttf|otf|woff2?)$/i.test(f.name));
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    void addFiles(files);
  }
  const setFace = (i: number, patch: Partial<FontFace>) => (faces = faces.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  const canUse = $derived(ed.selected.some((e) => e.type === 'text'));
  let saving = $state(false);
  async function save(apply = false): Promise<void> {
    saving = true;
    try {
      const p = parsePlugin({
        ...(start ?? {}), kind: 'font', name: name.trim() || family.trim() || 'My font', family: family.trim() || name.trim(),
        faces: faces.map(({ asset, mime, weight, italic }) => ({ asset, mime, weight, italic })), license: license.trim() || undefined,
      }) as FontPlugin;
      const saved = await plugins.save(p) as FontPlugin;
      if (apply) await plugins.useFont(ed, saved);
      toast.show(`“${saved.name}” is in your fonts`);
      onclose();
    } catch (e) {
      toast.show(`Couldn't save: ${e instanceof Error ? e.message : e}`);
    } finally {
      saving = false;
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="dp cr" class:drag={dragging} data-testid="font-creator" ondragover={(e) => { e.preventDefault(); dragging = true; }} ondragleave={() => (dragging = false)} ondrop={onDrop}>
  <button class="dp-back" onclick={onclose}><Icon name="left" size={16} /> {start ? 'Edit font' : 'New font'}</button>

  <button class="btn dp-cta" data-testid="font-plugin-upload" onclick={upload}><Icon name="upload" size={16} /> Upload font files</button>
  <p class="dp-hint">TTF, OTF, WOFF or WOFF2: one file per weight and style. You can drop them here.</p>
  {#if error}<p class="dp-err">{error}</p>{/if}

  {#if faces.length}
    <div class="fc-pv" style="font-family:'{cssFamily}', Inter" data-testid="font-plugin-preview">
      {#each faces as f (f.asset)}<p style="font-weight:{f.weight};font-style:{f.italic ? 'italic' : 'normal'}">The quick brown fox jumps</p>{/each}
    </div>
    <label class="cr-f"><span>Family</span><input class="cr-in" bind:value={family} maxlength="80" data-testid="font-plugin-family" /></label>
    <label class="cr-f"><span>Name in your plugins</span><input class="cr-in" bind:value={name} maxlength="80" data-testid="font-plugin-name" /></label>
    <div class="dp-head"><h3>Faces · {faces.length}</h3></div>
    <div class="dp-list">
      {#each faces as f, i (f.asset)}
        <div class="fc-face" data-testid="font-face-{i}">
          <span class="fc-file" title={f.file ?? f.asset}>{f.file ?? `${WEIGHT_NAMES[f.weight] ?? f.weight}${f.italic ? ' italic' : ''}`}</span>
          <select value={f.weight} aria-label="Weight" onchange={(e) => setFace(i, { weight: Number((e.currentTarget as HTMLSelectElement).value) })}>
            {#each WEIGHTS as w (w)}<option value={w}>{w} {WEIGHT_NAMES[w]}</option>{/each}
          </select>
          <label class="cr-chk"><input type="checkbox" checked={f.italic} onchange={(e) => setFace(i, { italic: (e.currentTarget as HTMLInputElement).checked })} /> Italic</label>
          <button class="btn ghost icon" aria-label="Remove face" onclick={() => (faces = faces.filter((_, j) => j !== i))}><Icon name="close" size={12} /></button>
        </div>
      {/each}
    </div>
    <label class="cr-f"><span>Licence</span><textarea class="dp-textarea" rows="2" bind:value={license} maxlength="200" placeholder="e.g. SIL Open Font License 1.1, or “My own font”" data-testid="font-plugin-license"></textarea></label>
    <p class="dp-hint">Designs that use the font embed its files, so make sure its licence lets you share them.</p>
  {/if}

  <div class="cr-acts">
    <button class="btn primary grow" disabled={!faces.length || saving} data-testid="font-plugin-save" onclick={() => save(false)}>Save</button>
    <button class="btn grow" disabled={!faces.length || saving || !canUse} data-testid="font-plugin-save-apply" onclick={() => save(true)}>Save and use</button>
  </div>
</div>

<style>
  .cr { gap: 10px; position: relative; }
  .cr.drag { outline: 2px dashed var(--accent); outline-offset: 4px; border-radius: 8px; }
  .cr-f { display: flex; flex-direction: column; gap: 4px; font-size: 13px; font-weight: 600; }
  .cr-in { height: 36px; border: 1px solid var(--line); border-radius: 8px; background: var(--field); color: var(--ink); padding: 0 10px; font: inherit; font-weight: 400; }
  .fc-pv { background: var(--chip); border-radius: 8px; padding: 8px 12px; font-size: 20px; }
  .fc-pv p { margin: 4px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fc-face { display: flex; align-items: center; gap: 6px; padding: 4px 0; font-size: 12px; }
  .fc-file { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fc-face select { height: 28px; border: 1px solid var(--line); border-radius: 6px; background: var(--field); color: var(--ink); font-size: 12px; }
  .cr-chk { display: flex; align-items: center; gap: 4px; font-size: 12px; }
  .cr-acts { display: flex; gap: 8px; margin-top: 4px; }
  .cr-acts .grow { flex: 1; height: 38px; justify-content: center; }
</style>
