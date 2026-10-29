<script lang="ts">
  import './panels.css';
  import type { Doc, TextElement } from '@digital-canvas/scene';
  import type { EditorState } from '../../lib/editor.svelte.ts';
  import Icon from '../../lib/Icon.svelte';
  import { fetchIcon } from '../../lib/stock.ts';
  import { brand } from '../../lib/brand.svelte.ts';
  import { place } from '../../lib/tools.ts';
  import { text as textEl } from '@digital-canvas/scene';
  import { insertDesign, pageIsEmpty, type InsertMode } from '../../lib/templates.ts';
  import { WRITE_ACTIONS, describePage, designForMe, magicWrite, resolveIcons, type WriteAction } from '../../lib/ai.ts';
  import { aiSettings } from '../../lib/ai/settings.svelte.ts';
  import { STYLES, studio } from '../../lib/ai/media.svelte.ts';
  import { kieDurations } from '../../lib/ai/kie.ts';
  import { SORA_SECONDS } from '../../lib/ai/openai.ts';
  import type { Task } from '../../lib/ai/types.ts';
  import InsertDialog from './InsertDialog.svelte';
  import AIProviders from './AIProviders.svelte';

  let { ed }: { ed: EditorState } = $props();

  let showSettings = $state(false);
  const hasAny = $derived(aiSettings.any);
  type Mode = 'design' | 'write' | 'describe' | 'image' | 'video';
  let mode = $state<Mode>(studio.tab);
  $effect(() => { studio.tab = mode; });
  const TASK: Record<Mode, Task> = { design: 'design', write: 'writing', describe: 'vision', image: 'image', video: 'video' };
  const using = $derived(aiSettings.describe(TASK[mode]));
  const ready = $derived(!!aiSettings.choice(TASK[mode]));
  let busy = $state(false);
  let error = $state('');

  // ---- design for me ----
  let prompt = $state('');
  let warnings = $state<string[]>([]);
  let pending = $state.raw<Doc | null>(null);
  const IDEAS = ['Instagram post for a monsoon sale at a saree shop, 40% off', 'Poster for a weekend jazz night at a rooftop café', 'Slide: our Q3 results — revenue up 18%, 3 key wins', 'Birthday wishes for my sister Aanya, playful and pink'];
  function brandHint(): string {
    const parts: string[] = [];
    if (brand.colors.length) parts.push(`Use these brand colours: ${brand.colors.slice(0, 6).join(', ')}.`);
    const f = brand.kit.fonts;
    if (f.heading) parts.push(`Headline font: ${f.heading.fontFamily}.`);
    if (f.body) parts.push(`Body font: ${f.body.fontFamily}.`);
    return parts.join(' ');
  }
  async function generate(): Promise<void> {
    if (!prompt.trim()) return;
    busy = true;
    error = '';
    warnings = [];
    try {
      const r = await designForMe(prompt, { width: ed.doc.width, height: ed.doc.height }, brandHint());
      const doc = await resolveIcons(r.doc, r.icons, fetchIcon);
      warnings = r.warnings;
      if (pageIsEmpty(ed)) await insertDesign(ed, doc, 'replace');
      else pending = doc;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
  async function pick(m: InsertMode): Promise<void> {
    const d = pending;
    pending = null;
    if (d) { busy = true; try { await insertDesign(ed, d, m); } finally { busy = false; } }
  }

  // ---- magic write ----
  const sel = $derived(ed.selected.find((e): e is TextElement => e.type === 'text') ?? null);
  let lang = $state('Hindi');
  let custom = $state('');
  let result = $state<{ id: string | null; text: string; action: WriteAction } | null>(null);
  async function write(action: WriteAction): Promise<void> {
    busy = true;
    error = '';
    try {
      const out = await magicWrite(sel?.text ?? '', action, action === 'translate' ? lang : custom);
      result = { id: sel?.id ?? null, text: out, action };
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
  function useResult(): void {
    if (!result) return;
    if (result.id && ed.doc.pages.some((p) => p.elements.some((e) => e.id === result!.id))) {
      ed.setText(result.id, result.text);
      ed.seal();
      ed.refitText();
    } else addAsText(result.text);
    result = null;
  }
  function addAsText(value: string): void {
    const size = Math.round(Math.max(14, Math.min(ed.doc.width, ed.doc.height) / 40));
    let t = textEl(value, { x: 0, y: 0, w: ed.doc.width * 0.7, h: 10 }, { fontSize: size });
    t = { ...t, h: ed.renderer.textHeight(t), x: ed.doc.width * 0.15 };
    t.y = (ed.doc.height - t.h) / 2;
    place(ed, [t]);
  }

  // ---- describe ----
  let alt = $state('');
  let copied = $state(false);
  async function describe(): Promise<void> {
    busy = true;
    error = '';
    alt = '';
    try {
      const png = ed.exportPage(ed.pageId, 'png', Math.min(1, 1024 / Math.max(ed.doc.width, ed.doc.height)));
      alt = await describePage(png, ed.page, ed.doc);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
  function saveToNotes(): void {
    const notes = ed.page.notes ? `${ed.page.notes}\n\nAlt text: ${alt}` : `Alt text: ${alt}`;
    ed.updatePage({ notes });
    ed.seal();
  }

  // ---- generate image / video ----
  type Aspect = 'page' | '1:1' | '4:5' | '9:16' | '16:9';
  let mediaPrompt = $state('');
  let style = $state('');
  let aspectSel = $state<Aspect>('page');
  let count = $state(1);
  let duration = $state(5);
  let fromImage = $state(true);
  const aspect = $derived(aspectSel === 'page' ? { w: ed.doc.width, h: ed.doc.height } : (([w, h]) => ({ w, h }))(aspectSel.split(':').map(Number) as [number, number]));
  const selImage = $derived(ed.selected.find((e) => e.type === 'image') as { asset: string } | undefined);
  const videoChoice = $derived(aiSettings.choice('video'));
  const durations = $derived.by(() => {
    const c = videoChoice;
    const kind = c ? aiSettings.get(c.provider)?.kind : undefined;
    if (kind === 'openai') return SORA_SECONDS;
    if (kind === 'kie') return kieDurations(c!.model) ?? [5, 10];
    return [4, 6, 8, 10];
  });
  $effect(() => { if (!durations.includes(duration)) duration = durations[0]!; });
  const ratioLabel = $derived.by(() => {
    const r = ed.doc.width / ed.doc.height;
    return Math.abs(r - 1) < 0.05 ? 'square' : r > 1 ? 'landscape' : 'portrait';
  });
  const jobs = $derived(studio.jobs.filter((j) => j.kind === mode));
  const results = $derived(studio.results.filter((r) => r.kind === mode));
  async function makeImages(): Promise<void> {
    if (!mediaPrompt.trim()) return;
    error = '';
    studio.generateImages({ prompt: mediaPrompt, style, aspect, count }).catch((e) => (error = e instanceof Error ? e.message : String(e)));
  }
  async function makeVideo(): Promise<void> {
    if (!mediaPrompt.trim()) return;
    error = '';
    const img = fromImage && selImage ? { bytes: ed.assets.get(selImage.asset), mime: ed.doc.assets[selImage.asset]?.mime ?? 'image/png' } : null;
    studio.generateVideo({ prompt: mediaPrompt, aspect, duration, ...(img?.bytes ? { image: { bytes: img.bytes, mime: img.mime } } : {}) }).catch((e) => (error = e instanceof Error ? e.message : String(e)));
  }
  function dragResult(e: DragEvent, id: string): void {
    e.dataTransfer?.setData('application/x-digital-canvas', JSON.stringify({ kind: 'ai', id }));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  }
</script>

<div class="dp" data-testid="ai-panel">
  <div class="hero">
    <span class="logo"><Icon name="ai" size={22} /></span>
    <div class="grow">
      <b>AI</b>
      <small data-testid="ai-using">{hasAny ? (using || 'No provider for this yet') + ' · your key' : 'Bring your own key: Claude, GPT, Gemini, OpenRouter, kie.ai…'}</small>
    </div>
    {#if hasAny}<button class="dp-link" title="AI providers" aria-label="AI providers" onclick={() => (showSettings = !showSettings)} data-testid="ai-settings"><Icon name="key" size={16} /></button>{/if}
  </div>

  {#if !hasAny || showSettings}
    <AIProviders ondone={() => (showSettings = false)} />
  {/if}

  {#if hasAny && !showSettings}
    <div class="dp-tabs tabs5" role="tablist" style="margin-top:12px">
      <button role="tab" class:on={mode === 'design'} onclick={() => (mode = 'design')} data-testid="ai-tab-design">Design</button>
      <button role="tab" class:on={mode === 'write'} onclick={() => (mode = 'write')} data-testid="ai-tab-write">Write</button>
      <button role="tab" class:on={mode === 'describe'} onclick={() => (mode = 'describe')} data-testid="ai-tab-describe">Alt text</button>
      <button role="tab" class:on={mode === 'image'} onclick={() => (mode = 'image')} data-testid="ai-tab-image">Image{#if studio.jobs.some((j) => j.kind === 'image' && !j.error)}<span class="dot"></span>{/if}</button>
      <button role="tab" class:on={mode === 'video'} onclick={() => (mode = 'video')} data-testid="ai-tab-video">Video{#if studio.jobs.some((j) => j.kind === 'video' && !j.error)}<span class="dot"></span>{/if}</button>
    </div>
    {#if !ready}<p class="dp-hint" data-testid="ai-not-ready">None of your providers can do this yet. <button class="dp-link inline" onclick={() => (showSettings = true)}>Add one</button>{mode === 'video' ? ' (OpenAI, Gemini or kie.ai)' : mode === 'image' ? ' (OpenAI, Gemini, OpenRouter or kie.ai)' : ''}.</p>{/if}
    {#if error}<p class="dp-err" data-testid="ai-error">{error}</p>{/if}

    {#if mode === 'design'}
      <form class="dp-stack" onsubmit={(e) => { e.preventDefault(); void generate(); }}>
        <textarea class="dp-textarea" placeholder="Describe the design you want…" bind:value={prompt} data-testid="ai-prompt" onkeydown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void generate(); }}></textarea>
        <button class="btn primary dp-cta" disabled={busy || !prompt.trim()} data-testid="ai-generate">
          {#if busy}<span class="dp-spin"></span> Designing…{:else}<Icon name="sparkle" size={16} /> Generate design{/if}
        </button>
      </form>
      <p class="dp-hint">Makes a {Math.round(ed.doc.width)}×{Math.round(ed.doc.height)} page you can edit like any other: text, shapes, icons and charts.{brand.colors.length ? ' Uses your brand colours.' : ''}</p>
      {#if warnings.length}<p class="dp-hint">Note: {warnings.join('; ')}.</p>{/if}
      <div class="dp-head"><h3>Try</h3></div>
      <div class="dp-list">
        {#each IDEAS as idea (idea)}<button class="dp-item idea" onclick={() => (prompt = idea)}><Icon name="sparkle" size={14} /> <span class="dp-tx">{idea}</span></button>{/each}
      </div>
    {:else if mode === 'write'}
      {#if sel}
        <div class="quote">{sel.text.slice(0, 220)}{sel.text.length > 220 ? '…' : ''}</div>
      {:else}
        <p class="dp-hint" style="margin-top:0">Select a text box to rewrite it — or describe what to write and add it as new text.</p>
      {/if}
      {#if sel}
        <div class="actions">
          {#each WRITE_ACTIONS as a (a.id)}<button class="dp-chip" disabled={busy} onclick={() => write(a.id)} data-testid="ai-write-{a.id}">{a.label}</button>{/each}
        </div>
        <div class="dp-row" style="margin-top:8px">
          <select class="input grow" bind:value={lang} aria-label="Language">
            {#each ['Hindi', 'Marathi', 'Gujarati', 'Tamil', 'Telugu', 'Bengali', 'Kannada', 'Malayalam', 'Punjabi', 'Urdu', 'English', 'Spanish', 'French', 'German', 'Portuguese', 'Arabic', 'Japanese', 'Chinese (Simplified)'] as l}<option>{l}</option>{/each}
          </select>
          <button class="btn" disabled={busy} onclick={() => write('translate')} data-testid="ai-write-translate"><Icon name="globe" size={16} /> Translate</button>
        </div>
      {/if}
      <form class="dp-row" style="margin-top:8px" onsubmit={(e) => { e.preventDefault(); if (custom.trim()) void write('custom'); }}>
        <input class="input grow" placeholder={sel ? 'Or say how to change it…' : 'e.g. a catchy tagline for a bakery'} bind:value={custom} data-testid="ai-write-custom" />
        <button class="btn icon" disabled={busy || !custom.trim()} aria-label="Write"><Icon name="send" size={16} /></button>
      </form>
      {#if busy}<p class="dp-hint"><span class="dp-spin"></span> Writing…</p>{/if}
      {#if result}
        <div class="dp-box dp-stack" style="margin-top:12px" data-testid="ai-write-result">
          <div class="out">{result.text}</div>
          <div class="dp-row">
            <button class="btn primary grow" onclick={useResult} data-testid="ai-write-use">{result.id ? 'Replace text' : 'Add to page'}</button>
            {#if result.id}<button class="btn" onclick={() => { addAsText(result!.text); result = null; }}>Add as new</button>{/if}
            <button class="btn icon" title="Try again" aria-label="Try again" disabled={busy} onclick={() => write(result!.action)}><Icon name="redo" size={16} /></button>
          </div>
        </div>
      {/if}
    {:else if mode === 'describe'}
      <p class="dp-hint" style="margin-top:0">The AI looks at page {ed.pageIndex + 1} and writes alt text for it, for screen readers and social posts.</p>
      <button class="btn primary dp-cta" style="margin-top:10px" disabled={busy} onclick={describe} data-testid="ai-describe">
        {#if busy}<span class="dp-spin"></span> Looking…{:else}<Icon name="eye" size={16} /> Describe this page{/if}
      </button>
      {#if alt}
        <div class="dp-box dp-stack" style="margin-top:12px" data-testid="ai-alt">
          <div class="out">{alt}</div>
          <div class="dp-row">
            <button class="btn grow" onclick={async () => { await navigator.clipboard?.writeText(alt).catch(() => {}); copied = true; setTimeout(() => (copied = false), 1500); }}>{copied ? 'Copied' : 'Copy'}</button>
            <button class="btn grow" onclick={saveToNotes} data-testid="ai-alt-notes">Save to page notes</button>
          </div>
        </div>
      {/if}
    {:else}
      <form class="dp-stack" onsubmit={(e) => { e.preventDefault(); void (mode === 'image' ? makeImages() : makeVideo()); }}>
        <textarea class="dp-textarea" placeholder={mode === 'image' ? 'Describe the picture you want…' : selImage && fromImage ? 'How should the selected picture move?' : 'Describe the video clip you want…'} bind:value={mediaPrompt} data-testid="ai-media-prompt"></textarea>
        {#if mode === 'image'}
          <div class="dp-chips" role="radiogroup" aria-label="Style">
            {#each STYLES as st (st.id)}<button type="button" class="dp-chip" class:on={style === st.id} onclick={() => (style = st.id)} data-testid="ai-style-{st.id || 'none'}">{st.label}</button>{/each}
          </div>
        {:else if selImage}
          <label class="dp-row check"><input type="checkbox" bind:checked={fromImage} data-testid="ai-video-from-image" /> Start from the selected picture</label>
        {/if}
        <div class="dp-row">
          <select class="input grow" bind:value={aspectSel} aria-label="Shape" data-testid="ai-media-aspect">
            <option value="page">Page shape ({ratioLabel})</option>
            <option value="1:1">Square 1:1</option><option value="4:5">Portrait 4:5</option><option value="9:16">Story 9:16</option><option value="16:9">Wide 16:9</option>
          </select>
          {#if mode === 'image'}
            <select class="input small" bind:value={count} aria-label="How many" data-testid="ai-image-count">{#each [1, 2, 3, 4] as n}<option value={n}>{n}×</option>{/each}</select>
          {:else}
            <select class="input small" bind:value={duration} aria-label="Length" data-testid="ai-video-duration">{#each durations as d}<option value={d}>{d} s</option>{/each}</select>
          {/if}
        </div>
        <button class="btn primary dp-cta" disabled={!ready || !mediaPrompt.trim()} data-testid="ai-media-generate"><Icon name={mode === 'image' ? 'image' : 'video'} size={16} /> Generate {mode === 'image' ? (count > 1 ? `${count} images` : 'image') : 'video'}</button>
      </form>
      <p class="dp-hint">{mode === 'video' ? 'Videos take a few minutes. Keep editing: it carries on and lands here.' : 'Click a result to add it, or drag it onto the page.'} Results are saved to your Uploads.</p>
      {#each jobs as j (j.id)}
        <div class="dp-box job" data-testid="ai-job">
          <div class="dp-row"><span class="grow tx">{j.prompt}</span><button class="dp-link" onclick={() => (j.error ? studio.cancel(j.id) : studio.cancel(j.id))} aria-label={j.error ? 'Dismiss' : 'Cancel'}><Icon name="close" size={14} /></button></div>
          {#if j.error}<p class="dp-err" style="margin:0" data-testid="ai-job-error">{j.error}</p>
          {:else}
            <div class="bar" class:indet={j.progress.fraction === null}><i style:width={j.progress.fraction === null ? '35%' : `${Math.round(j.progress.fraction * 100)}%`}></i></div>
            <small class="dp-hint">{j.progress.message} · {j.label}</small>
          {/if}
        </div>
      {/each}
      {#if results.length}
        <div class="dp-grid two" style="margin-top:10px">
          {#each results as r (r.id)}
            <div class="tile">
              <button class="tile-btn" draggable="true" ondragstart={(e) => dragResult(e, r.id)} onclick={() => studio.insert(ed, r.id)} title={r.ai.prompt} data-testid="ai-result">
                {#if r.kind === 'image'}<img src={r.url} alt={r.ai.prompt} />{:else}<video src={r.url} muted loop playsinline onmouseenter={(e) => (e.currentTarget as HTMLVideoElement).play()} onmouseleave={(e) => (e.currentTarget as HTMLVideoElement).pause()}></video>{/if}
              </button>
              <button class="x" aria-label="Remove from this list" onclick={() => studio.dismiss(r.id)}><Icon name="close" size={12} /></button>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  {/if}
</div>

{#if pending}
  <InsertDialog title="your AI design" oncancel={() => (pending = null)} onpick={pick} />
{/if}

<style>
  .hero { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .hero .logo { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; color: #fff; background: conic-gradient(from 200deg, #00c4cc, #7d2ae8, #ff66c4, #00c4cc); flex-shrink: 0; }
  .hero b { display: block; font-size: 17px; }
  .hero small { color: var(--muted); font-size: 12px; }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .quote { border-left: 3px solid var(--accent); padding: 6px 10px; background: var(--chip); border-radius: 0 8px 8px 0; font-size: 13px; line-height: 1.45; white-space: pre-wrap; }
  .out { white-space: pre-wrap; font-size: 14px; line-height: 1.5; }
  .idea { font-size: 13px; color: var(--ink-2); }
  .idea .dp-tx { white-space: normal; }
  select.input { height: 34px; }
  .grow { flex: 1; min-width: 0; }
  .tabs5 button { padding: 10px 7px; position: relative; white-space: nowrap; }
  select.small { width: 76px; flex: none; }
  .dot { position: absolute; top: 7px; right: 1px; width: 6px; height: 6px; border-radius: 3px; background: var(--accent); }
  .inline { padding: 0; color: var(--accent); }
  .check { font-size: 13px; gap: 6px; }
  .job { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
  .job .tx { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar { height: 6px; border-radius: 3px; background: var(--chip); overflow: hidden; }
  .bar i { display: block; height: 100%; background: var(--accent); border-radius: 3px; transition: width .3s; }
  .bar.indet i { animation: indet 1.4s ease-in-out infinite; }
  @keyframes indet { 0% { margin-left: -35%; } 100% { margin-left: 100%; } }
  .tile { position: relative; }
  .tile-btn { display: block; width: 100%; padding: 0; border: 0; border-radius: 8px; overflow: hidden; background: var(--chip); aspect-ratio: 1; cursor: grab; }
  .tile-btn img, .tile-btn video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .tile .x { position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; border-radius: 11px; border: 0; background: rgba(0,0,0,.55); color: #fff; display: none; place-items: center; padding: 0; }
  .tile:hover .x { display: grid; }
</style>
